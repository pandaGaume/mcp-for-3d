import { IMcpBehaviorAdapter, JsonRpcMimeType, McpBehavior, McpBehaviorOptions, McpResource, McpResourceTemplate, McpTool } from "@dev/core";
import { McpMeshNamespace } from "../mcp.commons";

export class McpMeshBehavior extends McpBehavior {
    // -------------------------------------------------------------------------
    // Tool name constants — visibility
    // -------------------------------------------------------------------------

    /** Enables or disables a mesh (affects rendering, picking and children). */
    public static readonly MeshSetEnabledFn = "mesh_set_enabled";

    /** Sets the isVisible flag on a mesh (fast show/hide without disabling children). */
    public static readonly MeshSetVisibleFn = "mesh_set_visible";

    /** Sets the per-mesh alpha (0 = fully transparent, 1 = fully opaque). */
    public static readonly MeshSetVisibilityFn = "mesh_set_visibility";

    // -------------------------------------------------------------------------
    // Tool name constants — transform
    // -------------------------------------------------------------------------

    /** Teleports the mesh to a world-space position. */
    public static readonly MeshSetPositionFn = "mesh_set_position";

    /** Sets the local Euler rotation of a mesh in degrees (x = pitch, y = yaw, z = roll). */
    public static readonly MeshSetRotationFn = "mesh_set_rotation";

    /** Sets the local scale of a mesh. */
    public static readonly MeshSetScalingFn = "mesh_set_scaling";

    /** Smoothly animates position, rotation and/or scaling to target values over a duration. */
    public static readonly MeshAnimateToFn = "mesh_animate_to";

    // -------------------------------------------------------------------------
    // Tool name constants — material
    // -------------------------------------------------------------------------

    /** Sets the base color (diffuse for Standard, albedo for PBR) of a mesh's material.
     *  Creates a StandardMaterial if the mesh has none. */
    public static readonly MeshSetColorFn = "mesh_set_color";

    /** Sets the alpha of the mesh's material (0 = fully transparent, 1 = fully opaque). */
    public static readonly MeshSetMaterialAlphaFn = "mesh_set_material_alpha";

    // -------------------------------------------------------------------------
    // Tool name constants — tags
    // -------------------------------------------------------------------------

    /** Adds one or more space-separated tags to a mesh. */
    public static readonly MeshTagAddFn = "mesh_tag_add";

    /** Removes one or more space-separated tags from a mesh. */
    public static readonly MeshTagRemoveFn = "mesh_tag_remove";

    /** Replaces all existing tags on a mesh with a new set. */
    public static readonly MeshTagSetFn = "mesh_tag_set";

    // -------------------------------------------------------------------------
    // Tool name constants — namespace-level queries (uri = babylon://mesh)
    // -------------------------------------------------------------------------

    /** Finds all meshes matching a Babylon.js tag query expression and returns their ids, names and tags. */
    public static readonly MeshFindByTagFn = "mesh_find_by_tag";

    // -------------------------------------------------------------------------

