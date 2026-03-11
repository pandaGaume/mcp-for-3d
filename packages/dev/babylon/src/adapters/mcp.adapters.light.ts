import { Color3, DirectionalLight, Engine, EventState, HemisphericLight, Light, Nullable, Observer, PointLight, Scene, SpotLight, Vector3 } from "@babylonjs/core";
import { JsonRpcMimeType, McpAdapterBase, McpResourceContent, McpToolResult, McpToolResults } from "@dev/core";
import { IColor3, ILightPatch, ILightState, McpLightBehavior } from "@dev/behaviors";
import { McpBabylonDomain, McpLightResourceUriPrefix } from "../mcp.commons";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** All tool names exposed by this adapter, used in default error messages. */
const ALL_TOOLS = [
    McpLightBehavior.LightCreateFn,
    McpLightBehavior.LightRemoveFn,
    McpLightBehavior.LightSetEnabledFn,
    McpLightBehavior.LightSetIntensityFn,
    McpLightBehavior.LightSetDiffuseColorFn,
    McpLightBehavior.LightSetSpecularColorFn,
    McpLightBehavior.LightSetPositionFn,
    McpLightBehavior.LightSetDirectionFn,
    McpLightBehavior.LightSetTargetFn,
    McpLightBehavior.LightSetRangeFn,
    McpLightBehavior.LightSpotSetAngleFn,
    McpLightBehavior.LightSpotSetExponentFn,
    McpLightBehavior.LightHemiSetGroundColorFn,
    McpLightBehavior.SceneGetAmbientFn,
    McpLightBehavior.SceneSetAmbientColorFn,
    McpLightBehavior.SceneSetAmbientEnabledFn,
    McpLightBehavior.LightUpdateFn,
].join('", "');

/**
 * MCP adapter for Babylon.js lights.
 *
 * Bridges the MCP protocol layer and the live Babylon.js scene:
 * - `readResourceAsync` exposes the light list and individual light states as JSON resources.
 * - `executeToolAsync` dispatches tool calls to the matching light.
 *
 * The adapter maintains an internal URI→Light index, kept in sync with the scene
 * via `onNewLightAddedObservable` / `onLightRemovedObservable`.
 *
 * Scene ambient lighting is managed independently of individual lights via
 * `_ambientColor` (the "real" desired color) and `_ambientEnabled` (whether it is applied).
 * When disabled, `scene.ambientColor` is set to black; the stored color is restored on re-enable.
 *
 * All vectors use the right-handed y-up coordinate system.
 * When the scene uses the default left-handed system, Z is negated on the way in and out.
 */
export class McpLightAdapter extends McpAdapterBase {
    private _scene: Scene;
    private _indexedLights = new Map<string, Light>();
    private _observers: Nullable<Observer<Light>>[] = [];

    /**
     * URIs of lights created through `light_create`.
     * Only these may be disposed via `light_remove`; pre-existing scene lights are protected.
     */
    private _mcpCreatedLights = new Set<string>();

    /** Tracks the desired ambient color independently of the scene's current ambientColor. */
    private _ambientColor: Color3;
    /** Whether ambient is currently applied to the scene. */
    private _ambientEnabled = true;

    public constructor(scene?: Scene) {
        super(McpBabylonDomain);
        this._scene = scene ?? Engine.LastCreatedScene!;
        if (!this._scene) {
            throw new Error("McpLightAdapter requires a Babylon.js Scene. Provide one in the constructor or ensure Engine.LastCreatedScene is set.");
        }
        this._ambientColor = this._scene.ambientColor.clone();
        this._initializeLightIndex();
        this._observers.push(this._scene.onNewLightAddedObservable.add(this._onLightAdded.bind(this)));
        this._observers.push(this._scene.onLightRemovedObservable.add(this._onLightRemoved.bind(this)));
    }

