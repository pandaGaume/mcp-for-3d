import {
    AbstractMesh,
    BackEase,
    BounceEase,
    CircleEase,
    Color3,
    CubicEase,
    EasingFunction,
    ElasticEase,
    Engine,
    EventState,
    ExponentialEase,
    InstancedMesh,
    Nullable,
    Observer,
    PBRMaterial,
    QuadraticEase,
    Scene,
    SineEase,
    StandardMaterial,
    Tags,
    Vector3,
} from "@babylonjs/core";
import { JsonRpcMimeType, McpAdapterBase, McpResourceContent, McpToolResult, McpToolResults } from "@dev/core";
import { IMeshMaterialState, IMeshState, IMeshTransformState, McpMeshBehavior, MeshMaterialType } from "@dev/behaviors";
import { McpBabylonDomain, McpMeshResourceUriPrefix } from "../mcp.commons";

const DEG_TO_RAD = Math.PI / 180;

/** All tool names exposed by this adapter, used in the default error message. */
const ALL_TOOLS = [
    McpMeshBehavior.MeshSetEnabledFn,
    McpMeshBehavior.MeshSetVisibleFn,
    McpMeshBehavior.MeshSetVisibilityFn,
    McpMeshBehavior.MeshSetPositionFn,
    McpMeshBehavior.MeshSetRotationFn,
    McpMeshBehavior.MeshSetScalingFn,
    McpMeshBehavior.MeshAnimateToFn,
    McpMeshBehavior.MeshSetColorFn,
    McpMeshBehavior.MeshSetMaterialAlphaFn,
    McpMeshBehavior.MeshTagAddFn,
    McpMeshBehavior.MeshTagRemoveFn,
    McpMeshBehavior.MeshTagSetFn,
    McpMeshBehavior.MeshFindByTagFn,
].join('", "');

/**
 * MCP adapter for Babylon.js meshes.
 *
 * Bridges the MCP protocol layer and the live Babylon.js scene:
 * - `readResourceAsync` exposes the mesh list and individual mesh states as JSON resources.
 * - `executeToolAsync` dispatches tool calls to the matching mesh.
 *
 * The adapter maintains an internal URI→Mesh index keyed by `babylon://mesh/{mesh.id}`,
 * kept in sync with the scene via `onNewMeshAddedObservable` / `onMeshRemovedObservable`.
 *
 * Coordinate system: all vectors are returned in right-handed y-up world space.
 * When the scene uses the default left-handed system, Z coordinates and rotation
 * x/y components are negated on the way out and restored on the way in.
 */
export class McpMeshAdapter extends McpAdapterBase {
    private _scene: Scene;
    private _indexedMeshes = new Map<string, AbstractMesh>();
    private _observers: Nullable<Observer<AbstractMesh>>[] = [];
    private _activeAnimations = new Map<string, Observer<Scene>>();

    public constructor(scene?: Scene) {
        super(McpBabylonDomain);
        this._scene = scene ?? Engine.LastCreatedScene!;
        if (!this._scene) {
            throw new Error("McpMeshAdapter requires a Babylon.js Scene. Provide one in the constructor or ensure Engine.LastCreatedScene is set.");
        }
        this._initializeMeshIndex();
        this._observers.push(this._scene.onNewMeshAddedObservable.add(this._onMeshAdded.bind(this)));
        this._observers.push(this._scene.onMeshRemovedObservable.add(this._onMeshRemoved.bind(this)));
    }

    /**
     * Reads a mesh resource by URI.
     *
     * - `babylon://mesh`        → list of all meshes (id, name, uri, type, tags).
     * - `babylon://mesh/{id}`   → full {@link IMeshState} of a single mesh.
     */
    public async readResourceAsync(uri: string): Promise<McpResourceContent | undefined> {
        let text: string | undefined;

        if (uri === McpMeshResourceUriPrefix) {
            const meshes = this._scene.meshes.map((m) => ({
                uri: this._buildUriForMesh(m),
                id: m.id,
                name: m.name,
                type: m instanceof InstancedMesh ? "instancedMesh" : "mesh",
                tags: this._getTags(m),
            }));
            text = JSON.stringify(meshes);
        } else if (uri.startsWith(`${McpMeshResourceUriPrefix}/`)) {
            const mesh = this._indexedMeshes.get(uri);
            if (mesh) {
                text = JSON.stringify(this._getMeshState(mesh));
            }
        }

        return text ? { uri, text, mimeType: JsonRpcMimeType } : undefined;
    }

