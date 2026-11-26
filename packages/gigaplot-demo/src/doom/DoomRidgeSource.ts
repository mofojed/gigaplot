import {
  AbstractPlotDataSource,
  type Bounds,
  type PlotShape,
  type SeriesData,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
  type SeriesDescriptor,
} from "gigaplot";
import { DOOM_HEIGHT, DOOM_WIDTH, type DoomFrame } from "./doomFrame";
import { DoomPalette } from "./DoomPalette";
import { DOOM_BOUNDS } from "./DoomPaletteSource";
import { getThermalColor } from "./doomColors";

/** Lines to split the frame into. Each averages a band of Doom's rows. */
export const RIDGE_LINE_COUNTS = [25, 50, 100, 200];

/** How high the brightest pixel lifts a line, in gaps between lines. */
export const RIDGE_AMPLITUDES = [1, 2, 4, 8];

export type DoomRidgeStyle = "pulsar" | "colorway" | "glow";

export const DOOM_RIDGE_STYLES: { id: DoomRidgeStyle; label: string }[] = [
  { id: "pulsar", label: "Unknown Pleasures" },
  { id: "colorway", label: "Plot colorway" },
  { id: "glow", label: "Glow (areas)" },
];

/** The pulsar plot is white on black, whatever the demo theme. */
const PULSAR_COLOR = "#f4f4f0";

export interface DoomRidgeOptions {
  /** One of {@link RIDGE_LINE_COUNTS}. */
  lineCount: number;
  amplitude: number;
  style: DoomRidgeStyle;
  /**
   * Hides the parts of each line behind the lines in front of it, as in the
   * album cover, rather than drawing every line through the others.
   */
  occlude: boolean;
  lineWidth: number;
}

/** How far a glowing line's fill reaches below it, in gaps between lines. */
const GLOW_DEPTH = 4;

/** Opacity of a glowing line's fill at the line, fading to none below. */
const GLOW_OPACITY = 0.3;

export function getRidgeBounds(
  lineCount: number,
  amplitude: number,
  style: DoomRidgeStyle,
): Bounds {
  const gap = DOOM_HEIGHT / lineCount;
  // The front line's glow reaches below the frame
  const depth = style === "glow" ? GLOW_DEPTH - 1 : 0;
  return {
    ...DOOM_BOUNDS,
    yMin: DOOM_BOUNDS.yMin - depth * gap,
    yMax: DOOM_BOUNDS.yMax - gap + amplitude * gap,
  };
}

/**
 * Plots Doom as a ridgeline plot, like the pulsar plot on the cover of Joy
 * Division's Unknown Pleasures: the frame is cut into bands of rows, and each
 * band becomes a line along x that rises with the brightness of its pixels.
 *
 * Lines further up the screen are further back. Occlusion is done here rather
 * than by the renderer: wherever a line dips behind the silhouette of the
 * lines in front, it follows that silhouette instead, which looks the same
 * when the lines share a color.
 */
export class DoomRidgeSource extends AbstractPlotDataSource {
  private options: DoomRidgeOptions;

  private palette: DoomPalette;

  private lines: SeriesData[] = [];

  private horizon = new Float64Array(DOOM_WIDTH);

  private brightness = new Float64Array(DOOM_WIDTH);

  private indexes = new Uint8Array(DOOM_WIDTH * DOOM_HEIGHT);

  private hasFrame = false;

  /**
   * Set when the lines are laid out afresh. Updates only copy the columns the
   * plot already holds, so a line turning into an area must be replaced.
   */
  private isReplaceNeeded = false;

  private shape: PlotShape;

  private frameCount = 0;

  constructor(options: DoomRidgeOptions, palette = new DoomPalette()) {
    super();
    this.options = options;
    this.palette = palette;
    this.createLines();
    this.shape = this.buildShape();
  }

  async getShape(): Promise<PlotShape> {
    return this.shape;
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const index = this.shape.series.findIndex(
      (series) => series.id === request.seriesId,
    );
    if (index < 0) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    // Renderers copy what they are given, so the live buffer can be handed over
    return { data: this.lines[index], complete: true };
  }