    /**
     * Reads a light resource by URI.
     *
     * Two patterns:
     * - `{prefix}`        → full list of lights (id, name, type, enabled, uri).
     * - `{prefix}/{name}` → full {@link ILightState} of a single light.
     */
    public async readResourceAsync(uri: string): Promise<McpResourceContent | undefined> {
        let text: string | undefined;

        if (uri === McpLightResourceUriPrefix) {
            const lights = this._scene.lights.map((l) => ({
                uri: this._buildUriForLight(l),
                id: l.id,
                name: l.name,
                type: this._getLightType(l),
                enabled: l.isEnabled(),
            }));
            text = JSON.stringify(lights);
        } else if (uri.startsWith(`${McpLightResourceUriPrefix}/`)) {
            const light = this._indexedLights.get(uri);
            if (light) {
                text = JSON.stringify(this._getLightState(light));
            }
        }

        return text ? { uri, text, mimeType: JsonRpcMimeType } : undefined;
    }

    /**
     * Dispatches a tool call.
     *
     * Namespace-level tools (create, scene ambient) accept `uri = babylon://light`.
     * Instance-level tools require a valid `uri = babylon://light/{name}`.
     */
    public async executeToolAsync(uri: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
        // Namespace-level tools — no specific light required.
        switch (toolName) {
            case McpLightBehavior.LightCreateFn:
                return this._handleCreate(args);
            case McpLightBehavior.SceneGetAmbientFn:
                return this._handleSceneGetAmbient();
            case McpLightBehavior.SceneSetAmbientColorFn:
                return this._handleSceneSetAmbientColor(args);
            case McpLightBehavior.SceneSetAmbientEnabledFn:
                return this._handleSceneSetAmbientEnabled(args);
        }

        // Instance-level tools — look up the light by URI.
        const light = this._indexedLights.get(uri);
        if (!light) {
            return McpToolResults.error(`No light found for URI "${uri}". ` + `Read the resource "${McpLightResourceUriPrefix}" to get the list of available light URIs.`);
        }

        switch (toolName) {
            // -----------------------------------------------------------------
            // light.remove — only MCP-created lights may be disposed
            // -----------------------------------------------------------------
            case McpLightBehavior.LightRemoveFn: {
                if (!this._mcpCreatedLights.has(uri)) {
                    return McpToolResults.error(
                        `Light "${light.name}" was not created by the MCP server and cannot be removed. ` +
                            `Only lights created via "${McpLightBehavior.LightCreateFn}" are disposable.`
                    );
                }
                const name = light.name;
                light.dispose();
                return McpToolResults.text(`Light "${name}" removed from the scene.`);
            }

            // -----------------------------------------------------------------
            // light.setEnabled
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetEnabledFn: {
                const enabled = args["enabled"];
                if (typeof enabled !== "boolean") {
                    return McpToolResults.error(`Invalid "enabled" for "${toolName}". Expected a boolean, got: ${JSON.stringify(enabled)}`);
                }
                light.setEnabled(enabled);
                return McpToolResults.text(`Light "${light.name}" ${enabled ? "enabled" : "disabled"}.`);
            }

            // -----------------------------------------------------------------
            // light.setIntensity
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetIntensityFn: {
                const intensity = args["intensity"];
                if (typeof intensity !== "number" || !isFinite(intensity) || intensity < 0) {
                    return McpToolResults.error(`Invalid "intensity" for "${toolName}". Expected a non-negative number, got: ${JSON.stringify(intensity)}`);
                }
                light.intensity = intensity;
                return McpToolResults.text(`Light "${light.name}" intensity set to ${intensity}.`);
            }

            // -----------------------------------------------------------------
            // light.setDiffuseColor
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetDiffuseColorFn: {
                const color = args["color"] as IColor3 | undefined;
                if (!this._isColor3(color)) return this._color3Error(toolName, "color", args["color"]);
                light.diffuse.copyFromFloats(color.r, color.g, color.b);
                return McpToolResults.text(`Light "${light.name}" diffuse color set to rgb(${color.r}, ${color.g}, ${color.b}).`);
            }

            // -----------------------------------------------------------------
            // light.setSpecularColor
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetSpecularColorFn: {
                const color = args["color"] as IColor3 | undefined;
                if (!this._isColor3(color)) return this._color3Error(toolName, "color", args["color"]);
                light.specular.copyFromFloats(color.r, color.g, color.b);
                return McpToolResults.text(`Light "${light.name}" specular color set to rgb(${color.r}, ${color.g}, ${color.b}).`);
            }

            // -----------------------------------------------------------------
            // light.setPosition
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetPositionFn: {
                if (!(light instanceof PointLight) && !(light instanceof SpotLight) && !(light instanceof DirectionalLight)) {
                    return McpToolResults.error(
                        `"${toolName}" is not applicable to ${this._getLightType(light)} lights. ` + `Only point, spot, and directional lights have a position.`
                    );
                }
                const position = args["position"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(position)) return this._vec3Error(toolName, "position", args["position"]);
                light.position.copyFrom(this._toBjsVec3(position));
                return McpToolResults.text(`Light "${light.name}" position set to (${position.x}, ${position.y}, ${position.z}).`);
            }

            // -----------------------------------------------------------------
            // light.setDirection
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetDirectionFn: {
                if (!(light instanceof DirectionalLight) && !(light instanceof SpotLight) && !(light instanceof HemisphericLight)) {
                    return McpToolResults.error(
                        `"${toolName}" is not applicable to ${this._getLightType(light)} lights. ` + `Only directional, spot, and hemispheric lights have a direction.`
                    );
                }
                const direction = args["direction"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(direction)) return this._vec3Error(toolName, "direction", args["direction"]);
                light.direction.copyFrom(this._toBjsVec3(direction));
                return McpToolResults.text(`Light "${light.name}" direction set to (${direction.x}, ${direction.y}, ${direction.z}).`);
            }

            // -----------------------------------------------------------------
            // light.setTarget
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetTargetFn: {
                if (!(light instanceof SpotLight) && !(light instanceof DirectionalLight)) {
                    return McpToolResults.error(
                        `"${toolName}" is only applicable to spot and directional lights. ` + `Light "${light.name}" is of type ${this._getLightType(light)}.`
                    );
                }
                const target = args["target"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(target)) return this._vec3Error(toolName, "target", args["target"]);
                const tgtVec = this._toBjsVec3(target);
                const newDir = tgtVec.subtract(light.position).normalize();
                light.direction.copyFrom(newDir);
                return McpToolResults.text(
                    `Light "${light.name}" aimed at (${target.x}, ${target.y}, ${target.z}). ` +
                        `Direction: (${newDir.x.toFixed(3)}, ${newDir.y.toFixed(3)}, ${newDir.z.toFixed(3)}).`
                );
            }

            // -----------------------------------------------------------------
            // light.setRange
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSetRangeFn: {
                if (!(light instanceof PointLight) && !(light instanceof SpotLight)) {
                    return McpToolResults.error(`"${toolName}" is only applicable to point and spot lights. ` + `Light "${light.name}" is of type ${this._getLightType(light)}.`);
                }
                const range = args["range"];
                if (typeof range !== "number" || !isFinite(range) || range <= 0) {
                    return McpToolResults.error(`Invalid "range" for "${toolName}". Expected a positive number, got: ${JSON.stringify(range)}`);
                }
                light.range = range;
                return McpToolResults.text(`Light "${light.name}" range set to ${range}.`);
            }

            // -----------------------------------------------------------------
            // light.spot.setAngle
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSpotSetAngleFn: {
                if (!(light instanceof SpotLight)) {
                    return McpToolResults.error(`"${toolName}" is only applicable to spot lights. ` + `Light "${light.name}" is of type ${this._getLightType(light)}.`);
                }
                const angle = args["angle"];
                if (typeof angle !== "number" || !isFinite(angle) || angle <= 0 || angle >= 90) {
                    return McpToolResults.error(`Invalid "angle" for "${toolName}". Expected a number in (0, 90) degrees, got: ${JSON.stringify(angle)}`);
                }
                light.angle = angle * DEG_TO_RAD;
                return McpToolResults.text(`Spot light "${light.name}" cone angle set to ${angle}°.`);
            }

            // -----------------------------------------------------------------
            // light.spot.setExponent
            // -----------------------------------------------------------------
            case McpLightBehavior.LightSpotSetExponentFn: {
                if (!(light instanceof SpotLight)) {
                    return McpToolResults.error(`"${toolName}" is only applicable to spot lights. ` + `Light "${light.name}" is of type ${this._getLightType(light)}.`);
                }
                const exponent = args["exponent"];
                if (typeof exponent !== "number" || !isFinite(exponent) || exponent < 0) {
                    return McpToolResults.error(`Invalid "exponent" for "${toolName}". Expected a non-negative number, got: ${JSON.stringify(exponent)}`);
                }
                light.exponent = exponent;
                return McpToolResults.text(`Spot light "${light.name}" exponent set to ${exponent}.`);
            }

            // -----------------------------------------------------------------
            // light.hemi.setGroundColor
            // -----------------------------------------------------------------
            case McpLightBehavior.LightHemiSetGroundColorFn: {
                if (!(light instanceof HemisphericLight)) {
                    return McpToolResults.error(`"${toolName}" is only applicable to hemispheric lights. ` + `Light "${light.name}" is of type ${this._getLightType(light)}.`);
                }
                const color = args["color"] as IColor3 | undefined;
                if (!this._isColor3(color)) return this._color3Error(toolName, "color", args["color"]);
                light.groundColor.copyFromFloats(color.r, color.g, color.b);
                return McpToolResults.text(`Hemispheric light "${light.name}" ground color set to rgb(${color.r}, ${color.g}, ${color.b}).`);
            }

            // -----------------------------------------------------------------
            // light.update — batch patch
            // -----------------------------------------------------------------
            case McpLightBehavior.LightUpdateFn:
                return this._handleUpdate(light, args);

            // -----------------------------------------------------------------
            // Unknown
            // -----------------------------------------------------------------
            default:
                return McpToolResults.error(`Unknown tool "${toolName}" for light adapter. Available tools: "${ALL_TOOLS}".`);
        }
    }

