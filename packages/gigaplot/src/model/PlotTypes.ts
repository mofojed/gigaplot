import type { PlotScale } from '../scale/PlotScale';

/**
 * Core value types for the plot package. These are intentionally free of any
 * Deephaven or framework specific concepts so that any data source can be
 * adapted to them.
 */

/** The kinds of series that can be drawn. Renderers advertise which they support. */
export type PlotSeriesType =
  'scatter' | 'line' | 'area' | 'ohlc' | 'candlestick' | 'scatter3d' | 'line3d';

/** Series types drawn in three dimensions, from `x`, `y`, and `z` columns. */
export type Plot3DSeriesType = 'scatter3d' | 'line3d';

/** True for series types drawn by a 3D plot rather than a 2D one. */
export function is3DSeriesType(type: PlotSeriesType): type is Plot3DSeriesType {
  return type === 'scatter3d' || type === 'line3d';
}

/**
 * True for series drawn as a line joining their points in order: `line`, and
 * `area`, which also fills below the line.
 */
export function isLineSeriesType(type: PlotSeriesType): boolean {
  return type === 'line' || type === 'area';
}

/** Series types drawn as a bar per point, from open, high, low, and close values. */
export type OhlcSeriesType = 'ohlc' | 'candlestick';

/** True for series types whose data carries open, high, and low as well as close. */
export function isOhlcSeriesType(type: PlotSeriesType): type is OhlcSeriesType {
  return type === 'ohlc' || type === 'candlestick';
}

/**
 * An axis aligned rectangle in data space. Bounds of 3D data also carry
 * `zMin` and `zMax`, which 2D plots ignore.
 */
export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin?: number;
  zMax?: number;
}

/** {@link Bounds} of 3D data, an axis aligned box. */
export type Bounds3D = Bounds & { zMin: number; zMax: number };

/** True if `bounds` has a finite z range as well as x and y. */
export function isBounds3D(bounds: Bounds | undefined): bounds is Bounds3D {
  return (
    bounds != null &&
    bounds.zMin != null &&
    bounds.zMax != null &&
    Number.isFinite(bounds.zMin) &&
    Number.isFinite(bounds.zMax)
  );
}

/** Size in device independent pixels. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Columnar point data for a single series.
 *
 * `x` and `y` are parallel arrays. They may be longer than `length`, allowing a
 * source to over-allocate and append without reallocating.
 *
 * `ohlc` and `candlestick` series also carry `open`, `high`, and `low`, parallel
 * to the others, with `y` holding the close. `area` series may carry `base`,
 * the bottom of the fill at each point, which is zero when it is absent.
 * `scatter3d` and `line3d` series carry `z`. Every helper here keeps these
 * columns in step when present.
 */
export interface SeriesData {
  x: Float64Array;
  y: Float64Array;
  z?: Float64Array;
  open?: Float64Array;
  high?: Float64Array;
  low?: Float64Array;
  base?: Float64Array;
  length: number;
}

/** {@link SeriesData} with the open, high, and low columns of a bar series. */
export type OhlcSeriesData = SeriesData & {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
};

/** {@link SeriesData} with the `z` column of a 3D series. */
export type SeriesData3D = SeriesData & { z: Float64Array };

/** True if `data` carries z values. */
export function isSeriesData3D(data: SeriesData): data is SeriesData3D {
  return data.z != null;
}

/** True if `data` carries open, high, and low values. */
export function isOhlcSeriesData(data: SeriesData): data is OhlcSeriesData {
  return data.open != null && data.high != null && data.low != null;
}

/** A color at one position along a {@link PlotLinearGradient}. */
export interface PlotGradientStop {
  /**
   * Where the color sits, in the gradient's `units`. Stops without one are
   * spaced evenly from 0 to 1, which only makes sense in `plot` units.
   */
  offset?: number;
  /** CSS color. Defaults to the series color. */
  color?: string;
  /** Multiplies the color's alpha, from 0 to 1. Defaults to 1. */
  opacity?: number;
}

/**
 * A fill that blends between colors along one axis. Beyond the first and last
 * stops, the fill keeps their colors.
 *
 * Colors are blended without premultiplying alpha, as a canvas gradient does,
 * so fade to transparent with `opacity: 0` rather than `transparent`, which is
 * transparent black and greys the colors on the way.
 */
