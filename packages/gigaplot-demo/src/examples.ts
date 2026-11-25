import {
  createBusinessCalendarScale,
  createExponentialScale,
  createLogScale,
  createPowerScale,
  createRandom,
  identityDownsampler,
  lttbDownsampler,
  StaticDataSource,
  StreamingDataSource,
  generateCluster,
  generateOhlc,
  generateSine,
  generateSpikes,
  seriesDataFromArrays,
  stackSeriesData,
  type Plot3DCamera,
  type Plot3DPointScaling,
  type BusinessCalendarOptions,
  type PlotDataSource,
  type PlotScale,
  type PlotThemeOverrides,
  type SeriesData,
} from "gigaplot";
import { CUBE_FACES } from "./cubeFaces";
import { GREAT_SCOTT_EXAMPLE } from "./greatScott";
import { spiralArm } from "./samplers";
import { generateCluster3D, generateHelix, generateLorenz } from "./samplers3d";
import { LorenzSource } from "./sources/LorenzSource";
import { MarketDataSource } from "./sources/MarketDataSource";
import { RollingScatterSource } from "./sources/RollingScatterSource";
import { RippleSource } from "./sources/RippleSource";
import { StarFieldSource } from "./sources/StarFieldSource";

export interface StressOptions {
  /** Total points across every series. */
  pointCount: number;
  /** Fraction of the points replaced on every frame, from 0 to 1. */
  refreshFraction: number;
  pointSize: number;
}

export interface ExampleOptions {
  /** Skip downsampling so the renderer draws every point. */
  fullFidelity: boolean;
  /** Only read by examples with `supportsStressControls`. */
  stress: StressOptions;
}

export type ExampleLayout = "single" | "grid" | "cube" | "stack" | "quad";

/** Scales a plot uses in place of its source's. Keep them stable. */
export interface PlotScaleOverrides {
  xScale?: PlotScale;
  yScale?: PlotScale;
}

/** How a 3D example is drawn. Its presence draws the example with `Plot3D`. */
export interface Plot3DExampleOptions {
  camera?: Partial<Plot3DCamera>;
  showAxes?: boolean;
  pointScaling?: Plot3DPointScaling;
  depthFade?: number;
  /** Applied over the demo theme, such as the black of space. */
  theme?: PlotThemeOverrides;
}

export interface PlotExample {
  id: string;
  name: string;
  description: string;
  /** How the plots are arranged. Defaults to `grid` for many plots, otherwise `single`. */
  layout?: ExampleLayout;
  /** How many plots to lay out side by side. Defaults to 1. */
  plotCount?: number;
  /** Labels shown with each plot, by index. */
  plotTitles?: string[];
  /** Applied to 2D plots in place of the layout's theme. */
  theme?: PlotThemeOverrides;
  /** Whether the full fidelity toggle applies to this example. */
  supportsFullFidelity?: boolean;
  /** Whether the point count, refresh rate, and point size controls apply. */
  supportsStressControls?: boolean;
  /** Starts streaming as soon as the example loads. */
  autoStart?: boolean;
  /** Draws the example as a 3D plot, with these options. */
  plot3d?: Plot3DExampleOptions;
  /** 3D options of each plot, by index, in place of `plot3d`, to mix 2D and 3D plots. */
  plots3d?: (Plot3DExampleOptions | undefined)[];
  /** Scales for each plot, by index, in place of its source's. */
  plotScales?: PlotScaleOverrides[];
  /** Creates the source of each plot. */
  createSource?: (index: number, options: ExampleOptions) => PlotDataSource;
  /**
   * Creates every plot's source at once, in place of `createSource`, so plots
   * can share one, such as to compare scales on the same ticking data.
   */
  createSources?: (options: ExampleOptions) => PlotDataSource[];
}

/** The sources of every plot in an example. */
export function createExampleSources(
  example: PlotExample,
  options: ExampleOptions,
): PlotDataSource[] {
  if (example.createSources != null) {
    return example.createSources(options);
  }
  const { createSource } = example;
  if (createSource == null) {
    throw new Error(`Example ${example.id} has no sources`);
  }
  return Array.from({ length: example.plotCount ?? 1 }, (_unused, index) =>
    createSource(index, options),
  );
}