  getPointCount(): number {
    return this.options.lineCount * DOOM_WIDTH;
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  setOptions(changes: Partial<DoomRidgeOptions>): void {
    const previous = this.options;
    this.options = { ...previous, ...changes };
    const { options } = this;
    if (
      options.lineCount !== previous.lineCount ||
      (options.style === "glow") !== (previous.style === "glow")
    ) {
      this.createLines();
    }
    if (
      options.lineCount !== previous.lineCount ||
      options.amplitude !== previous.amplitude ||
      options.style !== previous.style ||
      options.lineWidth !== previous.lineWidth
    ) {
      this.shape = this.buildShape();
      this.fireShapeChanged(this.shape);
    }
    if (this.hasFrame) {
      this.plotFrame();
    }
  }

  pushFrame(frame: DoomFrame): void {
    this.frameCount += 1;
    this.indexes.set(frame.indexes);
    this.hasFrame = true;
    this.palette.learn(frame);
    this.plotFrame();
  }

  private createLines(): void {
    const isArea = this.options.style === "glow";
    this.isReplaceNeeded = true;
    this.lines = Array.from({ length: this.options.lineCount }, () => {
      const x = new Float64Array(DOOM_WIDTH);
      for (let column = 0; column < DOOM_WIDTH; column += 1) {
        x[column] = DOOM_BOUNDS.xMin + column + 0.5;
      }
      // Only areas carry a base, which renderers lay out differently
      return isArea
        ? {
            x,
            y: new Float64Array(DOOM_WIDTH),
            base: new Float64Array(DOOM_WIDTH),
            length: DOOM_WIDTH,
          }
        : { x, y: new Float64Array(DOOM_WIDTH), length: DOOM_WIDTH };
    });
  }

  private getBaseline(line: number): number {
    const gap = DOOM_HEIGHT / this.options.lineCount;
    return DOOM_BOUNDS.yMax - (line + 1) * gap;
  }

  private buildShape(): PlotShape {
    const { lineCount, amplitude, style, lineWidth } = this.options;
    const gap = DOOM_HEIGHT / lineCount;
    const series = Array.from(
      { length: lineCount },
      (_unused, line): SeriesDescriptor => {
        const baseline = this.getBaseline(line);
        const id = `row-${line}`;
        const name = `Row ${Math.round(line * gap)}`;
        if (style === "glow") {
          // Glowing hotter towards the front
          const color = getThermalColor(0.2 + (0.55 * line) / lineCount);
          return {
            id,
            name,
            type: "area",
            style: {
              color,
              lineWidth,
              fill: {
                type: "linear",
                units: "data",
                stops: [
                  { offset: baseline - GLOW_DEPTH * gap, opacity: 0 },
                  { offset: baseline, opacity: GLOW_OPACITY },
                ],
              },
            },
          };
        }
        return {
          id,
          name,
          type: "line",
          style: {
            color: style === "pulsar" ? PULSAR_COLOR : undefined,
            lineWidth,
          },
        };
      },
    );
    return {
      series,
      bounds: getRidgeBounds(lineCount, amplitude, style),
    };
  }

  private plotFrame(): void {
    const { lineCount, amplitude, occlude, style } = this.options;
    const { indexes, horizon, brightness, lines } = this;
    const { luminance } = this.palette;
    const gap = DOOM_HEIGHT / lineCount;
    const lift = amplitude * gap;
    // Areas glow through the lines in front, so they are not occluded
    const isOccluded = occlude && style !== "glow";
    const glowBase = GLOW_DEPTH * gap;
    horizon.fill(Number.NEGATIVE_INFINITY);

    // The front line, at the bottom of the screen, goes first
    for (let line = lineCount - 1; line >= 0; line -= 1) {
      const firstRow = Math.round(line * gap);
      const lastRow = Math.max(firstRow + 1, Math.round((line + 1) * gap));
      brightness.fill(0);
      for (let row = firstRow; row < lastRow; row += 1) {
        const rowStart = row * DOOM_WIDTH;
        for (let column = 0; column < DOOM_WIDTH; column += 1) {
          brightness[column] += luminance[indexes[rowStart + column]];
        }
      }
      const rows = lastRow - firstRow;
      const baseline = this.getBaseline(line);
      const data = lines[line];
      for (let column = 0; column < DOOM_WIDTH; column += 1) {
        let y = baseline + (brightness[column] / rows) * lift;
        if (isOccluded) {
          if (y < horizon[column]) {
            y = horizon[column];
          } else {
            horizon[column] = y;
          }
        }
        data.y[column] = y;
        if (data.base != null) {
          data.base[column] = baseline - glowBase;
        }
      }
    }

    // Otherwise every line keeps its length, so its points update in place
    const isReplaced = this.isReplaceNeeded;
    this.isReplaceNeeded = false;
    const deltas: SeriesDelta[] = this.shape.series.map((series, line) =>
      isReplaced
        ? { type: "replace", seriesId: series.id, data: lines[line] }
        : { type: "update", seriesId: series.id, offset: 0, data: lines[line] },
    );
    this.fireDataChanged(deltas);
  }
}

export default DoomRidgeSource;