    public constructor(adapter: IMcpBehaviorAdapter, options: McpBehaviorOptions = {}) {
        super(adapter, {
            ...options,
            domain: options.domain ?? adapter.domain,
            namespace: options.namespace ?? McpMeshNamespace,
        });
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
                r: { type: "number", description: "Red channel (0..1)." },
                g: { type: "number", description: "Green channel (0..1)." },
                b: { type: "number", description: "Blue channel (0..1)." },
            },
            required: ["r", "g", "b"],
            additionalProperties: false,
        };

        const easingParam = {
            type: "string",
            description:
                "Easing curve. Format '<type>' or '<type>.<mode>'. " +
                "Types: linear | sine | quad | cubic | circle | expo | back | bounce | elastic. " +
                "Modes: in | out | inout (default). Example: 'sine.inout'.",
        };

        return [
            // -----------------------------------------------------------------
            // mesh.setEnabled
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetEnabledFn,
                description:
                    "Enables or disables a mesh. A disabled mesh is not rendered, not pickable and " +
                    "propagates the disabled state to its children.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI, e.g. babylon://mesh/meshId" },
                        enabled: { type: "boolean", description: "True to enable, false to disable." },
                    },
                    required: ["uri", "enabled"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setVisible
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetVisibleFn,
                description:
                    "Shows or hides a mesh without affecting its children or pickability. " +
                    "Prefer this over mesh_set_enabled for simple show/hide operations.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        visible: { type: "boolean", description: "True to show, false to hide." },
                    },
                    required: ["uri", "visible"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setVisibility
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetVisibilityFn,
                description: "Sets the per-mesh alpha. 0 = fully transparent, 1 = fully opaque. " + "Independent of the material alpha.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        visibility: { type: "number", description: "Alpha value in [0..1]." },
                    },
                    required: ["uri", "visibility"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setPosition
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetPositionFn,
                description: "Teleports the mesh to an absolute world-space position (right-handed y-up).",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        position: { ...vec3, description: "Target world-space position (right-handed y-up)." },
                    },
                    required: ["uri", "position"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setRotation
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetRotationFn,
                description:
                    "Sets the local Euler rotation of a mesh in degrees (right-handed y-up). " +
                    "x = pitch (tilt forward/back), y = yaw (turn left/right), z = roll (lean sideways). " +
                    "Clears any existing rotationQuaternion.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        rotation: {
                            ...vec3,
                            description: "Euler angles in degrees (right-handed y-up). x=pitch, y=yaw, z=roll.",
                        },
                    },
                    required: ["uri", "rotation"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setScaling
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetScalingFn,
                description:
                    "Sets the local scale of a mesh. Use (1,1,1) to reset to original size. " +
                    "Negative values mirror the mesh along that axis.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        scaling: { ...vec3, description: "Scale factors along each local axis." },
                    },
                    required: ["uri", "scaling"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.animateTo
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshAnimateToFn,
                description:
                    "Smoothly animates a mesh toward target position, rotation and/or scaling values. " +
                    "Only the provided fields are animated; omitted fields remain unchanged. " +
                    "Rotation is specified in degrees (Euler, right-handed y-up).",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        position: { ...vec3, description: "Target world-space position (right-handed y-up)." },
                        rotation: { ...vec3, description: "Target Euler rotation in degrees (right-handed y-up)." },
                        scaling: { ...vec3, description: "Target local scale factors." },
                        duration: { type: "number", description: "Animation duration in seconds. Defaults to 1." },
                        easing: easingParam,
                    },
                    required: ["uri"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setColor
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetColorFn,
                description:
                    "Sets the base color of the mesh's material (diffuse for StandardMaterial, albedo for PBRMaterial). " +
                    "If the mesh has no material a new StandardMaterial is created. " +
                    "Color channels are in [0..1].",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        color: { ...color3, description: "Target base color (r, g, b in 0..1)." },
                    },
                    required: ["uri", "color"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.setMaterialAlpha
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshSetMaterialAlphaFn,
                description:
                    "Sets the alpha of the mesh's material (0 = fully transparent, 1 = fully opaque). " +
                    "This is distinct from the per-mesh visibility alpha. " +
                    "If the mesh has no material a new StandardMaterial is created.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        alpha: { type: "number", description: "Alpha value in [0..1]." },
                    },
                    required: ["uri", "alpha"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.tagAdd
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshTagAddFn,
                description:
                    "Adds one or more Babylon.js tags to a mesh. Tags are space-separated identifiers " +
                    "that can later be queried with mesh_find_by_tag using boolean expressions (&&, ||, !).",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        tags: { type: "string", description: "Space-separated list of tags to add, e.g. 'enemy destructible'." },
                    },
                    required: ["uri", "tags"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.tagRemove
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshTagRemoveFn,
                description: "Removes one or more Babylon.js tags from a mesh.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        tags: { type: "string", description: "Space-separated list of tags to remove." },
                    },
                    required: ["uri", "tags"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.tagSet
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshTagSetFn,
                description: "Replaces ALL existing tags on a mesh with the provided set. Pass an empty string to clear all tags.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Mesh URI" },
                        tags: { type: "string", description: "Space-separated list of new tags (replaces existing). Empty string clears all." },
                    },
                    required: ["uri", "tags"],
                    additionalProperties: false,
                },
            },

            // -----------------------------------------------------------------
            // mesh.findByTag  — namespace-level (uri = babylon://mesh)
            // -----------------------------------------------------------------
            {
                name: McpMeshBehavior.MeshFindByTagFn,
                description:
                    "Finds all meshes in the scene matching a Babylon.js tag query expression. " +
                    "Supports boolean operators: '&&' (AND), '||' (OR), '!' (NOT). " +
                    "Examples: 'enemy', 'enemy && destructible', 'enemy || ally', '!static'. " +
                    "Pass uri as 'babylon://mesh' (the mesh list resource).",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: { type: "string", description: "Must be 'babylon://mesh' (namespace-level tool)." },
                        query: {
                            type: "string",
                            description: "Babylon.js tag query expression, e.g. 'enemy && destructible'.",
                        },
                    },
                    required: ["uri", "query"],
                    additionalProperties: false,
                },
            },
        ];
    }

    protected override _buildResources(): McpResource[] {
        return [
            {
                uri: `${this.baseUri}`,
                name: "Mesh list",
                description: "All meshes currently present in the scene.",
                mimeType: JsonRpcMimeType,
            },
        ];
    }

    protected override _buildTemplate(): McpResourceTemplate[] {
        return [
            {
                uriTemplate: `${this.baseUri}/{meshId}`,
                name: "Scene mesh",
                description: "A single mesh in the scene, identified by its Babylon.js id.",
                mimeType: JsonRpcMimeType,
            },
        ];
    }
}