    /**
     * Dispatches a tool call.
     *
     * Namespace-level tools (mesh_find_by_tag) are handled before the URI→Mesh lookup.
     * All other tools require a valid mesh URI.
     */
    public async executeToolAsync(uri: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
        // ---- Namespace-level tools (no mesh instance needed) ----
        if (toolName === McpMeshBehavior.MeshFindByTagFn) {
            return this._handleFindByTag(args);
        }

        // ---- Instance tools — resolve mesh from URI ----
        const mesh = this._indexedMeshes.get(uri);
        if (!mesh) {
            return McpToolResults.error(`No mesh found for URI "${uri}". ` + `Read the resource "${McpMeshResourceUriPrefix}" to get the list of available mesh URIs.`);
        }

        switch (toolName) {
            // -----------------------------------------------------------------
            // Visibility
            // -----------------------------------------------------------------
            case McpMeshBehavior.MeshSetEnabledFn: {
                const enabled = args["enabled"];
                if (typeof enabled !== "boolean") {
                    return McpToolResults.error(`"enabled" must be a boolean for "${toolName}".`);
                }
                mesh.setEnabled(enabled);
                return McpToolResults.text(`Mesh "${mesh.name}" ${enabled ? "enabled" : "disabled"}.`);
            }

            case McpMeshBehavior.MeshSetVisibleFn: {
                const visible = args["visible"];
                if (typeof visible !== "boolean") {
                    return McpToolResults.error(`"visible" must be a boolean for "${toolName}".`);
                }
                mesh.isVisible = visible;
                return McpToolResults.text(`Mesh "${mesh.name}" is now ${visible ? "visible" : "hidden"}.`);
            }

            case McpMeshBehavior.MeshSetVisibilityFn: {
                const visibility = args["visibility"];
                if (typeof visibility !== "number" || visibility < 0 || visibility > 1) {
                    return McpToolResults.error(`"visibility" must be a number in [0..1] for "${toolName}".`);
                }
                mesh.visibility = visibility;
                return McpToolResults.text(`Mesh "${mesh.name}" visibility set to ${visibility}.`);
            }

            // -----------------------------------------------------------------
            // Transform
            // -----------------------------------------------------------------
            case McpMeshBehavior.MeshSetPositionFn: {
                const pos = args["position"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(pos)) return this._vec3Error(toolName, "position", args["position"]);
                mesh.position.copyFrom(this._tobjsVec3(pos));
                return McpToolResults.text(`Mesh "${mesh.name}" moved to (${pos.x}, ${pos.y}, ${pos.z}).`);
            }

            case McpMeshBehavior.MeshSetRotationFn: {
                const rot = args["rotation"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(rot)) return this._vec3Error(toolName, "rotation", args["rotation"]);
                // Degrees → radians, RH → BJS LH
                mesh.rotationQuaternion = null;
                mesh.rotation.copyFrom(this._tobjsRotationDeg(rot));
                return McpToolResults.text(`Mesh "${mesh.name}" rotation set to (${rot.x}°, ${rot.y}°, ${rot.z}°).`);
            }

            case McpMeshBehavior.MeshSetScalingFn: {
                const sc = args["scaling"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(sc)) return this._vec3Error(toolName, "scaling", args["scaling"]);
                mesh.scaling.copyFrom(new Vector3(sc.x, sc.y, sc.z));
                return McpToolResults.text(`Mesh "${mesh.name}" scaling set to (${sc.x}, ${sc.y}, ${sc.z}).`);
            }

            case McpMeshBehavior.MeshAnimateToFn: {
                const duration = typeof args["duration"] === "number" && args["duration"] > 0 ? args["duration"] : 1;
                const easingStr = args["easing"] as string | undefined;

                const targetPos = this._isVec3(args["position"]) ? this._tobjsVec3(args["position"] as { x: number; y: number; z: number }) : null;
                const targetRot = this._isVec3(args["rotation"]) ? this._tobjsRotationDeg(args["rotation"] as { x: number; y: number; z: number }) : null;
                const targetSc = this._isVec3(args["scaling"])
                    ? new Vector3(
                          (args["scaling"] as { x: number; y: number; z: number }).x,
                          (args["scaling"] as { x: number; y: number; z: number }).y,
                          (args["scaling"] as { x: number; y: number; z: number }).z
                      )
                    : null;

                if (!targetPos && !targetRot && !targetSc) {
                    return McpToolResults.error(`"${toolName}" requires at least one of: position, rotation, scaling.`);
                }

                const startPos = mesh.position.clone();
                const startSc = mesh.scaling.clone();

                // Ensure Euler rotation mode for animation
                if (mesh.rotationQuaternion && targetRot) {
                    mesh.rotationQuaternion.toEulerAnglesToRef(mesh.rotation);
                    mesh.rotationQuaternion = null;
                }
                const startRot = mesh.rotation.clone();

                return await new Promise<McpToolResult>((resolve) => {
                    this._animate(
                        uri,
                        duration,
                        easingStr,
                        (t) => {
                            if (targetPos) mesh.position.copyFrom(Vector3.Lerp(startPos, targetPos, t));
                            if (targetRot) mesh.rotation.copyFrom(Vector3.Lerp(startRot, targetRot, t));
                            if (targetSc) mesh.scaling.copyFrom(Vector3.Lerp(startSc, targetSc, t));
                        },
                        () => resolve(McpToolResults.text(`Mesh "${mesh.name}" animation complete.`))
                    );
                });
            }

            // -----------------------------------------------------------------
            // Material
            // -----------------------------------------------------------------
            case McpMeshBehavior.MeshSetColorFn: {
                const color = args["color"] as { r: number; g: number; b: number } | undefined;
                if (!color || typeof color.r !== "number" || typeof color.g !== "number" || typeof color.b !== "number") {
                    return McpToolResults.error(`"color" must be an object with numeric r, g, b fields (0..1) for "${toolName}".`);
                }
                const c3 = new Color3(color.r, color.g, color.b);
                this._ensureStandardMaterial(mesh).diffuseColor = c3;
                if (mesh.material instanceof PBRMaterial) {
                    mesh.material.albedoColor = c3;
                }
                return McpToolResults.text(`Mesh "${mesh.name}" color set to rgb(${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)}).`);
            }

            case McpMeshBehavior.MeshSetMaterialAlphaFn: {
                const alpha = args["alpha"];
                if (typeof alpha !== "number" || alpha < 0 || alpha > 1) {
                    return McpToolResults.error(`"alpha" must be a number in [0..1] for "${toolName}".`);
                }
                this._ensureStandardMaterial(mesh).alpha = alpha;
                return McpToolResults.text(`Mesh "${mesh.name}" material alpha set to ${alpha}.`);
            }

            // -----------------------------------------------------------------
            // Tags
            // -----------------------------------------------------------------
            case McpMeshBehavior.MeshTagAddFn: {
                const tags = args["tags"];
                if (typeof tags !== "string" || tags.trim() === "") {
                    return McpToolResults.error(`"tags" must be a non-empty string for "${toolName}".`);
                }
                Tags.AddTagsTo(mesh, tags.trim());
                return McpToolResults.text(`Tags [${tags.trim()}] added to mesh "${mesh.name}". Current tags: [${this._getTags(mesh).join(", ")}].`);
            }

            case McpMeshBehavior.MeshTagRemoveFn: {
                const tags = args["tags"];
                if (typeof tags !== "string" || tags.trim() === "") {
                    return McpToolResults.error(`"tags" must be a non-empty string for "${toolName}".`);
                }
                Tags.RemoveTagsFrom(mesh, tags.trim());
                return McpToolResults.text(`Tags [${tags.trim()}] removed from mesh "${mesh.name}". Current tags: [${this._getTags(mesh).join(", ")}].`);
            }

            case McpMeshBehavior.MeshTagSetFn: {
                const tags = args["tags"];
                if (typeof tags !== "string") {
                    return McpToolResults.error(`"tags" must be a string for "${toolName}".`);
                }
                // Remove all existing tags, then add new ones.
                const current = this._getTags(mesh);
                if (current.length > 0) Tags.RemoveTagsFrom(mesh, current.join(" "));
                if (tags.trim() !== "") Tags.AddTagsTo(mesh, tags.trim());
                return McpToolResults.text(`Tags on mesh "${mesh.name}" replaced with [${tags.trim() || "(none)"}].`);
            }

            // -----------------------------------------------------------------
            // Unknown
            // -----------------------------------------------------------------
            default:
                return McpToolResults.error(`Unknown tool "${toolName}" for mesh adapter. Available tools: "${ALL_TOOLS}".`);
        }
    }

