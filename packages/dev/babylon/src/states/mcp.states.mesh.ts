import { ICartesian3, IQuaternion } from "./mcp.states.math";
import { IColor3 } from "./mcp.states.light";

export type MeshMaterialType = "standard" | "pbr" | "node" | "other";

// -------------------------------------------------------------------------
// Material
// -------------------------------------------------------------------------

export interface IMeshMaterialState {
    name?: string;
    type: MeshMaterialType;
    /** Dominant color (diffuse for Standard, albedo for PBR). */
    baseColor?: IColor3;
    /** True when a diffuse / albedo texture is set. */
    hasTexture?: boolean;
    /** Material-level alpha (0 = fully transparent, 1 = fully opaque). */
    alpha?: number;
}

// -------------------------------------------------------------------------
// Transform
// -------------------------------------------------------------------------

export interface IMeshTransformState {
    /** Local position (right-handed y-up). */
    position: ICartesian3;
    /**
     * Local Euler rotation in radians (right-handed y-up).
     * Present when the mesh does not use a rotationQuaternion.
     */
    rotationEuler?: ICartesian3;
    /**
     * Local rotation as a unit quaternion (right-handed y-up).
     * Present and preferred when rotationQuaternion is set on the mesh.
     */
    rotationQuat?: IQuaternion;
    /** Local scale factors (1 = identity). */
    scaling: ICartesian3;
}

// -------------------------------------------------------------------------
// Full mesh state — returned by resource reads
// -------------------------------------------------------------------------

export interface IMeshState {
    id: string;
    name: string;
    type: "mesh" | "instancedMesh";
    enabled: boolean;
    visible: boolean;
    /** Per-mesh alpha (0 = fully transparent, 1 = fully opaque). */
    visibility: number;
    pickable: boolean;
    receiveShadows: boolean;
    /** True when the mesh appears in at least one ShadowGenerator render list. */
    castsShadows: boolean;
    transform: IMeshTransformState;
    material?: IMeshMaterialState;
    /** Babylon.js tags assigned to this mesh. */
    tags: string[];
    /** Parent mesh id, if the parent is an AbstractMesh. */
    parentId?: string;
    /** Direct children mesh ids. */
    childIds: string[];
}