export interface PlotLinearGradient {
  type: 'linear';
  stops: PlotGradientStop[];
  /**
   * `vertical`, the default, varies with y; `horizontal` varies with x.
   */
  direction?: 'vertical' | 'horizontal';
  /**
   * What offsets measure. `plot`, the default, spans the plot area from 0 at
   * its top, or left, to 1 at its bottom, or right, so the gradient stays put
   * while panning. `data` places stops at values on the axis, so the gradient
   * moves with the data, such as a color change at zero.
   */
  units?: 'plot' | 'data';
}

/** How an area is filled: a CSS color, or a gradient. */
export type PlotFill = string | PlotLinearGradient;

/** Visual style for a series. Passed to the data source so it can honour fidelity requirements. */
export interface SeriesStyle {
  /** CSS color. When omitted the theme colorway is used based on series index. */
  color?: string;
  /**
   * Line width in pixels. Used by `line`, `line3d`, and `area` series. Zero
   * hides an area's line.
   */
  lineWidth?: number;
  /** Point diameter in pixels. Used by `scatter` and `scatter3d` series. */
  pointSize?: number;
  /**
   * Fill of an `area` series. Defaults to the series color at the theme's
   * `areaFillOpacity`.
   */
  fill?: PlotFill;
}

/** Describes a single series without providing any of its data. */
export interface SeriesDescriptor {
  id: string;
  name: string;
  type: PlotSeriesType;
  style?: SeriesStyle;
  /**
   * True for an `area` stacked on the series below it: its `y` is the
   * running total and its `base` the total below, so it is drawn there, but
   * its value is `y - base`. See {@link stackSeriesData}.
   */
  stacked?: boolean;
  /** Known bounds of the full series, if the source can cheaply provide them. */
  bounds?: Bounds;
}

/** A labelled tick on an axis. */
export interface AxisTick {
  /** Position in data space. */
  value: number;
  label: string;
}

/**
 * Picks the ticks for an axis showing `[min, max]`, aiming for about
 * `targetCount` of them. Lets a source label an axis in its own units, such as
 * timestamps.
 */
export type AxisTickGenerator = (
  min: number,
  max: number,
  targetCount: number
) => AxisTick[];

/**
 * Formats a single value on an axis, such as the hovered value in a tooltip.
 * `resolution` is the data units one screen pixel spans on that axis, so a
 * formatter can show as much precision as the plot can tell apart and no more.
 */
export type AxisValueFormatter = (value: number, resolution: number) => string;

/**
 * The "shape" of a plot: enough information to lay out axes and allocate
 * renderer resources without transferring any point data.
 */
export interface PlotShape {
  series: SeriesDescriptor[];
  /** Union of all series bounds, if known. Used to pick the initial viewport. */
  bounds?: Bounds;
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  /** Ticks for the x axis. Defaults to evenly spaced numbers. */
  xAxisTicks?: AxisTickGenerator;
  /** Ticks for the y axis. Defaults to evenly spaced numbers. */
  yAxisTicks?: AxisTickGenerator;
  /** Formats x values in tooltips. Defaults to numbers at screen precision. */
  xAxisFormatter?: AxisValueFormatter;
  /** Formats y values in tooltips. Defaults to numbers at screen precision. */
  yAxisFormatter?: AxisValueFormatter;
  /**
   * How x values map to positions along the axis, such as a business calendar
   * that removes nights and weekends. Defaults to linear. Its ticks, if it
   * has any, take precedence over `xAxisTicks`. 2D plots only.
   */
  xScale?: PlotScale;
  /** How y values map to positions, such as a log scale. Defaults to linear. */
  yScale?: PlotScale;
  /** Title of the z axis of a 3D plot. */
  zAxisLabel?: string;
  /** Ticks for the z axis of a 3D plot. Defaults to evenly spaced numbers. */
  zAxisTicks?: AxisTickGenerator;
  /** Formats z values in tooltips. Defaults to numbers at screen precision. */
  zAxisFormatter?: AxisValueFormatter;
}

/**
 * An incremental change to a single series.
 *
 * Renderers that can apply deltas cheaply (WebGPU writes into an existing GPU
 * buffer) should do so. Renderers that cannot may treat any delta as "redraw
 * everything" without changing behaviour.
 */
export type SeriesDelta =
  | { type: 'append'; seriesId: string; data: SeriesData }
  | { type: 'update'; seriesId: string; offset: number; data: SeriesData }
  | { type: 'replace'; seriesId: string; data: SeriesData }
  | { type: 'clear'; seriesId: string }
  /**
   * The first `count` points were removed, so every remaining point moved
   * down by `count`. Paired with `append`, this is a rolling window.
   */
  | { type: 'trimStart'; seriesId: string; count: number };

