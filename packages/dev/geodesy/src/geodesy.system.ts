import { DEG2RAD, RAD2DEG } from "./geodesy.constants";
import { Ellipsoid } from "./geodesy.ellipsoid";
import { ICartesian3, IGeo3, CartesianMode } from "./geodesy.interfaces";

type ENUChangeCallback = (system: GeodeticSystem) => void;

/**
 * A geodetic coordinate system backed by a reference ellipsoid.
 *
 * Converts between geodetic (lat/lon/alt) and Cartesian coordinates.
 * When an ENU reference point is set, output is in the local East-North-Up
 * tangent plane; otherwise output is in ECEF.
 */
export class GeodeticSystem {
    /** Default system using WGS84 in ECEF mode (no ENU reference). */
    public static readonly Default: GeodeticSystem = new GeodeticSystem(Ellipsoid.WGS84);

    /**
     * Compute the 4x4 ENU transformation matrix for a given geographic origin.
     *
     * @param lat  Latitude in degrees.
     * @param lon  Longitude in degrees.
     * @param alt  Altitude in meters (default 0).
     * @param ellipsoid  Reference ellipsoid (default WGS84).
     * @param rowOrder  true = row-major, false = column-major. Default true.
     * @returns A 16-element array representing the 4x4 transform.
     */
    public static GetENUTransformMatrixFromFloat(lat: number, lon: number, alt = 0, ellipsoid: Ellipsoid = Ellipsoid.WGS84, rowOrder = true): number[] {
        const lambda = lat * DEG2RAD;
        const phi = lon * DEG2RAD;

        const sinLambda = Math.sin(lambda);
        const cosLambda = Math.cos(lambda);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        const N = ellipsoid.semiMajorAxis / Math.sqrt(1 - ellipsoid.sqrEccentricity * sinLambda * sinLambda);
        const tmp = (alt + N) * cosLambda;
        const x = tmp * cosPhi;
        const y = tmp * sinPhi;
        const z = (alt + ellipsoid.oneMinusSqrEccentricity * N) * sinLambda;

        // ENU rotation components
        const om0 = -sinPhi;
        const om1 = -sinLambda * cosPhi;
        const om2 = cosLambda * cosPhi;
        const om4 = cosPhi;
        const om5 = -sinLambda * sinPhi;
        const om6 = cosLambda * sinPhi;
        const om9 = cosLambda;
        const om10 = sinLambda;

        // Translation (rotation applied to -origin)
        const om12 = -x * om0 - y * om4;
        const om13 = -x * om1 - y * om5 - z * om9;
        const om14 = -x * om2 - y * om6 - z * om10;

        if (rowOrder) {
            return [om0, om1, om2, 0, om4, om5, om6, 0, 0, om9, om10, 0, om12, om13, om14, 1.0];
        } else {
            return [om0, om4, 0, om12, om1, om5, om9, om13, om2, om6, om10, om14, 0, 0, 0, 1.0];
        }
    }

    private _ellipsoid: Ellipsoid;
    private _enuReference?: IGeo3;
    private _enuTransform?: number[];
    private _enuListeners: ENUChangeCallback[] = [];

    public constructor(ellipsoid?: Ellipsoid) {
        this._ellipsoid = ellipsoid ?? Ellipsoid.WGS84;
    }

    public get ellipsoid(): Ellipsoid {
        return this._ellipsoid;
    }

    /** The current ENU origin, if any. */
    public get ENUReference(): IGeo3 | undefined {
        return this._enuReference;
    }

    /** Set or clear the ENU reference point. Notifies listeners on change. */
    public set ENUReference(v: IGeo3 | undefined) {
        // No change — skip
        if (this._enuReference && v && this._enuReference.lat === v.lat && this._enuReference.lon === v.lon && this._enuReference.alt === v.alt) {
            return;
        }
        if (!this._enuReference && !v) {
            return;
        }

        this._enuReference = v ? { lat: v.lat, lon: v.lon, alt: v.alt, hasAltitude: v.hasAltitude } : undefined;
        this._enuTransform = undefined;

        for (const cb of this._enuListeners) {
            cb(this);
        }
    }

    /** Lazily computed ENU 4x4 matrix. */
    public get ENUTransform(): number[] | undefined {
        if (this._enuTransform === undefined && this._enuReference) {
            this._enuTransform = GeodeticSystem.GetENUTransformMatrixFromFloat(this._enuReference.lat, this._enuReference.lon, this._enuReference.alt, this._ellipsoid);
        }
        return this._enuTransform;
    }

    /** Current output mode: ECEF if no ENU reference is set, ENU otherwise. */
    public get cartesianMode(): CartesianMode {
        return this._enuReference !== undefined ? CartesianMode.ENU : CartesianMode.ECEF;
    }

