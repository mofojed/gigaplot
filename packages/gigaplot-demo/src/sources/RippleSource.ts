import {
  AbstractPlotDataSource,
  createSeriesData3D,
  type Bounds3D,
  type PlotShape,
  type SeriesData3D,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
  type SeriesStyle,
} from "gigaplot";
import type { StreamableSource } from "./StreamableSource";

export interface RippleSourceOptions {
  /** Grid lines in each direction across the surface. */
  gridSize: number;
  /** How far the waves travel on each tick, in radians of phase. */
  speed?: number;
  /** Milliseconds between ticks. Omit to tick once per animation frame. */
  intervalMs?: number;
  /** Styles of the lines running along x and along y. */
  rowStyle?: SeriesStyle;
  columnStyle?: SeriesStyle;
  title?: string;
}

/** The pond. Fixed, so the box never resizes as the water moves. */
export const RIPPLE_BOUNDS: Bounds3D = {
  xMin: -1,
  xMax: 1,
  yMin: -1,
  yMax: 1,
  zMin: -1,
  zMax: 1,
};

/** Waves per unit of distance from a drop. */
const WAVE_NUMBER = 16;

/** How quickly a wave dies away from its drop. */
const DAMPING = 1.6;

/** How far the drops are from the center of the pond. */
const DROP_ORBIT = 0.45;

/** Radians the drops circle the center per radian of wave phase. */
const DROP_DRIFT = 0.01;

/** The height of the water at `(x, y)` with two drops interfering at `phase`. */
export function rippleHeight(x: number, y: number, phase: number): number {
  const angle = phase * DROP_DRIFT;
  let z = 0;
  for (let drop = 0; drop < 2; drop += 1) {
    const dropAngle = angle + drop * Math.PI;
    const dx = x - DROP_ORBIT * Math.cos(dropAngle);
    const dy = y - DROP_ORBIT * Math.sin(dropAngle);
    const r = Math.sqrt(dx * dx + dy * dy);
    z += 0.35 * Math.sin(WAVE_NUMBER * r - phase) * Math.exp(-DAMPING * r);
  }
  return z;
}

/**
 * A pond rippling out from two drops that slowly circle each other, drawn as
 * a wireframe of `line3d` series.
 *
 * The rows and columns of the grid are each one series, with a NaN gap
 * between lines so they do not join up. Every tick moves the water and sends
 * an `update` delta per series covering every point.
 */
export class RippleSource
  extends AbstractPlotDataSource
  implements StreamableSource
{
  private options: RippleSourceOptions;

  private phase = 0;

  private rows: SeriesData3D;

  private columns: SeriesData3D;

  private interval: ReturnType<typeof setInterval> | undefined;

  private frame: number | undefined;

  constructor(options: RippleSourceOptions) {
    super();
    this.options = options;
    this.tick = this.tick.bind(this);
    this.handleFrame = this.handleFrame.bind(this);

    const { gridSize } = options;
    // Each line has a trailing gap so the next one starts fresh
    const count = gridSize * (gridSize + 1);
    this.rows = createSeriesData3D(count);
    this.columns = createSeriesData3D(count);
    this.rows.length = count;
    this.columns.length = count;
    this.layOut();
    this.computeHeights();
  }

  /** The x and y of every vertex never change, only the heights do. */
  private layOut(): void {
    const { gridSize } = this.options;
    const { xMin, xMax, yMin, yMax } = RIPPLE_BOUNDS;
    const step = gridSize > 1 ? 1 / (gridSize - 1) : 0;
    let index = 0;
    for (let line = 0; line < gridSize; line += 1) {
      const across = line * step;
      for (let i = 0; i < gridSize; i += 1) {
        const along = i * step;
        this.rows.x[index] = xMin + along * (xMax - xMin);
        this.rows.y[index] = yMin + across * (yMax - yMin);
        this.columns.x[index] = xMin + across * (xMax - xMin);
        this.columns.y[index] = yMin + along * (yMax - yMin);
        index += 1;
      }
      this.rows.x[index] = Number.NaN;
      this.rows.y[index] = Number.NaN;
      this.rows.z[index] = Number.NaN;
      this.columns.x[index] = Number.NaN;
      this.columns.y[index] = Number.NaN;
      this.columns.z[index] = Number.NaN;
      index += 1;
    }
  }

  private computeHeights(): void {
    const { phase } = this;
    [this.rows, this.columns].forEach((data) => {
      for (let i = 0; i < data.length; i += 1) {
        if (!Number.isNaN(data.x[i])) {
          // eslint-disable-next-line no-param-reassign
          data.z[i] = rippleHeight(data.x[i], data.y[i], phase);
        }
      }
    });
  }

  getPointCount(): number {
    return this.rows.length + this.columns.length;
  }

  async getShape(): Promise<PlotShape> {
    const { rowStyle, columnStyle, title } = this.options;
    return {
      series: [
        {
          id: "rows",
          name: "Rows",
          type: "line3d",
          style: rowStyle,
          bounds: RIPPLE_BOUNDS,
        },
        {
          id: "columns",
          name: "Columns",
          type: "line3d",
          style: columnStyle,
          bounds: RIPPLE_BOUNDS,
        },
      ],
      bounds: RIPPLE_BOUNDS,
      title,
      xAxisLabel: "X",
      yAxisLabel: "Y",
      zAxisLabel: "Height",
    };
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const data =
      request.seriesId === "rows"
        ? this.rows
        : request.seriesId === "columns"
          ? this.columns
          : undefined;
    if (data == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    // Renderers copy what they are given, so the live buffer can be handed over
    return { data, complete: true };
  }

  /** Moves the water. Exposed so tests can drive it without timers. */
  tick(): void {
    this.phase += this.options.speed ?? 0.15;
    this.computeHeights();
    const deltas: SeriesDelta[] = [
      { type: "update", seriesId: "rows", offset: 0, data: this.rows },
      { type: "update", seriesId: "columns", offset: 0, data: this.columns },
    ];
    this.fireDataChanged(deltas);
  }

  private handleFrame(): void {
    this.tick();
    this.frame = requestAnimationFrame(this.handleFrame);
  }

  start(): void {
    if (this.isRunning()) {
      return;
    }
    const { intervalMs } = this.options;
    if (intervalMs == null) {
      this.frame = requestAnimationFrame(this.handleFrame);
    } else {
      this.interval = setInterval(this.tick, intervalMs);
    }
  }

  stop(): void {
    if (this.frame != null) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    if (this.interval != null) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  isRunning(): boolean {
    return this.frame != null || this.interval != null;
  }

  close(): void {
    this.stop();
    super.close();
  }
}

export default RippleSource;
