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
             │  ws://localhost:3000/provider  (wss:// when TLS is enabled)
             ▼
┌─────────────────────────────┐
│  McpServer (browser page)   │  packages/host/www
│  Babylon.js dev harness     │
└─────────────────────────────┘
```

The **browser page** runs an `McpServer` instance (UMD bundles) that registers
Babylon.js scene objects as MCP resources with callable tools. The **tunnel**
bridges HTTP/SSE MCP clients to the browser's WebSocket connection.

---

## Prerequisites

| Tool    | Version                            |
| ------- | ---------------------------------- |
| Node.js | ≥ 20.11.0 < 23.0.0                 |
| npm     | ≥ 8.0.0                            |
| Browser | Any modern (Chrome, Edge, Firefox) |

> **MCP Inspector** (optional, for interactive testing):
>
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

This builds the tunnel and starts it. You will see:

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

## HTTPS / TLS

Some MCP clients require a secure connection (`https://` / `wss://`). The tunnel
supports TLS natively — no proxy needed.

### 1 — Generate a self-signed certificate

```bash
npm run gen-cert
```

This creates `certs/cert.pem` and `certs/key.pem` in the repo root (the `certs/`
folder is already gitignored). The script prints the exact commands to start the
server:

```
✅  Certificate written:
     cert  →  C:\…\certs\cert.pem
     key   →  C:\…\certs\key.pem

   Start the tunnel with TLS (PowerShell):
────────────────────────────────────────────────────────────────
   $env:MCP_TUNNEL_TLS_CERT="C:\…\certs\cert.pem"
   $env:MCP_TUNNEL_TLS_KEY="C:\…\certs\key.pem"
   npm run server:start
────────────────────────────────────────────────────────────────
```

### 2 — Start the tunnel with TLS

**PowerShell:**

```powershell
$env:MCP_TUNNEL_TLS_CERT="certs\cert.pem"
$env:MCP_TUNNEL_TLS_KEY="certs\key.pem"
npm run server:start
```

**Bash / Git Bash:**

```bash
MCP_TUNNEL_TLS_CERT=certs/cert.pem MCP_TUNNEL_TLS_KEY=certs/key.pem npm run server:start
```

The startup banner switches to `https://` and `wss://` automatically:

```
⚙️  MCP for Babylon — multi-provider tunnel started (TLS)
────────────────────────────────────────────────────────────────
📡  Provider WebSocket   wss://localhost:3000/provider/<serverName>
🔌  MCP Inspector (HTTP) https://localhost:3000/<serverName>/mcp
📺  Claude Code   (SSE)  https://localhost:3000/<serverName>/sse
```

### 3 — Connect your MCP client over HTTPS

Replace `http://` with `https://` in all client URLs. For Claude Code:

```json
{
    "mcpServers": {
        "babylon": {
            "url": "https://localhost:3000/<serverName>/sse"
        }
    }
}
```

> **Self-signed certificate warning** — browsers show an "untrusted certificate"
> warning the first time you open `https://localhost:3000/`.
> Click **Advanced → Proceed to localhost**.
> MCP clients (Claude Code, MCP Inspector) typically skip certificate validation
> for `localhost` and do not show this warning.

> **Production certificates** — for a real domain, point the env vars at your
> Let's Encrypt files:
>
> ```
> MCP_TUNNEL_TLS_CERT=/etc/letsencrypt/live/example.com/fullchain.pem
> MCP_TUNNEL_TLS_KEY=/etc/letsencrypt/live/example.com/privkey.pem
> ```

### Forcing HTTP or HTTPS explicitly

By default the tunnel auto-detects the protocol (HTTPS when cert+key are present,
HTTP otherwise). Use `MCP_TUNNEL_PROTOCOL` to override this:

```powershell
npm run server:start:http     # always plain HTTP
```

```powershell
npm run server:start:https    # always HTTPS (run gen-cert first)
```

```powershell
npm run server:start          # auto-detect (existing behaviour)
```

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
3. Set the URL to (replace `<serverName>` with the name used in the browser page):
    ```
    http://localhost:3000/<serverName>/mcp
    ```
4. Click **Connect**.

> Make sure the browser dev harness is already connected (status = **Connected**)
> before clicking Connect in MCP Inspector, otherwise you will receive
> `-32000 No provider connected`.

### Explore resources and tools

| Tab                       | MCP method                 | What you see                                                             |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **Resources** → List      | `resources/list`           | `mesh://scene/BoxMesh`, `mesh://scene/SphereMesh`, `camera://scene/main` |
| **Resources** → Templates | `resources/templates/list` | `mesh://scene/{meshName}`, `camera://scene/{cameraId}`                   |
| **Resources** → Read      | `resources/read`           | JSON state for a specific mesh or camera                                 |
| **Tools** → List          | `tools/list`               | mesh tools + camera tools (see below)                                    |
| **Tools** → Call          | `tools/call`               | Execute a tool on a specific instance via its URI                        |

## Testing with Claude Code

Add the tunnel as an MCP server in your Claude Code settings.

Edit `~/.claude/settings.json` (or open **Settings → MCP Servers**), replacing
`<serverName>` with the name passed to `McpServerBuilder.withName()` in your page:

