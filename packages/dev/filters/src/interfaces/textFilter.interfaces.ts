import { ISnapshotFilter } from "./snapshot.interfaces";

/**
 * Extension of {@link ISnapshotFilter} for filters that produce a **text**
 * representation of the image instead of (or in addition to) transformed
 * pixel data.
 *
 * The canonical example is an ASCII-art encoder that converts an RGB frame
 * into a fixed-size character raster suitable for consumption by text-only
 * LLMs (see "ASCII Art Turns LLMs into VLA Controllers").
 *
 * - {@link ISnapshotFilter.apply} is retained for pipeline compatibility and
 *   should pass the {@link ImageData} through unchanged.
 * - {@link renderToText} is the primary output — a deterministic, human-
 *   readable string encoding of the image content.
 *
 * @example
 * ```typescript
 * export class AsciiFilter implements ITextSnapshotFilter {
 *     readonly name = "ascii";
 *     apply(imageData: ImageData): ImageData { return imageData; }
 *     renderToText(imageData: ImageData): string {
 *         // ... convert pixels to ASCII grid ...
 *     }
 * }
 * ```
 */
export interface ITextSnapshotFilter extends ISnapshotFilter {
    /**
     * Converts image data to a text representation.
     *
     * @param imageData  Raw RGBA pixel buffer (width × height × 4 bytes).
     * @param context    Optional engine-specific context supplied by the adapter.
     * @returns          A text encoding of the image (e.g. ASCII art grid).
     */
    renderToText(imageData: ImageData, context?: Record<string, unknown>): string;
}

/** Type guard for {@link ITextSnapshotFilter}. */
export function isTextSnapshotFilter(filter: ISnapshotFilter): filter is ITextSnapshotFilter {
    return typeof (filter as ITextSnapshotFilter).renderToText === "function";
}
