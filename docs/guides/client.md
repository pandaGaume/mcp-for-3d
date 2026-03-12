# MCP Client

The MCP client allows an in-browser agent (e.g. a robot in a swarm) to connect
to another MCP server and consume its resources and tools programmatically. This
is the counterpart to `McpServer` — where the server **exposes** scene objects,
the client **consumes** them.

**Package:** `@dev/core`
**Class:** `McpClient`
**Interface:** `IMcpClient`

---

## Overview

```
McpServer (robot_1)  ◄──  IMessageTransport  ──►  McpClient (robot_2)
                              │
                              ├── DirectTransport      (cross-page, via tunnel)
                              ├── MultiplexTransport   (cross-page, shared socket)
                              └── LoopbackTransport    (same page, zero network)
```

| Transport           | Use case                                      | Latency    |
| ------------------- | --------------------------------------------- | ---------- |
| `DirectTransport`   | Client connects to a remote server via tunnel  | Network    |
| `MultiplexTransport`| Client connects via shared multiplexed socket  | Network    |
| `LoopbackTransport` | Client and server in the same page             | Microtask  |

---

## Quick start — Loopback (same page)

When both the server and client live in the same page, use `LoopbackTransport`
for zero-network communication.

```typescript
import {
    McpClient, McpServerBuilder, LoopbackTransport,
    McpCameraBehavior, McpCameraAdapter
} from "@dev/core";

// 1. Create an in-process transport pair
const [serverEnd, clientEnd] = LoopbackTransport.createPair();

// 2. Build and start the server on one end
const adapter  = new McpCameraAdapter(scene, robot1Camera);
const behavior = new McpCameraBehavior(adapter);
const server   = new McpServerBuilder()
    .withName("robot_1")
    .withTransport(serverEnd)
    .register(behavior)
    .build();
await server.start();

// 3. Connect a client on the other end
const client = new McpClient({ name: "robot_2", version: "1.0.0" }, clientEnd);
await client.connect();

// 4. Use standard MCP operations
const tools  = await client.listTools();
const result = await client.callTool("camera_set_target", {
    uri: "babylon://camera/robot1Cam",
    target: { x: 0, y: 5, z: 0 }
});
```

---

## Quick start — Tunnel (cross-page)

When the server runs in a different page (or a different machine), use
`DirectTransport` through the WebSocket tunnel.

```typescript
import { McpClient, DirectTransport } from "@dev/core";

const transport = new DirectTransport("ws://localhost:3000/robot_1");
const client    = new McpClient({ name: "robot_2", version: "1.0.0" }, transport);
await client.connect();

console.log(client.serverInfo?.name); // "robot_1"

const resources = await client.listResources();
const camera    = await client.readResource("babylon://camera/robot1Cam");
```

---

## IMcpClient interface

```typescript
interface IMcpClient {
    readonly name: string;
    readonly isConnected: boolean;
    readonly serverInfo: McpServerInfo | undefined;

    connect(): Promise<McpInitializeResult>;
    disconnect(): void;

    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    readResource(uri: string): Promise<McpResourceContent>;

    listTools(): Promise<McpTool[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;

    onResourcesChanged: IEventSource<void> | null;
    onToolsChanged: IEventSource<void> | null;
}
```

---

## McpClient constructor

```typescript
new McpClient(clientInfo: McpClientInfo, transport: IMessageTransport, timeoutMs?: number)
```

| Parameter    | Type                | Default   | Description                                     |
| ------------ | ------------------- | --------- | ----------------------------------------------- |
| `clientInfo` | `McpClientInfo`     | —         | `{ name, version }` sent during the handshake   |
| `transport`  | `IMessageTransport` | —         | Any transport (Direct, Multiplex, Loopback, ...) |
| `timeoutMs`  | `number`            | `30 000`  | Timeout for individual JSON-RPC requests         |

---

## Lifecycle

### `connect()`

1. Wires the transport callbacks (`onMessage`, `onOpen`, `onClose`, `onError`)
2. Opens the transport (calls `connect()` or `activate()` depending on type)
3. Sends an `initialize` JSON-RPC request with `{ clientInfo, capabilities: {} }`
4. Waits for the server's response — stores `serverInfo` and `capabilities`
5. Sends a `notifications/initialized` notification
6. Resolves with `McpInitializeResult`

### `disconnect()`

1. Rejects all pending requests with an error
2. Closes the transport
3. Clears event subscriptions

---

## Notifications

The client listens for server-initiated notifications and re-emits them via
event sources:

| Server notification                       | Client event         |
| ----------------------------------------- | -------------------- |
| `notifications/resources/list_changed`    | `onResourcesChanged` |
| `notifications/tools/list_changed`        | `onToolsChanged`     |

```typescript
client.onResourcesChanged?.subscribe(() => {
    console.log("Server resource list changed — refreshing...");
    const resources = await client.listResources();
});
```

---

## LoopbackTransport

Creates a pair of `IMessageTransport` instances connected back-to-back
in-process. Messages sent on one end are delivered to the other's `onMessage`
callback via `queueMicrotask` (avoids synchronous re-entrancy while keeping
near-zero latency).

```typescript
const [serverEnd, clientEnd] = LoopbackTransport.createPair();
```

- Either side calling `connect()` opens **both** ends simultaneously
- Either side calling `close()` closes **both** ends
- No network, no serialization overhead beyond `JSON.stringify` / `JSON.parse`

### When to use

- Same-page robot-to-robot communication in a swarm
- Unit testing server behaviors without a tunnel
- Any scenario where both endpoints live in the same JavaScript context

---

## Swarm scenario

In a swarm of robots, each robot runs its own `McpServer` (addressable by
external clients via the multiplexing tunnel). Robots also need to communicate
with each other — robot_1 reading robot_2's camera, or calling a tool on
robot_3. This is where `McpClient` + `LoopbackTransport` fit:

```
                      ┌─ Tunnel ──────────────────────────────┐
 Claude / Inspector ──┤  ws://host/robot_1                    │
                      │  ws://host/robot_2                    │
                      │  ws://host/robot_3                    │
                      └───────────────────────────────────────┘

 Same page:
   robot_1.server ◄── loopback ──► robot_2.client  (robot_2 reads robot_1's camera)
   robot_2.server ◄── loopback ──► robot_3.client  (robot_3 calls tools on robot_2)
```

```typescript
// Robot 2 wants to read Robot 1's camera state
const [r1ServerEnd, r1ClientEnd] = LoopbackTransport.createPair();

// Robot 1's server uses one end
const r1Server = new McpServerBuilder()
    .withName("robot_1")
    .withTransport(r1ServerEnd)
    .register(r1CameraBehavior)
    .build();
await r1Server.start();

// Robot 2's client uses the other end
const r2Client = new McpClient({ name: "robot_2", version: "1.0.0" }, r1ClientEnd);
await r2Client.connect();

const r1Camera = await r2Client.readResource("babylon://camera/robot1Cam");
```

---

## Error handling

- If the transport closes unexpectedly, all pending requests are rejected with
  `"McpClient: transport closed"`
- If a request exceeds `timeoutMs`, it is rejected with a timeout error
- JSON-RPC errors from the server are surfaced as `Error` with the server's
  error code and message
