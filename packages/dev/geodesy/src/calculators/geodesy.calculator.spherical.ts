import { IGeo2 } from "../geodesy.interfaces";
import { Geo2 } from "../geodesy.implementations";
import { DEG2RAD, RAD2DEG } from "../geodesy.constants";
import { CalculatorBase } from "../geodesy.calculators";
import { Ellipsoid } from "../geodesy.ellipsoid";

/**
 * Spherical (Haversine) geodetic calculator.
 * Provides great-circle distance, initial azimuth, and destination point.
 */
export class SphericalCalculator extends CalculatorBase {
    public static readonly Shared = new SphericalCalculator();

    public constructor(ellipsoid?: Ellipsoid) {
        super(ellipsoid);
    }

    public getDistanceFromFloat(lata: number, lona: number, latb: number, lonb: number, alta?: number, altb?: number, deg?: boolean): number {
        if (lata === latb && lona === lonb && alta === altb) {
            return 0;
        }

        if (deg) {
            lata *= DEG2RAD;
            lona *= DEG2RAD;
            latb *= DEG2RAD;
            lonb *= DEG2RAD;
        }

        const dLat = (latb - lata) / 2;
        const dLon = (lonb - lona) / 2;
        const sdLat = Math.sin(dLat);
        const sdLon = Math.sin(dLon);
        const a = sdLat * sdLat + Math.cos(lata) * Math.cos(latb) * sdLon * sdLon;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        let distance = this._ellipsoid.semiMajorAxis * c;

        if (alta !== undefined && altb !== undefined) {
            const altDiff = altb - alta;
            distance = Math.sqrt(distance * distance + altDiff * altDiff);
        }

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
        const cosLat2 = Math.cos(lat2);

        const y = Math.sin(dLon) * cosLat2;
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * cosLat2 * Math.cos(dLon);
        let az = Math.atan2(y, x);

        if (deg) {
            az *= RAD2DEG;
        }
        return az;
    }

    public getLocationAtDistanceAzimuth(lat: number, lon: number, dist: number, az: number, deg?: boolean): IGeo2 {
        if (dist === 0) {
            return new Geo2(lat, lon);
        }

        if (deg) {
            lat *= DEG2RAD;
            lon *= DEG2RAD;
            az *= DEG2RAD;
        }

        const ddr = dist / this._ellipsoid.semiMajorAxis;
        const cosDdr = Math.cos(ddr);
        const sinDdr = Math.sin(ddr);
        const cosLat = Math.cos(lat);
        const sinLat = Math.sin(lat);
        const cosLatSinDdr = cosLat * sinDdr;

        let lat1 = Math.asin(sinLat * cosDdr + cosLatSinDdr * Math.cos(az));
        let lon1 = lon + Math.atan2(cosLatSinDdr * Math.sin(az), cosDdr - sinLat * Math.sin(lat1));

        if (deg) {
            lat1 *= RAD2DEG;
            lon1 *= RAD2DEG;
        }
        return new Geo2(lat1, lon1);
    }
}
