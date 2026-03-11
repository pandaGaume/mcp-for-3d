import { IMcpBehaviorAdapter, JsonRpcMimeType, McpBehavior, McpBehaviorOptions, McpGrammar, McpResource, McpResourceTemplate, McpTool } from "@dev/core";
import { McpLightNamespace } from "../mcp.commons";

export class McpLightBehavior extends McpBehavior {
    // -------------------------------------------------------------------------
    // Tool name constants
    // -------------------------------------------------------------------------

    /** Creates a new light in the scene. */
    public static readonly LightCreateFn = "light_create";

    /** Removes a light from the scene and disposes it. */
    public static readonly LightRemoveFn = "light_remove";

    /** Enables or disables a light without removing it. */
    public static readonly LightSetEnabledFn = "light_set_enabled";

    /** Sets the intensity (brightness multiplier) of a light. */
    public static readonly LightSetIntensityFn = "light_set_intensity";

    /** Sets the diffuse (main) color emitted by a light. */
    public static readonly LightSetDiffuseColorFn = "light_set_diffuse_color";

    /** Sets the specular (highlight) color emitted by a light. */
    public static readonly LightSetSpecularColorFn = "light_set_specular_color";

    /** Sets the world-space position of a positional light (point, spot, directional). */
    public static readonly LightSetPositionFn = "light_set_position";

    /** Sets the direction vector of a directional, spot, or hemispheric light. */
    public static readonly LightSetDirectionFn = "light_set_direction";

    /**
     * Aims a spot or directional light at a world-space target point.
     * Computes direction = normalize(target − position).
     */
    public static readonly LightSetTargetFn = "light_set_target";

    /** Sets the effective range of a point or spot light in world units. */
    public static readonly LightSetRangeFn = "light_set_range";

    /** Sets the cone half-angle (degrees) of a spot light. */
    public static readonly LightSpotSetAngleFn = "light_spot_set_angle";

    /** Sets the falloff exponent of a spot light. */
    public static readonly LightSpotSetExponentFn = "light_spot_set_exponent";

    /** Sets the ground (bottom hemisphere) color of a hemispheric light. */
    public static readonly LightHemiSetGroundColorFn = "light_hemi_set_ground_color";

    /** Returns the current scene-level ambient color and enabled state. */
    public static readonly SceneGetAmbientFn = "scene_get_ambient";

    /** Sets the scene ambient color (scene.ambientColor). */
    public static readonly SceneSetAmbientColorFn = "scene_set_ambient_color";

    /** Enables or disables scene ambient lighting; restores the previous color when re-enabled. */
    public static readonly SceneSetAmbientEnabledFn = "scene_set_ambient_enabled";

    /** Applies a partial patch to a light; inapplicable fields are silently ignored. */
    public static readonly LightUpdateFn = "light_update";

    // -------------------------------------------------------------------------

    public constructor(adapter: IMcpBehaviorAdapter, options: McpBehaviorOptions = {}) {
        super(adapter, {
            ...options,
            domain: options.domain ?? adapter.domain,
            namespace: options.namespace ?? McpLightNamespace,
        });
    }

