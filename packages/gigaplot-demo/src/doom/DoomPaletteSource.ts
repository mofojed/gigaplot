import {
  AbstractPlotDataSource,
  createSeriesData,
  createSeriesData3D,
  type Bounds,
  type Bounds3D,
  type PlotShape,
  type SeriesData,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
} from "gigaplot";
import { DOOM_HEIGHT, DOOM_WIDTH, type DoomFrame } from "./doomFrame";
import { PALETTE_SIZE, getSeriesColor, type DoomColorMode } from "./doomColors";
import { DoomPalette } from "./DoomPalette";

/** Points drawn for each Doom pixel. A quarter samples every other pixel. */
export const POINTS_PER_PIXEL_CHOICES = [0.25, 1, 4, 9, 16];

export interface DoomPlotOptions {
  /** One of {@link POINTS_PER_PIXEL_CHOICES}. */
  pointsPerPixel: number;
  pointSize: number;
  colorMode: DoomColorMode;
  /** Palette indexes left out of the plot. */
  hidden: ReadonlySet<number>;
  /**
   * How far the brightest color stands above the darkest, in Doom pixels,
   * around zero. Only read in 3D.
   */
  height?: number;
}

export interface DoomPaletteSourceConfig {
  /** Shared with other views, so their colors stay in step. */
  palette?: DoomPalette;
  /**
   * Plots `scatter3d` series, standing each pixel off the floor by its
   * brightness, as a height field.
   */
  is3D?: boolean;
}

/** Centred on the crosshair, in Doom pixels, with y up as on any plot. */
export const DOOM_BOUNDS: Bounds = {
  xMin: -DOOM_WIDTH / 2,
  xMax: DOOM_WIDTH / 2,
  yMin: -DOOM_HEIGHT / 2,
  yMax: DOOM_HEIGHT / 2,
};

/**
 * The 3D box. A plot draws its box as a cube, so y spans as much as x to keep
 * the frame's shape. z is squashed to a third of that, so heights stand out,
 * and centred, as the camera looks at the middle of the box.
 */
export const DOOM_BOUNDS_3D: Bounds3D = {
  ...DOOM_BOUNDS,
  yMin: DOOM_BOUNDS.xMin,
  yMax: DOOM_BOUNDS.xMax,
  zMin: -50,
  zMax: 50,
};

const SERIES_PREFIX = "palette-";

export function getPaletteSeriesId(index: number): string {
  return `${SERIES_PREFIX}${index}`;
}

export function getPaletteIndex(seriesId: string): number | undefined {
  if (!seriesId.startsWith(SERIES_PREFIX)) {
    return undefined;
  }
  const index = Number(seriesId.slice(SERIES_PREFIX.length));
  return Number.isInteger(index) && index >= 0 && index < PALETTE_SIZE
    ? index
    : undefined;
}

/** How a frame is sampled for a points per pixel choice. */
function getSampling(pointsPerPixel: number): {
  step: number;
  split: number;
} {
  if (pointsPerPixel < 1) {
    return { step: Math.round(1 / Math.sqrt(pointsPerPixel)), split: 1 };
  }
  return { step: 1, split: Math.round(Math.sqrt(pointsPerPixel)) };
}

/**
 * Plots Doom as one scatter series per palette color: every pixel of a frame
 * becomes a point in the series of its color.
 *
 * Each frame replaces every series that has, or had, points on screen, so the
 * plot redraws up to the whole frame on every tick. Colors are learned from
 * the frames as they appear, and change with Doom's palette, such as the red
 * flash on taking damage.
 *
 * In 3D, every point also stands up by its color's brightness, from below
 * zero for black to above it for white.
 */
export class DoomPaletteSource extends AbstractPlotDataSource {
  private options: DoomPlotOptions;

  private palette: DoomPalette;

  private is3D: boolean;

  private series: SeriesData[];

  private hiddenMask = new Uint8Array(PALETTE_SIZE);

  private counts = new Uint32Array(PALETTE_SIZE);

  private indexes = new Uint8Array(DOOM_WIDTH * DOOM_HEIGHT);

  private hasFrame = false;

  private shape: PlotShape;

  private pointCount = 0;

  private frameCount = 0;

  private paletteVersion: number;

  constructor(
    options: DoomPlotOptions,
    { palette = new DoomPalette(), is3D = false }: DoomPaletteSourceConfig = {},
  ) {
    super();
    this.options = options;
    this.palette = palette;
    this.is3D = is3D;
    this.series = Array.from({ length: PALETTE_SIZE }, () =>
      this.createData(0),
    );
    this.updateHiddenMask();
    this.paletteVersion = palette.version;
    this.shape = this.buildShape();
  }

