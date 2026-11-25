import {
  OHLC_BAR_PIXELS,
  isLineSeriesType,
  isOhlcSeriesType,
  type PlotScale,
  type PlotSeriesType,
  type SeriesDataRequest,
} from "gigaplot";

/**
 * Describes the downsampled table a plot needs. Keys match `Viewport` in
 * `downsample.py`. Values are in plot units: the column value for numeric
 * columns, and nanoseconds since the axis origin for Instant columns. On an
 * axis with a scale, bin sizes are in positions on the scale instead, so bins
 * are even on screen.
 */
export interface DownsampleParams {
  x_min: number;
  x_max: number;
  /** Width of one bin: at most a pixel for lines, several for bars. */
  x_bin: number;
  y_min?: number;
  y_max?: number;
  y_bin?: number;
  /** Epoch nanoseconds that x plot units count from, when x is an Instant. */
  x_origin?: number;
  /** Epoch nanoseconds that y plot units count from, when y is an Instant. */
  y_origin?: number;
}

/**
 * Scatter cells span 1.5 to 3 pixels. A cell holds one point, so this keeps
 * dense regions from returning a row for every pixel while moving points by
 * no more than the default point radius.
 */
const SCATTER_CELL_PIXELS = 3;

function floorPowerOfTwo(value: number): number {
  return 2 ** Math.floor(Math.log2(value));
}

/**
 * Widens `[min, max]` by half its span on each side, then snaps outward to a
 * grid of between half and one span.
 *
 * The result only changes once the viewport has moved a whole grid step, so
 * small pans and zooms reuse the table already loaded. The margin keeps the
 * plot covered while the next table loads.
 */
export function snapRange(min: number, max: number): [number, number] {
  const span = max - min;
  const grid = 2 ** Math.ceil(Math.log2(span)) / 2;
  return [
    Math.floor((min - span / 2) / grid) * grid,
    Math.ceil((max + span / 2) / grid) * grid,
  ];
}

const identity = (value: number): number => value;

/**
 * Snaps a range like {@link snapRange}, but in positions on a scale, so the
 * margin and grid are even on screen, and returns it in plot units.
 */
function snapScaledRange(
  min: number,
  max: number,
  scale: PlotScale | undefined,
): [number, number] {
  if (scale == null) {
    return snapRange(min, max);
  }
  const [low, high] = snapRange(scale.toPlot(min), scale.toPlot(max));
  const snappedMin = scale.fromPlot(low);
  const snappedMax = scale.fromPlot(high);
  // A margin past the end of the scale's domain, like below zero on an
  // exponential axis, has no value, so the range stops at the view there
  return [
    Number.isFinite(snappedMin) ? Math.min(snappedMin, min) : min,
    Number.isFinite(snappedMax) ? Math.max(snappedMax, max) : max,
  ];
}

/**
 * Turns a data request into downsample params, or null if the request does not
 * describe a drawable area.
 *
 * Bin sizes are rounded down to a power of two, so zooming only asks for a new
 * table once the resolution has changed by a factor of two. Line, area, and
 * bar plots ignore the y viewport, since every y value in an x bin is drawn
 * anyway. Bars are binned like `ohlcDownsampler` does in memory, so neighbours
 * end up `OHLC_BAR_PIXELS / 2` to `OHLC_BAR_PIXELS` pixels apart.
 */
export function getDownsampleParams(
  request: Pick<
    SeriesDataRequest,
    "viewport" | "pixelSize" | "xScale" | "yScale"
  >,
  type: PlotSeriesType,
): DownsampleParams | null {
  const { viewport, pixelSize, xScale, yScale } = request;
  const toX = xScale?.toPlot ?? identity;
  const toY = yScale?.toPlot ?? identity;
  const xSpan = toX(viewport.xMax) - toX(viewport.xMin);
  const ySpan = toY(viewport.yMax) - toY(viewport.yMin);
  if (
    !(xSpan > 0) ||
    !Number.isFinite(xSpan) ||
    !(pixelSize.width > 0) ||
    !(pixelSize.height > 0)
  ) {
    return null;
  }

  const [xMin, xMax] = snapScaledRange(viewport.xMin, viewport.xMax, xScale);
  if (isLineSeriesType(type) || isOhlcSeriesType(type)) {
    const binPixels = isLineSeriesType(type) ? 1 : OHLC_BAR_PIXELS;
    return {
      x_min: xMin,
      x_max: xMax,
      x_bin: floorPowerOfTwo((xSpan / pixelSize.width) * binPixels),
    };
  }

  if (!(ySpan > 0) || !Number.isFinite(ySpan)) {
    return null;
  }
  const [yMin, yMax] = snapScaledRange(viewport.yMin, viewport.yMax, yScale);
  return {
    x_min: xMin,
    x_max: xMax,
    x_bin: floorPowerOfTwo((xSpan / pixelSize.width) * SCATTER_CELL_PIXELS),
    y_min: yMin,
    y_max: yMax,
    y_bin: floorPowerOfTwo((ySpan / pixelSize.height) * SCATTER_CELL_PIXELS),
  };
}

/**
 * Positions along x per pixel column that a table downsampled with `params`
 * resolves: data units on a linear axis. Lines keep every extreme per bin, so a bin is one column; scatter
 * cells are drawn up to {@link SCATTER_CELL_PIXELS} columns wide, and bars up
 * to `OHLC_BAR_PIXELS` apart.
 */
export function getParamsXResolution(
  params: DownsampleParams,
  type: PlotSeriesType,
): number {
  if (isLineSeriesType(type)) {
    return params.x_bin;
  }
  return (
    params.x_bin /
    (isOhlcSeriesType(type) ? OHLC_BAR_PIXELS : SCATTER_CELL_PIXELS)
  );
}

export function downsampleParamsEqual(
  a: DownsampleParams | undefined,
  b: DownsampleParams | undefined,
): boolean {
  if (a == null || b == null) {
    return a === b;
  }
  return (
    a.x_min === b.x_min &&
    a.x_max === b.x_max &&
    a.x_bin === b.x_bin &&
    a.y_min === b.y_min &&
    a.y_max === b.y_max &&
    a.y_bin === b.y_bin &&
    a.x_origin === b.x_origin &&
    a.y_origin === b.y_origin
  );
}
