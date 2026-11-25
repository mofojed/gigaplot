import {
  AbstractPlotDataSource,
  createRandom,
  createSeriesData,
  type Bounds,
  type PlotSeriesType,
  type PlotShape,
  type SeriesData,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
  type SeriesStyle,
} from "gigaplot";
import {
  FIRE_TRAIL_DRIVE_TICKS,
  FIRE_TRAIL_FLASH_TICKS,
  FIRE_TRAIL_RUN,
  type FireTrailSource,
} from "./FireTrailSource";

export const SPEEDOMETER_SERIES = [
  "speed",
  "limit",
  "lightning",
  "gone",
] as const;

export type SpeedometerSeriesId = (typeof SPEEDOMETER_SERIES)[number];

export interface SpeedometerSourceOptions {
  styles?: Partial<Record<SpeedometerSeriesId, SeriesStyle>>;
  /** Fixed seed keeps demo and e2e output reproducible. */
  seed?: number;
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

const SERIES: Record<
  SpeedometerSeriesId,
  { name: string; type: PlotSeriesType }
> = {
  speed: { name: "DeLorean", type: "area" },
  limit: { name: "88 mph", type: "line" },
  lightning: { name: "1.21 gigaplots", type: "line" },
  gone: { name: "Time displacement", type: "scatter" },
};

const TICKS_PER_SECOND = FIRE_TRAIL_RUN.ticks / FIRE_TRAIL_RUN.seconds;

/** Where the bolt of lightning strikes from. */
const LIGHTNING_TOP = 108;

/** Ticks each bolt of lightning holds before it forks somewhere new. */
const LIGHTNING_TICKS = 3;

const BOUNDS: Bounds = {
  xMin: 0,
  xMax: FIRE_TRAIL_RUN.seconds * 1.1,
  yMin: 0,
  yMax: 110,
};

/**
 * The speedometer of a {@link FireTrailSource}'s DeLorean, which follows the
 * car tick for tick: it climbs through the gears as the car pulls away, and
 * at 88 the car is gone in a crack of lightning. When the car comes round
 * again the readout starts over.
 *
 * It has no clock of its own, so starting and stopping the car is enough.
 */
export class SpeedometerSource extends AbstractPlotDataSource {
  private car: FireTrailSource;

  private options: SpeedometerSourceOptions;

  private random: () => number;

  private data: Record<SpeedometerSeriesId, SeriesData>;

  /** What the series last showed, so only those that change are sent. */
  private shown = { speedTicks: -1, bolt: -1, gone: false };

  constructor(car: FireTrailSource, options: SpeedometerSourceOptions = {}) {
    super();
    this.car = car;
    this.options = options;
    this.random = createRandom(options.seed ?? 1);
    this.handleCarChanged = this.handleCarChanged.bind(this);

    const speed = createSeriesData(FIRE_TRAIL_DRIVE_TICKS + 1);
    for (let tick = 0; tick <= FIRE_TRAIL_DRIVE_TICKS; tick += 1) {
      speed.x[tick] = tick / TICKS_PER_SECOND;
      speed.y[tick] = FIRE_TRAIL_RUN.speed[tick];
    }
    const limit = createSeriesData(2);
    limit.x.set([0, BOUNDS.xMax]);
    limit.y.set([88, 88]);
    limit.length = 2;
    this.data = {
      speed,
      limit,
      lightning: createSeriesData(0),
      gone: createSeriesData(0),
    };
    this.update();
    car.addEventListener("datachanged", this.handleCarChanged);
  }

  async getShape(): Promise<PlotShape> {
    const { styles = {}, title, xAxisLabel, yAxisLabel } = this.options;
    return {
      series: SPEEDOMETER_SERIES.map((id) => ({
        id,
        ...SERIES[id],
        style: styles[id],
        bounds: BOUNDS,
      })),
      bounds: BOUNDS,
      title,
      xAxisLabel,
      yAxisLabel,
    };
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const data = this.data[request.seriesId as SpeedometerSeriesId];
    if (data == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    // A few hundred points at most, so every one is drawn
    return { data, complete: true };
  }

  /** A jagged bolt from the sky down to where the car vanished. */
  private createBolt(): SeriesData {
    const { random } = this;
    const steps = 9;
    const bolt = createSeriesData(steps + 1);
    const x = FIRE_TRAIL_RUN.seconds;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      // Wildest at the top, narrowing onto its target
      bolt.x[i] =
        i === steps
          ? x
          : x + (random() - 0.5) * 0.12 * FIRE_TRAIL_RUN.seconds * (1 - t);
      bolt.y[i] = LIGHTNING_TOP + (88 - LIGHTNING_TOP) * t;
    }
    bolt.length = steps + 1;
    return bolt;
  }

  /** Catches the readout up with the car, returning what changed. */
  private update(): SeriesDelta[] {
    const phase = this.car.getPhase();
    const deltas: SeriesDelta[] = [];
    const { data, shown } = this;

    const speedTicks = Math.min(phase, FIRE_TRAIL_DRIVE_TICKS) + 1;
    if (speedTicks !== shown.speedTicks) {
      data.speed.length = speedTicks;
      deltas.push({ type: "replace", seriesId: "speed", data: data.speed });
      shown.speedTicks = speedTicks;
    }

    const isGone = phase >= FIRE_TRAIL_DRIVE_TICKS;
    if (isGone !== shown.gone) {
      data.gone = isGone
        ? {
            x: Float64Array.of(FIRE_TRAIL_RUN.seconds),
            y: Float64Array.of(88),
            length: 1,
          }
        : createSeriesData(0);
      deltas.push({ type: "replace", seriesId: "gone", data: data.gone });
      shown.gone = isGone;
    }

    // The bolt flickers, forking anew every few ticks, while the sparks fly
    const sinceGone = phase - FIRE_TRAIL_DRIVE_TICKS;
    const flicker = Math.floor(sinceGone / LIGHTNING_TICKS);
    const bolt =
      sinceGone >= 0 && sinceGone < FIRE_TRAIL_FLASH_TICKS && flicker % 3 !== 2
        ? flicker
        : -1;
    if (bolt !== shown.bolt) {
      data.lightning = bolt >= 0 ? this.createBolt() : createSeriesData(0);
      deltas.push({
        type: "replace",
        seriesId: "lightning",
        data: data.lightning,
      });
      shown.bolt = bolt;
    }
    return deltas;
  }

  private handleCarChanged(): void {
    const deltas = this.update();
    if (deltas.length > 0) {
      this.fireDataChanged(deltas);
    }
  }

  close(): void {
    this.car.removeEventListener("datachanged", this.handleCarChanged);
    super.close();
  }
}

export default SpeedometerSource;
