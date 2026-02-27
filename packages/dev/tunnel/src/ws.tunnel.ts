import * as fs from "fs";
import * as http from "http";
import * as nodePath from "path";
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { WebSocket, WebSocketServer } from "ws";

// ---------------------------------------------------------------------------
// Static-file helpers
// ---------------------------------------------------------------------------

/** Maps file extensions to their HTTP Content-Type values. */
const MIME: Readonly<Record<string, string>> = {
    ".html":  "text/html; charset=utf-8",
    ".js":    "application/javascript; charset=utf-8",
    ".mjs":   "application/javascript; charset=utf-8",
    ".css":   "text/css; charset=utf-8",
    ".json":  "application/json; charset=utf-8",
    ".map":   "application/json; charset=utf-8",
    ".svg":   "image/svg+xml",
    ".png":   "image/png",
    ".ico":   "image/x-icon",
    ".woff2": "font/woff2",
    ".woff":  "font/woff",
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Where a JSON-RPC response should be delivered.
 * Either a WebSocket socket (raw WS client), an SSE session (legacy MCP/HTTP),
 * or a held-open HTTP response (Streamable HTTP transport, MCP 2025-03-26).
 */
type ResponseSink =
    | { type: "ws";   socket: WebSocket }
    | { type: "sse";  sessionId: string }
    | { type: "http"; res: ServerResponse };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single static-file mount: serves the contents of `dir` under `urlPrefix`.
 *
 * @example
 * { urlPrefix: "/",       dir: "/absolute/path/to/www" }
 * { urlPrefix: "/bundle", dir: "/absolute/path/to/bundle" }
 */
export interface StaticMount {
    /** URL prefix that triggers this mount (e.g. `"/"` or `"/bundle"`). */
    urlPrefix: string;
    /** Absolute path to the directory to serve. */
    dir: string;
}

/**
 * Configuration options for a {@link WsTunnel} instance.
 */
export interface WsTunnelOptions {
    /** TCP port to listen on. */
    port: number;

    /**
     * Host/interface to bind to.
     * @default "0.0.0.0"
     */
    host?: string;

    /**
     * URL path the Babylon.js `McpServer` (provider) connects to via WebSocket.
     * @default "/provider"
     */
    providerPath?: string;

    /**
     * URL path raw WebSocket MCP clients connect to.
     * @default "/"
     */
    clientPath?: string;

    /**
     * URL path Claude (or any SSE MCP client) hits for the SSE stream.
     * Claude sends `GET <ssePath>` to open a long-lived event stream.
     * @default "/sse"
     */
    ssePath?: string;

    /**
     * URL path Claude POSTs JSON-RPC requests to.
     * The session id is passed as a query param: `POST <messagesPath>?sessionId=…`
     * @default "/messages"
     */
    messagesPath?: string;

    /**
     * URL path for the **Streamable HTTP transport** (MCP 2025-03-26).
     * MCP Inspector and other 2025+ clients POST JSON-RPC here and receive a
     * synchronous `application/json` response on the same connection.
     * @default "/mcp"
     */
    mcpPath?: string;

    /**
     * URL path that returns a `{ files: string[] }` JSON listing of every file
     * inside the `samples/` subdirectory of the root static mount.
     * Used by `index.html` to build the samples gallery.
     * @default "/__samples_index__"
     */
    samplesIndexPath?: string;

    /**
     * Optional static-file mounts served over plain HTTP.
     * Matched by longest URL prefix; directory requests fall back to `index.html`.
     */
    staticMounts?: StaticMount[];
}

// ---------------------------------------------------------------------------
// WsTunnel
// ---------------------------------------------------------------------------

/**
 * A relay that bridges a Babylon.js `McpServer` (the **provider**) with
 * one or more MCP clients — both raw WebSocket and HTTP/SSE (Claude).
 *
 * ## Transport overview
 * ```
 * MCP Insp.   POST /mcp            → JSON-RPC    (Streamable HTTP, 2025-03-26)
 * Claude      GET  /sse            ← SSE stream  (server → Claude, legacy)
 *             POST /messages       → JSON-RPC    (Claude → server, legacy)
 *                                        ↕  WebSocket
 * Babylon.js  ws://host/provider   ← provider registration
 * ```
 *
 * ## MCP Inspector
 * Point it at `http://localhost:3000/mcp` (Streamable HTTP transport).
 *
 * ## Claude Code configuration
 * Add to `~/.claude/settings.json`:
 * ```json
 * {
 *   "mcpServers": {
 *     "babylon": { "url": "http://localhost:3000/sse" }
 *   }
 * }
 * ```
 */
export class WsTunnel {
    private readonly _options: WsTunnelOptions;
    private _httpServer: http.Server | null = null;
    private _wss: WebSocketServer | null = null;

    /** The single connected Babylon.js provider. */
    private _provider: WebSocket | null = null;

    /** Raw WebSocket MCP clients. */
    private readonly _clients = new Set<WebSocket>();

    /**
     * Active SSE sessions keyed by session id.
     * Each entry is the long-lived HTTP response object for that Claude session.
     */
    private readonly _sseSessions = new Map<string, ServerResponse>();

    /**
     * Active `GET /mcp` SSE streams keyed by session id.
     * Opened by Streamable HTTP clients (e.g. MCP Inspector) to receive
     * server-initiated notifications as required by MCP 2025-03-26.
     */
    private readonly _mcpGetSessions = new Map<string, ServerResponse>();

    /**
     * Tracks which sink (WS socket or SSE session) is waiting for a given
     * JSON-RPC response id, so the reply can be routed back correctly.
     */
    private readonly _pending = new Map<string | number, ResponseSink>();

    constructor(options: WsTunnelOptions) {
        this._options = options;
    }

    // -------------------------------------------------------------------------
    // Public state
    // -------------------------------------------------------------------------

    get isListening(): boolean { return this._httpServer?.listening ?? false; }
    get clientCount(): number  { return this._clients.size + this._sseSessions.size; }
    get hasProvider(): boolean { return this._provider?.readyState === WebSocket.OPEN; }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Starts the tunnel. Resolves once the HTTP server is listening.
     */
    start(): Promise<void> {
        return new Promise((resolve) => {
            this._httpServer = http.createServer((req, res) => this._handleHttp(req, res));
            this._wss = new WebSocketServer({ server: this._httpServer });

            this._wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
                const url = req.url ?? "/";
                const providerPath = this._options.providerPath ?? "/provider";
                if (url.startsWith(providerPath)) {
                    this._onProviderConnect(ws);
                } else {
                    this._onClientConnect(ws);
                }
            });

            this._httpServer.listen(this._options.port, this._options.host ?? "0.0.0.0", () => resolve());
        });
    }

    /**
     * Gracefully closes all connections and stops the HTTP server.
     */
    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Close SSE sessions
            for (const res of this._sseSessions.values()) res.end();
            this._sseSessions.clear();

            // Close Streamable HTTP GET streams
            for (const res of this._mcpGetSessions.values()) res.end();
            this._mcpGetSessions.clear();

            for (const client of this._clients) client.close();
            this._provider?.close();
            this._wss?.close();
            this._httpServer?.close((err) => (err ? reject(err) : resolve()));
        });
    }

    // -------------------------------------------------------------------------
    // HTTP dispatcher
    // -------------------------------------------------------------------------

    private _handleHttp(req: IncomingMessage, res: ServerResponse): void {
        const method = req.method ?? "GET";
        const rawUrl = (req.url ?? "/").split("?")[0];

        // CORS — allow the dev page (same origin) and MCP clients (different origin).
        // Reflect the requested headers back so Streamable HTTP clients that include
        // Mcp-Session-Id, Accept, or other custom headers are not blocked by preflight.
        res.setHeader("Access-Control-Allow-Origin",  "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers",
            req.headers["access-control-request-headers"] ?? "Content-Type, Accept, Mcp-Session-Id");
        res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

        if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

        const ssePath          = this._options.ssePath           ?? "/sse";
        const messagesPath     = this._options.messagesPath      ?? "/messages";
        const mcpPath          = this._options.mcpPath           ?? "/mcp";
        const samplesIndexPath = this._options.samplesIndexPath  ?? "/__samples_index__";

        if (method === "GET"  && rawUrl === ssePath)           { this._handleSseConnect(req, res);    return; }
        if (method === "POST" && rawUrl === ssePath)           { this._handleMcpPost(req, res);       return; }
        if (method === "POST" && rawUrl === messagesPath)      { this._handleSseMessage(req, res);    return; }
        if (method === "GET"  && rawUrl === mcpPath)           { this._handleMcpGetStream(req, res);  return; }
        if (method === "POST" && rawUrl === mcpPath)           { this._handleMcpPost(req, res);       return; }
        if (method === "GET"  && rawUrl === samplesIndexPath)  { this._handleSamplesIndex(res);       return; }

        // Fall through to static file serving
        if (this._options.staticMounts?.length) {
            this._serveStatic(req, res);
        } else {
            res.writeHead(404); res.end();
        }
    }

    // -------------------------------------------------------------------------
    // MCP / SSE transport
    // -------------------------------------------------------------------------

    /**
     * Handles `GET /sse` — opens a long-lived SSE stream for one Claude session.
     * Sends an `endpoint` event so Claude knows where to POST its requests.
     */
    private _handleSseConnect(req: IncomingMessage, res: ServerResponse): void {
        const sessionId    = randomUUID();
        const messagesPath = this._options.messagesPath ?? "/messages";

        res.writeHead(200, {
            "Content-Type":  "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection":    "keep-alive",
        });

        // MCP SSE spec: first event tells the client its POST endpoint.
        res.write(`event: endpoint\ndata: ${messagesPath}?sessionId=${sessionId}\n\n`);

        this._sseSessions.set(sessionId, res);

        req.on("close", () => {
            this._sseSessions.delete(sessionId);
            // Clean up any pending requests for this session.
            for (const [id, sink] of this._pending) {
                if (sink.type === "sse" && sink.sessionId === sessionId) {
                    this._pending.delete(id);
                }
            }
        });
    }

    /**
     * Handles `POST /messages?sessionId=…` — receives a JSON-RPC request from
     * Claude and forwards it to the Babylon.js provider.
     * Always responds 202 Accepted immediately; the real response arrives over SSE.
     */
    private _handleSseMessage(req: IncomingMessage, res: ServerResponse): void {
        const params    = new URL(req.url ?? "", "http://localhost").searchParams;
        const sessionId = params.get("sessionId") ?? "";

        if (!this._sseSessions.has(sessionId)) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Unknown or expired session");
            return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end",  () => {
            // Register the sink before forwarding so the response can be routed back.
            try {
                const msg = JSON.parse(body) as { id?: string | number };
                if (msg.id != null) {
                    this._pending.set(msg.id, { type: "sse", sessionId });
                }
            } catch { /* malformed — forward anyway, provider returns parse error */ }

            if (this._provider?.readyState === WebSocket.OPEN) {
                this._provider.send(body);
            } else {
                // No provider: send error via SSE immediately.
                const sseRes = this._sseSessions.get(sessionId);
                if (sseRes) {
                    let errId: string | number | null = null;
                    try { errId = (JSON.parse(body) as { id?: string | number }).id ?? null; } catch { /* */ }
                    this._sendSseEvent(sseRes, JSON.stringify({
                        jsonrpc: "2.0", id: errId,
                        error: { code: -32000, message: "No provider connected" },
                    }));
                }
            }

            // Always 202 — response will arrive asynchronously over the SSE stream.
            res.writeHead(202); res.end();
        });
    }

    /**
     * Handles `POST /mcp` — Streamable HTTP transport (MCP 2025-03-26).
     * Forwards the JSON-RPC request to the provider and holds the HTTP response
     * open until the reply arrives, then writes it as `application/json`.
     */
    private _handleMcpPost(req: IncomingMessage, res: ServerResponse): void {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
            let msg: { id?: string | number } = {};
            try { msg = JSON.parse(body) as { id?: string | number }; }
            catch {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Invalid JSON");
                return;
            }

            if (!this._provider || this._provider.readyState !== WebSocket.OPEN) {
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    jsonrpc: "2.0", id: msg.id ?? null,
                    error: { code: -32000, message: "No provider connected" },
                }));
                return;
            }

            if (msg.id != null) {
                // Request: hold the response open; reply arrives in _routeFromProvider.
                this._pending.set(msg.id, { type: "http", res });
            } else {
                // Notification: forward and acknowledge immediately.
                res.writeHead(202);
                res.end();
            }

            this._provider.send(body);
        });
    }

    /**
     * Handles `GET /mcp` — opens a persistent SSE stream per MCP 2025-03-26.
     * Streamable HTTP clients (e.g. MCP Inspector) use this to receive
     * server-initiated notifications and requests without re-polling.
     * The session id is taken from the `Mcp-Session-Id` request header when
     * present, so the stream is associated with the correct client session.
     */
    private _handleMcpGetStream(req: IncomingMessage, res: ServerResponse): void {
        const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? randomUUID();

        res.writeHead(200, {
            "Content-Type":  "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection":    "keep-alive",
            "Mcp-Session-Id": sessionId,
        });
        // Send an empty comment to flush headers immediately.
        res.write(": stream open\n\n");

        this._mcpGetSessions.set(sessionId, res);

        req.on("close", () => {
            this._mcpGetSessions.delete(sessionId);
        });
    }

    /** Writes one JSON-RPC message as an SSE `message` event. */
    private _sendSseEvent(res: ServerResponse, data: string): void {
        // SSE data fields must be single-line; compact the JSON just in case.
        let line: string;
        try { line = JSON.stringify(JSON.parse(data)); } catch { line = data; }
        res.write(`event: message\ndata: ${line}\n\n`);
    }

    // -------------------------------------------------------------------------
    // WebSocket connection handlers
    // -------------------------------------------------------------------------

    private _onProviderConnect(ws: WebSocket): void {
        if (this._provider) {
            ws.close(1008, "A provider is already connected");
            return;
        }

        this._provider = ws;

        ws.on("message", (data: Buffer) => this._routeFromProvider(data.toString()));

        ws.on("close", () => {
            this._provider = null;
            // Notify all pending sinks that the provider is gone.
            const error = JSON.stringify({
                jsonrpc: "2.0", id: null,
                error: { code: -32000, message: "Provider disconnected" },
            });
            for (const [, sink] of this._pending) {
                if (sink.type === "ws") {
                    if (sink.socket.readyState === WebSocket.OPEN) sink.socket.send(error);
                } else if (sink.type === "sse") {
                    const sseRes = this._sseSessions.get(sink.sessionId);
                    if (sseRes) this._sendSseEvent(sseRes, error);
                } else {
                    sink.res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    sink.res.end(error);
                }
            }
            this._pending.clear();
        });
    }

    private _onClientConnect(ws: WebSocket): void {
        this._clients.add(ws);

        ws.on("message", (data: Buffer) => this._routeFromClient(ws, data.toString()));

        ws.on("close", () => {
            this._clients.delete(ws);
            for (const [id, sink] of this._pending) {
                if (sink.type === "ws" && sink.socket === ws) this._pending.delete(id);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Message routing
    // -------------------------------------------------------------------------

    private _routeFromClient(client: WebSocket, data: string): void {
        try {
            const msg = JSON.parse(data) as { id?: string | number };
            if (msg?.id != null) {
                this._pending.set(msg.id, { type: "ws", socket: client });
            }
        } catch { /* forward as-is */ }

        if (this._provider?.readyState === WebSocket.OPEN) {
            this._provider.send(data);
        } else {
            client.send(JSON.stringify({
                jsonrpc: "2.0", id: null,
                error: { code: -32000, message: "No provider connected" },
            }));
        }
    }

    private _routeFromProvider(data: string): void {
        try {
            const msg = JSON.parse(data) as { id?: string | number };

            if (msg.id != null) {
                // Response: route to the specific sink that made the request.
                const sink = this._pending.get(msg.id);
                if (sink?.type === "ws" && sink.socket.readyState === WebSocket.OPEN) {
                    sink.socket.send(data);
                } else if (sink?.type === "sse") {
                    const sseRes = this._sseSessions.get(sink.sessionId);
                    if (sseRes) this._sendSseEvent(sseRes, data);
                } else if (sink?.type === "http") {
                    sink.res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    sink.res.end(data);
                }
                this._pending.delete(msg.id);
            } else {
                // Notification (no id): broadcast to all clients.
                this._broadcast(data);
            }
        } catch {
            this._broadcast(data);
        }
    }

    /** Sends a message to all connected clients — WebSocket, SSE, and Streamable HTTP GET streams. */
    private _broadcast(data: string): void {
        for (const client of this._clients) {
            if (client.readyState === WebSocket.OPEN) client.send(data);
        }
        for (const sseRes of this._sseSessions.values()) {
            this._sendSseEvent(sseRes, data);
        }
        for (const mcpRes of this._mcpGetSessions.values()) {
            this._sendSseEvent(mcpRes, data);
        }
    }

    // -------------------------------------------------------------------------
    // Samples index
    // -------------------------------------------------------------------------

    /**
     * Handles `GET /__samples_index__` — returns `{ files: string[] }` listing
     * every file inside the `samples/` subdirectory of the root static mount.
     *
     * `index.html` fetches this endpoint to populate the samples gallery without
     * requiring directory-listing support in the static file server.
     */
    private _handleSamplesIndex(res: ServerResponse): void {
        const rootMount = (this._options.staticMounts ?? []).find((m) => m.urlPrefix === "/");

        let files: string[] = [];
        if (rootMount) {
            const samplesDir = nodePath.join(rootMount.dir, "samples");
            try {
                if (fs.existsSync(samplesDir) && fs.statSync(samplesDir).isDirectory()) {
                    files = fs.readdirSync(samplesDir).filter((name) =>
                        fs.statSync(nodePath.join(samplesDir, name)).isFile()
                    );
                }
            } catch { /* return empty list on any I/O error */ }
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ files }));
    }

    // -------------------------------------------------------------------------
    // Static file serving
    // -------------------------------------------------------------------------

    private _serveStatic(req: IncomingMessage, res: ServerResponse): void {
        const rawUrl = (req.url ?? "/").split("?")[0].split("#")[0];
        const mounts = this._options.staticMounts ?? [];

        // Longest-prefix match wins.
        const mount = [...mounts]
            .filter((m) => {
                const prefix = m.urlPrefix.endsWith("/") ? m.urlPrefix : m.urlPrefix + "/";
                return rawUrl === m.urlPrefix || rawUrl.startsWith(prefix);
            })
            .sort((a, b) => b.urlPrefix.length - a.urlPrefix.length)[0];

        if (!mount) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }

        const relative   = rawUrl.slice(mount.urlPrefix.length) || "/";
        const normalized = nodePath.normalize(relative);

        if (normalized.startsWith("..")) { res.writeHead(403); res.end("Forbidden"); return; }

        const mountAbs = nodePath.resolve(mount.dir);
        let   filePath = nodePath.join(mountAbs, normalized);

        if (!filePath.startsWith(mountAbs + nodePath.sep) && filePath !== mountAbs) {
            res.writeHead(403); res.end("Forbidden"); return;
        }

        try {
            if (fs.statSync(filePath).isDirectory()) filePath = nodePath.join(filePath, "index.html");
        } catch { res.writeHead(404); res.end("Not found"); return; }

        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("Not found"); return; }

        const ext = nodePath.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
    }
}