    /** Removes all scene observables and clears event emitters. */
    public override dispose(): void {
        this._stopAllAnimations();
        super.dispose();
        this._observers.forEach((o) => o?.remove());
    }

    // -------------------------------------------------------------------------
    // Internal — index management
    // -------------------------------------------------------------------------

    protected _initializeMeshIndex(): void {
        this._scene.meshes.forEach((m) => this._indexedMeshes.set(this._buildUriForMesh(m), m));
    }

    protected _buildUriForMesh(mesh: AbstractMesh): string {
        return `${McpMeshResourceUriPrefix}/${mesh.id}`;
    }

    protected _onMeshAdded(mesh: AbstractMesh, _state: EventState): void {
        this._indexedMeshes.set(this._buildUriForMesh(mesh), mesh);
        this._forwardResourceChanged();
    }

    protected _onMeshRemoved(mesh: AbstractMesh, _state: EventState): void {
        this._indexedMeshes.delete(this._buildUriForMesh(mesh));
        this._forwardResourceChanged();
    }

    // -------------------------------------------------------------------------
    // Internal — state serialization
    // -------------------------------------------------------------------------

    protected _getMeshState(mesh: AbstractMesh): IMeshState {
        const zSign = this._scene.useRightHandedSystem ? 1 : -1;
        const p = mesh.position;
        const s = mesh.scaling;

        const transform: IMeshTransformState = {
            position: { x: p.x, y: p.y, z: p.z * zSign },
            scaling: { x: s.x, y: s.y, z: s.z },
        };

        if (mesh.rotationQuaternion) {
            const q = mesh.rotationQuaternion;
            transform.rotationQuat = this._scene.useRightHandedSystem ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: -q.x, y: -q.y, z: q.z, w: q.w };
        } else {
            const r = mesh.rotation;
            transform.rotationEuler = this._scene.useRightHandedSystem ? { x: r.x, y: r.y, z: r.z } : { x: -r.x, y: -r.y, z: r.z };
        }

