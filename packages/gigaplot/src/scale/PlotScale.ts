import {
  PRIMARY_X_AXIS,
  PRIMARY_Y_AXIS,
  type AxisTick,
  type AxisTickGenerator,
  type AxisValueFormatter,
  type Bounds,
  type PlotAxis,
  type PlotFill,
  type PlotRange,
  type PlotShape,
  type SeriesData,
  type SeriesDescriptor,
} from '../model/PlotTypes';
import { formatValue, linearTicks } from './ticks';

/**
 * Maps the values on an axis to positions along it.
 *
 * A plot draws, pans, zooms, and downsamples in plot units, which are linear
 * on screen, so a scale is what makes an axis logarithmic or removes ranges
 * from it, such as the nights and weekends of a market calendar. The data
 * keeps its own units throughout: sources serve it, tooltips show it, and
 * events report it, in data units.
 *
 * `toPlot` must never decrease as `value` increases, so sorted data stays
 * sorted and a range of values is a range of positions.
 */
export interface PlotScale {
  /** The kind of scale, such as `linear`, `log`, or `breaks`. */
  readonly type: string;
  /**
   * The position of a data value, in plot units. NaN where the scale is not
   * defined, such as at zero on a log scale. Values a scale removes, such as
   * those inside a break, share the position of the end of the removed range.
   */
  toPlot: (value: number) => number;
  /**
   * The data value at a position. The inverse of {@link toPlot}, where a
   * removed range comes back as its end.
   */
  fromPlot: (position: number) => number;
  /**
   * Ticks for the data range `[min, max]`, in data units. Scales that are not
   * linear know where readable ticks fall along them, so these take
   * precedence over the shape's own tick generator.
   */
  ticks?: AxisTickGenerator;
  /** Formats a data value, when the shape has no formatter for the axis. */
  format?: AxisValueFormatter;
}

/** Positions are the values themselves. The default for every axis. */
export const linearScale: PlotScale = Object.freeze({
  type: 'linear',
  toPlot: (value: number) => value,
  fromPlot: (position: number) => position,
});

/** True for a missing scale or a linear one, either of which leaves data as is. */
export function isLinearScale(scale: PlotScale | undefined): boolean {
  return scale == null || scale.type === 'linear';
}

/** The scale of each axis of a 2D plot. */
export interface PlotScales {
  x: PlotScale;
  y: PlotScale;
  /** Scales of the shape's other axes, by id. Linear for those missing. */
  axes?: ReadonlyMap<string, PlotScale>;
}

/**
 * The scales a series is drawn on: those of the axes it names, or of the
 * primary axes for any it does not.
 */
export function getSeriesScales(
  { xAxis, yAxis }: Pick<SeriesDescriptor, 'xAxis' | 'yAxis'>,
  scales: PlotScales
): PlotScales {
  const x =
    xAxis == null || xAxis === PRIMARY_X_AXIS
      ? scales.x
      : (scales.axes?.get(xAxis) ?? linearScale);
  const y =
    yAxis == null || yAxis === PRIMARY_Y_AXIS
      ? scales.y
      : (scales.axes?.get(yAxis) ?? linearScale);
  return x === scales.x && y === scales.y ? scales : { x, y };
}

/**
 * True if a value maps to a position that maps back to it, within rounding,
 * so it is not inside a removed range or outside the scale's domain.
 */
export function isOnScale(scale: PlotScale, value: number): boolean {
  const position = scale.toPlot(value);
  if (!Number.isFinite(position)) {
    return false;
  }
  const back = scale.fromPlot(position);
  return Math.abs(back - value) <= 1e-9 * Math.max(1, Math.abs(value));
}

/** The data units one pixel spans around a position, for formatting values. */
function getDataResolution(
  scale: PlotScale,
  position: number,
  resolution: number
): number {
  const value = scale.fromPlot(position);
  const after = Math.abs(scale.fromPlot(position + resolution) - value);
  // Just before a break, the next pixel jumps across it
  const before = Math.abs(value - scale.fromPlot(position - resolution));
  const smallest = Math.min(after, before);
  return smallest > 0 ? smallest : Math.max(after, before);
}

/** Steps tried inward from each end of a range to find a data value. */
const DOMAIN_SEARCH_STEPS = 64;

