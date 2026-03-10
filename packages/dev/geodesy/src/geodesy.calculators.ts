import { IGeo2, IGeoProcessor } from "./geodesy.interfaces";
import { Ellipsoid } from "./geodesy.ellipsoid";

/**
 * Abstract base class for geodetic distance and bearing calculators.
 * Subclasses implement spherical (Haversine) or flat-earth approximations.
 */
export abstract class CalculatorBase implements IGeoProcessor {
    protected _ellipsoid: Ellipsoid;

    public constructor(ellipsoid?: Ellipsoid) {
        this._ellipsoid = ellipsoid ?? Ellipsoid.WGS84;
    }

    public get ellipsoid(): Ellipsoid {
        return this._ellipsoid;
    }

    abstract getDistanceFromFloat(lata: number, lona: number, latb: number, lonb: number, alta?: number, altb?: number, deg?: boolean): number;
    abstract getAzimuthFromFloat(lata: number, lona: number, latb: number, lonb: number, deg?: boolean): number;
    abstract getLocationAtDistanceAzimuth(lat: number, lon: number, distance: number, azimuth: number, deg?: boolean): IGeo2;
}
