// ---- Cartesian ----

/**
 * A 3D Cartesian coordinate.
 * Structurally compatible with the ICartesian3 defined in @dev/behaviors.
 */
export interface ICartesian3 {
    x: number;
    y: number;
    z: number;
}

// ---- Geographic ----

/** A 2D geographic position (latitude, longitude) in degrees. */
export interface IGeo2 {
    lat: number;
    lon: number;
}

/** A 3D geographic position (latitude, longitude, altitude). */
export interface IGeo3 extends IGeo2 {
    alt: number;
    hasAltitude: boolean;
}

// ---- Coordinate union ----

/**
 * Discriminated coordinate union for MCP tool parameters.
 * Detection is implicit: presence of `lat`/`lon` = geographic, `x`/`y`/`z` = Cartesian.
 */
export type Coordinate = ICartesian3 | IGeo3;

// ---- Cartesian mode ----

/** The Cartesian output mode of a GeodeticSystem. */
export enum CartesianMode {
    /** Earth-Centered Earth-Fixed (absolute world coordinates in meters). */
    ECEF = "ecef",
    /** East-North-Up (local tangent plane relative to an origin). */
    ENU = "enu",
    /** North-East-Down (aviation/navigation convention). */
    NED = "ned",
}

// ---- Geo processor interface (for calculators) ----

/** Interface for geodetic distance and bearing calculators. */
export interface IGeoProcessor {
    getDistanceFromFloat(lata: number, lona: number, latb: number, lonb: number, alta?: number, altb?: number, deg?: boolean): number;
    getAzimuthFromFloat(lata: number, lona: number, latb: number, lonb: number, deg?: boolean): number;
    getLocationAtDistanceAzimuth(lat: number, lon: number, distance: number, azimuth: number, deg?: boolean): IGeo2;
}

// ---- Type guards ----

/** Returns true if the coordinate has geographic keys (lat, lon). */
export function isGeoCoordinate(c: unknown): c is IGeo3 {
    if (typeof c !== "object" || c === null) return false;
    const o = c as Record<string, unknown>;
    return typeof o["lat"] === "number" && typeof o["lon"] === "number";
}

/** Returns true if the coordinate has Cartesian keys (x, y, z). */
export function isCartesianCoordinate(c: unknown): c is ICartesian3 {
    if (typeof c !== "object" || c === null) return false;
    const o = c as Record<string, unknown>;
    return typeof o["x"] === "number" && typeof o["y"] === "number" && typeof o["z"] === "number";
}