        return {
            id: mesh.id,
            name: mesh.name,
            type: mesh instanceof InstancedMesh ? "instancedMesh" : "mesh",
            enabled: mesh.isEnabled(),
            visible: mesh.isVisible,
            visibility: mesh.visibility,
            pickable: mesh.isPickable,
            receiveShadows: mesh.receiveShadows,
            castsShadows: this._meshCastsShadows(mesh),
            transform,
            material: this._getMeshMaterialState(mesh),
            tags: this._getTags(mesh),
            parentId: mesh.parent instanceof AbstractMesh ? mesh.parent.id : undefined,
            childIds: mesh.getChildMeshes(true).map((c) => c.id),
        };
    }

    private _getMeshMaterialState(mesh: AbstractMesh): IMeshMaterialState | undefined {
        const mat = mesh.material;
        if (!mat) return undefined;

        let type: MeshMaterialType = "other";
        let baseColor: { r: number; g: number; b: number } | undefined;
        let hasTexture: boolean | undefined;

        if (mat instanceof StandardMaterial) {
            type = "standard";
            const c = mat.diffuseColor ?? Color3.White();
            baseColor = { r: c.r, g: c.g, b: c.b };
            hasTexture = mat.diffuseTexture !== null;
        } else if (mat instanceof PBRMaterial) {
            type = "pbr";
            const c = mat.albedoColor ?? Color3.White();
            baseColor = { r: c.r, g: c.g, b: c.b };
            hasTexture = mat.albedoTexture !== null;
        } else {
            if (mat.getClassName() === "NodeMaterial") type = "node";
        }

        return { name: mat.name, type, baseColor, hasTexture, alpha: mat.alpha };
    }

    // -------------------------------------------------------------------------
    // Internal — tool handlers
    // -------------------------------------------------------------------------

    private _handleFindByTag(args: Record<string, unknown>): McpToolResult {
        const query = args["query"];
        if (typeof query !== "string" || query.trim() === "") {
            return McpToolResults.error(`"query" must be a non-empty tag expression for "mesh_find_by_tag". Example: 'enemy && destructible'.`);
        }
        const found = this._scene.getMeshesByTags(query.trim());
        const results = found.map((m) => ({
            uri: this._buildUriForMesh(m),
            id: m.id,
            name: m.name,
            tags: this._getTags(m),
        }));
        return McpToolResults.json({ query: query.trim(), count: results.length, meshes: results });
    }

    // -------------------------------------------------------------------------
    // Internal — coordinate helpers
    // -------------------------------------------------------------------------

    /**
     * Converts a right-handed y-up position vector to Babylon.js internal (negates Z when LH).
     */
    private _tobjsVec3(v: { x: number; y: number; z: number }): Vector3 {
        return new Vector3(v.x, v.y, this._scene.useRightHandedSystem ? v.z : -v.z);
    }

    /**
     * Converts a right-handed y-up Euler rotation in DEGREES to a Babylon.js
     * internal rotation Vector3 in radians (negates x and y when LH).
     */
    private _tobjsRotationDeg(v: { x: number; y: number; z: number }): Vector3 {
        const s = this._scene.useRightHandedSystem ? 1 : -1;
        return new Vector3(v.x * DEG_TO_RAD * s, v.y * DEG_TO_RAD * s, v.z * DEG_TO_RAD);
    }

    private _isVec3(v: unknown): v is { x: number; y: number; z: number } {
        if (!v || typeof v !== "object") return false;
        const o = v as Record<string, unknown>;
        return typeof o["x"] === "number" && typeof o["y"] === "number" && typeof o["z"] === "number" && isFinite(o["x"]) && isFinite(o["y"]) && isFinite(o["z"]);
    }

    private _vec3Error(toolName: string, paramName: string, received: unknown): McpToolResult {
        return McpToolResults.error(`Invalid "${paramName}" for "${toolName}". Expected { x, y, z } with finite numbers. Received: ${JSON.stringify(received)}`);
    }

    /**
     * Returns true when the mesh appears in at least one ShadowGenerator render list.
     * Babylon.js has no castsShadows flag on AbstractMesh — shadow casting is opt-in per generator.
     */
    private _meshCastsShadows(mesh: AbstractMesh): boolean {
        for (const light of this._scene.lights) {
            const gen = light.getShadowGenerator();
            if (!gen) continue;
            const renderList = gen.getShadowMap()?.renderList;
            if (renderList && renderList.includes(mesh)) return true;
        }
        return false;
    }

    /** Returns the current tags as a string array. */
    private _getTags(mesh: AbstractMesh): string[] {
        const tagStr = Tags.GetTags(mesh, true);
        return tagStr ? (tagStr as string).split(" ").filter(Boolean) : [];
    }

    /**
     * Returns the mesh's existing StandardMaterial, or creates and assigns a new one.
     * PBRMaterial is left as-is — callers that need PBR-specific handling check `instanceof` first.
     */
    private _ensureStandardMaterial(mesh: AbstractMesh): StandardMaterial {
        if (mesh.material instanceof StandardMaterial) return mesh.material;
        if (mesh.material instanceof PBRMaterial) return mesh.material as unknown as StandardMaterial; // handled by caller
        const mat = new StandardMaterial(`mcp_mat_${mesh.id}`, this._scene);
        mesh.material = mat;
        return mat;
    }

    // -------------------------------------------------------------------------
    // Internal — animation
    // -------------------------------------------------------------------------

    private _animate(uri: string, durationSecs: number, easingStr: string | undefined, onFrame: (easedT: number) => void, onComplete?: () => void): void {
        this._stopAnimation(uri);
        const easingFn = this._createEasingFunction(easingStr);
        let elapsed = 0;

        const observer = this._scene.onBeforeRenderObservable.add(() => {
            const dt = this._scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            const rawT = Math.min(elapsed / durationSecs, 1);
            const easedT = easingFn ? easingFn.ease(rawT) : rawT;
            onFrame(easedT);
            if (rawT >= 1) {
                this._stopAnimation(uri);
                onComplete?.();
            }
        });

        if (observer) this._activeAnimations.set(uri, observer);
    }

    private _stopAnimation(uri: string): void {
        const observer = this._activeAnimations.get(uri);
        if (observer) {
            this._scene.onBeforeRenderObservable.remove(observer);
            this._activeAnimations.delete(uri);
        }
    }

    private _stopAllAnimations(): void {
        for (const [uri] of this._activeAnimations) this._stopAnimation(uri);
    }

    private _createEasingFunction(easingStr?: string): EasingFunction | null {
        if (!easingStr) return null;
        const parts = easingStr.toLowerCase().split(".");
        const type = parts[0];
        const mode = parts[1] ?? "inout";
        if (type === "linear") return null;

        let easing: EasingFunction;
        switch (type) {
            case "sine":
                easing = new SineEase();
                break;
            case "quad":
                easing = new QuadraticEase();
                break;
            case "cubic":
                easing = new CubicEase();
                break;
            case "circle":
                easing = new CircleEase();
                break;
            case "expo":
                easing = new ExponentialEase();
                break;
            case "back":
                easing = new BackEase();
                break;
            case "bounce":
                easing = new BounceEase();
                break;
            case "elastic":
                easing = new ElasticEase();
                break;
            default:
                easing = new SineEase();
                break;
        }

        switch (mode) {
            case "in":
                easing.setEasingMode(EasingFunction.EASINGMODE_EASEIN);
                break;
            case "out":
                easing.setEasingMode(EasingFunction.EASINGMODE_EASEOUT);
                break;
            default:
                easing.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
                break;
        }

        return easing;
    }
}