/** The 3D options of the plot at `index`, if it is drawn in 3D. */
export function getPlot3DOptions(
  example: PlotExample,
  index: number,
): Plot3DExampleOptions | undefined {
  return example.plots3d?.[index] ?? example.plot3d;
}

/** Plots in the "many plots" example. 8x8 grid. */
export const GRID_PLOT_COUNT = 64;

const GRID_POINTS_PER_PLOT = 50_000;

/** Spiral arms in the scatter stress example, one series and color each. */
export const STRESS_SERIES_COUNT = 4;

export const STRESS_POINT_COUNTS = [
  10_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
  10_000_000,
];

export const STRESS_REFRESH_FRACTIONS = [0.01, 0.1, 0.25, 1];

export const STRESS_POINT_SIZES = [1, 2, 3, 5];

export const DEFAULT_STRESS_OPTIONS: StressOptions = {
  pointCount: 100_000,
  refreshFraction: 0.1,
  pointSize: 2,
};

const GALAXY_RADIUS = 10;

function createStressSource({
  pointCount,
  refreshFraction,
  pointSize,
}: StressOptions): RollingScatterSource {
  const pointsPerSeries = Math.ceil(pointCount / STRESS_SERIES_COUNT);
  const bound = GALAXY_RADIUS * 1.2;
  return new RollingScatterSource(
    Array.from({ length: STRESS_SERIES_COUNT }, (_unused, index) => ({
      id: `arm-${index}`,
      name: `Arm ${index + 1}`,
      style: { pointSize },
      sample: spiralArm({
        angle: (index * 2 * Math.PI) / STRESS_SERIES_COUNT,
        radius: GALAXY_RADIUS,
        speed: 0.004,
      }),
    })),
    {
      seed: 42,
      pointsPerSeries,
      pointsPerTick: Math.ceil(pointsPerSeries * refreshFraction),
      bounds: { xMin: -bound, xMax: bound, yMin: -bound, yMax: bound },
      title: "Scatter stress",
    },
  );
}

/** A star field never shows its box, and is flown through from its top face. */
const STAR_FIELD_CAMERA: Partial<Plot3DCamera> = {
  azimuth: -90,
  elevation: 90,
  distance: 1,
  fov: 60,
};

const STAR_FIELD_THEME: PlotThemeOverrides = { backgroundColor: "#000000" };

/** A New York stock exchange day, closed for two January and February holidays. */
const MARKET_CALENDAR: BusinessCalendarOptions = {
  timeZone: "America/New_York",
  sessions: [["09:30", "16:00"]],
  holidays: ["2026-01-19", "2026-02-16"],
};

/** Business time: the close of each session runs into the next open. */
const MARKET_SCALE = createBusinessCalendarScale(MARKET_CALENDAR);

/**
 * Clock time, as a calendar that is always open, so it labels time like the
 * business calendar but keeps every night and weekend.
 */
const CLOCK_SCALE = createBusinessCalendarScale({
  timeZone: "America/New_York",
  sessions: [["00:00", "24:00"]],
  businessDays: [0, 1, 2, 3, 4, 5, 6],
});

const LOG_SCALE = createLogScale(10);

/**
 * Investments compounding monthly for 50 years at different annual rates,
 * with a little noise, which a log scale draws as straight lines.
 */
function compoundGrowth(seed: number, rate: number): SeriesData {
  const random = createRandom(seed);
  const x: number[] = [];
  const y: number[] = [];
  let value = 1000;
  for (let month = 0; month <= 600; month += 1) {
    x.push(month / 12);
    y.push(value);
    value *= 1 + rate / 12 + (random() - 0.5) * 0.02;
  }
  return seriesDataFromArrays(x, y);
}

/** Sound levels in bels, the log of an intensity that rises as `shape(t)`. */
function soundLevel(seed: number, shape: (t: number) => number): SeriesData {
  const random = createRandom(seed);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= 500; i += 1) {
    const t = i / 500;
    x.push(t * 60);
    y.push(Math.log10(1 + 9999 * shape(t)) + (random() - 0.5) * 0.02);
  }
  return seriesDataFromArrays(x, y);
}

