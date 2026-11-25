export type PlotKind = "scatter" | "line";

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface DatasetOptions {
  kind: PlotKind;
  /** Total points across every series. */
  pointCount: number;
  seriesCount: number;
  /** Fixed seed keeps every library drawing exactly the same points. */
  seed?: number;
}

export interface DatasetSeries {
  id: string;
  name: string;
  color: string;
  /**
   * Line series all share one `x` array, which some libraries require. A
   * scrolled line's arrays are new views, so read them again after a tick.
   */
  x: Float64Array;
  y: Float64Array;
}

/** A run of points, the same in every series. */
export interface PointRange {
  offset: number;
  count: number;
}

/**
 * What a tick changed.
 *
 * - `scatter`: the points in `ranges` were overwritten in place. The point
 *   count never changes, like a ring buffer.
 * - `line`: the oldest `shift` points were dropped from the front and as many
 *   new points appended, so the window scrolls and its x range moves.
 */
export type DatasetChange =
  { kind: "scatter"; ranges: PointRange[] } | { kind: "line"; shift: number };

export const SERIES_COLORS = [
  "#76d9e4",
  "#fcd65b",
  "#9edc6f",
  "#f37e3f",
  "#aa9af4",
  "#f95d84",
  "#5ec9a8",
  "#e6a1d6",
  "#d0a46a",
  "#8fb3ff",
];

const GALAXY_RADIUS = 10;

const GALAXY_BOUND = GALAXY_RADIUS * 1.2;

/** Distinct points per scatter arm. Larger arms reuse them, rotated. */
const SCATTER_POOL_SIZE = 1 << 18;

/** Vertical distance between line series, so each has its own band. */
const LINE_SPACING = 2.5;

/** Line values stay within +/- this of their band's center. */
const LINE_AMPLITUDE = 1;

/** Mulberry32. Small, fast, and seedable. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately normal with a standard deviation of 0.5. */
function gaussian(random: () => number): number {
  return random() + random() + random() - 1.5;
}

/**
 * The data every library draws. It owns the arrays and mutates them in place
 * on every tick, then reports what changed so each library can be updated in
 * whatever way suits it best.
 *
 * Scatter plots are the rotating spiral galaxy of the gigaplot demo's scatter
 * stress example, one arm per series. Lines are bounded random walks, one band
 * per series, so axis ranges are known up front and no library pays for
 * scanning the data to autoscale.
 */
export class BenchmarkDataset {
  readonly kind: PlotKind;

  readonly pointsPerSeries: number;

  readonly series: DatasetSeries[];

  private random: () => number;

  /** Scatter: index of the oldest point, which is the next to be replaced. */
  private cursor = 0;

  /** Scatter: ticks so far, which sets how far the galaxy has turned. */
  private time = 0;

  /** Scatter: points of each arm, see {@link buildScatterPools}. */
  private pools: { x: Float64Array; y: Float64Array }[] = [];

  /** Scatter: the next pool point to place. */
  private poolCursor = 0;

  /** Line: x of the next point to be appended. */
  private nextX = 1;

  /** Line: current value of each series' walk. */
  private walks: number[];

  /**
   * Line: twice the window, so it can scroll by moving where the window's
   * views start, and only has to be moved back to the front now and then.
   */
  private lineBacking: { x: Float64Array; y: Float64Array[] } | undefined;

  /** Line: where the window starts in {@link lineBacking}. */
  private lineStart = 0;

  /** Line: xorshift state, inlined as the walks need two numbers per point. */
  private lineRandom = 1;

  constructor({ kind, pointCount, seriesCount, seed = 42 }: DatasetOptions) {
    this.kind = kind;
    const count = Math.max(1, Math.floor(seriesCount));
    this.pointsPerSeries = Math.max(2, Math.ceil(pointCount / count));
    this.random = createRandom(seed);
    this.walks = new Array(count).fill(0);

    const n = this.pointsPerSeries;
    if (kind === "line") {
      this.lineBacking = {
        x: new Float64Array(n * 2),
        y: Array.from({ length: count }, () => new Float64Array(n * 2)),
      };
      this.lineRandom = Math.floor(this.random() * 0xffffffff) || 1;
    }
    const sharedX = this.lineBacking?.x.subarray(0, n);
    this.series = Array.from({ length: count }, (_unused, index) => ({
      id: `series-${index}`,
      name: `Series ${index + 1}`,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      x: sharedX ?? new Float64Array(n),
      y: this.lineBacking?.y[index].subarray(0, n) ?? new Float64Array(n),
    }));

    if (kind === "scatter") {
      this.buildScatterPools();
      this.writeScatter(0, n);
    } else {
      this.writeLine(0, n);
    }
  }

  getPointCount(): number {
    return this.pointsPerSeries * this.series.length;
  }