/**
 * The data values at the ends of a range of positions. An end with no data
 * value, such as below zero on an exponential axis, is moved inward until it
 * has one.
 */
export function getDataRange(
  scale: PlotScale,
  min: number,
  max: number
): [number, number] {
  const step = (max - min) / DOMAIN_SEARCH_STEPS;
  let low = scale.fromPlot(min);
  for (let i = 1; !Number.isFinite(low) && i < DOMAIN_SEARCH_STEPS; i += 1) {
    low = scale.fromPlot(min + step * i);
  }
  let high = scale.fromPlot(max);
  for (let i = 1; !Number.isFinite(high) && i < DOMAIN_SEARCH_STEPS; i += 1) {
    high = scale.fromPlot(max - step * i);
  }
  return [low, high];
}

/**
 * Tick generator in plot units for an axis with `scale`. Asks the scale's
 * ticks, or else `fallback`, for the data range on screen, and places them by
 * their position, dropping any the scale removes.
 */
export function toPlotTicks(
  scale: PlotScale,
  fallback: AxisTickGenerator | undefined
): AxisTickGenerator {
  const generate = scale.ticks ?? fallback ?? linearTicks;
  return (min, max, targetCount) => {
    const [low, high] = getDataRange(scale, min, max);
    const ticks = generate(low, high, targetCount);
    const placed: AxisTick[] = [];
    for (let i = 0; i < ticks.length; i += 1) {
      const { value, label } = ticks[i];
      const position = scale.toPlot(value);
      if (
        isOnScale(scale, value) &&
        position >= min - (max - min) * 1e-9 &&
        position <= max + (max - min) * 1e-9 &&
        placed[placed.length - 1]?.value !== position
      ) {
        placed.push({ value: position, label });
      }
    }
    return placed;
  };
}

/**
 * Formatter in plot units for an axis with `scale`, which formats the data
 * value at a position with the shape's formatter, the scale's, or numbers.
 */
export function toPlotFormatter(
  scale: PlotScale,
  formatter: AxisValueFormatter | undefined
): AxisValueFormatter {
  const format = formatter ?? scale.format ?? formatValue;
  return (position, resolution) =>
    format(
      scale.fromPlot(position),
      getDataResolution(scale, position, resolution)
    );
}

/** Bounds in data units to plot units. Undefined if an edge has no position. */
export function toPlotBounds(
  bounds: Bounds | undefined,
  { x, y }: PlotScales
): Bounds | undefined {
  if (bounds == null) {
    return undefined;
  }
  const plotBounds = {
    xMin: x.toPlot(bounds.xMin),
    xMax: x.toPlot(bounds.xMax),
    yMin: y.toPlot(bounds.yMin),
    yMax: y.toPlot(bounds.yMax),
  };
  return Object.values(plotBounds).every(Number.isFinite)
    ? plotBounds
    : undefined;
}

/** A range in data units to plot units. Undefined if an end has no position. */
export function toPlotRange(
  range: PlotRange | undefined,
  scale: PlotScale
): PlotRange | undefined {
  if (range == null) {
    return undefined;
  }
  const min = scale.toPlot(range.min);
  const max = scale.toPlot(range.max);
  return Number.isFinite(min) && Number.isFinite(max)
    ? { min, max }
    : undefined;
}

/**
 * Bounds in plot units to data units. An edge past the end of a scale's
 * domain, such as below zero on an exponential axis, is pulled in to the
 * nearest data value, so the bounds stay finite.
 */
export function fromPlotBounds(bounds: Bounds, { x, y }: PlotScales): Bounds {
  const [xMin, xMax] = getDataRange(x, bounds.xMin, bounds.xMax);
  const [yMin, yMax] = getDataRange(y, bounds.yMin, bounds.yMax);
  return { xMin, xMax, yMin, yMax };
}

function mapColumn(
  column: Float64Array,
  length: number,
  toPlot: (value: number) => number
): Float64Array {
  const mapped = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    mapped[i] = toPlot(column[i]);
  }
  return mapped;
}

/**
 * Series data in data units to plot units. Returns `data` itself when both
 * scales are linear, since renderers copy what they are given anyway.
 *
 * An area's base with no position, such as zero on a log scale, is moved to
 * the lowest point of the series, so the fill reaches down to the data rather
 * than vanishing.
 */