### Option A — SSE transport (2024-11-05, recommended for Claude Code)

```json
{
    "mcpServers": {
        "babylon": {
            "url": "http://localhost:3000/<serverName>/sse"
        }
    }
}
```

### Option B — Streamable HTTP transport (2025-03-26)

```json
{
    "mcpServers": {
        "babylon": {
            "url": "http://localhost:3000/<serverName>/mcp"
        }
    }
}
```

### With HTTPS (TLS enabled)

Replace `http://` with `https://` in both options above:

```json
{
    "mcpServers": {
        "babylon": {
            "url": "https://localhost:3000/<serverName>/sse"
        }
    }
}
```

Restart Claude Code, then verify the server appears under `/mcp` or in the
status bar. You can now ask Claude to inspect or move scene objects:

> "List all the resources available in the Babylon scene."
> "Move BoxMesh to position (3, 0, -2)."
> "Smoothly animate the camera to look at the sphere over 2 seconds."

---

## Light tools reference

The `@dev/babylon` package exposes a full set of light management tools.
All colours use `{ r, g, b }` objects with channels in `[0, 1]`.
Every tool takes a `uri` argument — either the namespace URI
(`babylon://light`) for scene-level and create tools, or an instance URI
(`babylon://light/<name>`) for per-light tools.

> **Protected lights** — lights that existed in the Babylon.js scene before the
> MCP server started cannot be removed via `light_remove`. Only lights created
> through `light_create` are disposable.

### Per-light tools

| Tool                          | Applies to                     | Description                                                                               |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `light_create`                | —                              | Creates a new light (`point`, `directional`, `spot`, `hemispheric`). Returns the new URI. |
| `light_remove`                | all                            | Removes and disposes a light created by the MCP server.                                   |
| `light_set_enabled`           | all                            | Enables or disables a light without removing it.                                          |
| `light_set_intensity`         | all                            | Sets the brightness multiplier (`>= 0`; default 1).                                       |
| `light_set_diffuse_color`     | all                            | Sets the main emitted colour.                                                             |
| `light_set_specular_color`    | all                            | Sets the highlight (specular) colour.                                                     |
| `light_set_position`          | point, spot, directional       | Sets the world-space origin. For directional lights this only affects the shadow frustum. |
| `light_set_direction`         | directional, spot, hemispheric | Sets the direction vector (normalised internally).                                        |
| `light_set_target`            | spot, directional              | Aims the light at a world-space point (`direction = normalize(target − position)`).       |
| `light_set_range`             | point, spot                    | Sets the effective range in world units.                                                  |
| `light_spot_set_angle`        | spot                           | Sets the cone half-angle in degrees `(0, 90)`.                                            |
| `light_spot_set_exponent`     | spot                           | Sets the falloff exponent toward the cone axis.                                           |
| `light_hemi_set_ground_color` | hemispheric                    | Sets the bottom-hemisphere (ground) colour.                                               |
| `light_update`                | all                            | Batch-patches multiple properties in one call; inapplicable fields are silently ignored.  |

### Scene ambient tools

| Tool                        | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| `scene_get_ambient`         | Returns the current ambient colour and enabled state.                      |
| `scene_set_ambient_color`   | Sets `scene.ambientColor` (affects all materials using ambient).           |
| `scene_set_ambient_enabled` | Disables ambient (sets black) or re-enables it (restores previous colour). |

---

## Camera tools reference

The `@dev/babylon` package exposes a rich set of camera tools. All coordinates
are world-space, **right-handed, y-axis up**. Every tool requires a `uri`
argument (e.g. `babylon://camera/MyCamera`) to identify the target camera.

### Immediate tools

| Tool                    | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `camera_set_target`     | Set the look-at point (`TargetCamera.setTarget`).                         |
| `camera_set_position`   | Teleport the camera to an absolute world-space position.                  |
| `camera_look_at`        | Move the camera and set its look-at target in one call.                   |
| `camera_orbit`          | Rotate around the current target by `deltaAlpha` / `deltaBeta` (degrees). |
| `camera_set_fov`        | Set the vertical field of view (degrees or radians).                      |
| `camera_zoom`           | Relative zoom: `factor < 1` zooms in, `factor > 1` zooms out.             |
| `camera_set_projection` | Switch between `"perspective"` and `"orthographic"` projection.           |
| `camera_dolly`          | Push/pull the camera along the view axis (affects parallax & DoF).        |
| `camera_pan`            | Slide the camera and target together perpendicular to the view axis.      |
| `camera_lock`           | Detach user input — cinematic lock.                                       |
| `camera_unlock`         | Re-attach user input after a cinematic lock.                              |
| `camera_snapshot`       | Capture a frame as a base64-encoded PNG (any resolution).                 |

### Animation tools

| Tool                    | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `camera_animate_to`     | Smoothly fly to a new position, target, and/or FOV over time.       |
| `camera_animate_orbit`  | Smooth orbit sweep; supports continuous `loop` mode.                |
| `camera_follow_path`    | Move the camera through an ordered sequence of waypoints.           |
| `camera_shake`          | Procedural trauma shake with intensity, duration, and frequency.    |
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