    public override dispose(): void {
        super.dispose();
        this._observers.forEach((o) => o?.remove());
    }

    // -------------------------------------------------------------------------
    // Namespace-level handlers
    // -------------------------------------------------------------------------

    private _handleCreate(args: Record<string, unknown>): McpToolResult {
        const type = args["type"] as string | undefined;
        const name = args["name"] as string | undefined;

        if (!name || typeof name !== "string") {
            return McpToolResults.error(`"name" is required for "${McpLightBehavior.LightCreateFn}".`);
        }

        let light: Light;

        switch (type) {
            case "point": {
                const pos = args["position"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(pos)) {
                    return McpToolResults.error(`"position" ({x, y, z}) is required to create a point light.`);
                }
                light = new PointLight(name, this._toBjsVec3(pos), this._scene);
                break;
            }
            case "directional": {
                const dir = args["direction"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(dir)) {
                    return McpToolResults.error(`"direction" ({x, y, z}) is required to create a directional light.`);
                }
                light = new DirectionalLight(name, this._toBjsVec3(dir), this._scene);
                break;
            }
            case "spot": {
                const pos = args["position"] as { x: number; y: number; z: number } | undefined;
                const dir = args["direction"] as { x: number; y: number; z: number } | undefined;
                const angle = args["angle"] as number | undefined;
                if (!this._isVec3(pos)) {
                    return McpToolResults.error(`"position" ({x, y, z}) is required to create a spot light.`);
                }
                if (!this._isVec3(dir)) {
                    return McpToolResults.error(`"direction" ({x, y, z}) is required to create a spot light.`);
                }
                if (typeof angle !== "number" || !isFinite(angle) || angle <= 0) {
                    return McpToolResults.error(`"angle" (degrees, > 0) is required to create a spot light.`);
                }
                const exponent = typeof args["exponent"] === "number" ? (args["exponent"] as number) : 2;
                light = new SpotLight(name, this._toBjsVec3(pos), this._toBjsVec3(dir), angle * DEG_TO_RAD, exponent, this._scene);
                break;
            }
            case "hemispheric": {
                const dir = args["direction"] as { x: number; y: number; z: number } | undefined;
                if (!this._isVec3(dir)) {
                    return McpToolResults.error(`"direction" ({x, y, z}) is required to create a hemispheric light.`);
                }
                light = new HemisphericLight(name, this._toBjsVec3(dir), this._scene);
                break;
            }
            default:
                return McpToolResults.error(
                    `Invalid "type" for "${McpLightBehavior.LightCreateFn}". ` + `Expected "point", "directional", "spot", or "hemispheric", got: ${JSON.stringify(type)}`
                );
        }

        // Apply optional common properties.
        if (typeof args["intensity"] === "number" && isFinite(args["intensity"] as number)) {
            light.intensity = args["intensity"] as number;
        }
        const diffuse = args["diffuseColor"] as IColor3 | undefined;
        if (this._isColor3(diffuse)) light.diffuse.copyFromFloats(diffuse.r, diffuse.g, diffuse.b);

        const specular = args["specularColor"] as IColor3 | undefined;
        if (this._isColor3(specular)) light.specular.copyFromFloats(specular.r, specular.g, specular.b);

        if (light instanceof HemisphericLight) {
            const ground = args["groundColor"] as IColor3 | undefined;
            if (this._isColor3(ground)) light.groundColor.copyFromFloats(ground.r, ground.g, ground.b);
        }

        if ((light instanceof PointLight || light instanceof SpotLight) && typeof args["range"] === "number" && (args["range"] as number) > 0) {
            light.range = args["range"] as number;
        }

        // The observable handler adds the light to the index synchronously when the constructor fires.
        const lightUri = this._buildUriForLight(light);
        // Mark as MCP-owned so light_remove is allowed for it.
        this._mcpCreatedLights.add(lightUri);
        return McpToolResults.json({ uri: lightUri });
    }