export function toPlotSeriesData(
  data: SeriesData,
  scales: PlotScales
): SeriesData {
  const isXLinear = isLinearScale(scales.x);
  const isYLinear = isLinearScale(scales.y);
  if (isXLinear && isYLinear) {
    return data;
  }
  const { length } = data;
  const toX = scales.x.toPlot;
  const toY = scales.y.toPlot;
  const mapX = (column: Float64Array): Float64Array =>
    isXLinear ? column.slice(0, length) : mapColumn(column, length, toX);
  const mapY = (column: Float64Array): Float64Array =>
    isYLinear ? column.slice(0, length) : mapColumn(column, length, toY);
  const mapped: SeriesData = { x: mapX(data.x), y: mapY(data.y), length };
  if (data.open != null) {
    mapped.open = mapY(data.open);
  }
  if (data.high != null) {
    mapped.high = mapY(data.high);
  }
  if (data.low != null) {
    mapped.low = mapY(data.low);
  }
  if (data.z != null) {
    mapped.z = data.z.slice(0, length);
  }
  if (data.base != null) {
    const base = mapY(data.base);
    let lowest = Infinity;
    for (let i = 0; i < length; i += 1) {
      if (Number.isFinite(mapped.y[i]) && mapped.y[i] < lowest) {
        lowest = mapped.y[i];
      }
    }
    for (let i = 0; i < length; i += 1) {
      if (!Number.isFinite(base[i]) && Number.isFinite(lowest)) {
        base[i] = lowest;
      }
    }
    mapped.base = base;
  }
  return mapped;
}

/** Places a fill's gradient stops in data units at their positions. */
function toPlotFill(fill: PlotFill | undefined, scales: PlotScales) {
  if (fill == null || typeof fill === 'string' || fill.units !== 'data') {
    return fill;
  }
  const scale = fill.direction === 'horizontal' ? scales.x : scales.y;
  return {
    ...fill,
    stops: fill.stops.map(stop =>
      stop.offset == null
        ? stop
        : { ...stop, offset: scale.toPlot(stop.offset) }
    ),
  };
}

/** An axis in plot units, the way {@link toPlotShape} places the primary axes. */
function toPlotAxis(axis: PlotAxis, scale: PlotScale): PlotAxis {
  if (isLinearScale(scale)) {
    return axis;
  }
  return {
    ...axis,
    range: toPlotRange(axis.range, scale),
    ticks: toPlotTicks(scale, axis.ticks),
    formatter: toPlotFormatter(scale, axis.formatter),
  };
}

/**
 * The shape as a plot in plot units sees it: bounds placed by the scales,
 * ticks and formatters that read and label data values, and gradients in data
 * units placed along the axis. The axes, legend, hover, and renderers all
 * work from this, so none of them needs to know about scales.
 */
export function toPlotShape(shape: PlotShape, scales: PlotScales): PlotShape {
  const isPrimaryLinear = isLinearScale(scales.x) && isLinearScale(scales.y);
  const axisScales = scales.axes;
  const isAxesLinear =
    axisScales == null ||
    Array.from(axisScales.values()).every(scale => isLinearScale(scale));
  if (isPrimaryLinear && isAxesLinear) {
    return shape;
  }
  const series = shape.series.map((descriptor): SeriesDescriptor => {
    const seriesScales = getSeriesScales(descriptor, scales);
    return {
      ...descriptor,
      bounds: toPlotBounds(descriptor.bounds, seriesScales),
      ...(descriptor.style?.fill != null
        ? {
            style: {
              ...descriptor.style,
              fill: toPlotFill(descriptor.style.fill, seriesScales),
            },
          }
        : {}),
    };
  });
  return {
    ...shape,
    series,
    ...(shape.axes != null
      ? {
          axes: shape.axes.map(axis =>
            toPlotAxis(axis, axisScales?.get(axis.id) ?? linearScale)
          ),
        }
      : {}),
    ...(isPrimaryLinear
      ? {}
      : {
          bounds: toPlotBounds(shape.bounds, scales),
          xAxisTicks: toPlotTicks(scales.x, shape.xAxisTicks),
          yAxisTicks: toPlotTicks(scales.y, shape.yAxisTicks),
          xAxisFormatter: toPlotFormatter(scales.x, shape.xAxisFormatter),
          yAxisFormatter: toPlotFormatter(scales.y, shape.yAxisFormatter),
        }),
  };
}