/** Creates an empty {@link SeriesData} with the given capacity. */
export function createSeriesData(capacity = 0): SeriesData {
  return {
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    length: 0,
  };
}

/** Creates an empty {@link OhlcSeriesData} with the given capacity. */
export function createOhlcSeriesData(capacity = 0): OhlcSeriesData {
  return {
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    open: new Float64Array(capacity),
    high: new Float64Array(capacity),
    low: new Float64Array(capacity),
    length: 0,
  };
}

/** Creates an empty {@link SeriesData3D} with the given capacity. */
export function createSeriesData3D(capacity = 0): SeriesData3D {
  return {
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    length: 0,
  };
}

/** Creates an empty series with the same columns as `data`. */
export function createSeriesDataLike(
  data: SeriesData,
  capacity = 0
): SeriesData {
  const created = isOhlcSeriesData(data)
    ? createOhlcSeriesData(capacity)
    : createSeriesData(capacity);
  if (data.base != null) {
    created.base = new Float64Array(capacity);
  }
  if (data.z != null) {
    created.z = new Float64Array(capacity);
  }
  return created;
}

/** Copies point `from` of `source` to point `to` of `target`, in every column. */
/* eslint-disable no-param-reassign -- copies into the target in place */
export function copySeriesPoint(
  source: SeriesData,
  from: number,
  target: SeriesData,
  to: number
): void {
  target.x[to] = source.x[from];
  target.y[to] = source.y[from];
  if (target.open != null && target.high != null && target.low != null) {
    target.open[to] = source.open?.[from] ?? Number.NaN;
    target.high[to] = source.high?.[from] ?? Number.NaN;
    target.low[to] = source.low?.[from] ?? Number.NaN;
  }
  if (target.base != null) {
    target.base[to] = source.base?.[from] ?? 0;
  }
  if (target.z != null) {
    target.z[to] = source.z?.[from] ?? Number.NaN;
  }
}
/* eslint-enable no-param-reassign */

/** Creates a {@link SeriesData} from plain number arrays. */
export function seriesDataFromArrays(
  x: ArrayLike<number>,
  y: ArrayLike<number>
): SeriesData {
  const length = Math.min(x.length, y.length);
  const data = createSeriesData(length);
  for (let i = 0; i < length; i += 1) {
    data.x[i] = x[i];
    data.y[i] = y[i];
  }
  data.length = length;
  return data;
}

/** Creates a {@link SeriesData3D} from plain number arrays. */
export function seriesData3DFromArrays(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>
): SeriesData3D {
  const length = Math.min(x.length, y.length, z.length);
  const data = createSeriesData3D(length);
  for (let i = 0; i < length; i += 1) {
    data.x[i] = x[i];
    data.y[i] = y[i];
    data.z[i] = z[i];
  }
  data.length = length;
  return data;
}

/** Creates an {@link OhlcSeriesData} from plain number arrays, `close` as `y`. */
export function ohlcSeriesDataFromArrays(
  x: ArrayLike<number>,
  open: ArrayLike<number>,
  high: ArrayLike<number>,
  low: ArrayLike<number>,
  close: ArrayLike<number>
): OhlcSeriesData {
  const length = Math.min(
    x.length,
    open.length,
    high.length,
    low.length,
    close.length
  );
  const data = createOhlcSeriesData(length);
  for (let i = 0; i < length; i += 1) {
    data.x[i] = x[i];
    data.open[i] = open[i];
    data.high[i] = high[i];
    data.low[i] = low[i];
    data.y[i] = close[i];
  }
  data.length = length;
  return data;
}

/** Returns a copy holding only the populated portion of `data`. */
export function copySeriesData(data: SeriesData): SeriesData {
  const copy = createSeriesDataLike(data, data.length);
  copy.x.set(data.x.subarray(0, data.length));
  copy.y.set(data.y.subarray(0, data.length));
  if (isOhlcSeriesData(data) && isOhlcSeriesData(copy)) {
    copy.open.set(data.open.subarray(0, data.length));
    copy.high.set(data.high.subarray(0, data.length));
    copy.low.set(data.low.subarray(0, data.length));
  }
  if (data.base != null && copy.base != null) {
    copy.base.set(data.base.subarray(0, data.length));
  }
  if (data.z != null && copy.z != null) {
    copy.z.set(data.z.subarray(0, data.length));
  }
  copy.length = data.length;
  return copy;
}