/** Distances that grow with the square root of time, like a random walk's spread. */
function diffusion(seed: number, rate: number): SeriesData {
  const random = createRandom(seed);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= 500; i += 1) {
    const t = i / 5;
    x.push(t);
    y.push(Math.sqrt(rate * t) * (1 + (random() - 0.5) * 0.04));
  }
  return seriesDataFromArrays(x, y);
}

/** The mean close of each bar and up to `window - 1` bars before it. */
function movingAverage(bars: SeriesData, window: number): SeriesData {
  const x: number[] = [];
  const y: number[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars.y[i];
    if (i >= window) {
      sum -= bars.y[i - window];
    }
    x.push(bars.x[i]);
    y.push(sum / Math.min(i + 1, window));
  }
  return seriesDataFromArrays(x, y);
}

/** A noisy sine wave lifted to stay above zero, for stacking. */
function positiveWave(seed: number, phase: number): SeriesData {
  const wave = generateSine(2000, {
    seed,
    frequency: 0.004,
    phase,
    noise: 0.1,
  });
  for (let i = 0; i < wave.length; i += 1) {
    wave.y[i] = Math.max(0, wave.y[i] + 1.5);
  }
  return wave;
}

/** Looks down on the pond at an angle, so the waves stand out. */
const RIPPLE_CAMERA: Partial<Plot3DCamera> = { azimuth: -55, elevation: 35 };

function createRippleSource(gridSize: number, title?: string): RippleSource {
  return new RippleSource({
    gridSize,
    rowStyle: { color: "#4cc9f0", lineWidth: 1 },
    columnStyle: { color: "#7b61ff", lineWidth: 1 },
    title,
  });
}

/** One kind of plot in the "many plots" grid. */
interface GridTile {
  plot3d?: Plot3DExampleOptions;
  /** `variant` counts how many times the tile has already appeared in the grid. */
  createSource: (variant: number, options: ExampleOptions) => PlotDataSource;
}

function cubeFace(title: string): GridTile["createSource"] {
  const face = CUBE_FACES.find((item) => item.title === title);
  if (face == null) {
    throw new Error(`No cube face ${title}`);
  }
  return () => face.createSource();
}

/**
 * Every kind of plot the demo can draw, cycled through to fill the grid. The
 * first plot in the grid is the random walk and the last is the Lissajous
 * curve; both stream, which the e2e tests rely on to check both ends of the
 * grid tick.
 */
