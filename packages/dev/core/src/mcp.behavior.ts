/* eslint-disable @typescript-eslint/no-explicit-any */
import { IMcpBehaviorAdapter, McpResource, McpResourceContent, McpResourceTemplate, McpTool, McpToolResult, ToolSupport } from "./interfaces";
import { McpBehaviorBase, McpBehaviorOptions } from "./mcp.behaviorBase";
import { McpGrammar } from "./mcp.grammar";

export abstract class McpBehavior extends McpBehaviorBase {
    private _resourceCache?: McpResource[];
    private _resourceTemplateCache?: McpResourceTemplate[];
    private _resourceContentCache = new Map<string, McpResourceContent>();
    private _resourceContentPromiseCache = new Map<string, Promise<McpResourceContent | undefined>>();
    private _toolsCache?: McpTool[];
    private _adapter: IMcpBehaviorAdapter;

    private _defaultGrammarCache?: McpGrammar;
    private _runtimeGrammar?: McpGrammar;

    public constructor(adapter: IMcpBehaviorAdapter, options: McpBehaviorOptions) {
        super(options);
        this._adapter = adapter;

        // Subscribe to adapter grammar changes to invalidate tools cache.
        adapter.onGrammarChanged?.subscribe(() => {
            this._toolsCache = undefined;
        });
    }

    protected get adapter(): IMcpBehaviorAdapter {
        return this._adapter;
    }

    // ── Grammar ──────────────────────────────────────────────────────────────

    /**
     * Override in subclasses to provide the baseline grammar containing all
     * default tool and property descriptions for this behaviour.
     *
     * Called once (lazily) and cached.  The result is the lowest-priority layer
     * in the three-layer grammar resolution.
     */
    protected abstract _buildDefaultGrammar(): McpGrammar;

    private get _defaultGrammar(): McpGrammar {
        if (!this._defaultGrammarCache) {
            this._defaultGrammarCache = this._buildDefaultGrammar();
        }
        return this._defaultGrammarCache;
    }

    /**
     * Sets (or clears) the runtime grammar layer — highest priority.
     * Invalidates the tools cache so the next `getTools()` call reflects the
     * new descriptions.
     */
    public setRuntimeGrammar(grammar: McpGrammar | undefined): void {
        this._runtimeGrammar = grammar;
        this._toolsCache = undefined;
    }

    /** Returns the runtime grammar (if set). */
    public getRuntimeGrammar(): McpGrammar | undefined {
        return this._runtimeGrammar;
    }

    /**
     * Returns a merged grammar snapshot: default ← adapter ← runtime.
     * Useful for serialisation / inspection.
     */
    public getEffectiveGrammar(): McpGrammar {
        return McpGrammar.merge(this._defaultGrammar, this._adapter.grammar, this._runtimeGrammar);
    }

    /**
     * Resolves a tool description through the three grammar layers.
     * Falls back to `fallback` if no layer provides a value.
     */
    protected _resolveToolDescription(toolName: string, fallback: string): string {
        return this._runtimeGrammar?.getToolDescription(toolName)
            ?? this._adapter.grammar?.getToolDescription(toolName)
            ?? this._defaultGrammar.getToolDescription(toolName)
            ?? fallback;
    }

    /**
     * Resolves a property description through the three grammar layers.
     * Falls back to `fallback` if no layer provides a value.
     */
    protected _resolvePropertyDescription(toolName: string, propertyName: string, fallback: string): string {
        return this._runtimeGrammar?.getPropertyDescription(toolName, propertyName)
            ?? this._adapter.grammar?.getPropertyDescription(toolName, propertyName)
            ?? this._defaultGrammar.getPropertyDescription(toolName, propertyName)
            ?? fallback;
    }

    // ── Resources ────────────────────────────────────────────────────────────

    public override getResources(): McpResource[] {
        if (this._resourceCache) {
            return this._resourceCache;
        }
        this._resourceCache = this._buildResources();
        return this._resourceCache;
    }

    public override getResourceTemplates(): McpResourceTemplate[] {
        if (this._resourceTemplateCache) {
            return this._resourceTemplateCache;
        }
        this._resourceTemplateCache = this._buildTemplate();
        return this._resourceTemplateCache;
    }

    /**
     * Returns the tool schemas exposed by this behavior, filtered by the
     * adapter's declared support level.
     *
     * Tools where the adapter returns {@link ToolSupport.Planned} or
     * {@link ToolSupport.None} are excluded from the advertised list.
     * Tools not in the adapter's support map (returns `undefined`) are
     * treated as {@link ToolSupport.Full} for backwards compatibility.
     */
    public override getTools(): McpTool[] {
        if (this._toolsCache) {
            return this._toolsCache;
        }
        const allTools = this._buildTools();
        this._toolsCache = allTools.filter((tool) => {
            const level = this._adapter.getToolSupport?.(tool.name);
            // undefined → Full (default). Full/Partial → expose. Planned/None → hide.
            return !level || level === ToolSupport.Full || level === ToolSupport.Partial;
        });
        return this._toolsCache;
    }

    public override async readResourceAsync(uri: string): Promise<McpResourceContent | undefined> {
        // behavior root uri — build own resource content (cached)
        const rootUri = this.getResources()[0]?.uri;
        if (uri === rootUri) {
            if (this._resourceContentCache.has(uri)) {
                return this._resourceContentCache.get(uri)!;
            }

            // coalesce concurrent requests for the same uri into one promise
            if (this._resourceContentPromiseCache.has(uri)) {
                return this._resourceContentPromiseCache.get(uri)!;
            }

            const promise = this._buildResourceContentAsync(uri).then((content) => {
                if (content) {
                    this._resourceContentCache.set(uri, content);
                }
                this._resourceContentPromiseCache.delete(uri);
                return content;
            });

            this._resourceContentPromiseCache.set(uri, promise);
            return promise;
        }

        // specific instance uri — delegate to adapter
        return this._adapter.readResourceAsync(uri);
    }

    public override async executeToolAsync(uri: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
        return this._adapter.executeToolAsync(uri, toolName, args);
    }

    protected _buildResources(): McpResource[] {
        return [];
    }

    protected _buildTemplate(): McpResourceTemplate[] {
        return [];
    }

    protected async _buildResourceContentAsync(uri: string): Promise<McpResourceContent | undefined> {
        return await this.adapter.readResourceAsync(uri);
    }

    protected _buildTools(): McpTool[] {
        return [];
    }
}