/**
 * Grows the backing arrays of `data` in place so it can hold `capacity` points.
 * Capacity is doubled rather than fitted exactly so repeated appends amortize.
 */
/* eslint-disable no-param-reassign -- these grow and append in place by design */
export function ensureSeriesCapacity(
  data: SeriesData,
  capacity: number
): SeriesData {
  if (data.x.length >= capacity) {
    return data;
  }
  let nextCapacity = Math.max(data.x.length, 1);
  while (nextCapacity < capacity) {
    nextCapacity *= 2;
  }
  const grow = (column: Float64Array): Float64Array => {
    const grown = new Float64Array(nextCapacity);
    grown.set(column);
    return grown;
  };
  data.x = grow(data.x);
  data.y = grow(data.y);
  if (data.open != null) {
    data.open = grow(data.open);
  }
  if (data.high != null) {
    data.high = grow(data.high);
  }
  if (data.low != null) {
    data.low = grow(data.low);
  }
  if (data.base != null) {
    data.base = grow(data.base);
  }
  if (data.z != null) {
    data.z = grow(data.z);
  }
  return data;
}

/**
 * Removes the first `count` points of `data` in place, without copying: each
 * column becomes a view that starts later in the same memory. The room given
 * up at the front is reclaimed when an append next grows the arrays, which
 * copies only the points kept, so a rolling window costs nothing per trim and
 * a constant amount per point appended.
 */
export function trimSeriesData(data: SeriesData, count: number): SeriesData {
  const removed = Math.min(Math.max(0, Math.floor(count)), data.length);
  if (removed === 0) {
    return data;
  }
  data.x = data.x.subarray(removed);
  data.y = data.y.subarray(removed);
  if (data.open != null) {
    data.open = data.open.subarray(removed);
  }
  if (data.high != null) {
    data.high = data.high.subarray(removed);
  }
  if (data.low != null) {
    data.low = data.low.subarray(removed);
  }
  if (data.base != null) {
    data.base = data.base.subarray(removed);
  }
  if (data.z != null) {
    data.z = data.z.subarray(removed);
  }
  data.length -= removed;
  return data;
}

/** Appends `source` to `target`, growing `target` as needed. */
export function appendSeriesData(
  target: SeriesData,
  source: SeriesData
): SeriesData {
  const count = source.length;
  const at = target.length;
  ensureSeriesCapacity(target, at + count);
  // Column by column with set, which is far faster than point by point. A
  // column the source lacks gets the same default as in copySeriesPoint
  const copy = (
    to: Float64Array | undefined,
    from: Float64Array | undefined,
    missing: number
  ): void => {
    if (to == null) {
      return;
    }
    if (from != null) {
      to.set(from.subarray(0, count), at);
    } else {
      to.fill(missing, at, at + count);
    }
  };
  copy(target.x, source.x, Number.NaN);
  copy(target.y, source.y, Number.NaN);
  if (target.open != null && target.high != null && target.low != null) {
    copy(target.open, source.open, Number.NaN);
    copy(target.high, source.high, Number.NaN);
    copy(target.low, source.low, Number.NaN);
  }
  copy(target.base, source.base, 0);
  copy(target.z, source.z, Number.NaN);
  target.length += count;
  return target;
}
/* eslint-enable no-param-reassign */

/**
 * Computes the bounds of the populated portion of a {@link SeriesData}. Bars
 * span from their low to their high, and areas from their base, so those are
 * included when present. Pass the series `type` to include the zero an `area`
 * without a base is filled down to. Data with a `z` column has its z range
 * too, from the points whose x, y, and z are all finite.
 */
export function getSeriesBounds(
  data: SeriesData,
  type?: PlotSeriesType
): Bounds | undefined {
  if (data.length === 0) {
    return undefined;
  }
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  const { high, low, base, z } = data;
  for (let i = 0; i < data.length; i += 1) {
    const xValue = data.x[i];
    const yValue = data.y[i];
    if (
      Number.isFinite(xValue) &&
      Number.isFinite(yValue) &&
      (z == null || Number.isFinite(z[i]))
    ) {
      if (z != null) {
        zMin = Math.min(zMin, z[i]);
        zMax = Math.max(zMax, z[i]);
      }
      xMin = Math.min(xMin, xValue);
      xMax = Math.max(xMax, xValue);
      yMin = Math.min(yMin, yValue);
      yMax = Math.max(yMax, yValue);
      if (high != null && Number.isFinite(high[i])) {
        yMax = Math.max(yMax, high[i]);
      }
      if (low != null && Number.isFinite(low[i])) {
        yMin = Math.min(yMin, low[i]);
      }
      if (base != null && Number.isFinite(base[i])) {
        yMin = Math.min(yMin, base[i]);
        yMax = Math.max(yMax, base[i]);
      }
    }
  }
  if (!Number.isFinite(xMin)) {
    return undefined;
  }
  if (type === 'area' && base == null) {
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
  }
  return z != null
    ? { xMin, xMax, yMin, yMax, zMin, zMax }
    : { xMin, xMax, yMin, yMax };
}