    private _handleSceneGetAmbient(): McpToolResult {
        return McpToolResults.json({
            enabled: this._ambientEnabled,
            color: {
                r: this._ambientColor.r,
                g: this._ambientColor.g,
                b: this._ambientColor.b,
            },
        });
    }

    private _handleSceneSetAmbientColor(args: Record<string, unknown>): McpToolResult {
        const color = args["color"] as IColor3 | undefined;
        if (!this._isColor3(color)) return this._color3Error(McpLightBehavior.SceneSetAmbientColorFn, "color", args["color"]);

        // Always update the stored color.
        this._ambientColor.copyFromFloats(color.r, color.g, color.b);

        // Apply to scene only when ambient is currently enabled.
        if (this._ambientEnabled) {
            this._scene.ambientColor.copyFromFloats(color.r, color.g, color.b);
        }

        return McpToolResults.text(`Scene ambient color set to rgb(${color.r}, ${color.g}, ${color.b}).`);
    }

    private _handleSceneSetAmbientEnabled(args: Record<string, unknown>): McpToolResult {
        const enabled = args["enabled"];
        if (typeof enabled !== "boolean") {
            return McpToolResults.error(`Invalid "enabled" for "${McpLightBehavior.SceneSetAmbientEnabledFn}". Expected a boolean.`);
        }

        if (enabled === this._ambientEnabled) {
            return McpToolResults.text(`Scene ambient is already ${enabled ? "enabled" : "disabled"}.`);
        }

        this._ambientEnabled = enabled;

        if (enabled) {
            this._scene.ambientColor.copyFrom(this._ambientColor);
        } else {
            // Store the current scene color as the "real" value before blanking it.
            this._ambientColor.copyFrom(this._scene.ambientColor);
            this._scene.ambientColor.copyFromFloats(0, 0, 0);
        }

        return McpToolResults.text(`Scene ambient lighting ${enabled ? "enabled" : "disabled"}.`);
    }