| Variable                   | Default                    | Description                                                                    |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `MCP_TUNNEL_PORT`          | `3000`                     | TCP port for the tunnel HTTP server                                            |
| `MCP_TUNNEL_HOST`          | `0.0.0.0`                  | Bind address                                                                   |
| `MCP_TUNNEL_PROVIDER_PATH` | `/provider`                | WebSocket path for the browser provider                                        |
| `MCP_TUNNEL_CLIENT_PATH`   | `/`                        | WebSocket path for raw WS MCP clients                                          |
| `MCP_TUNNEL_MCP_PATH`      | `/mcp`                     | Streamable HTTP endpoint (MCP 2025-03-26)                                      |
| `MCP_TUNNEL_WWW_DIR`       | `packages/host/www`        | Directory served as the dev harness                                            |
| `MCP_TUNNEL_BUNDLE_DIR`    | `packages/dev/core/bundle` | Directory served under `/bundle/`                                              |
| `MCP_TUNNEL_NO_OPEN`       | _(unset)_                  | Set to any value to skip auto-opening browser                                  |
| `MCP_TUNNEL_TLS_CERT`      | _(unset)_                  | Path to PEM certificate file — enables HTTPS/WSS                               |
| `MCP_TUNNEL_TLS_KEY`       | _(unset)_                  | Path to PEM private-key file — enables HTTPS/WSS                               |
| `MCP_TUNNEL_PROTOCOL`      | _(auto)_                   | Force `"http"` or `"https"`. Auto: HTTPS when cert+key are set, HTTP otherwise |

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
│   │   │   │   ├── adapters/         McpCameraAdapter, McpLightAdapter
│   │   │   │   ├── behaviours/       McpCameraBehavior, McpLightBehavior
│   │   │   │   └── states/           Camera / light / math state types
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
│           ├── samples/    Ready-to-use sample scenes (babylon-camera.html, babylon-light.html, …)
│           ├── templates/  Reusable HTML templates
│           └── index.html  Browser MCP provider + mock Babylon.js behaviors
├── scripts/
│   ├── deploy-bundles.mjs  Copies bundle output into www/bundle/
│   └── gen-cert.mjs        Generates a self-signed TLS certificate (→ certs/)
└── package.json            Monorepo root (npm workspaces)
```

### Key concepts

| Term                                  | Description                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Behavior** (`IMcpBehavior<T>`)      | Capability template for a type of object (mesh, light, camera). Registered once per type.        |
| **Instance** (`IMcpBehaviorInstance`) | Live wrapper around one specific object. Exposes it as a resource + tool executor.               |
| **Adapter** (`IMcpBehaviorAdapter`)   | Babylon.js-specific implementation that reads scene state and dispatches tool calls.             |
| **Namespace**                         | Short identifier (e.g. `"camera"`) that groups tools and URI templates per behavior type.        |
| **URI template**                      | RFC 6570 pattern (e.g. `babylon://camera/{cameraId}`) advertised via `resources/templates/list`. |
| **`uri` argument**                    | Required tool argument that routes a call to the correct instance (fast path).                   |

---

## MCP transports supported

| Transport       | Endpoint                                  | Spec               |
| --------------- | ----------------------------------------- | ------------------ |
| Streamable HTTP | `POST /<serverName>/mcp`                  | MCP 2025-03-26     |
| SSE stream      | `GET /<serverName>/sse`                   | MCP 2024-11-05     |
| SSE messages    | `POST /<serverName>/messages?sessionId=…` | MCP 2024-11-05     |
| Raw WebSocket   | `ws://localhost:3000/<serverName>`        | Internal / testing |

All transports are available over HTTPS/WSS when `MCP_TUNNEL_TLS_CERT` and
`MCP_TUNNEL_TLS_KEY` are set (see [HTTPS / TLS](#https--tls)).

---

## npm scripts reference

| Script                       | Description                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `npm run build:dev`          | Compile all TypeScript packages to `dist/`                                            |
| `npm run build:watch`        | Compile TypeScript in watch mode                                                      |
| `npm run bundle`             | Production webpack bundles (core + babylon)                                           |
| `npm run bundle:dev`         | Development webpack bundles (readable, with source maps)                              |
| `npm run bundle:watch`       | Watch + auto-rebuild core bundle                                                      |
| `npm run deploy:bundles`     | Copy bundle files into `packages/host/www/bundle/`                                    |
| `npm run build:all`          | Full production build: compile + bundle + deploy                                      |
| `npm run build:all:dev`      | Full development build: compile + bundle:dev + deploy                                 |
| `npm run server:build`       | Compile tunnel TypeScript                                                             |
| `npm run server:start`       | Build + start the tunnel (auto: HTTP or HTTPS based on env vars)                      |
| `npm run server:start:http`  | Build + start the tunnel forced to **HTTP** (ignores any cert env vars)               |
| `npm run server:start:https` | Build + start the tunnel forced to **HTTPS** using `certs/cert.pem` + `certs/key.pem` |
| `npm run gen-cert`           | Generate a self-signed TLS certificate into `certs/`                                  |
