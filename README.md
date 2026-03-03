# MCP for Babylon

A **Model Context Protocol (MCP) server** that runs inside a Babylon.js scene and
exposes scene objects (meshes, lights, cameras, …) as MCP resources and tools.

This lets LLM clients — **MCP Inspector**, **Claude Code**, and others — inspect and
manipulate your Babylon.js scene in real time through a standard JSON-RPC interface.

---

## Architecture

```
MCP Inspector / Claude Code
        │
        │  POST /mcp   (Streamable HTTP, MCP 2025-03-26)
        │  GET  /sse   (SSE stream,      MCP 2024-11-05)
        │  POST /messages?sessionId=…
        ▼
┌─────────────────────────────┐
│      WsTunnel (Node.js)     │  packages/dev/tunnel
│  HTTP + WebSocket relay     │
└────────────┬────────────────┘
             │  ws://localhost:3000/provider
             ▼
┌─────────────────────────────┐
│  McpServer (browser page)   │  packages/host/www
│  Babylon.js dev harness     │
└─────────────────────────────┘
```

The **browser page** runs an `McpServer` instance (UMD bundles) that registers
Babylon.js scene objects as MCP resources with callable tools.  The **tunnel**
bridges HTTP/SSE MCP clients to the browser's WebSocket connection.

---

## Prerequisites

| Tool    | Version    |
|---------|------------|
| Node.js | ≥ 20.11.0 < 23.0.0 |
| npm     | ≥ 8.0.0    |
| Browser | Any modern (Chrome, Edge, Firefox) |

> **MCP Inspector** (optional, for interactive testing):
> ```
> npx @modelcontextprotocol/inspector
> ```

---

## Installation

Clone and install all workspace dependencies from the repo root:

```bash
git clone https://github.com/pandaGaume/mcp-for-babylon.git
cd mcp-for-babylon
npm install
```

---

## Build

Three steps are required before you can run the project:

### 1 — Compile TypeScript

Compiles all packages (`@dev/core`, `@dev/babylon`, `@dev/tunnel`) to their `dist/` directories:

```bash
npm run build:dev
```

For watch mode (auto-recompile on source changes):

```bash
npm run build:watch
```

### 2 — UMD browser bundles

Produces webpack bundles for both `@dev/core` and `@dev/babylon`:

```bash
# Production build (minified)
npm run bundle

# Development build (readable, with source maps)
npm run bundle:dev

# Watch mode — auto-rebuilds on source changes
npm run bundle:watch
```

Outputs:
- `packages/dev/core/bundle/mcp-server.js`
- `packages/dev/babylon/bundle/mcp-babylon.js`

### 3 — Deploy bundles to the dev harness

Copies all bundle files into `packages/host/www/bundle/`, which is the directory
served by the tunnel at `/bundle/`:

```bash
npm run deploy:bundles
```

### Build everything at once

```bash
# Development (recommended during active work)
npm run build:all:dev

# Production (minified)
npm run build:all
```

> **Tip — after changing TypeScript source**, always re-run `npm run build:all:dev`
> so the browser picks up your changes.

---

## Running the dev server

```bash
npm run server:start
```

This builds the tunnel and starts it.  You will see:

```
⚙️  MCP for Babylon — tunnel started
────────────────────────────────────────────────────────
📡  Provider     ws://localhost:3000/provider
🔌  MCP HTTP     http://localhost:3000/mcp   ← MCP Inspector
📺  MCP SSE      http://localhost:3000/sse   ← Claude Code
🖥️   Dev harness  http://localhost:3000/
────────────────────────────────────────────────────────
   Press Ctrl+C to stop.

🚀  Opening dev harness: http://localhost:3000/
```

The dev harness (`index.html`) opens automatically in your default browser.

> Set `MCP_TUNNEL_NO_OPEN=1` to suppress the automatic browser launch.

---

## Connecting the browser provider

1. The browser opens the **dev harness** at `http://localhost:3000/`.
2. Leave the default values in the **Connection** panel:
   - **Tunnel provider URL**: `ws://localhost:3000/provider`
   - **Server name**: `Babylon Dev Scene`
3. Click **▶ Start**.
4. The status badge changes to **Connected**.

The harness registers mock behaviors (BoxMesh, SphereMesh, Main Camera).
The left panel lists all registered resources and tools.

---

## Testing with MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the reference
interactive client for testing MCP servers.

### Start MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

MCP Inspector prints its own URL, e.g.:

```
🚀 MCP Inspector is up and running at: http://localhost:6274/
```

### Connect to the tunnel

