import {
  AbstractPlotDataSource,
  appendSeriesData,
  createSeriesData3D,
  type Bounds3D,
  type PlotShape,
  type SeriesData3D,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
} from "gigaplot";
import { stepLorenz, type Vector3 } from "../samplers3d";
import type { StreamableSource } from "./StreamableSource";

export interface LorenzTrace {
  id: string;
  name: string;
  start: Vector3;
}

export interface LorenzSourceOptions {
  /** Points traced per tick, per trace. */
  pointsPerTick: number;
  /** Points each trace starts with. */
  initialPoints: number;
  /** Traces start again once they reach this many points. */
  maxPoints: number;
  /** Time step between points. */
  dt?: number;
  intervalMs: number;
  title?: string;
}

/** Fixed bounds around the attractor, so the box does not move as it is traced. */
export const LORENZ_BOUNDS: Bounds3D = {
  xMin: -25,
  xMax: 25,
  yMin: -30,
  yMax: 30,
  zMin: 0,
  zMax: 55,
};

/**
 * Traces the Lorenz attractor from nearby starting points, which soon diverge.
 * Each tick sends `append` deltas, so the renderer only uploads the new
 * points. The traces start over once they reach `maxPoints`.
 */
export class LorenzSource
  extends AbstractPlotDataSource
  implements StreamableSource
{
  private traces: LorenzTrace[];

  private options: LorenzSourceOptions;

  private states: Vector3[];

  private data = new Map<string, SeriesData3D>();

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(traces: LorenzTrace[], options: LorenzSourceOptions) {
    super();
    this.traces = traces;
    this.options = options;
    this.states = traces.map(({ start }) => [...start]);
    this.tick = this.tick.bind(this);
    traces.forEach(({ id }, i) => {
      const data = createSeriesData3D();
      appendSeriesData(data, this.trace(i, options.initialPoints));
      this.data.set(id, data);
    });
  }

  private trace(index: number, count: number): SeriesData3D {
    const chunk = createSeriesData3D(count);
    const state = this.states[index];
    for (let i = 0; i < count; i += 1) {
      stepLorenz(state, this.options.dt ?? 0.005);
      [chunk.x[i], chunk.y[i], chunk.z[i]] = state;
    }
    chunk.length = count;
    return chunk;
  }

  async getShape(): Promise<PlotShape> {
    return {
      series: this.traces.map(({ id, name }) => ({
        id,
        name,
        type: "line3d",
        bounds: LORENZ_BOUNDS,
      })),
      bounds: LORENZ_BOUNDS,
      title: this.options.title,
      xAxisLabel: "X",
      yAxisLabel: "Y",
      zAxisLabel: "Z",
    };
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const data = this.data.get(request.seriesId);
    if (data == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    return { data, complete: true };
  }

  /** Traces the next points. Exposed so tests can drive it without timers. */
  tick(): void {
    const deltas: SeriesDelta[] = [];
    this.traces.forEach(({ id, start }, i) => {
      const data = this.data.get(id) as SeriesData3D;
      if (data.length >= this.options.maxPoints) {
        data.length = 0;
        this.states[i] = [...start];
        deltas.push({ type: "clear", seriesId: id });
      }
      const chunk = this.trace(i, this.options.pointsPerTick);
      appendSeriesData(data, chunk);
      deltas.push({ type: "append", seriesId: id, data: chunk });
    });
    this.fireDataChanged(deltas);
  }

  start(): void {
    if (this.timer == null) {
      this.timer = setInterval(this.tick, this.options.intervalMs);
    }
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning(): boolean {
    return this.timer != null;
  }

  close(): void {
    this.stop();
    super.close();
  }
}

export default LorenzSource;
