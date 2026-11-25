import {
  AbstractPlotDataSource,
  createRandom,
  createSeriesData3D,
  type Bounds3D,
  type PlotSeriesType,
  type PlotShape,
  type SeriesData3D,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
  type SeriesStyle,
} from "gigaplot";
import { createDeLoreanRun } from "./deLoreanRun";
import {
  createDeLoreanShape,
  DELOREAN_HALF_LENGTH,
  DELOREAN_TRACK,
} from "./deLoreanShape";
import type { StreamableSource } from "./StreamableSource";

/** Every series the fire trail draws, back to front. */
export const FIRE_TRAIL_SERIES = [
  "stars",
  "road",
  "tracks",
  "embers",
  "flames",
  "core",
  "car",
  "trim",
  "taillights",
  "sparks",
] as const;

export type FireTrailSeriesId = (typeof FIRE_TRAIL_SERIES)[number];

export interface FireTrailSourceOptions {
  /** Styles of each series, such as the color of the flames. */
  styles?: Partial<Record<FireTrailSeriesId, SeriesStyle>>;
  /** Milliseconds between ticks. Omit to tick once per animation frame. */
  intervalMs?: number;
  /** Fixed seed keeps demo and e2e output reproducible. */
  seed?: number;
  title?: string;
}

/**
 * A stretch of road, with the floor at z 0. The box is as tall as it is long,
 * so nothing is stretched, and starts below the floor so the camera, which
 * looks at its center, looks along the road rather than down on it.
 */
export const FIRE_TRAIL_BOUNDS: Bounds3D = {
  xMin: -1,
  xMax: 1,
  yMin: -1,
  yMax: 1,
  zMin: -0.75,
  zMax: 1.25,
};

/** Ticks from a standing start to 88 miles per hour. */
export const FIRE_TRAIL_DRIVE_TICKS = 300;

/**
 * The car's run, shared with anything that follows it such as a
 * speedometer, at one tick per animation frame.
 */
export const FIRE_TRAIL_RUN = createDeLoreanRun(FIRE_TRAIL_DRIVE_TICKS);

/** Ticks the burst of sparks lasts once the car has gone. */
export const FIRE_TRAIL_FLASH_TICKS = 50;

/** When the flames start to die down, and how long they take to go out. */
const BURN_END = FIRE_TRAIL_DRIVE_TICKS + 220;

const FADE_TICKS = 80;

/** Ticks in one run, including a moment of dark road before the next. */
export const FIRE_TRAIL_CYCLE_TICKS = BURN_END + FADE_TICKS + 40;

/** The tick the source starts on: the car almost at 88, trails ablaze. */
const START_TICK = 255;

const CAR_START = -0.9;

const CAR_END = 0.95;

const CAR_X = 0;

const STAR_COUNT = 500;

const CAR_HALF_LENGTH = DELOREAN_HALF_LENGTH;

/** The car's wheels are this far either side of its center. */
const TRACK_OFFSET = DELOREAN_TRACK;

const LANE_EDGE = 0.9;

/** The lines between the car's lane and the lanes either side. */
const LANE_LINE = 0.3;

const LANE_DASH = 0.12;

interface FlameLayer {
  id: "core" | "flames" | "embers";
  name: string;
  count: number;
  /** How high a particle rises by the end of its life. */
  height: number;
  /** Shortest and longest life, in ticks. */
  life: [number, number];
  /** How far a particle sways side to side as it rises. */
  sway: number;
}

const FLAME_LAYERS: FlameLayer[] = [
  {
    id: "embers",
    name: "Embers",
    count: 600,
    height: 0.32,
    life: [40, 90],
    sway: 0.08,
  },
  {
    id: "flames",
    name: "Flames",
    count: 2600,
    height: 0.16,
    life: [16, 34],
    sway: 0.025,
  },
  {
    id: "core",
    name: "Flame core",
    count: 1800,
    height: 0.08,
    life: [10, 22],
    sway: 0.01,
  },
];

const SPARK_COUNT = 800;

const SERIES_NAMES: Record<FireTrailSeriesId, string> = {
  stars: "Stars",
  road: "Road",
  tracks: "Tire tracks",
  embers: "Embers",
  flames: "Flames",
  core: "Flame core",
  car: "DeLorean",
  trim: "Trim",
  taillights: "Taillights",
  sparks: "Time displacement",
};

