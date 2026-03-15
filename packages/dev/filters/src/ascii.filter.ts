import { ITextSnapshotFilter } from "./interfaces";

/**
 * ASCII-art snapshot filter that converts an RGB image into a fixed-size
 * character raster for consumption by text-only LLMs.
 *
 * Inspired by "ASCII Art Turns LLMs into VLA Controllers" — each pixel
 * block is mapped to an ASCII character based on its average luminance
 * (ITU-R BT.601), producing a deterministic, human-readable text encoding
 * of the visual scene.
 *
 * The filter is registered like any other snapshot filter:
 * ```ts
 * adapter.imageFiltering.registerFilter(new AsciiSnapshotFilter());
 * ```
 *
 * When requested via `camera_snapshot` with `filters: ["ascii"]`, the tool
 * returns a plain-text ASCII grid instead of a base64 PNG image.
 *
 * @example Default 96 × 54 grid with standard ramp
 * ```ts
 * new AsciiSnapshotFilter()
 * ```
 *
 * @example Custom resolution and character set
 * ```ts
 * new AsciiSnapshotFilter({ cols: 120, rows: 40, charset: " .,;!vlLFE$" })
 * ```
 */
export class AsciiSnapshotFilter implements ITextSnapshotFilter {
    public readonly name = "ascii";
    public readonly description =
        "Converts the image to a fixed-size ASCII character grid for text-only LLM consumption. " +
        "Each cell maps average pixel luminance to an ASCII character from a configurable ramp. " +
        "Returns plain text instead of a PNG image.";

    private readonly _cols: number;
    private readonly _rows: number;
    private readonly _charset: string;

    /**
     * @param options.cols     Number of character columns (default 96).
     * @param options.rows     Number of character rows (default 54).
     * @param options.charset  Luminance-to-character ramp, ordered darkest → brightest
     *                         (default `" .:-=+*#%@"`). The first character maps to
     *                         luminance 0 (black) and the last to luminance 255 (white),
     *                         so a space first means dark areas become whitespace.
     */
    constructor(options?: { cols?: number; rows?: number; charset?: string }) {
        this._cols = options?.cols ?? 96;
        this._rows = options?.rows ?? 54;
        this._charset = options?.charset ?? " .:-=+*#%@";
    }

    /**
     * Pass-through — the image data is not modified.
     * Text output is produced exclusively by {@link renderToText}.
     */
    public apply(imageData: ImageData): ImageData {
        return imageData;
    }

    /**
     * Converts the image to an ASCII text grid.
     *
     * The source image is divided into a `cols × rows` grid of rectangular
     * cells.  For each cell the average RGB luminance is computed (BT.601)
     * and mapped to a character in the configured charset ramp.
     *
     * @returns  Multi-line string with `rows` lines of `cols` characters each.
     */
    public renderToText(imageData: ImageData): string {
        const { width, height, data } = imageData;
        const cols = this._cols;
        const rows = this._rows;
        const charset = this._charset;
        const charLen = charset.length;

        // Size of each cell in source pixels.
        const cellW = width / cols;
        const cellH = height / rows;

        const lines: string[] = new Array(rows);

        for (let row = 0; row < rows; row++) {
            let line = "";
            const yStart = Math.floor(row * cellH);
            const yEnd = Math.floor((row + 1) * cellH);

            for (let col = 0; col < cols; col++) {
                const xStart = Math.floor(col * cellW);
                const xEnd = Math.floor((col + 1) * cellW);

                // Average luminance over the cell.
                let sum = 0;
                let count = 0;
                for (let y = yStart; y < yEnd; y++) {
                    const rowOffset = y * width * 4;
                    for (let x = xStart; x < xEnd; x++) {
                        const i = rowOffset + x * 4;
                        // BT.601 luminance
                        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                        count++;
                    }
                }

                const avgLum = count > 0 ? sum / count : 0;
                // Map [0, 255] → [0, charLen - 1]
                const charIdx = Math.min(Math.floor((avgLum / 255) * charLen), charLen - 1);
                line += charset[charIdx];
            }

            lines[row] = line;
        }

        return lines.join("\n");
    }
}
