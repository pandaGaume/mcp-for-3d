import { ICartesian3, isGeoCoordinate } from "./geodesy.interfaces";
import { GeodeticSystem } from "./geodesy.system";

// ---- JSON Schema fragments for MCP tool definitions ----

/** JSON Schema for a Cartesian3 {x, y, z} coordinate. */
export const vec3Schema = {
    type: "object" as const,
    properties: {
        x: { type: "number" as const },
        y: { type: "number" as const },
        z: { type: "number" as const },
    },
    required: ["x", "y", "z"] as const,
    additionalProperties: false,
};

/** JSON Schema for a geographic {lat, lon, alt?} coordinate. */
export const geoCoordinateSchema = {
    type: "object" as const,
    properties: {
        lat: { type: "number" as const, description: "Latitude in degrees (-90 to +90)." },
        lon: { type: "number" as const, description: "Longitude in degrees (-180 to +180)." },
        alt: { type: "number" as const, description: "Altitude in meters above the WGS84 ellipsoid. Defaults to 0." },
    },
    required: ["lat", "lon"] as const,
    additionalProperties: false,
};

/**
 * JSON Schema accepting either Cartesian or geographic coordinates.
 * Detection is implicit: `{x,y,z}` = Cartesian, `{lat,lon}` = geographic.
 */
export const coordinateSchema = {
    oneOf: [vec3Schema, geoCoordinateSchema],
    description: "A 3D coordinate: either { x, y, z } for Cartesian (right-handed y-up or ECEF) or { lat, lon, alt? } for geographic WGS84 (degrees, meters).",
};

// ---- Runtime coordinate resolution ----

/**
 * Resolves an incoming MCP coordinate parameter to Cartesian3.
 *
 * If the input contains `lat`/`lon` keys, it is treated as geographic and
 * converted via the provided `GeodeticSystem` (default: WGS84 ECEF).
 * If it contains `x`/`y`/`z` keys, it is returned directly.
 *
 * @param coord  The raw coordinate object from MCP tool args.
 * @param system The geodetic system for geo→Cartesian conversion (optional).
 * @returns The resolved Cartesian3 coordinate, or undefined if the input is invalid.
 */
export function resolveToCartesian3(coord: Record<string, unknown>, system?: GeodeticSystem): ICartesian3 | undefined {
    if (isGeoCoordinate(coord)) {
        const target: ICartesian3 = { x: 0, y: 0, z: 0 };
        const gs = system ?? GeodeticSystem.Default;
        gs.geodeticFloatToCartesianToRef(coord.lat, coord.lon, (coord.alt as number) ?? 0, target);
        return target;
    }

    const o = coord as Record<string, unknown>;
    if (typeof o["x"] === "number" && typeof o["y"] === "number" && typeof o["z"] === "number") {
        return { x: o["x"] as number, y: o["y"] as number, z: o["z"] as number };
    }

    return undefined;
}
