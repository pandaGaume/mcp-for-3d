import { IGeo2 } from "../geodesy.interfaces";
import { Geo2 } from "../geodesy.implementations";
import { DEG2RAD, RAD2DEG, TWO_PI } from "../geodesy.constants";
import { CalculatorBase } from "../geodesy.calculators";
import { Ellipsoid } from "../geodesy.ellipsoid";

/**
 * Pythagorean flat-Earth distance calculator.
 *
 * Assumes meridians are parallel and parallels of latitude are approximately
 * great circles. Suitable for short distances (< ~20 km) at moderate latitudes.
 */
export class PythagoreanFlatEarthCalculator extends CalculatorBase {
    public static readonly Shared = new PythagoreanFlatEarthCalculator();

    public constructor(ellipsoid?: Ellipsoid) {
        super(ellipsoid);
    }

    public getDistanceFromFloat(lata: number, lona: number, latb: number, lonb: number, _alta?: number, _altb?: number, deg?: boolean): number {
        if (lata === latb && lona === lonb) {
            return 0;
        }

        if (deg) {
            lata *= DEG2RAD;
            lona *= DEG2RAD;
            latb *= DEG2RAD;
            lonb *= DEG2RAD;
        }

        const a = Math.PI / 2 - lata;
        const b = Math.PI / 2 - latb;
        const c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(lona - lonb));
        const distance = this._ellipsoid.semiMajorAxis * c;

        return distance;
    }

    public getAzimuthFromFloat(lat1: number, lon1: number, lat2: number, lon2: number, deg?: boolean): number {
        if (lat1 === lat2 && lon1 === lon2) {
            return 0;
        }

        if (deg) {
            lat1 *= DEG2RAD;
            lon1 *= DEG2RAD;
            lat2 *= DEG2RAD;
            lon2 *= DEG2RAD;
        }

        const dLon = lon2 - lon1;
        const dLat = lat2 - lat1;

        let azimuth = Math.atan2(dLon, dLat);

        // Normalize to [0, 2*PI)
        if (azimuth < 0) {
            azimuth += TWO_PI;
        }

        if (deg) {
            azimuth *= RAD2DEG;
        }

        return azimuth;
    }

    public getLocationAtDistanceAzimuth(lat1: number, lon1: number, dist: number, az: number, deg?: boolean): IGeo2 {
        const unit2deg = 1 / (((2 * Math.PI) / 360) * this._ellipsoid.semiMajorAxis);

        if (deg) {
            az *= DEG2RAD;
            lat1 *= DEG2RAD;
            lon1 *= DEG2RAD;
        }

        let newLat = lat1 + dist * Math.cos(az) * unit2deg;
        let newLon = lon1 + (dist * Math.sin(az) * unit2deg) / Math.cos(lat1);

        if (deg) {
            newLat *= RAD2DEG;
            newLon *= RAD2DEG;
        }
        return new Geo2(newLat, newLon);
    }
}
