import { IGeo2, IGeo3 } from "./geodesy.interfaces";

/** Concrete 2D geographic position. */
export class Geo2 implements IGeo2 {
    public static Zero(): Geo2 {
        return new Geo2(0, 0);
    }

    public constructor(
        public lat: number,
        public lon: number
    ) {}

    public equals(other: IGeo2 | undefined | null): boolean {
        if (!other) return false;
        return this.lat === other.lat && this.lon === other.lon;
    }

    public clone(): Geo2 {
        return new Geo2(this.lat, this.lon);
    }

    public toString(): string {
        return `(${this.lat}, ${this.lon})`;
    }
}

/** Concrete 3D geographic position. */
export class Geo3 extends Geo2 implements IGeo3 {
    public static override Zero(): Geo3 {
        return new Geo3(0, 0, 0);
    }

    public alt: number;

    public get hasAltitude(): boolean {
        return this.alt !== undefined && this.alt !== null;
    }

    public set hasAltitude(_v: boolean) {
        // Writable to satisfy IGeo3 (used by cartesianToGeodetic).
        // The actual value is always derived from alt.
    }

    public constructor(lat: number, lon: number, alt: number = 0) {
        super(lat, lon);
        this.alt = alt;
    }

    public override equals(other: IGeo3 | IGeo2 | undefined | null): boolean {
        if (!other) return false;
        if (!super.equals(other)) return false;
        if ("alt" in other) {
            return this.alt === (other as IGeo3).alt;
        }
        return true;
    }

    public override clone(): Geo3 {
        return new Geo3(this.lat, this.lon, this.alt);
    }

    public override toString(): string {
        return `(${this.lat}, ${this.lon}, ${this.alt})`;
    }
}
