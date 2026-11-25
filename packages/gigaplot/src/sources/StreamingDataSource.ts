import {
  appendSeriesData,
  createSeriesData,
  getSeriesBounds,
  seriesDataFromArrays,
  trimSeriesData,
  unionBounds,
  type PlotSeriesType,
  type SeriesData,
  type SeriesDelta,
  type SeriesStyle,
} from '../model/PlotTypes';
import {
  StaticDataSource,
  type StaticDataSourceOptions,
} from './StaticDataSource';
import { createRandom } from './createRandom';

export interface StreamingSeriesDefinition {
  id: string;
  name: string;
  type: PlotSeriesType;
  style?: SeriesStyle;
  /** Starting y value of the random walk. */
  start?: number;
  /** Magnitude of each random step. */
  volatility?: number;
}

export interface StreamingDataSourceOptions extends StaticDataSourceOptions {
  /** Fixed seed keeps demo and e2e output reproducible. */
  seed?: number;
  /** Points generated before the first tick. */
  initialPoints?: number;
  /** Points appended per tick, per series. */
  pointsPerTick?: number;
  /** Milliseconds between ticks when running. */
  intervalMs?: number;
  /**
   * Points kept per series. Once a series is full, every tick drops its
   * oldest points with a `trimStart` delta, making a rolling window. Omit to
   * keep every point.
   */
  maxPoints?: number;
}

interface SeriesState {
  id: string;
  value: number;
  volatility: number;
}

/**
 * Generates a seeded random walk per series and appends to it over time.
 *
 * Every tick emits `append` deltas, which lets renderers that support
 * incremental uploads avoid re-sending the whole series. With `maxPoints`, it
 * also emits `trimStart` deltas once full, so the series rolls.
 */
export class StreamingDataSource extends StaticDataSource {
  private states: SeriesState[] = [];

  private random: () => number;

  private nextX = 0;

  private pointsPerTick: number;

  private intervalMs: number;

  private maxPoints: number | undefined;

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    series: StreamingSeriesDefinition[],
    options: StreamingDataSourceOptions = {}
  ) {
    super(
      series.map(({ start, volatility, ...descriptor }) => ({
        ...descriptor,
        data: createSeriesData(),
      })),
      options
    );

    this.random = createRandom(options.seed ?? 1234);
    this.pointsPerTick = options.pointsPerTick ?? 1;
    this.intervalMs = options.intervalMs ?? 100;
    this.maxPoints =
      options.maxPoints != null
        ? Math.max(1, Math.floor(options.maxPoints))
        : undefined;
    this.states = series.map(({ id, start, volatility }) => ({
      id,
      value: start ?? 0,
      volatility: volatility ?? 1,
    }));

    this.generate(options.initialPoints ?? 100);
  }

  /** Appends `count` points to every series and returns the resulting deltas. */
  private generate(count: number): SeriesDelta[] {
    const deltas: SeriesDelta[] = [];
    if (count <= 0) {
      return deltas;
    }

    for (let s = 0; s < this.states.length; s += 1) {
      const state = this.states[s];
      const x = new Float64Array(count);
      const y = new Float64Array(count);
      for (let i = 0; i < count; i += 1) {
        state.value += (this.random() - 0.5) * state.volatility;
        x[i] = this.nextX + i;
        y[i] = state.value;
      }
      const appended = seriesDataFromArrays(x, y);

      const existing = this.seriesData.get(state.id);
      if (existing != null) {
        appendSeriesData(existing, appended);
      }
      deltas.push({ type: 'append', seriesId: state.id, data: appended });

      const { maxPoints } = this;
      if (
        existing != null &&
        maxPoints != null &&
        existing.length > maxPoints
      ) {
        const excess = existing.length - maxPoints;
        trimSeriesData(existing, excess);
        deltas.push({ type: 'trimStart', seriesId: state.id, count: excess });
      }
    }
    this.nextX += count;

    for (let i = 0; i < this.descriptors.length; i += 1) {
      const descriptor = this.descriptors[i];
      const bounds = getSeriesBounds(
        this.seriesData.get(descriptor.id) as SeriesData
      );
      // A rolling window's bounds can shrink as old points leave it
      descriptor.bounds =
        this.maxPoints != null
          ? bounds
          : unionBounds(descriptor.bounds, bounds);
    }

    return deltas;
  }

  /** Advances the stream by one tick. Exposed so tests can drive it without timers. */
  tick(): void {
    const deltas = this.generate(this.pointsPerTick);
    if (deltas.length > 0) {
      this.fireShapeChanged(this.buildShape());
      this.fireDataChanged(deltas);
    }
  }

  start(): void {
    if (this.timer != null) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
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

export default StreamingDataSource;