1. Open MCP Inspector in your browser.
2. In the **Transport** dropdown, select **Streamable HTTP**.
3. Set the URL to:
   ```
   http://localhost:3000/mcp
   ```
4. Click **Connect**.

> Make sure the browser dev harness is already connected (status = **Connected**)
> before clicking Connect in MCP Inspector, otherwise you will receive
> `-32000 No provider connected`.

### Explore resources and tools

| Tab | MCP method | What you see |
|-----|-----------|--------------|
| **Resources** → List | `resources/list` | `mesh://scene/BoxMesh`, `mesh://scene/SphereMesh`, `camera://scene/main` |
| **Resources** → Templates | `resources/templates/list` | `mesh://scene/{meshName}`, `camera://scene/{cameraId}` |
| **Resources** → Read | `resources/read` | JSON state for a specific mesh or camera |
| **Tools** → List | `tools/list` | mesh tools + camera tools (see below) |
| **Tools** → Call | `tools/call` | Execute a tool on a specific instance via its URI |

### Example tool call — move BoxMesh

In the **Tools** tab, select `set_position` and pass:

```json
{
  "uri": "mesh://scene/BoxMesh",
  "x": 2,
  "y": 1,
  "z": 0
}
```

The browser log panel will show:

```
✔  BoxMesh.position ← (2, 1, 0)
```

---

## Testing with Claude Code

Add the tunnel as an MCP server in your Claude Code settings.

### Option A — SSE transport (2024-11-05, recommended for Claude Code)

Edit `~/.claude/settings.json` (or open **Settings → MCP Servers**):

