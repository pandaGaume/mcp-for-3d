# Transport Layer

The transport layer decouples `McpServer` from the raw WebSocket connection to
the tunnel. This allows different connection strategies depending on the
deployment scenario.

**Package:** `@dev/core`
**Interface:** `IMessageTransport`

---

## Overview

```
McpServer  ──>  IMessageTransport
                    ├── DirectTransport      (1 server : 1 WebSocket)
                    ├── MultiplexTransport   (N servers : 1 WebSocket)
                    └── LoopbackTransport    (in-process, no network)
```

| Transport            | Use case                                | WebSocket path     |
| -------------------- | --------------------------------------- | ------------------ |
| `DirectTransport`    | Single server per page (default)        | `/provider/<name>` |
| `MultiplexTransport` | Multiple servers sharing one connection | `/providers`       |

---

## DirectTransport (default)

Each `McpServer` opens its own dedicated WebSocket to the tunnel. This is the
original behaviour and remains the default when using `withWsUrl()`.

```typescript
const server = new McpServerBuilder().withName("scene").withWsUrl("ws://localhost:3000/provider/scene").register(cameraBehavior).build();

await server.start();
```

No transport configuration is needed — `DirectTransport` is created internally.

---

## MultiplexTransport

When a page hosts multiple `McpServer` instances, each would normally open its
own WebSocket. `MultiplexTransport` lets them share a single connection by
wrapping every JSON-RPC message in an envelope:

```json
{ "provider": "scene-1", "payload": { "jsonrpc": "2.0", ... } }
```

The tunnel strips/adds the envelope transparently. MCP clients (Claude, MCP
Inspector) connect to each provider by name as usual, they are unaware of the
multiplexing.

### Setup

```typescript
// Create transports — same wsUrl means same underlying WebSocket
const t1 = MultiplexTransport.create("scene-1", "ws://localhost:3000/providers");
const t2 = MultiplexTransport.create("scene-2", "ws://localhost:3000/providers");

// Build servers with their transports
const server1 = new McpServerBuilder().withName("scene-1").withTransport(t1).register(cameraBehavior1, meshBehavior1).build();

const server2 = new McpServerBuilder().withName("scene-2").withTransport(t2).register(cameraBehavior2).build();

await server1.start();
await server2.start();
```

### How it works

1. `MultiplexTransport.create(name, wsUrl)` returns a per-server transport and
   lazily opens a shared `MultiplexSocket` for the given URL.
2. When `server.start()` is called, the transport registers itself with the
   shared socket. If the WebSocket is not yet open, the first registration
   triggers the connection.
3. Outbound messages are wrapped in `{ provider, payload }` before sending.
   Inbound envelopes are unwrapped and routed to the correct transport by
   provider name.
4. Reconnection (with exponential back-off) is managed by the shared socket.
   Individual servers do not attempt their own reconnection.
5. When the last transport calls `close()`, the shared WebSocket is torn down.

### Tunnel configuration

The tunnel accepts multiplexed connections on `/providers` by default. This path
can be changed via the builder:

```typescript
const tunnel = new WsTunnelBuilder()
    .withPort(3000)
    .withProvidersPath("/providers") // default
    .build();
```

### Client access

MCP clients connect to each multiplexed provider exactly as they would a
direct provider — the tunnel routes by provider name:

| Client        | URL                             |
| ------------- | ------------------------------- |
| Claude (SSE)  | `GET /<providerName>/sse`       |
| Claude (POST) | `POST /<providerName>/messages` |
| MCP Inspector | `GET/POST /<providerName>/mcp`  |
| Raw WebSocket | `ws://host/<providerName>`      |

---

## IMessageTransport interface

The interface is intentionally minimal:

```typescript
interface IMessageTransport {
    send(data: string): void;
    onMessage: ((data: string) => void) | null;
    onOpen: (() => void) | null;
    onClose: (() => void) | null;
    onError: ((error: Error) => void) | null;
    readonly isOpen: boolean;
    close(): void;
}
```

Custom transports can be implemented for scenarios not covered by the built-in
ones (e.g. a `BroadcastChannel` transport for cross-tab communication). Pass
them to the builder via `withTransport()`.

---

## LoopbackTransport

An in-process transport pair for same-page server↔client communication. Messages
are delivered via `queueMicrotask` — near-zero latency, no network. Primarily
used with `McpClient` for robot-to-robot communication in swarm scenarios.

```typescript
const [serverEnd, clientEnd] = LoopbackTransport.createPair();

// Server side
const server = new McpServerBuilder()
    .withName("robot_1")
    .withTransport(serverEnd)
    .register(behavior)
    .build();
await server.start();

// Client side
const client = new McpClient({ name: "robot_2", version: "1.0.0" }, clientEnd);
await client.connect();
```

See [client.md](./client.md) for full usage details.

---

## Mixing direct and multiplexed servers

A single tunnel can serve both connection types simultaneously. Direct providers
connect to `/provider/<name>` and multiplexed providers connect to `/providers`.
Provider names must be unique across both types, if a name is already
registered via one mode, a second connection with the same name will be rejected.