    // -------------------------------------------------------------------------
    // light.update — batch patch
    // -------------------------------------------------------------------------

    private _handleUpdate(light: Light, args: Record<string, unknown>): McpToolResult {
        const patch = args["patch"] as ILightPatch | undefined;
        if (!patch || typeof patch !== "object") {
            return McpToolResults.error(`"patch" must be an object for "${McpLightBehavior.LightUpdateFn}".`);
        }

        const type = this._getLightType(light);
        const applied: string[] = [];
        const ignored: string[] = [];

        if (typeof patch.enabled === "boolean") {
            light.setEnabled(patch.enabled);
            applied.push("enabled");
        }

        if (typeof patch.intensity === "number" && isFinite(patch.intensity) && patch.intensity >= 0) {
            light.intensity = patch.intensity;
            applied.push("intensity");
        }

        if (this._isColor3(patch.diffuseColor)) {
            light.diffuse.copyFromFloats(patch.diffuseColor.r, patch.diffuseColor.g, patch.diffuseColor.b);
            applied.push("diffuseColor");
        }

        if (this._isColor3(patch.specularColor)) {
            light.specular.copyFromFloats(patch.specularColor.r, patch.specularColor.g, patch.specularColor.b);
            applied.push("specularColor");
        }

        if (patch.position !== undefined) {
            if (light instanceof PointLight || light instanceof SpotLight || light instanceof DirectionalLight) {
                if (this._isVec3(patch.position)) {
                    light.position.copyFrom(this._toBjsVec3(patch.position));
                    applied.push("position");
                }
            } else {
                ignored.push(`position (not applicable to ${type})`);
            }
        }

        if (patch.direction !== undefined) {
            if (light instanceof DirectionalLight || light instanceof SpotLight || light instanceof HemisphericLight) {
                if (this._isVec3(patch.direction)) {
                    light.direction.copyFrom(this._toBjsVec3(patch.direction));
                    applied.push("direction");
                }
            } else {
                ignored.push(`direction (not applicable to ${type})`);
            }
        }

        if (patch.range !== undefined) {
            if (light instanceof PointLight || light instanceof SpotLight) {
                if (typeof patch.range === "number" && isFinite(patch.range) && patch.range > 0) {
                    light.range = patch.range;
                    applied.push("range");
                }
            } else {
                ignored.push(`range (not applicable to ${type})`);
            }
        }

        if (patch.angle !== undefined) {
            if (light instanceof SpotLight) {
                if (typeof patch.angle === "number" && isFinite(patch.angle) && patch.angle > 0) {
                    light.angle = patch.angle * DEG_TO_RAD;
                    applied.push("angle");
                }
            } else {
                ignored.push(`angle (not applicable to ${type})`);
            }
        }

        if (patch.exponent !== undefined) {
            if (light instanceof SpotLight) {
                if (typeof patch.exponent === "number" && isFinite(patch.exponent) && patch.exponent >= 0) {
                    light.exponent = patch.exponent;
                    applied.push("exponent");
                }
            } else {
                ignored.push(`exponent (not applicable to ${type})`);
            }
        }

        if (patch.groundColor !== undefined) {
            if (light instanceof HemisphericLight) {
                if (this._isColor3(patch.groundColor)) {
                    light.groundColor.copyFromFloats(patch.groundColor.r, patch.groundColor.g, patch.groundColor.b);
                    applied.push("groundColor");
                }
            } else {
                ignored.push(`groundColor (not applicable to ${type})`);
            }
        }

        let msg = `Light "${light.name}" updated.`;
        if (applied.length > 0) msg += ` Applied: ${applied.join(", ")}.`;
        if (ignored.length > 0) msg += ` Ignored (type mismatch): ${ignored.join("; ")}.`;

        return McpToolResults.text(msg);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /** Populates the URI→Light index from the lights already present in the scene. */
    private _initializeLightIndex(): void {
        this._scene.lights.forEach((light) => {
            this._indexedLights.set(this._buildUriForLight(light), light);
        });
    }

    /** Returns the MCP resource URI for a given light, e.g. `babylon://light/Sun`. */
    private _buildUriForLight(light: Light): string {
        return `${McpLightResourceUriPrefix}/${light.name}`;
    }

    /** Returns the MCP light type string for a Babylon.js Light instance. */
    private _getLightType(light: Light): string {
        if (light instanceof SpotLight) return "spot";
        if (light instanceof PointLight) return "point";
        if (light instanceof DirectionalLight) return "directional";
        if (light instanceof HemisphericLight) return "hemispheric";
        return "unknown";
    }

    /** Called when a new light is added to the scene. */
    private _onLightAdded(eventData: Light, _eventState: EventState): void {
        const uri = this._buildUriForLight(eventData);
        this._indexedLights.set(uri, eventData);
        this._forwardResourceChanged();
    }

    /** Called when a light is removed from the scene (by any means, including light_remove and external BJS code). */
    private _onLightRemoved(eventData: Light, _eventState: EventState): void {
        const uri = this._buildUriForLight(eventData);
        this._indexedLights.delete(uri);
        this._mcpCreatedLights.delete(uri);
        this._forwardResourceChanged();
    }

    /**
     * Serializes the current state of a Babylon.js Light into an {@link ILightState}.
     * All vectors are expressed in right-handed y-up world space.
     * When `scene.useRightHandedSystem` is false (BJS default), Z is negated on the way out.
     */
    private _getLightState(light: Light): ILightState {
        const zSign = this._scene.useRightHandedSystem ? 1 : -1;

        const base = {
            id: light.id,
            name: light.name,
            enabled: light.isEnabled(),
            intensity: light.intensity,
            diffuseColor: { r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b },
            specularColor: { r: light.specular.r, g: light.specular.g, b: light.specular.b },
        };

        if (light instanceof SpotLight) {
            return {
                ...base,
                type: "spot",
                position: { x: light.position.x, y: light.position.y, z: light.position.z * zSign },
                direction: { x: light.direction.x, y: light.direction.y, z: light.direction.z * zSign },
                angle: light.angle * RAD_TO_DEG,
                exponent: light.exponent,
                ...(light.range > 0 ? { range: light.range } : {}),
            };
        }

        if (light instanceof PointLight) {
            return {
                ...base,
                type: "point",
                position: { x: light.position.x, y: light.position.y, z: light.position.z * zSign },
                ...(light.range > 0 ? { range: light.range } : {}),
            };
        }

        if (light instanceof DirectionalLight) {
            return {
                ...base,
                type: "directional",
                direction: { x: light.direction.x, y: light.direction.y, z: light.direction.z * zSign },
                position: { x: light.position.x, y: light.position.y, z: light.position.z * zSign },
            };
        }

        if (light instanceof HemisphericLight) {
            return {
                ...base,
                type: "hemispheric",
                direction: { x: light.direction.x, y: light.direction.y, z: light.direction.z * zSign },
                groundColor: { r: light.groundColor.r, g: light.groundColor.g, b: light.groundColor.b },
            };
        }

        // Fallback for unknown/future light types — return a minimal directional state.
        return {
            ...base,
            type: "directional",
            direction: { x: 0, y: -1, z: 0 },
        };
    }

    /**
     * Converts a right-handed y-up input vector to a Babylon.js internal Vector3.
     * When the scene uses the default left-handed system, Z is negated.
     */
    private _toBjsVec3(v: { x: number; y: number; z: number }): Vector3 {
        return new Vector3(v.x, v.y, this._scene.useRightHandedSystem ? v.z : -v.z);
    }

    /** Returns true when `v` is a non-null object with finite numeric r, g, b fields. */
    private _isColor3(v: unknown): v is IColor3 {
        if (!v || typeof v !== "object") return false;
        const o = v as Record<string, unknown>;
        return typeof o["r"] === "number" && typeof o["g"] === "number" && typeof o["b"] === "number" && isFinite(o["r"]) && isFinite(o["g"]) && isFinite(o["b"]);
    }

    /** Returns true when `v` is a non-null object with finite numeric x, y, z fields. */
    private _isVec3(v: unknown): v is { x: number; y: number; z: number } {
        if (!v || typeof v !== "object") return false;
        const o = v as Record<string, unknown>;
        return typeof o["x"] === "number" && typeof o["y"] === "number" && typeof o["z"] === "number" && isFinite(o["x"]) && isFinite(o["y"]) && isFinite(o["z"]);
    }

    /** Builds a standardised argument-validation error for color3 parameters. */
    private _color3Error(toolName: string, paramName: string, received: unknown): McpToolResult {
        return McpToolResults.error(
            `Invalid "${paramName}" argument for "${toolName}". ` +
                `Expected an object with finite numeric fields r, g, b (each in [0, 1]). ` +
                `Received: ${JSON.stringify(received)}`
        );
    }

    /** Builds a standardised argument-validation error for vec3 parameters. */
    private _vec3Error(toolName: string, paramName: string, received: unknown): McpToolResult {
        return McpToolResults.error(
            `Invalid "${paramName}" argument for "${toolName}". ` +
                `Expected an object with finite numeric fields x, y, z (right-handed y-up). ` +
                `Received: ${JSON.stringify(received)}`
        );
    }
}