```json
{
  "mcpServers": {
    "babylon": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

### Option B — Streamable HTTP transport (2025-03-26)

```json
{
  "mcpServers": {
    "babylon": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Code, then verify the server appears under `/mcp` or in the
status bar.  You can now ask Claude to inspect or move scene objects:

> "List all the resources available in the Babylon scene."
> "Move BoxMesh to position (3, 0, -2)."
> "Smoothly animate the camera to look at the sphere over 2 seconds."

---

## Camera tools reference

The `@dev/babylon` package exposes a rich set of camera tools.  All coordinates
are world-space, **right-handed, y-axis up**.  Every tool requires a `uri`
argument (e.g. `babylon://camera/MyCamera`) to identify the target camera.

### Immediate tools

| Tool | Description |
|------|-------------|
| `camera_set_target` | Set the look-at point (`TargetCamera.setTarget`). |
| `camera_set_position` | Teleport the camera to an absolute world-space position. |
| `camera_look_at` | Move the camera and set its look-at target in one call. |
| `camera_orbit` | Rotate around the current target by `deltaAlpha` / `deltaBeta` (degrees). |
| `camera_set_fov` | Set the vertical field of view (degrees or radians). |
| `camera_zoom` | Relative zoom: `factor < 1` zooms in, `factor > 1` zooms out. |
| `camera_set_projection` | Switch between `"perspective"` and `"orthographic"` projection. |
| `camera_dolly` | Push/pull the camera along the view axis (affects parallax & DoF). |
| `camera_pan` | Slide the camera and target together perpendicular to the view axis. |
| `camera_lock` | Detach user input — cinematic lock. |
| `camera_unlock` | Re-attach user input after a cinematic lock. |
| `camera_snapshot` | Capture a frame as a base64-encoded PNG (any resolution). |

### Animation tools

| Tool | Description |
|------|-------------|
| `camera_animate_to` | Smoothly fly to a new position, target, and/or FOV over time. |
| `camera_animate_orbit` | Smooth orbit sweep; supports continuous `loop` mode. |
| `camera_follow_path` | Move the camera through an ordered sequence of waypoints. |
| `camera_shake` | Procedural trauma shake with intensity, duration, and frequency. |
| `camera_stop_animation` | Stop any currently running animation, freezing the camera in place. |

#### Easing format

Animation tools accept an optional `easing` string:

```
'<type>'          →  e.g. 'sine'           (defaults to inout mode)
'<type>.<mode>'   →  e.g. 'elastic.out'
```

**Types:** `linear` | `sine` | `quad` | `cubic` | `circle` | `expo` | `back` | `bounce` | `elastic`
**Modes:** `in` | `out` | `inout` (default)

---

## Environment variables

All variables are optional; the defaults work out-of-the-box for a local dev setup.

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TUNNEL_PORT` | `3000` | TCP port for the tunnel HTTP server |
| `MCP_TUNNEL_HOST` | `0.0.0.0` | Bind address |
| `MCP_TUNNEL_PROVIDER_PATH` | `/provider` | WebSocket path for the browser provider |
| `MCP_TUNNEL_CLIENT_PATH` | `/` | WebSocket path for raw WS MCP clients |
| `MCP_TUNNEL_MCP_PATH` | `/mcp` | Streamable HTTP endpoint (MCP 2025-03-26) |
| `MCP_TUNNEL_WWW_DIR` | `packages/host/www` | Directory served as the dev harness |
| `MCP_TUNNEL_BUNDLE_DIR` | `packages/dev/core/bundle` | Directory served under `/bundle/` |
| `MCP_TUNNEL_NO_OPEN` | _(unset)_ | Set to any value to skip auto-opening browser |

---

## Project structure

```
mcp-for-babylon/
├── packages/
│   ├── dev/
│   │   ├── core/           @dev/core — MCP server SDK (TypeScript → UMD)
│   │   │   ├── src/
│   │   │   │   ├── interfaces/       Public TypeScript interfaces
│   │   │   │   └── server/           McpServer, McpServerBuilder, JSON-RPC helpers
│   │   │   └── bundle/               webpack output (mcp-server.js)
│   │   ├── babylon/        @dev/babylon — Babylon.js behaviors & adapters (TypeScript → UMD)
│   │   │   ├── src/
│   │   │   │   ├── adapters/         McpCameraAdapter (tool dispatch + resource read)
│   │   │   │   ├── behaviours/       McpCameraBehavior (tool & resource schema)
│   │   │   │   └── states/           Camera / math state types
│   │   │   └── bundle/               webpack output (mcp-babylon.js)
│   │   ├── tunnel/         @dev/tunnel — WebSocket/HTTP relay (Node.js)
│   │   │   └── src/
│   │   │       ├── ws.tunnel.ts      WsTunnel class
│   │   │       ├── ws.tunnel.builder.ts
│   │   │       └── bin.ts            CLI entry point
│   │   └── tools/          @dev/tools — shared build utilities
│   └── host/
│       └── www/            Dev harness (plain HTML + UMD bundles)
│           ├── bundle/     Deployed bundles (output of npm run deploy:bundles)
│           ├── samples/    Ready-to-use sample scenes (e.g. babylon-camera.html)
│           ├── templates/  Reusable HTML templates
│           └── index.html  Browser MCP provider + mock Babylon.js behaviors
├── scripts/
│   └── deploy-bundles.mjs  Copies bundle output into www/bundle/
└── package.json            Monorepo root (npm workspaces)
```

### Key concepts

| Term | Description |
|------|-------------|
| **Behavior** (`IMcpBehavior<T>`) | Capability template for a type of object (mesh, light, camera). Registered once per type. |
| **Instance** (`IMcpBehaviorInstance`) | Live wrapper around one specific object. Exposes it as a resource + tool executor. |
| **Adapter** (`IMcpBehaviorAdapter`) | Babylon.js-specific implementation that reads scene state and dispatches tool calls. |
| **Namespace** | Short identifier (e.g. `"camera"`) that groups tools and URI templates per behavior type. |
| **URI template** | RFC 6570 pattern (e.g. `babylon://camera/{cameraId}`) advertised via `resources/templates/list`. |
| **`uri` argument** | Required tool argument that routes a call to the correct instance (fast path). |

---

## MCP transports supported

| Transport | Endpoint | Spec |
|-----------|----------|------|
| Streamable HTTP | `POST /mcp` | MCP 2025-03-26 |
| SSE stream | `GET /sse` | MCP 2024-11-05 |
| SSE messages | `POST /messages?sessionId=…` | MCP 2024-11-05 |
| Raw WebSocket | `ws://localhost:3000/` | Internal / testing |

---

## npm scripts reference

| Script | Description |
|--------|-------------|
| `npm run build:dev` | Compile all TypeScript packages to `dist/` |
| `npm run build:watch` | Compile TypeScript in watch mode |
| `npm run bundle` | Production webpack bundles (core + babylon) |
| `npm run bundle:dev` | Development webpack bundles (readable, with source maps) |
| `npm run bundle:watch` | Watch + auto-rebuild core bundle |
| `npm run deploy:bundles` | Copy bundle files into `packages/host/www/bundle/` |
| `npm run build:all` | Full production build: compile + bundle + deploy |
| `npm run build:all:dev` | Full development build: compile + bundle:dev + deploy |
| `npm run server:build` | Compile tunnel TypeScript |
| `npm run server:start` | Build + start the tunnel server |