const SERIES_TYPES: Record<FireTrailSeriesId, PlotSeriesType> = {
  stars: "scatter3d",
  road: "line3d",
  tracks: "line3d",
  embers: "scatter3d",
  flames: "scatter3d",
  core: "scatter3d",
  car: "scatter3d",
  trim: "scatter3d",
  taillights: "scatter3d",
  sparks: "scatter3d",
};

interface Particles {
  layer: FlameLayer;
  data: SeriesData3D;
  /** Where each particle caught light. */
  sourceX: Float64Array;
  sourceY: Float64Array;
  /** Ticks each has burned, negative while it waits to catch. */
  age: Float64Array;
  life: Float64Array;
  phase: Float64Array;
}

function hide(data: SeriesData3D, index: number): void {
  // eslint-disable-next-line no-param-reassign
  data.x[index] = NaN;
  // eslint-disable-next-line no-param-reassign
  data.y[index] = NaN;
  // eslint-disable-next-line no-param-reassign
  data.z[index] = NaN;
}

function setPoint(
  data: SeriesData3D,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  // eslint-disable-next-line no-param-reassign
  data.x[index] = x;
  // eslint-disable-next-line no-param-reassign
  data.y[index] = y;
  // eslint-disable-next-line no-param-reassign
  data.z[index] = z;
}

/**
 * A DeLorean accelerating away down a road at night. As it nears 88 miles per
 * hour electricity crackles around it, and then it is gone in a burst of
 * sparks, leaving two trails of fire burning in its tire tracks.
 *
 * Every particle moves on every tick, sent as one `update` delta per series
 * covering all of it. The run loops, so the trails burn out and the car
 * comes round again.
 */
