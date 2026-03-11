import { createEventEmitter, IEventEmitter, IEventSource, IMcpBehaviorAdapter, McpResourceContent, McpToolResult, ToolSupport } from "./interfaces";
import { McpGrammar } from "./mcp.grammar";

export abstract class McpAdapterBase implements IMcpBehaviorAdapter {
    private _domain: string;
    private _onResourceContentChanged?: IEventEmitter<string>;
    private _onResourcesChanged?: IEventEmitter<void>;
    private _onGrammarChanged?: IEventEmitter<void>;
    private _grammar?: McpGrammar;

    constructor(domain: string) {
        this._domain = domain;
    }

    public get domain(): string {
        return this._domain;
    }

    // ── Grammar ──────────────────────────────────────────────────────────────

    public get grammar(): McpGrammar | undefined {
        return this._grammar;
    }

    public set grammar(value: McpGrammar | undefined) {
        this._grammar = value;
    }

    public get onGrammarChanged(): IEventSource<void> {
        if (!this._onGrammarChanged) {
            this._onGrammarChanged = createEventEmitter<void>();
        }
        return this._onGrammarChanged;
    }

    protected _emitGrammarChanged(): void {
        this._onGrammarChanged?.emit();
    }

    // ── Resource events ──────────────────────────────────────────────────────

    public get onResourceContentChanged(): IEventSource<string> {
        if (!this._onResourceContentChanged) {
            this._onResourceContentChanged = createEventEmitter<string>();
        }
        return this._onResourceContentChanged;
    }

    public get onResourcesChanged(): IEventSource<void> {
        if (!this._onResourcesChanged) {
            this._onResourcesChanged = createEventEmitter<void>();
        }
        return this._onResourcesChanged;
    }

    // ── Tool support ─────────────────────────────────────────────────────────

    /**
     * Returns the support level for a tool, optionally scoped to a resource type.
     *
     * Override in subclasses to declare per-tool or per-resource-type support.
     * The default implementation returns `undefined` for every tool, which the
     * behavior interprets as {@link ToolSupport.Full} (all tools assumed fully supported).
     */
    public getToolSupport(_toolName: string, _resourceType?: string): ToolSupport | undefined {
        return undefined;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    public dispose(): void {
        this._onResourceContentChanged?.clear();
        this._onResourceContentChanged = undefined;
        this._onResourcesChanged?.clear();
        this._onResourcesChanged = undefined;
        this._onGrammarChanged?.clear();
        this._onGrammarChanged = undefined;
    }

    protected _forwardResourceChanged() {
        this._onResourcesChanged?.emit();
    }

    protected _forwardResourceContentChanged(uri: string) {
        this._onResourceContentChanged?.emit(uri);
    }

    public abstract readResourceAsync(uri: string): Promise<McpResourceContent | undefined>;
    public abstract executeToolAsync(uri: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult>;
}