    /**
     * Register a callback invoked when the ENU reference changes.
     * @returns A dispose function to unsubscribe.
     */
    public onENUReferenceChanged(cb: ENUChangeCallback): () => void {
        this._enuListeners.push(cb);
        return () => {
            const idx = this._enuListeners.indexOf(cb);
            if (idx >= 0) this._enuListeners.splice(idx, 1);
        };
    }

    /**
     * Convert geodetic (degrees) to Cartesian.
     * Returns ECEF if no ENU reference is set, otherwise ENU.
     */
    public geodeticFloatToCartesianToRef(lat: number, lon: number, alt: number, target: ICartesian3, deg = true): ICartesian3 {
        const lambda = deg ? lat * DEG2RAD : lat;
        const phi = deg ? lon * DEG2RAD : lon;

        const sinLambda = Math.sin(lambda);
        const cosLambda = Math.cos(lambda);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        const N = this._ellipsoid._a / Math.sqrt(1.0 - this._ellipsoid._ee * sinLambda * sinLambda);
        const tmp = (alt + N) * cosLambda;

        let x = tmp * cosPhi;
        let y = tmp * sinPhi;
        let z = (alt + this._ellipsoid._p1mee * N) * sinLambda;

        // Apply ENU transform if set
        if (this.ENUTransform) {
            const m = this.ENUTransform;
            const rx = x * m[0] + y * m[4] + z * m[8] + m[12];
            const ry = x * m[1] + y * m[5] + z * m[9] + m[13];
            const rz = x * m[2] + y * m[6] + z * m[10] + m[14];
            x = rx;
            y = ry;
            z = rz;
        }

        target.x = x;
        target.y = y;
        target.z = z;
        return target;
    }

    /** Convert an IGeo3 to Cartesian (convenience wrapper). */
    public geodeticToCartesianToRef(geo: IGeo3, target: ICartesian3): ICartesian3 {
        return this.geodeticFloatToCartesianToRef(geo.lat, geo.lon, geo.alt ?? 0, target);
    }

    /**
     * Convert ECEF Cartesian to geodetic.
     * Uses the Olson closed-form method with a Newton-Raphson refinement.
     *
     * @returns true on success, false if the point is too close to Earth's center.
     */
    public cartesianToGeodetic(from: ICartesian3, target: IGeo3): boolean {
        const x = from.x;
        const y = from.y;
        const z = from.z;

        const ww = x * x + y * y;
        const m = ww * this._ellipsoid._invaa;
        const n = z * z * this._ellipsoid._p1meedaa;
        const mpn = m + n;
        const p = Ellipsoid.inv6 * (mpn - this._ellipsoid._ll4);
        const G = m * n * this._ellipsoid._ll;
        const H = 2 * p * p * p + G;

        if (H < this._ellipsoid._hmin) {
            target.lat = 0;
            target.lon = 0;
            target.alt = 0;
            target.hasAltitude = true;
            return false;
        }

        const C = Math.pow(H + G + 2 * Math.sqrt(H * G), Ellipsoid.inv3) * Ellipsoid.invcbrt2;

        const i = -this._ellipsoid._ll - 0.5 * mpn;
        const P = p * p;
        const beta = Ellipsoid.inv3 * i - C - P / C;
        const k = this._ellipsoid._ll * (this._ellipsoid._ll - mpn);

        // Left part of t
        const t1 = beta * beta - k;
        const t2 = Math.sqrt(t1);
        const t3 = t2 - 0.5 * (beta + i);
        const t4 = Math.sqrt(t3);

        // Right part of t (with numeric turbulence fix near ~45.3 deg)
        let t5 = 0.5 * (beta - i);
        t5 = Math.abs(t5);
        const t6 = Math.sqrt(t5);
        const t7 = m < n ? t6 : -t6;

        const t = t4 + t7;

        // Newton-Raphson correction
        const j = this._ellipsoid._l * (m - n);
        const g = 2 * j;
        const tt = t * t;
        const ttt = tt * t;
        const tttt = tt * tt;
        const F = tttt + 2 * i * tt + g * t + k;
        const dFdt = 4 * ttt + 4 * i * t + g;
        const dt = -F / dFdt;

        // Latitude
        const u = t + dt + this._ellipsoid._l;
        const v = t + dt - this._ellipsoid._l;
        const w = Math.sqrt(ww);
        const zu = z * u;
        const wv = w * v;
        const lat = Math.atan2(zu, wv) * RAD2DEG;

        // Altitude
        const invuv = 1 / (u * v);
        const dw = w - wv * invuv;
        const dz = z - zu * this._ellipsoid._p1mee * invuv;
        const da = Math.sqrt(dw * dw + dz * dz);
        const alt = u < 1 ? -da : da;

        // Longitude
        const lon = Math.atan2(y, x) * RAD2DEG;

        target.lat = lat;
        target.lon = lon;
        target.alt = alt;
        target.hasAltitude = true;
        return true;
    }
}