const GRID_TILES: GridTile[] = [
  {
    // A long random walk, the plot the grid used to be filled with
    createSource: (variant, { fullFidelity }) =>
      new StreamingDataSource(
        [
          {
            id: "walk",
            name: "Walk",
            type: "line",
            volatility: 1 + variant * 0.5,
          },
        ],
        {
          seed: variant + 1,
          initialPoints: GRID_POINTS_PER_PLOT,
          pointsPerTick: 25,
          intervalMs: 250,
          ...(fullFidelity ? { downsampler: identityDownsampler } : {}),
        },
      ),
  },
  {
    plot3d: {},
    createSource: (variant) =>
      new StaticDataSource(
        [
          {
            id: "alpha",
            name: "Alpha",
            type: "scatter3d",
            data: generateCluster3D(800, { seed: 11 + variant }),
          },
          {
            id: "beta",
            name: "Beta",
            type: "scatter3d",
            data: generateCluster3D(800, {
              seed: 22 + variant,
              center: [2, 1, 1.5],
              spread: [0.6, 1, 0.8],
            }),
          },
        ],
        { xAxisLabel: "X", yAxisLabel: "Y", zAxisLabel: "Z" },
      ),
  },
  {
    createSource: (variant, { fullFidelity }) =>
      new StreamingDataSource(
        [
          {
            id: "level",
            name: "Level",
            type: "area",
            style: {
              fill: {
                type: "linear",
                stops: [{ opacity: 0.7 }, { opacity: 0 }],
              },
            },
            start: 20,
            volatility: 1.5,
          },
        ],
        {
          seed: 40 + variant,
          initialPoints: 2000,
          pointsPerTick: 10,
          intervalMs: 100,
          maxPoints: 2000,
          ...(fullFidelity ? { downsampler: identityDownsampler } : {}),
        },
      ),
  },
  { createSource: cubeFace("Orbiting clusters") },
  {
    createSource: (variant) => {
      const bars = generateOhlc(80, { seed: 13 + variant, volatility: 1.5 });
      return new StaticDataSource([
        {
          id: "average",
          name: "Average",
          type: "line",
          data: movingAverage(bars, 10),
        },
        { id: "price", name: "Price", type: "candlestick", data: bars },
      ]);
    },
  },
  {
    plot3d: { camera: RIPPLE_CAMERA, showAxes: false },
    createSource: () => createRippleSource(24),
  },
  { createSource: cubeFace("Oscilloscope") },
  {
    createSource: (variant) => {
      const names = ["North", "South", "West"];
      const stacked = stackSeriesData([
        positiveWave(21 + variant, 0),
        positiveWave(22 + variant, 2),
        positiveWave(23 + variant, 4),
      ]);
      return new StaticDataSource(
        stacked.map((data, i) => ({
          id: names[i].toLowerCase(),
          name: names[i],
          type: "area",
          stacked: true,
          data,
        })),
      );
    },
  },
  {
    plot3d: {},
    createSource: (variant) =>
      new LorenzSource(
        [{ id: "a", name: "Lorenz", start: [1 + variant, 1, 1] }],
        {
          pointsPerTick: 8,
          initialPoints: 2000,
          maxPoints: 8000,
          intervalMs: 30,
        },
      ),
  },
  {
    createSource: (variant) =>
      new StaticDataSource([
        {
          id: "price",
          name: "Price",
          type: "ohlc",
          data: generateOhlc(5000, { seed: 12 + variant, volatility: 0.5 }),
        },
      ]),
  },
  { createSource: cubeFace("Lissajous") },
  {
    createSource: (variant) =>
      new StaticDataSource(
        [
          {
            id: "bonds",
            name: "3%",
            type: "line",
            data: compoundGrowth(1 + variant, 0.03),
          },
          {
            id: "growth",
            name: "12%",
            type: "line",
            data: compoundGrowth(3 + variant, 0.12),
          },
        ],
        { yScale: LOG_SCALE },
      ),
  },
  {
    plot3d: {
      camera: STAR_FIELD_CAMERA,
      showAxes: false,
      pointScaling: "perspective",
      depthFade: 1,
      theme: STAR_FIELD_THEME,
    },
    createSource: (variant) =>
      new StarFieldSource(
        [
          {
            id: "white",
            name: "White",
            count: 1200,
            style: { color: "#ffffff", pointSize: 1.5 },
          },
          {
            id: "gold",
            name: "Gold",
            count: 400,
            style: { color: "#ffd59a", pointSize: 2 },
          },
        ],
        { speed: 0.01, seed: 7 + variant },
      ),
  },
  { createSource: cubeFace("Heartbeat") },
  { createSource: cubeFace("Signal + samples") },
  {
    createSource: (variant) =>
      new MarketDataSource(
        [{ id: "acme", name: "ACME", start: 100, volatility: 0.0012 }],
        {
          calendar: MARKET_CALENDAR,
          startDate: "2026-01-05",
          initialDays: 10,
          barsPerTick: 5,
          intervalMs: 100,
          seed: 17 + variant,
          xScale: MARKET_SCALE,
        },
      ),
  },
];

const GRID_COLUMNS = 8;

/** Each row starts this many tiles on from the last, so columns mix kinds too. */
const GRID_ROW_SHIFT = 5;

function getGridTile(index: number): GridTile {
  const row = Math.floor(index / GRID_COLUMNS);
  const column = index % GRID_COLUMNS;
  return GRID_TILES[(column + row * GRID_ROW_SHIFT) % GRID_TILES.length];
}

/** Distinguishes repeats of a tile. No row holds a tile twice. */
function getGridVariant(index: number): number {
  return Math.floor(index / GRID_COLUMNS);
}

/**
 * Every example is seeded so the demo renders identically on every run, which
 * is what makes the e2e screenshot snapshots stable.
 */