    protected override _buildDefaultGrammar(): McpGrammar {
        const g = new McpGrammar();

        // ── light_create ────────────────────────────────────────────────────
        g.setToolDescription(
            McpLightBehavior.LightCreateFn,
            "Creates a new light in the scene. Required fields vary by type:\n" +
                "- point: name, position\n" +
                "- directional: name, direction\n" +
                "- spot: name, position, direction, angle\n" +
                "- hemispheric: name, direction\n" +
                "Returns the URI of the newly created light."
        );
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "type", "Type of light to create.");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "name", "Name for the new light. Must be unique in the scene.");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "position", "World-space position (right-handed y-up). Required for point and spot.");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "direction", "Direction vector (right-handed y-up). Required for directional, spot, and hemispheric.");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "angle", "Cone half-angle in degrees. Required for spot. Must be in (0, 90).");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "exponent", "Falloff exponent. Spot only, optional (default 2).");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "intensity", "Initial intensity (default 1).");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "diffuseColor", "Initial diffuse color (default white).");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "specularColor", "Initial specular color (default white).");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "groundColor", "Initial ground color. Hemispheric only, optional.");
        g.setPropertyDescription(McpLightBehavior.LightCreateFn, "range", "Effective range in world units. Point and spot only, optional.");

        // ── light_remove ────────────────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightRemoveFn, "Removes a light from the scene and disposes all its resources.");

        // ── light_set_enabled ───────────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightSetEnabledFn, "Enables or disables a light without removing it from the scene.");
        g.setPropertyDescription(McpLightBehavior.LightSetEnabledFn, "enabled", "True to enable the light, false to disable it.");

        // ── light_set_intensity ─────────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightSetIntensityFn, "Sets the intensity (brightness multiplier) of a light. Default is 1. Values above 1 overbrighten.");
        g.setPropertyDescription(McpLightBehavior.LightSetIntensityFn, "intensity", "New intensity. Must be >= 0.");

        // ── light_set_diffuse_color ─────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightSetDiffuseColorFn, "Sets the diffuse (main) color emitted by a light. Channels are in [0, 1].");

        // ── light_set_specular_color ────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightSetSpecularColorFn, "Sets the specular (highlight) color emitted by a light. Channels are in [0, 1].");

        // ── light_set_position ──────────────────────────────────────────────
        g.setToolDescription(
            McpLightBehavior.LightSetPositionFn,
            "Sets the world-space position of a light. " +
                "For point and spot lights this is the emission origin. " +
                "For directional lights it only moves the shadow-frustum origin (no effect on light direction). " +
                "Not applicable to hemispheric lights."
        );
        g.setPropertyDescription(McpLightBehavior.LightSetPositionFn, "position", "New world-space position (right-handed y-up).");

        // ── light_set_direction ─────────────────────────────────────────────
        g.setToolDescription(
            McpLightBehavior.LightSetDirectionFn,
            "Sets the direction vector of a directional, spot, or hemispheric light. " +
                "The vector is normalised internally. " +
                "For hemispheric lights, direction points toward the sky (bright hemisphere). " +
                "Not applicable to point lights."
        );
        g.setPropertyDescription(McpLightBehavior.LightSetDirectionFn, "direction", "New direction vector (right-handed y-up). Will be normalised.");

        // ── light_set_target ────────────────────────────────────────────────
        g.setToolDescription(
            McpLightBehavior.LightSetTargetFn,
            "Aims a spot or directional light at a world-space target point. " +
                "Computes direction = normalize(target − position). " +
                "Only applicable to spot and directional lights (requires a position)."
        );
        g.setPropertyDescription(McpLightBehavior.LightSetTargetFn, "target", "World-space point to aim the light at (right-handed y-up).");

        // ── light_set_range ─────────────────────────────────────────────────
        g.setToolDescription(
            McpLightBehavior.LightSetRangeFn,
            "Sets the effective range of a point or spot light. Beyond this distance the light contributes nothing. Not applicable to directional or hemispheric lights."
        );
        g.setPropertyDescription(McpLightBehavior.LightSetRangeFn, "range", "Range in world units. Must be > 0.");

        // ── light_spot_set_angle ────────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightSpotSetAngleFn, "Sets the cone half-angle of a spot light in degrees. Smaller angle = tighter, more focused beam. Only applicable to spot lights.");
        g.setPropertyDescription(McpLightBehavior.LightSpotSetAngleFn, "angle", "Cone half-angle in degrees. Must be in (0, 90).");

        // ── light_spot_set_exponent ─────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightSpotSetExponentFn, "Sets the falloff exponent of a spot light. Higher values concentrate the light toward the cone axis. Only applicable to spot lights.");
        g.setPropertyDescription(McpLightBehavior.LightSpotSetExponentFn, "exponent", "Falloff exponent. Must be >= 0.");

        // ── light_hemi_set_ground_color ─────────────────────────────────────
        g.setToolDescription(McpLightBehavior.LightHemiSetGroundColorFn, "Sets the ground (bottom hemisphere) color of a hemispheric light. Channels are in [0, 1]. Only applicable to hemispheric lights.");

        // ── scene_get_ambient ───────────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.SceneGetAmbientFn, "Returns the current scene-level ambient light: enabled state and color (r, g, b in [0, 1]).");

        // ── scene_set_ambient_color ─────────────────────────────────────────
        g.setToolDescription(McpLightBehavior.SceneSetAmbientColorFn, "Sets the scene ambient color (scene.ambientColor). Affects all materials that use ambient. Channels are in [0, 1].");

        // ── scene_set_ambient_enabled ───────────────────────────────────────
        g.setToolDescription(McpLightBehavior.SceneSetAmbientEnabledFn, "Enables or disables scene ambient lighting. When disabled, scene.ambientColor is set to black; the previous color is restored when re-enabled.");
        g.setPropertyDescription(McpLightBehavior.SceneSetAmbientEnabledFn, "enabled", "True to enable ambient, false to disable.");

        // ── light_update ────────────────────────────────────────────────────
        g.setToolDescription(
            McpLightBehavior.LightUpdateFn,
            "Applies a partial patch to an existing light in one call. " +
                "Fields that are not applicable to the light type are silently ignored (reported in the response). " +
                "Useful for batching multiple property changes without issuing separate tool calls."
        );
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch", "Partial state to apply. All fields optional.");
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch.position", "point, spot, directional (shadow frustum).");
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch.direction", "directional, spot, hemispheric.");
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch.range", "point, spot only.");
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch.angle", "Spot only. Cone half-angle in degrees.");
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch.exponent", "Spot only. Falloff exponent.");
        g.setPropertyDescription(McpLightBehavior.LightUpdateFn, "patch.groundColor", "Hemispheric only. Ground color.");

        return g;
    }

    protected override _buildTools(): McpTool[] {
        const vec3 = {
            type: "object",
            properties: {
                x: { type: "number" },
                y: { type: "number" },
                z: { type: "number" },
            },
            required: ["x", "y", "z"],
            additionalProperties: false,
        };

        const color3 = {
            type: "object",
            properties: {
                r: { type: "number", description: "Red channel [0–1]." },
                g: { type: "number", description: "Green channel [0–1]." },
                b: { type: "number", description: "Blue channel [0–1]." },
            },
            required: ["r", "g", "b"],
            additionalProperties: false,
        };

        const namespaceUriDesc = `Namespace URI. Always pass "${this.baseUri}" for this tool.`;
        const lightUriDesc = `Light URI, e.g. ${this.baseUri}/MyLight. Read the resource ${this.baseUri} to list available URIs.`;

        return [
            // -----------------------------------------------------------------
            // light.create
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightCreateFn,
                description: this._resolveToolDescription(
                    McpLightBehavior.LightCreateFn,
                    "Creates a new light in the scene. Required fields vary by type:\n" +
                        "- point: name, position\n" +
                        "- directional: name, direction\n" +
                        "- spot: name, position, direction, angle\n" +
                        "- hemispheric: name, direction\n" +
                        "Returns the URI of the newly created light."
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "uri", namespaceUriDesc) },
                        type: {
                            type: "string",
                            enum: ["point", "directional", "spot", "hemispheric"],
                            description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "type", "Type of light to create."),
                        },
                        name: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "name", "Name for the new light. Must be unique in the scene.") },
                        position: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "position", "World-space position (right-handed y-up). Required for point and spot.") },
                        direction: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "direction", "Direction vector (right-handed y-up). Required for directional, spot, and hemispheric.") },
                        angle: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "angle", "Cone half-angle in degrees. Required for spot. Must be in (0, 90).") },
                        exponent: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "exponent", "Falloff exponent. Spot only, optional (default 2).") },
                        intensity: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "intensity", "Initial intensity (default 1).") },
                        diffuseColor: { ...color3, description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "diffuseColor", "Initial diffuse color (default white).") },
                        specularColor: { ...color3, description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "specularColor", "Initial specular color (default white).") },
                        groundColor: { ...color3, description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "groundColor", "Initial ground color. Hemispheric only, optional.") },
                        range: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightCreateFn, "range", "Effective range in world units. Point and spot only, optional.") },
                    },
                    required: ["uri", "type", "name"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.remove
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightRemoveFn,
                description: this._resolveToolDescription(McpLightBehavior.LightRemoveFn, "Removes a light from the scene and disposes all its resources."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightRemoveFn, "uri", lightUriDesc) },
                    },
                    required: ["uri"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setEnabled
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetEnabledFn,
                description: this._resolveToolDescription(McpLightBehavior.LightSetEnabledFn, "Enables or disables a light without removing it from the scene."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetEnabledFn, "uri", lightUriDesc) },
                        enabled: { type: "boolean", description: this._resolvePropertyDescription(McpLightBehavior.LightSetEnabledFn, "enabled", "True to enable the light, false to disable it.") },
                    },
                    required: ["uri", "enabled"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setIntensity
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetIntensityFn,
                description: this._resolveToolDescription(McpLightBehavior.LightSetIntensityFn, "Sets the intensity (brightness multiplier) of a light. Default is 1. Values above 1 overbrighten."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetIntensityFn, "uri", lightUriDesc) },
                        intensity: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightSetIntensityFn, "intensity", "New intensity. Must be >= 0.") },
                    },
                    required: ["uri", "intensity"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setDiffuseColor
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetDiffuseColorFn,
                description: this._resolveToolDescription(McpLightBehavior.LightSetDiffuseColorFn, "Sets the diffuse (main) color emitted by a light. Channels are in [0, 1]."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetDiffuseColorFn, "uri", lightUriDesc) },
                        color: color3,
                    },
                    required: ["uri", "color"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setSpecularColor
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetSpecularColorFn,
                description: this._resolveToolDescription(McpLightBehavior.LightSetSpecularColorFn, "Sets the specular (highlight) color emitted by a light. Channels are in [0, 1]."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetSpecularColorFn, "uri", lightUriDesc) },
                        color: color3,
                    },
                    required: ["uri", "color"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setPosition
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetPositionFn,
                description: this._resolveToolDescription(
                    McpLightBehavior.LightSetPositionFn,
                    "Sets the world-space position of a light. " +
                        "For point and spot lights this is the emission origin. " +
                        "For directional lights it only moves the shadow-frustum origin (no effect on light direction). " +
                        "Not applicable to hemispheric lights."
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetPositionFn, "uri", lightUriDesc) },
                        position: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightSetPositionFn, "position", "New world-space position (right-handed y-up).") },
                    },
                    required: ["uri", "position"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setDirection
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetDirectionFn,
                description: this._resolveToolDescription(
                    McpLightBehavior.LightSetDirectionFn,
                    "Sets the direction vector of a directional, spot, or hemispheric light. " +
                        "The vector is normalised internally. " +
                        "For hemispheric lights, direction points toward the sky (bright hemisphere). " +
                        "Not applicable to point lights."
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetDirectionFn, "uri", lightUriDesc) },
                        direction: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightSetDirectionFn, "direction", "New direction vector (right-handed y-up). Will be normalised.") },
                    },
                    required: ["uri", "direction"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setTarget
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetTargetFn,
                description: this._resolveToolDescription(
                    McpLightBehavior.LightSetTargetFn,
                    "Aims a spot or directional light at a world-space target point. " +
                        "Computes direction = normalize(target − position). " +
                        "Only applicable to spot and directional lights (requires a position)."
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetTargetFn, "uri", lightUriDesc) },
                        target: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightSetTargetFn, "target", "World-space point to aim the light at (right-handed y-up).") },
                    },
                    required: ["uri", "target"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.setRange
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSetRangeFn,
                description: this._resolveToolDescription(
                    McpLightBehavior.LightSetRangeFn,
                    "Sets the effective range of a point or spot light. Beyond this distance the light contributes nothing. Not applicable to directional or hemispheric lights."
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSetRangeFn, "uri", lightUriDesc) },
                        range: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightSetRangeFn, "range", "Range in world units. Must be > 0.") },
                    },
                    required: ["uri", "range"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.spot.setAngle
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSpotSetAngleFn,
                description: this._resolveToolDescription(McpLightBehavior.LightSpotSetAngleFn, "Sets the cone half-angle of a spot light in degrees. Smaller angle = tighter, more focused beam. Only applicable to spot lights."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSpotSetAngleFn, "uri", lightUriDesc) },
                        angle: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightSpotSetAngleFn, "angle", "Cone half-angle in degrees. Must be in (0, 90).") },
                    },
                    required: ["uri", "angle"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.spot.setExponent
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightSpotSetExponentFn,
                description: this._resolveToolDescription(McpLightBehavior.LightSpotSetExponentFn, "Sets the falloff exponent of a spot light. Higher values concentrate the light toward the cone axis. Only applicable to spot lights."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightSpotSetExponentFn, "uri", lightUriDesc) },
                        exponent: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightSpotSetExponentFn, "exponent", "Falloff exponent. Must be >= 0.") },
                    },
                    required: ["uri", "exponent"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.hemi.setGroundColor
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightHemiSetGroundColorFn,
                description: this._resolveToolDescription(McpLightBehavior.LightHemiSetGroundColorFn, "Sets the ground (bottom hemisphere) color of a hemispheric light. Channels are in [0, 1]. Only applicable to hemispheric lights."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightHemiSetGroundColorFn, "uri", lightUriDesc) },
                        color: color3,
                    },
                    required: ["uri", "color"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // scene.getAmbient
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.SceneGetAmbientFn,
                description: this._resolveToolDescription(McpLightBehavior.SceneGetAmbientFn, "Returns the current scene-level ambient light: enabled state and color (r, g, b in [0, 1])."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.SceneGetAmbientFn, "uri", namespaceUriDesc) },
                    },
                    required: ["uri"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // scene.setAmbientColor
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.SceneSetAmbientColorFn,
                description: this._resolveToolDescription(McpLightBehavior.SceneSetAmbientColorFn, "Sets the scene ambient color (scene.ambientColor). Affects all materials that use ambient. Channels are in [0, 1]."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.SceneSetAmbientColorFn, "uri", namespaceUriDesc) },
                        color: color3,
                    },
                    required: ["uri", "color"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // scene.setAmbientEnabled
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.SceneSetAmbientEnabledFn,
                description: this._resolveToolDescription(McpLightBehavior.SceneSetAmbientEnabledFn, "Enables or disables scene ambient lighting. When disabled, scene.ambientColor is set to black; the previous color is restored when re-enabled."),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.SceneSetAmbientEnabledFn, "uri", namespaceUriDesc) },
                        enabled: { type: "boolean", description: this._resolvePropertyDescription(McpLightBehavior.SceneSetAmbientEnabledFn, "enabled", "True to enable ambient, false to disable.") },
                    },
                    required: ["uri", "enabled"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // light.update — batch patch
            // -----------------------------------------------------------------
            {
                name: McpLightBehavior.LightUpdateFn,
                description: this._resolveToolDescription(
                    McpLightBehavior.LightUpdateFn,
                    "Applies a partial patch to an existing light in one call. " +
                        "Fields that are not applicable to the light type are silently ignored (reported in the response). " +
                        "Useful for batching multiple property changes without issuing separate tool calls."
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "uri", lightUriDesc) },
                        patch: {
                            type: "object",
                            description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch", "Partial state to apply. All fields optional."),
                            properties: {
                                enabled: { type: "boolean" },
                                intensity: { type: "number" },
                                diffuseColor: color3,
                                specularColor: color3,
                                position: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch.position", "point, spot, directional (shadow frustum).") },
                                direction: { ...vec3, description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch.direction", "directional, spot, hemispheric.") },
                                range: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch.range", "point, spot only.") },
                                angle: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch.angle", "Spot only. Cone half-angle in degrees.") },
                                exponent: { type: "number", description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch.exponent", "Spot only. Falloff exponent.") },
                                groundColor: { ...color3, description: this._resolvePropertyDescription(McpLightBehavior.LightUpdateFn, "patch.groundColor", "Hemispheric only. Ground color.") },
                            },
                            additionalProperties: false,
                        },
                    },
                    required: ["uri", "patch"],
                    additionalProperties: false,
                },
            },
        ];
    }

    protected override _buildResources(): McpResource[] {
        return [
            {
                uri: `${this.baseUri}`,
                name: "Lights list.",
                description: "Lights available in the scene.",
                mimeType: JsonRpcMimeType,
            },
        ];
    }

    protected override _buildTemplate(): McpResourceTemplate[] {
        return [
            {
                uriTemplate: `${this.baseUri}/{lightId}`,
                name: "Scene light",
                description: "A single light in the scene.",
                mimeType: JsonRpcMimeType,
            },
        ];
    }
}
