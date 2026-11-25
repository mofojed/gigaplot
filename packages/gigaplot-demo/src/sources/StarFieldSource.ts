import {
  AbstractPlotDataSource,
  createRandom,
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

export interface StarFieldLayer {
  id: string;
  name: string;
  /** Stars in this layer. */
  count: number;
  style?: SeriesStyle;
}

export interface StarFieldSourceOptions {
  /** How far every star moves towards +z on each tick, in data units. */
  speed: number;
  /** Milliseconds between ticks. Omit to tick once per animation frame. */
  intervalMs?: number;
  /** Fixed seed keeps demo and e2e output reproducible. */
  seed?: number;
  title?: string;
}

/** The box the stars fly through. Fixed, so the camera never moves with them. */
export const STAR_FIELD_BOUNDS: Bounds3D = {
  xMin: -1,
  xMax: 1,
  yMin: -1,
  yMax: 1,
  zMin: -1,
  zMax: 1,
};

/**
 * Stars streaming past a camera at the top of the box, looking down it.
 *
 * Every tick moves every star towards +z, and stars that pass the top of the
 * box wrap around to the bottom at a new x and y. Each tick sends one
 * `update` delta per layer covering all of its stars, so a renderer that
 * supports incremental updates rewrites its buffer in place.
 */
export class StarFieldSource
  extends AbstractPlotDataSource
  implements StreamableSource
{
  private layers: StarFieldLayer[];

  private options: StarFieldSourceOptions;

  private random: () => number;

  private stars = new Map<string, SeriesData3D>();

  private interval: ReturnType<typeof setInterval> | undefined;

  private frame: number | undefined;

  constructor(layers: StarFieldLayer[], options: StarFieldSourceOptions) {
    super();
    this.layers = layers;
    this.options = options;
    this.random = createRandom(options.seed ?? 1);
    this.tick = this.tick.bind(this);
    this.handleFrame = this.handleFrame.bind(this);

    const { zMin, zMax } = STAR_FIELD_BOUNDS;
    layers.forEach(({ id, count }) => {
      const data = createSeriesData3D(count);
      for (let i = 0; i < count; i += 1) {
        this.placeStar(data, i);
        data.z[i] = zMin + this.random() * (zMax - zMin);
      }
      data.length = count;
      this.stars.set(id, data);
    });
  }

  private placeStar(data: SeriesData3D, index: number): void {
    const { xMin, xMax, yMin, yMax } = STAR_FIELD_BOUNDS;
    // eslint-disable-next-line no-param-reassign
    data.x[index] = xMin + this.random() * (xMax - xMin);
    // eslint-disable-next-line no-param-reassign
    data.y[index] = yMin + this.random() * (yMax - yMin);
  }

  getPointCount(): number {
    return this.layers.reduce((total, layer) => total + layer.count, 0);
  }

  async getShape(): Promise<PlotShape> {
    return {
      series: this.layers.map(({ id, name, style }) => ({
        id,
        name,
        type: "scatter3d",
        style,
        bounds: STAR_FIELD_BOUNDS,
      })),
      bounds: STAR_FIELD_BOUNDS,
      title: this.options.title,
    };
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const data = this.stars.get(request.seriesId);
    if (data == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    // Renderers copy what they are given, so the live buffer can be handed over
    return { data, complete: true };
  }

  /** Moves every star. Exposed so tests can drive it without timers. */
  tick(): void {
    const { zMin, zMax } = STAR_FIELD_BOUNDS;
    const span = zMax - zMin;
    const deltas: SeriesDelta[] = [];
    this.stars.forEach((data, seriesId) => {
      for (let i = 0; i < data.length; i += 1) {
        data.z[i] += this.options.speed;
        if (data.z[i] > zMax) {
          data.z[i] -= span;
          this.placeStar(data, i);
        }
      }
      deltas.push({ type: "update", seriesId, offset: 0, data });
    });
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

export default StarFieldSource;