/** How {@link stackSeriesData} scales each stack. */
export type StackNormalization = 'fraction' | 'percent';

/**
 * Stacks series that share x values point for point, bottom first, for
 * `area` series with `stacked` set. Each result's `y` is the running total
 * up to and including that series, and its `base` the total below it, so each
 * area sits on the one before. Missing values count as zero, so a gap in one
 * series does not open a hole through the ones above.
 *
 * With `normalize`, every point's totals are divided by the total of all the
 * series there, as a `fraction` of 1 or a `percent` of 100.
 *
 * Returns new series and leaves the inputs unchanged.
 */
export function stackSeriesData(
  series: readonly SeriesData[],
  normalize?: StackNormalization
): SeriesData[] {
  const length = series.reduce(
    (longest, data) => Math.max(longest, data.length),
    0
  );
  const valueAt = (data: SeriesData, i: number): number => {
    const value = i < data.length ? data.y[i] : Number.NaN;
    return Number.isFinite(value) ? value : 0;
  };
  const scales = new Float64Array(length).fill(1);
  if (normalize != null) {
    const scale = normalize === 'percent' ? 100 : 1;
    for (let i = 0; i < length; i += 1) {
      const total = series.reduce((sum, data) => sum + valueAt(data, i), 0);
      scales[i] = total !== 0 ? scale / total : Number.NaN;
    }
  }
  const totals = new Float64Array(length);
  return series.map(data => {
    const stacked = createSeriesData(data.length);
    stacked.base = new Float64Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      stacked.x[i] = data.x[i];
      stacked.base[i] = totals[i] * scales[i];
      totals[i] += valueAt(data, i);
      stacked.y[i] = totals[i] * scales[i];
    }
    stacked.length = data.length;
    return stacked;
  });
}

/**
 * Returns the smallest bounds containing both inputs. The z range is the union
 * of whichever inputs have one.
 */
export function unionBounds(
  a: Bounds | undefined,
  b: Bounds | undefined
): Bounds | undefined {
  if (a == null) {
    return b;
  }
  if (b == null) {
    return a;
  }
  const union: Bounds = {
    xMin: Math.min(a.xMin, b.xMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMin: Math.min(a.yMin, b.yMin),
    yMax: Math.max(a.yMax, b.yMax),
  };
  if (isBounds3D(a) || isBounds3D(b)) {
    union.zMin = Math.min(a.zMin ?? Infinity, b.zMin ?? Infinity);
    union.zMax = Math.max(a.zMax ?? -Infinity, b.zMax ?? -Infinity);
  }
  return union;
}

/**
 * Expands zero-width or zero-height bounds and applies a proportional margin so
 * that data does not sit exactly on the plot edge.
 */
export function padBounds(bounds: Bounds, fraction = 0.05): Bounds {
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  const xPad = xSpan > 0 ? xSpan * fraction : 0.5;
  const yPad = ySpan > 0 ? ySpan * fraction : 0.5;
  return {
    xMin: bounds.xMin - xPad,
    xMax: bounds.xMax + xPad,
    yMin: bounds.yMin - yPad,
    yMax: bounds.yMax + yPad,
  };
}

/**
 * Returns true if the two bounds are equal within a small relative epsilon.
 * Only x and y are compared.
 */
export function boundsEqual(
  a: Bounds | undefined,
  b: Bounds | undefined,
  epsilon = 1e-9
): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  const scale =
    Math.max(
      Math.abs(a.xMax - a.xMin),
      Math.abs(a.yMax - a.yMin),
      Number.MIN_VALUE
    ) * epsilon;
  return (
    Math.abs(a.xMin - b.xMin) <= scale &&
    Math.abs(a.xMax - b.xMax) <= scale &&
    Math.abs(a.yMin - b.yMin) <= scale &&
    Math.abs(a.yMax - b.yMax) <= scale
  );
}