  async getShape(): Promise<PlotShape> {
    return this.shape;
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const index = getPaletteIndex(request.seriesId);
    if (index == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    // Renderers copy what they are given, so the live buffer can be handed over
    return { data: this.series[index], complete: true };
  }

  /** Points drawn for the latest frame. */
  getPointCount(): number {
    return this.pointCount;
  }

  /** Frames received since the source was created. */
  getFrameCount(): number {
    return this.frameCount;
  }

  setOptions(changes: Partial<DoomPlotOptions>): void {
    const previous = this.options;
    this.options = { ...previous, ...changes };
    const { options } = this;
    if (
      options.pointSize !== previous.pointSize ||
      options.colorMode !== previous.colorMode
    ) {
      this.shape = this.buildShape();
      this.fireShapeChanged(this.shape);
    }
    if (
      options.hidden !== previous.hidden ||
      options.pointsPerPixel !== previous.pointsPerPixel ||
      options.height !== previous.height
    ) {
      this.updateHiddenMask();
      if (this.hasFrame) {
        this.plotFrame();
      }
    }
  }

  /** Plots a frame. Neither array is held, so they can be reused afterwards. */
  pushFrame(frame: DoomFrame): void {
    this.frameCount += 1;
    this.indexes.set(frame.indexes);
    this.hasFrame = true;
    this.palette.learn(frame);
    // Polled rather than listened for, as the palette outlives the source
    if (this.palette.version !== this.paletteVersion) {
      this.paletteVersion = this.palette.version;
      this.shape = this.buildShape();
      this.fireShapeChanged(this.shape);
    }
    this.plotFrame();
  }

  private createData(capacity: number): SeriesData {
    return this.is3D
      ? createSeriesData3D(capacity)
      : createSeriesData(capacity);
  }

  private updateHiddenMask(): void {
    this.hiddenMask.fill(0);
    this.options.hidden.forEach((index) => {
      this.hiddenMask[index] = 1;
    });
  }

  private buildShape(): PlotShape {
    const { colorMode, pointSize } = this.options;
    return {
      series: Array.from({ length: PALETTE_SIZE }, (_unused, index) => ({
        id: getPaletteSeriesId(index),
        name: `Palette ${index}`,
        type: this.is3D ? "scatter3d" : "scatter",
        style: {
          color: getSeriesColor(colorMode, index, this.palette.colors[index]),
          pointSize,
        },
      })),
      bounds: this.is3D ? DOOM_BOUNDS_3D : DOOM_BOUNDS,
    };
  }

  private ensureCapacity(index: number, capacity: number): SeriesData {
    const data = this.series[index];
    if (data.x.length < capacity) {
      // Grown with headroom, as the count of a color changes on every frame
      const next = this.createData(Math.ceil(capacity * 1.5));
      this.series[index] = next;
      return next;
    }
    return data;
  }

  private plotFrame(): void {
    const { counts, indexes, hiddenMask, series } = this;
    const { luminance } = this.palette;
    const height = this.is3D ? (this.options.height ?? 0) : 0;
    const { step, split } = getSampling(this.options.pointsPerPixel);
    const pointsPerSample = split * split;
    const previousLengths = series.map((data) => data.length);

    counts.fill(0);
    for (let row = 0; row < DOOM_HEIGHT; row += step) {
      const rowStart = row * DOOM_WIDTH;
      for (let column = 0; column < DOOM_WIDTH; column += step) {
        counts[indexes[rowStart + column]] += 1;
      }
    }

    for (let index = 0; index < PALETTE_SIZE; index += 1) {
      const capacity = hiddenMask[index] === 1 ? 0 : counts[index];
      this.ensureCapacity(index, capacity * pointsPerSample).length = 0;
    }

    // Each sample covers a step by step block, split into split by split points
    const spacing = step / split;
    const left = DOOM_BOUNDS.xMin + spacing / 2;
    const top = DOOM_BOUNDS.yMax - spacing / 2;
    let pointCount = 0;
    for (let row = 0; row < DOOM_HEIGHT; row += step) {
      const rowStart = row * DOOM_WIDTH;
      const y = top - row;
      for (let column = 0; column < DOOM_WIDTH; column += step) {
        const index = indexes[rowStart + column];
        if (hiddenMask[index] === 0) {
          const data = series[index];
          const x = left + column;
          const { z } = data;
          const pointZ = (luminance[index] - 0.5) * height;
          let { length } = data;
          for (let j = 0; j < split; j += 1) {
            const pointY = y - j * spacing;
            for (let i = 0; i < split; i += 1) {
              data.x[length] = x + i * spacing;
              data.y[length] = pointY;
              if (z != null) {
                z[length] = pointZ;
              }
              length += 1;
            }
          }
          data.length = length;
          pointCount += pointsPerSample;
        }
      }
    }
    this.pointCount = pointCount;

    const deltas: SeriesDelta[] = [];
    for (let index = 0; index < PALETTE_SIZE; index += 1) {
      // A color absent from this frame and the last has nothing to update
      if (series[index].length > 0 || previousLengths[index] > 0) {
        deltas.push({
          type: "replace",
          seriesId: getPaletteSeriesId(index),
          data: series[index],
        });
      }
    }
    if (deltas.length > 0) {
      this.fireDataChanged(deltas);
    }
  }
}

export default DoomPaletteSource;