export class FireTrailSource
  extends AbstractPlotDataSource
  implements StreamableSource
{
  private options: FireTrailSourceOptions;

  private random: () => number;

  private tickCount = 0;

  private road: SeriesData3D;

  private tracks: SeriesData3D;

  private stars: SeriesData3D;

  /** The car's parts, and their shapes as offsets from its center. */
  private carParts: { data: SeriesData3D; shape: SeriesData3D }[];

  private car: SeriesData3D;

  private trim: SeriesData3D;

  private taillights: SeriesData3D;

  private sparks: SeriesData3D;

  /** The direction each spark flies when the car goes. */
  private sparkDirections: SeriesData3D;

  private particles: Particles[];

  private interval: ReturnType<typeof setInterval> | undefined;

  private frame: number | undefined;

  constructor(options: FireTrailSourceOptions = {}) {
    super();
    this.options = options;
    this.random = createRandom(options.seed ?? 1);
    this.tick = this.tick.bind(this);
    this.handleFrame = this.handleFrame.bind(this);

    this.stars = this.createStars();
    this.road = this.createRoad();
    this.tracks = createSeriesData3D(5);
    this.tracks.length = 5;
    const shape = createDeLoreanShape(this.random);
    this.carParts = [shape.body, shape.trim, shape.taillights].map(
      (partShape) => {
        const data = createSeriesData3D(partShape.length);
        data.length = partShape.length;
        return { data, shape: partShape };
      },
    );
    [this.car, this.trim, this.taillights] = this.carParts.map(
      ({ data }) => data,
    );
    this.sparks = createSeriesData3D(SPARK_COUNT);
    this.sparks.length = SPARK_COUNT;
    this.sparkDirections = this.createSparkDirections();
    this.particles = FLAME_LAYERS.map((layer) => {
      const data = createSeriesData3D(layer.count);
      data.length = layer.count;
      const particles: Particles = {
        layer,
        data,
        sourceX: new Float64Array(layer.count),
        sourceY: new Float64Array(layer.count),
        age: new Float64Array(layer.count),
        life: new Float64Array(layer.count),
        phase: new Float64Array(layer.count),
      };
      for (let i = 0; i < layer.count; i += 1) {
        // Stagger the first flames so they do not all catch at once
        particles.age[i] = -Math.floor(this.random() * layer.life[1]);
        particles.life[i] = 1;
        hide(data, i);
      }
      return particles;
    });

    // Run up to the opening moment, so a still of the plot is worth seeing
    for (let i = 0; i < START_TICK; i += 1) {
      this.advance();
    }
  }

  /** A night sky on the far wall of the box, beyond the end of the road. */
  private createStars(): SeriesData3D {
    const { random } = this;
    const { xMin, xMax, yMax, zMax } = FIRE_TRAIL_BOUNDS;
    const stars = createSeriesData3D(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      setPoint(
        stars,
        i,
        xMin + random() * (xMax - xMin),
        yMax,
        // Thinning out towards the horizon
        0.1 + Math.sqrt(random()) * (zMax - 0.1),
      );
    }
    stars.length = STAR_COUNT;
    return stars;
  }

  private createRoad(): SeriesData3D {
    const x: number[] = [];
    const y: number[] = [];
    const z: number[] = [];
    const line = (lineX: number, from: number, to: number) => {
      x.push(lineX, lineX, NaN);
      y.push(from, to, NaN);
      z.push(0, 0, NaN);
    };
    line(-LANE_EDGE, -1, 1);
    line(LANE_EDGE, -1, 1);
    for (let from = -1; from < 1; from += LANE_DASH * 2) {
      line(-LANE_LINE, from, Math.min(1, from + LANE_DASH));
      line(LANE_LINE, from, Math.min(1, from + LANE_DASH));
    }
    const data = createSeriesData3D(x.length);
    data.x.set(x);
    data.y.set(y);
    data.z.set(z);
    data.length = x.length;
    return data;
  }

  private createSparkDirections(): SeriesData3D {
    const { random } = this;
    const directions = createSeriesData3D(SPARK_COUNT);
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      const angle = random() * 2 * Math.PI;
      const rise = random() * 2 - 1;
      const flat = Math.sqrt(1 - rise * rise);
      const reach = 0.4 + random() * 0.6;
      setPoint(
        directions,
        i,
        Math.cos(angle) * flat * reach,
        Math.sin(angle) * flat * reach,
        Math.abs(rise) * reach,
      );
    }
    directions.length = SPARK_COUNT;
    return directions;
  }

  /** Where the run is, from 0 to the cycle length. */
  getPhase(): number {
    return this.tickCount % FIRE_TRAIL_CYCLE_TICKS;
  }

  /** How far down the road the car's center is at `phase`. */
  static getCarY(phase: number): number {
    const tick = Math.min(FIRE_TRAIL_DRIVE_TICKS, Math.max(0, phase));
    return CAR_START + (CAR_END - CAR_START) * FIRE_TRAIL_RUN.distance[tick];
  }

  getPointCount(): number {
    return (
      this.road.length +
      this.tracks.length +
      this.stars.length +
      this.carParts.reduce((total, { data }) => total + data.length, 0) +
      SPARK_COUNT +
      FLAME_LAYERS.reduce((total, layer) => total + layer.count, 0)
    );
  }

  private getData(id: FireTrailSeriesId): SeriesData3D {
    switch (id) {
      case "road":
        return this.road;
      case "tracks":
        return this.tracks;
      case "stars":
        return this.stars;
      case "car":
        return this.car;
      case "trim":
        return this.trim;
      case "taillights":
        return this.taillights;
      case "sparks":
        return this.sparks;
      default:
        return (
          this.particles.find((particles) => particles.layer.id === id)?.data ??
          this.road
        );
    }
  }

  async getShape(): Promise<PlotShape> {
    const styles = this.options.styles ?? {};
    return {
      series: FIRE_TRAIL_SERIES.map((id) => ({
        id,
        name: SERIES_NAMES[id],
        type: SERIES_TYPES[id],
        style: styles[id],
        bounds: FIRE_TRAIL_BOUNDS,
      })),
      bounds: FIRE_TRAIL_BOUNDS,
      title: this.options.title,
    };
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    if (!(FIRE_TRAIL_SERIES as readonly string[]).includes(request.seriesId)) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    // Renderers copy what they are given, so the live buffer can be handed over
    return {
      data: this.getData(request.seriesId as FireTrailSeriesId),
      complete: true,
    };
  }

  private updateTracks(phase: number): void {
    const { tracks } = this;
    const end =
      phase < FIRE_TRAIL_DRIVE_TICKS
        ? FireTrailSource.getCarY(phase) - CAR_HALF_LENGTH
        : CAR_END;
    hide(tracks, 2);
    if (end <= -1) {
      hide(tracks, 0);
      hide(tracks, 1);
      hide(tracks, 3);
      hide(tracks, 4);
      return;
    }
    setPoint(tracks, 0, CAR_X - TRACK_OFFSET, -1, 0);
    setPoint(tracks, 1, CAR_X - TRACK_OFFSET, end, 0);
    setPoint(tracks, 3, CAR_X + TRACK_OFFSET, -1, 0);
    setPoint(tracks, 4, CAR_X + TRACK_OFFSET, end, 0);
  }

  private updateCar(phase: number): void {
    const isDriving = phase < FIRE_TRAIL_DRIVE_TICKS;
    const carY = FireTrailSource.getCarY(phase);
    this.carParts.forEach(({ data, shape }) => {
      for (let i = 0; i < shape.length; i += 1) {
        if (isDriving) {
          setPoint(data, i, CAR_X + shape.x[i], carY + shape.y[i], shape.z[i]);
        } else {
          hide(data, i);
        }
      }
    });
  }

  private updateSparks(phase: number): void {
    const { sparks, sparkDirections, random } = this;
    const carY = FireTrailSource.getCarY(phase);
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      if (phase < FIRE_TRAIL_DRIVE_TICKS) {
        // Electricity crackling round the car, building towards 88
        const charge = (FIRE_TRAIL_RUN.speed[phase] / 88) ** 4;
        if (random() < charge * 0.9) {
          const reach = 1.1 + random() * 0.5;
          setPoint(
            sparks,
            i,
            CAR_X + sparkDirections.x[i] * 0.2 * reach,
            carY + sparkDirections.y[i] * 0.3 * reach,
            0.05 + sparkDirections.z[i] * 0.2 * reach,
          );
        } else {
          hide(sparks, i);
        }
      } else if (phase < FIRE_TRAIL_DRIVE_TICKS + FIRE_TRAIL_FLASH_TICKS) {
        // The burst as it goes, thinning out as the sparks fly apart
        const t = (phase - FIRE_TRAIL_DRIVE_TICKS) / FIRE_TRAIL_FLASH_TICKS;
        if (random() > t) {
          const reach = 0.05 + 1.2 * (1 - (1 - t) ** 3);
          setPoint(
            sparks,
            i,
            CAR_X + sparkDirections.x[i] * reach,
            CAR_END + sparkDirections.y[i] * reach,
            Math.max(0, 0.08 + sparkDirections.z[i] * reach - 0.3 * t * t),
          );
        } else {
          hide(sparks, i);
        }
      } else {
        hide(sparks, i);
      }
    }
  }

  private updateFlames(phase: number): void {
    const { random } = this;
    const isDriving = phase < FIRE_TRAIL_DRIVE_TICKS;
    // Fire only catches in the tracks behind the car
    const burnTo = isDriving
      ? FireTrailSource.getCarY(phase) - CAR_HALF_LENGTH - 0.02
      : CAR_END - CAR_HALF_LENGTH;
    let catchChance = 1;
    if (phase >= BURN_END) {
      catchChance = Math.max(0, 1 - (phase - BURN_END) / FADE_TICKS);
    }

    this.particles.forEach(
      ({ layer, data, sourceX, sourceY, age, life, phase: sway }) => {
        for (let i = 0; i < layer.count; i += 1) {
          age[i] += 1;
          if (age[i] >= life[i]) {
            if (burnTo > -1 && random() < catchChance) {
              const side = random() < 0.5 ? -1 : 1;
              sourceX[i] =
                CAR_X + side * TRACK_OFFSET + (random() - 0.5) * 0.03;
              sourceY[i] = -1 + random() * (burnTo + 1);
              age[i] = 0;
              life[i] =
                layer.life[0] + random() * (layer.life[1] - layer.life[0]);
              sway[i] = random() * 2 * Math.PI;
            } else {
              // Try again a little later
              age[i] = -Math.floor(random() * 10);
              life[i] = 1;
            }
          }
          if (age[i] < 0 || life[i] <= 1) {
            hide(data, i);
          } else {
            const t = age[i] / life[i];
            setPoint(
              data,
              i,
              sourceX[i] + Math.sin(age[i] * 0.3 + sway[i]) * layer.sway * t,
              sourceY[i] - 0.03 * t,
              layer.height * t ** 0.7,
            );
          }
        }
      },
    );
  }

  /** Moves the run on by a tick without telling anyone. */
  private advance(): void {
    this.tickCount += 1;
    const phase = this.getPhase();
    this.updateTracks(phase);
    this.updateCar(phase);
    this.updateSparks(phase);
    this.updateFlames(phase);
  }

  /** Moves everything on by a tick. Exposed so tests can drive it without timers. */
  tick(): void {
    this.advance();
    const deltas: SeriesDelta[] = FIRE_TRAIL_SERIES.filter(
      (id) => id !== "road" && id !== "stars",
    ).map((id) => ({
      type: "update",
      seriesId: id,
      offset: 0,
      data: this.getData(id),
    }));
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

export default FireTrailSource;