export const examples: PlotExample[] = [
  {
    id: "scatter",
    name: "Scatter",
    description: "Three clusters of 2,000 points each.",
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "alpha",
            name: "Alpha",
            type: "scatter",
            data: generateCluster(2000, {
              seed: 11,
              centerX: -3,
              centerY: 2,
              spreadX: 1.2,
              spreadY: 1,
            }),
          },
          {
            id: "beta",
            name: "Beta",
            type: "scatter",
            data: generateCluster(2000, {
              seed: 22,
              centerX: 1,
              centerY: -1,
              spreadX: 1,
              spreadY: 1.4,
            }),
          },
          {
            id: "gamma",
            name: "Gamma",
            type: "scatter",
            data: generateCluster(2000, {
              seed: 33,
              centerX: 4,
              centerY: 3,
              spreadX: 1.5,
              spreadY: 0.8,
            }),
          },
        ],
        { title: "Scatter", xAxisLabel: "X", yAxisLabel: "Y" },
      ),
  },
  {
    id: "line",
    name: "Line",
    description: "Three noisy sine waves of 5,000 points each.",
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "sine",
            name: "Sine",
            type: "line",
            data: generateSine(5000, {
              seed: 1,
              frequency: 0.01,
              noise: 0.05,
            }),
          },
          {
            id: "cosine",
            name: "Cosine",
            type: "line",
            data: generateSine(5000, {
              seed: 2,
              frequency: 0.01,
              phase: Math.PI / 2,
              amplitude: 0.75,
              noise: 0.05,
            }),
          },
          {
            id: "slow",
            name: "Slow",
            type: "line",
            data: generateSine(5000, {
              seed: 3,
              frequency: 0.002,
              amplitude: 1.5,
              noise: 0.02,
            }),
          },
        ],
        { title: "Line", xAxisLabel: "Sample", yAxisLabel: "Value" },
      ),
  },
  {
    id: "mixed",
    name: "Mixed",
    description: "A line series with a scatter series overlaid.",
    createSource: () =>
      new StaticDataSource([
        {
          id: "trend",
          name: "Trend",
          type: "line",
          data: generateSine(2000, { seed: 5, frequency: 0.01, noise: 0.02 }),
        },
        {
          id: "samples",
          name: "Samples",
          type: "scatter",
          style: { pointSize: 7 },
          data: generateSine(120, {
            seed: 6,
            frequency: 0.01,
            xStep: 16,
            noise: 0.15,
          }),
        },
      ]),
  },
  {
    id: "area",
    name: "Area",
    description:
      "Two areas filled down to zero. One fades from its line color at the " +
      "top of the plot to clear at the bottom; the other is green above zero " +
      "and red below, with a gradient placed at data values.",
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "slow",
            name: "Slow",
            type: "area",
            style: {
              fill: {
                type: "linear",
                stops: [{ opacity: 0.7 }, { opacity: 0 }],
              },
            },
            data: generateSine(5000, {
              seed: 3,
              frequency: 0.002,
              amplitude: 1.5,
              noise: 0.02,
            }),
          },
          {
            id: "signal",
            name: "Signal",
            type: "area",
            style: {
              color: "#f0f0ee",
              lineWidth: 1,
              fill: {
                type: "linear",
                units: "data",
                stops: [
                  { offset: 0, color: "#f85e85", opacity: 0.6 },
                  { offset: 0, color: "#9bd96c", opacity: 0.6 },
                ],
              },
            },
            data: generateSine(5000, {
              seed: 2,
              frequency: 0.01,
              amplitude: 0.75,
              noise: 0.05,
            }),
          },
        ],
        { title: "Area", xAxisLabel: "Sample", yAxisLabel: "Value" },
      ),
  },
  {
    id: "stacked-area",
    name: "Stacked area",
    description:
      "Three series of 2,000 points stacked on each other. Hover to see each " +
      "one's own value.",
    createSource: () => {
      const names = ["North", "South", "West"];
      const stacked = stackSeriesData([
        positiveWave(21, 0),
        positiveWave(22, 2),
        positiveWave(23, 4),
      ]);
      return new StaticDataSource(
        stacked.map((data, i) => ({
          id: names[i].toLowerCase(),
          name: names[i],
          type: "area",
          stacked: true,
          data,
        })),
        { title: "Stacked area", xAxisLabel: "Day", yAxisLabel: "Total" },
      );
    },
  },
  {
    id: "ohlc",
    name: "OHLC",
    description:
      "20,000 price bars. Bars are resampled into longer periods until " +
      "they fit; zoom in to see the original bars.",
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "price",
            name: "Price",
            type: "ohlc",
            data: generateOhlc(20_000, { seed: 12, volatility: 0.5 }),
          },
        ],
        { title: "OHLC", xAxisLabel: "Bar", yAxisLabel: "Price" },
      ),
  },
  {
    id: "candlestick",
    name: "Candlestick",
    description: "120 candlesticks with a moving average line.",
    createSource: () => {
      const bars = generateOhlc(120, { seed: 13, volatility: 1.5 });
      return new StaticDataSource(
        [
          // First, so it takes the first colorway color rather than a green
          {
            id: "average",
            name: "Average",
            type: "line",
            data: movingAverage(bars, 10),
          },
          {
            id: "price",
            name: "Price",
            type: "candlestick",
            data: bars,
          },
        ],
        { title: "Candlestick", xAxisLabel: "Bar", yAxisLabel: "Price" },
      );
    },
  },
  {
    id: "downsample",
    name: "Downsample (1M)",
    description:
      "One million points with periodic spikes. Zoom in to see detail resolve.",
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "spikes",
            name: "Spikes",
            type: "line",
            data: generateSpikes(1_000_000, { seed: 7 }),
          },
        ],
        { title: "Downsample" },
      ),
  },
  {
    id: "downsample-lttb",
    name: "Downsample (LTTB)",
    description:
      "The same million points reduced with LTTB instead of min/max, which clips spikes.",
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "spikes",
            name: "Spikes",
            type: "line",
            data: generateSpikes(1_000_000, { seed: 7 }),
          },
        ],
        { downsampler: lttbDownsampler },
      ),
  },
  {
    id: "streaming",
    name: "Streaming",
    description:
      "Four random walks appending points every 100ms as incremental deltas.",
    createSource: () =>
      new StreamingDataSource(
        [
          { id: "w1", name: "Walk 1", type: "line", start: 0, volatility: 1 },
          { id: "w2", name: "Walk 2", type: "line", start: 5, volatility: 1.5 },
          {
            id: "w3",
            name: "Walk 3",
            type: "line",
            start: -5,
            volatility: 0.8,
          },
          { id: "w4", name: "Walk 4", type: "line", start: 10, volatility: 2 },
        ],
        {
          seed: 99,
          initialPoints: 500,
          pointsPerTick: 5,
          intervalMs: 100,
          title: "Streaming",
        },
      ),
  },
  {
    id: "scatter-3d",
    name: "Scatter 3D",
    description:
      "Three clusters of 2,000 points each in 3D. Drag to rotate, scroll to " +
      "zoom, and double click to reset. Hover a point to see its values.",
    plot3d: {},
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "alpha",
            name: "Alpha",
            type: "scatter3d",
            data: generateCluster3D(2000, {
              seed: 11,
              center: [-3, 2, 1],
              spread: [1.2, 1, 1.4],
            }),
          },
          {
            id: "beta",
            name: "Beta",
            type: "scatter3d",
            data: generateCluster3D(2000, {
              seed: 22,
              center: [1, -1, -2],
              spread: [1, 1.4, 0.8],
            }),
          },
          {
            id: "gamma",
            name: "Gamma",
            type: "scatter3d",
            data: generateCluster3D(2000, {
              seed: 33,
              center: [4, 3, 3],
              spread: [1.5, 0.8, 1],
            }),
          },
        ],
        {
          title: "Scatter 3D",
          xAxisLabel: "X",
          yAxisLabel: "Y",
          zAxisLabel: "Z",
        },
      ),
  },
  {
    id: "line-3d",
    name: "Line 3D",
    description:
      "The Lorenz attractor traced from two starting points a hair apart, " +
      "20,000 points each, with a helix around it.",
    plot3d: {},
    createSource: () =>
      new StaticDataSource(
        [
          {
            id: "lorenz-a",
            name: "Lorenz A",
            type: "line3d",
            style: { lineWidth: 1 },
            data: generateLorenz(20_000, { start: [1, 1, 1] }),
          },
          {
            id: "lorenz-b",
            name: "Lorenz B",
            type: "line3d",
            style: { lineWidth: 1 },
            data: generateLorenz(20_000, { start: [1.001, 1, 1] }),
          },
          {
            id: "helix",
            name: "Helix",
            type: "line3d",
            style: { lineWidth: 2 },
            data: generateHelix(2000, { radius: 22, turns: 6, height: 50 }),
          },
        ],
        {
          title: "Line 3D",
          xAxisLabel: "X",
          yAxisLabel: "Y",
          zAxisLabel: "Z",
        },
      ),
  },
  {
    id: "lorenz-3d",
    name: "Streaming 3D",
    description:
      "Two Lorenz attractor traces growing as incremental appends, " +
      "diverging from starting points a hair apart.",
    plot3d: {},
    autoStart: true,
    createSource: () =>
      new LorenzSource(
        [
          { id: "a", name: "Trace A", start: [1, 1, 1] },
          { id: "b", name: "Trace B", start: [1.0001, 1, 1] },
        ],
        {
          pointsPerTick: 8,
          initialPoints: 2000,
          maxPoints: 40_000,
          intervalMs: 30,
          title: "Streaming 3D",
        },
      ),
  },
  {
    id: "ripple-3d",
    name: "Ripple 3D",
    description:
      "Waves rippling out from two drops that slowly circle each other, " +
      "interfering where they meet. A wireframe of over 7,000 points in 3D lines " +
      "that all move on every frame as incremental updates.",
    plot3d: { camera: RIPPLE_CAMERA, depthFade: 0.6 },
    autoStart: true,
    createSource: () => createRippleSource(60, "Ripple 3D"),
  },
  {
    id: "star-field",
    name: "Star field",
    description:
      "A ticking 3D scatter plot of 9,000 stars flying past the camera. " +
      "Every star moves on every frame as an incremental update. Points grow " +
      "with perspective as they near the camera and fade with distance.",
    plot3d: {
      camera: STAR_FIELD_CAMERA,
      showAxes: false,
      pointScaling: "perspective",
      depthFade: 1,
      theme: STAR_FIELD_THEME,
    },
    autoStart: true,
    createSource: () =>
      new StarFieldSource(
        [
          {
            id: "white",
            name: "White",
            count: 5000,
            style: { color: "#ffffff", pointSize: 1.5 },
          },
          {
            id: "blue",
            name: "Blue",
            count: 2500,
            style: { color: "#9fc3ff", pointSize: 2 },
          },
          {
            id: "gold",
            name: "Gold",
            count: 1500,
            style: { color: "#ffd59a", pointSize: 2.5 },
          },
        ],
        { speed: 0.01, seed: 7, title: "Star field" },
      ),
  },
  {
    id: "market-hours",
    name: "Market hours",
    description:
      "Six weeks of one minute prices that only trade from 9:30 to 16:00 New " +
      "York time on weekdays, ticking forward. On a clock time axis, nights, " +
      "weekends, and the Martin Luther King Jr. Day holiday are long flat " +
      "lines. A business calendar scale removes them, so each close runs " +
      "straight into the next open and ticks label sessions and times.",
    layout: "stack",
    plotCount: 2,
    plotTitles: [
      "Clock time: nights, weekends, and holidays included",
      "Business calendar: only trading sessions",
    ],
    plotScales: [{ xScale: CLOCK_SCALE }, {}],
    autoStart: true,
    createSources: () => {
      const source = new MarketDataSource(
        [
          { id: "acme", name: "ACME", start: 100, volatility: 0.0012 },
          { id: "globex", name: "GLOBEX", start: 80, volatility: 0.0016 },
        ],
        {
          calendar: MARKET_CALENDAR,
          startDate: "2026-01-05",
          initialDays: 35,
          barsPerTick: 5,
          intervalMs: 100,
          seed: 17,
          title: "Market hours",
          xAxisLabel: "Time (New York)",
          yAxisLabel: "Price",
          xScale: MARKET_SCALE,
        },
      );
      // Both plots draw the same ticking prices, each with its own x scale
      return [source, source];
    },
  },
  {
    id: "log-scale",
    name: "Log scale",
    description:
      "$1,000 compounding for 50 years at 3%, 7%, and 12% a year. On a " +
      "linear axis the slower two look flat; on a log axis every constant " +
      "rate of growth is a straight line, and their slopes compare.",
    layout: "stack",
    plotCount: 2,
    plotTitles: ["Linear", "Logarithmic"],
    plotScales: [{}, { yScale: LOG_SCALE }],
    createSources: () => {
      const source = new StaticDataSource(
        [
          {
            id: "bonds",
            name: "3%",
            type: "line",
            data: compoundGrowth(1, 0.03),
          },
          {
            id: "index",
            name: "7%",
            type: "line",
            data: compoundGrowth(2, 0.07),
          },
          {
            id: "growth",
            name: "12%",
            type: "line",
            data: compoundGrowth(3, 0.12),
          },
        ],
        { title: "Log scale", xAxisLabel: "Years", yAxisLabel: "Value ($)" },
      );
      return [source, source];
    },
  },
  {
    id: "exp-scale",
    name: "Exponential and power",
    description:
      "An exponential scale draws a logarithm, here sound levels in bels, in " +
      "proportion to the intensity it measures, so an intensity rising " +
      "steadily is a straight line. A power scale of 2 does the same for " +
      "values that grow with a square root, like how far diffusion spreads.",
    layout: "stack",
    plotCount: 2,
    plotTitles: ["Exponential scale: 10^y", "Power scale: y²"],
    createSources: () => [
      new StaticDataSource(
        [
          {
            id: "steady",
            name: "Steady",
            type: "line",
            data: soundLevel(4, (t) => t),
          },
          {
            id: "accelerating",
            name: "Accelerating",
            type: "line",
            data: soundLevel(5, (t) => t * t),
          },
        ],
        {
          xAxisLabel: "Seconds",
          yAxisLabel: "Level (B)",
          yScale: createExponentialScale(10),
        },
      ),
      new StaticDataSource(
        [
          {
            id: "fast",
            name: "Fast",
            type: "line",
            data: diffusion(6, 2),
          },
          {
            id: "slow",
            name: "Slow",
            type: "line",
            data: diffusion(7, 0.5),
          },
        ],
        {
          xAxisLabel: "Time (s)",
          yAxisLabel: "Spread (mm)",
          yScale: createPowerScale(2),
        },
      ),
    ],
  },
  {
    id: "many",
    name: `Many plots (${GRID_PLOT_COUNT})`,
    description:
      `${GRID_PLOT_COUNT} independent plots of every kind the demo can draw: ` +
      "lines, scatter, areas, stacked areas, OHLC, candlesticks, log and " +
      "business time axes, and 3D scatter, lines, and surfaces. Start the " +
      "stream to tick them all at once. WebGL caps a page at roughly 8-16 " +
      "live contexts and drops the oldest beyond that; every WebGPU plot " +
      "here shares a single device.",
    plotCount: GRID_PLOT_COUNT,
    plots3d: Array.from(
      { length: GRID_PLOT_COUNT },
      (_unused, index) => getGridTile(index).plot3d,
    ),
    supportsFullFidelity: true,
    createSource: (index, options) =>
      getGridTile(index).createSource(getGridVariant(index), options),
  },
  {
    id: "cube",
    name: "Plot cube",
    description:
      "Six different streaming plots on the faces of a cube. Drag or use the " +
      "arrow keys to spin it, and explode it to pull the faces apart. Every " +
      "face keeps streaming while it rotates.",
    layout: "cube",
    plotCount: CUBE_FACES.length,
    plotTitles: CUBE_FACES.map((face) => face.title),
    autoStart: true,
    createSource: (index) => CUBE_FACES[index].createSource(),
  },
  GREAT_SCOTT_EXAMPLE,
  {
    id: "scatter-stress",
    name: "Scatter stress",
    description:
      "A rotating spiral galaxy that is never downsampled, so every point is " +
      "drawn on every frame. Points are replaced oldest first, once per " +
      "animation frame, as incremental updates. Raise the point count to find " +
      "where the renderer's frame rate drops.",
    supportsStressControls: true,
    autoStart: true,
    createSource: (_index, { stress }) => createStressSource(stress),
  },
];

export function getExample(id: string): PlotExample {
  return examples.find((example) => example.id === id) ?? examples[0];
}
