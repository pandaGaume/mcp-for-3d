import { DEG2RAD, RAD2DEG } from "./geodesy.constants";

/**
 * A reference ellipsoid used for geodetic calculations.
 *
 * Pre-computes derived constants (eccentricity, squared axes, etc.) at
 * construction time so that repeated conversions are fast.
 */
export class Ellipsoid {
    /** The WGS84 ellipsoid (meters). */
    public static readonly WGS84: Ellipsoid = Ellipsoid.FromAAndInverseF("WGS84", 6378137.0, 298.257223563);

    /** The GRS80 ellipsoid (meters). */
    public static readonly GRS80: Ellipsoid = Ellipsoid.FromAAndInverseF("GRS80", 6378137.0, 298.257222101);

    /** The GRS67 ellipsoid (meters). */
    public static readonly GRS67: Ellipsoid = Ellipsoid.FromAAndInverseF("GRS67", 6378160.0, 298.25);

    /** The ANS ellipsoid (meters). */
    public static readonly ANS: Ellipsoid = Ellipsoid.FromAAndInverseF("ANS", 6378160.0, 298.25);

    /** The WGS72 ellipsoid (meters). */
    public static readonly WGS72: Ellipsoid = Ellipsoid.FromAAndInverseF("WGS72", 6378135.0, 298.26);

    /** The Clarke1858 ellipsoid (meters). */
    public static readonly Clarke1858: Ellipsoid = Ellipsoid.FromAAndInverseF("Clarke1858", 6378293.645, 294.26);

    /** The Clarke1880 ellipsoid (meters). */
    public static readonly Clarke1880: Ellipsoid = Ellipsoid.FromAAndInverseF("Clarke1880", 6378249.145, 293.465);

    // Pre-computed numeric constants
    static readonly inv3 = 1.0 / 3;
    static readonly inv6 = 1.0 / 6;
    static readonly invcbrt2 = 1.0 / Math.pow(2, 1.0 / 3);
    static readonly d2r = DEG2RAD;
    static readonly r2d = RAD2DEG;

    /**
     * Build an Ellipsoid from the semi-major axis and inverse flattening.
     */
    public static FromAAndInverseF(name: string, semiMajor: number, inverseFlattening: number): Ellipsoid {
        const f = 1.0 / inverseFlattening;
        const b = (1.0 - f) * semiMajor;
        return new Ellipsoid(name, semiMajor, b, f, inverseFlattening);
    }

    /**
     * Build an Ellipsoid from the semi-major axis and flattening.
     */
    public static FromAAndF(name: string, semiMajor: number, flattening: number): Ellipsoid {
        const inverseF = 1.0 / flattening;
        const b = (1.0 - flattening) * semiMajor;
        return new Ellipsoid(name, semiMajor, b, flattening, inverseF);
    }

    // Instance fields — named to match SpaceXR conventions
    readonly _name: string;
    readonly _a: number; // semi-major axis
    readonly _b: number; // semi-minor axis = a(1-f)
    readonly _aa: number; // a^2
    readonly _bb: number; // b^2
    readonly _f: number; // flattening
    readonly _p1mf: number; // 1 - f
    readonly _invf: number; // inverse flattening
    readonly _c: number; // linear eccentricity = sqrt(a^2 - b^2)
    readonly _e: number; // eccentricity
    readonly _ee: number; // e^2
    readonly _invaa: number; // 1/a^2
    readonly _aadc: number; // a^2 / c
    readonly _bbdcc: number; // b^2 / c^2
    readonly _l: number; // e^2 / 2
    readonly _p1mee: number; // 1 - e^2
    readonly _p1meedaa: number; // (1 - e^2) / a^2
    readonly _hmin: number; // e^12 / 4
    readonly _ll4: number; // 4 * l^2 = e^4
    readonly _ll: number; // l^2 = e^4 / 4

    private constructor(name: string, semiMajor: number, semiMinor: number, flattening: number, inverseFlattening: number) {
        this._name = name;
        this._a = semiMajor;
        this._b = semiMinor;
        this._f = flattening;
        this._p1mf = 1.0 - this._f;
        this._invf = inverseFlattening;

        this._aa = this._a * this._a;
        this._bb = this._b * this._b;

        this._c = Math.sqrt(this._aa - this._bb);
        this._ee = 1 - this._bb / this._aa;
        this._e = Math.sqrt(this._ee);

        this._invaa = 1.0 / this._aa;
        this._aadc = this._aa / this._c;
        this._bbdcc = this._bb / (this._c * this._c);
        this._l = this._ee / 2;
        this._p1mee = 1 - this._ee;
        this._p1meedaa = this._p1mee / this._aa;
        this._hmin = Math.pow(this._e, 12) / 4;
        this._ll = this._l * this._l;
        this._ll4 = this._ll * 4;
    }

    public get name(): string {
        return this._name;
    }

    /** Semi-major axis in meters. */
    public get semiMajorAxis(): number {
        return this._a;
    }

    /** Semi-minor axis in meters. */
    public get semiMinorAxis(): number {
        return this._b;
    }

    /** Flattening. */
    public get flattening(): number {
        return this._f;
    }

    /** Inverse flattening. */
    public get inverseFlattening(): number {
        return this._invf;
    }

    /** Linear eccentricity in meters. */
    public get linearEccentricity(): number {
        return this._c;
    }

    /** First eccentricity. */
    public get eccentricity(): number {
        return this._e;
    }

    /** Square of the first eccentricity. */
    public get sqrEccentricity(): number {
        return this._ee;
    }

    /** 1 - e^2. */
    public get oneMinusSqrEccentricity(): number {
        return this._p1mee;
    }

    /** Semi-latus rectum. */
    public get semiLatusRectum(): number {
        return this._p1mee * this._a;
    }

    /** Test equality with another ellipsoid (by axis lengths). */
    public isEquals(other: Ellipsoid): boolean {
        return other !== null && other !== undefined && other._a === this._a && other._b === this._b;
    }

    /**
     * Clone this ellipsoid with an optional scale factor.
     * Useful for working in ECEF within platform floating-point limitations.
     */
    public clone(name: string, scale = 1.0): Ellipsoid {
        return new Ellipsoid(name, this._a * scale, this._b * scale, this._f, this._invf);
    }

    /** Radius at a given latitude (radians). */
    public radiusAtLatitude(phiRad: number): number {
        const cos = Math.cos(phiRad);
        const sin = Math.sin(phiRad);
        return Math.sqrt(((this._aa * cos) ** 2 + (this._bb * sin) ** 2) / ((this._a * cos) ** 2 + (this._b * sin) ** 2));
    }

    /** Radius to the ellipsoid surface along a normalized direction vector. */
    public radiusAtPosition(x: number, y: number, z: number): number {
        const denom = (x * x + y * y) / this._aa + (z * z) / this._bb;
        return 1.0 / Math.sqrt(denom);
    }
}