  getBounds(): Bounds {
    if (this.kind === "scatter") {
      return {
        xMin: -GALAXY_BOUND,
        xMax: GALAXY_BOUND,
        yMin: -GALAXY_BOUND,
        yMax: GALAXY_BOUND,
      };
    }
    const { x } = this.series[0];
    const margin = LINE_AMPLITUDE * 0.1;
    return {
      xMin: x[0],
      xMax: x[x.length - 1],
      yMin: -LINE_AMPLITUDE - margin,
      yMax: (this.series.length - 1) * LINE_SPACING + LINE_AMPLITUDE + margin,
    };
  }

  /** Replaces `count` points in every series. */
  tick(count: number): DatasetChange {
    const n = this.pointsPerSeries;
    const pointsPerTick = Math.max(1, Math.min(n, Math.floor(count)));
    const backing = this.lineBacking;
    if (backing != null) {
      let start = this.lineStart + pointsPerTick;
      if (start + n > backing.x.length) {
        // Out of room: move the points kept back to the front
        const end = this.lineStart + n;
        backing.x.copyWithin(0, start, end);
        backing.y.forEach((y) => y.copyWithin(0, start, end));
        start = 0;
      }
      this.lineStart = start;
      const x = backing.x.subarray(start, start + n);
      this.series.forEach((series, index) => {
        // eslint-disable-next-line no-param-reassign
        series.x = x;
        // eslint-disable-next-line no-param-reassign
        series.y = backing.y[index].subarray(start, start + n);
      });
      this.writeLine(n - pointsPerTick, pointsPerTick);
      return { kind: "line", shift: pointsPerTick };
    }

    const ranges: PointRange[] = [];
    let remaining = pointsPerTick;
    let offset = this.cursor;
    while (remaining > 0) {
      const chunk = Math.min(remaining, n - offset);
      this.writeScatter(offset, chunk);
      ranges.push({ offset, count: chunk });
      remaining -= chunk;
      offset = (offset + chunk) % n;
    }
    this.cursor = offset;
    this.time += 1;
    return { kind: "scatter", ranges };
  }

  /**
   * Points of every arm at time 0, built once. Placing a point is then a
   * rotation and a little jitter rather than a power, a sine, and a cosine,
   * so generating data costs far less than drawing it.
   */
  private buildScatterPools(): void {
    const { random } = this;
    const twist = 0.55;
    const spread = 0.35;
    const size = Math.min(this.pointsPerSeries, SCATTER_POOL_SIZE);
    const seriesCount = this.series.length;
    this.pools = this.series.map((_series, s) => {
      const x = new Float64Array(size);
      const y = new Float64Array(size);
      const angle = (s * 2 * Math.PI) / seriesCount;
      for (let i = 0; i < size; i += 1) {
        const r = GALAXY_RADIUS * random() ** 0.7;
        const theta = angle + r * twist;
        const jitter = spread * (0.4 + r / GALAXY_RADIUS);
        x[i] = r * Math.cos(theta) + gaussian(random) * jitter;
        y[i] = r * Math.sin(theta) + gaussian(random) * jitter;
      }
      return { x, y };
    });
  }

  private writeScatter(offset: number, count: number): void {
    const { random } = this;
    // The whole galaxy turns slowly as time passes
    const rotation = -this.time * 0.004;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    for (let s = 0; s < this.series.length; s += 1) {
      const { x, y } = this.series[s];
      const pool = this.pools[s];
      const size = pool.x.length;
      let p = this.poolCursor;
      for (let i = offset; i < offset + count; i += 1) {
        const px = pool.x[p];
        const py = pool.y[p];
        // Reused pool points never land exactly on their earlier copies
        x[i] = px * cos - py * sin + (random() - 0.5) * 0.05;
        y[i] = px * sin + py * cos + (random() - 0.5) * 0.05;
        p += 1;
        if (p === size) {
          p = 0;
        }
      }
    }
    this.poolCursor = (this.poolCursor + count) % this.pools[0].x.length;
  }

  private writeLine(offset: number, count: number): void {
    const { x } = this.series[0];
    for (let i = offset; i < offset + count; i += 1) {
      x[i] = this.nextX;
      this.nextX += 1;
    }
    // xorshift32, inline: a call per random number costs more than the rest
    let state = this.lineRandom;
    for (let s = 0; s < this.series.length; s += 1) {
      const { y } = this.series[s];
      const center = s * LINE_SPACING;
      let value = this.walks[s];
      for (let i = offset; i < offset + count; i += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        value += ((state >>> 0) / 4294967296 - 0.5) * 0.08;
        // Reflect off the edges of the band so it never leaves the y range
        if (value > LINE_AMPLITUDE * 0.9) {
          value = LINE_AMPLITUDE * 1.8 - value;
        } else if (value < -LINE_AMPLITUDE * 0.9) {
          value = -LINE_AMPLITUDE * 1.8 - value;
        }
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        y[i] =
          center +
          value +
          ((state >>> 0) / 4294967296 - 0.5) * 0.1 * LINE_AMPLITUDE;
      }
      this.walks[s] = value;
    }
    this.lineRandom = state;
  }
}

export default BenchmarkDataset;
