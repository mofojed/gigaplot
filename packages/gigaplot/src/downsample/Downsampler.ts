import type { SeriesDataRequest } from '../model/PlotDataSource';
import {
  copySeriesPoint,
  createOhlcSeriesData,
  createSeriesDataLike,
  ensureSeriesCapacity,
  isOhlcSeriesData,
  type SeriesData,
} from '../model/PlotTypes';

/**
 * Reduces a fully materialized series to the points needed for one request.
 *
 * This is the in-memory counterpart to a server side downsample. Sources that
 * push work to a backend implement {@link SeriesDataRequest} handling directly
 * and never need a `Downsampler`.
 */
export type Downsampler = (
  input: SeriesData,
  request: SeriesDataRequest
) => SeriesData;

const identity = (value: number): number => value;

/**
 * Where x values sit on screen for a request: their positions on its x
 * scale, so pixel columns are even on screen, such as in business time on an
 * axis without nights and weekends. The data itself stays in data units.
 */
function getXPlacement(request: SeriesDataRequest): {
  toX: (value: number) => number;
  min: number;
  max: number;
} {
  const toX = request.xScale?.toPlot ?? identity;
  return {
    toX,
    min: toX(request.viewport.xMin),
    max: toX(request.viewport.xMax),
  };
}

/** Returns the input unchanged. Useful for small series and for tests. */
export const identityDownsampler: Downsampler = input => input;

/**
 * Finds the index of the last point with `x` less than `value`, or -1.
 * Assumes `data` is sorted ascending by `x`.
 */
function findLastIndexBefore(data: SeriesData, value: number): number {
  let low = 0;
  let high = data.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1; // eslint-disable-line no-bitwise
    if (data.x[mid] < value) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

function copyPoints(
  input: SeriesData,
  indexes: number[],
  count: number
): SeriesData {
  const output = createSeriesDataLike(input, count);
  for (let i = 0; i < count; i += 1) {
    copySeriesPoint(input, indexes[i], output, i);
  }
  output.length = count;
  return output;
}

/**
 * Keeps the first, last, minimum, and maximum point of every pixel column.
 * Areas with a `base` also keep the points where it is lowest and highest, so
 * the bottom of the fill is as exact as the top.
 *
 * The rasterized result is pixel identical to drawing every point at the
 * requested resolution, so no visual fidelity is lost. Requires `input` to be
 * sorted ascending by `x`. Columns are even in the request's x scale, and
 * points with no position on it are dropped.
 */
export const minMaxDownsampler: Downsampler = (input, request) => {
  const { viewport, pixelSize } = request;
  const { base } = input;
  const columns = Math.max(1, Math.floor(pixelSize.width));
  const { toX, min: xMin, max: xMax } = getXPlacement(request);
  const xSpan = xMax - xMin;
  if (
    input.length <= columns * (base != null ? 6 : 4) ||
    !(xSpan > 0) ||
    !Number.isFinite(xSpan)
  ) {
    return input;
  }

  // Include one point outside each edge so lines still enter and exit the plot
  const startIndex = Math.max(0, findLastIndexBefore(input, viewport.xMin));
  const indexes: number[] = [];
  let count = 0;

  let bucket = -1;
  let bucketFirst = -1;
  let bucketLast = -1;
  let bucketMin = -1;
  let bucketMax = -1;
  let bucketBaseMin = -1;
  let bucketBaseMax = -1;

  const flush = (): void => {
    if (bucketFirst < 0) {
      return;
    }
    const ordered = (
      base != null
        ? [
            bucketFirst,
            bucketMin,
            bucketMax,
            bucketBaseMin,
            bucketBaseMax,
            bucketLast,
          ]
        : [bucketFirst, bucketMin, bucketMax, bucketLast]
    ).sort((a, b) => a - b);
    for (let i = 0; i < ordered.length; i += 1) {
      if (i === 0 || ordered[i] !== ordered[i - 1]) {
        indexes[count] = ordered[i];
        count += 1;
      }
    }
    bucketFirst = -1;
  };

  for (let i = startIndex; i < input.length; i += 1) {
    const x = input.x[i];
    const y = input.y[i];
    const position = toX(x);
    const column = Math.floor(((position - xMin) / xSpan) * columns);
    if (!Number.isFinite(column)) {
      // Nothing to place, such as zero on a log axis
    } else if (column !== bucket) {
      flush();
      bucket = column;
      bucketFirst = i;
      bucketMin = i;
      bucketMax = i;
      bucketBaseMin = i;
      bucketBaseMax = i;
    } else {
      if (y < input.y[bucketMin]) {
        bucketMin = i;
      }
      if (y > input.y[bucketMax]) {
        bucketMax = i;
      }
      if (base != null) {
        if (base[i] < base[bucketBaseMin]) {
          bucketBaseMin = i;
        }
        if (base[i] > base[bucketBaseMax]) {
          bucketBaseMax = i;
        }
      }
    }
    if (Number.isFinite(column)) {
      bucketLast = i;
    }
    if (x > viewport.xMax && column > columns) {
      break;
    }
  }
  flush();

  return copyPoints(input, indexes, count);
};

/**
 * Largest Triangle Three Buckets.
 *
 * Produces a fixed point budget that preserves the perceived shape of a line.
 * Unlike {@link minMaxDownsampler} it can clip narrow spikes, so prefer it only
 * when a hard point budget matters more than exactness. Areas are measured in
 * the request's x scale, so the shape kept is the one on screen.
 */
export const lttbDownsampler: Downsampler = (input, request) => {
  const threshold = Math.max(3, Math.floor(request.pixelSize.width));
  if (input.length <= threshold) {
    return input;
  }
  const { toX } = getXPlacement(request);
  const xAt = (index: number): number => toX(input.x[index]);

  const indexes: number[] = [0];
  let count = 1;
  const every = (input.length - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i += 1) {
    const avgRangeStart = Math.floor((i + 1) * every) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * every) + 1, input.length);
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    let avgX = 0;
    let avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j += 1) {
      avgX += xAt(j);
      avgY += input.y[j];
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeStart = Math.floor(i * every) + 1;
    const rangeEnd = Math.floor((i + 1) * every) + 1;
    const pointAX = xAt(a);
    const pointAY = input.y[a];

    let maxArea = -1;
    let maxAreaIndex = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const area = Math.abs(
        (pointAX - avgX) * (input.y[j] - pointAY) -
          (pointAX - xAt(j)) * (avgY - pointAY)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    indexes[count] = maxAreaIndex;
    count += 1;
    a = maxAreaIndex;
  }

  indexes[count] = input.length - 1;
  count += 1;

  return copyPoints(input, indexes, count);
};

/**
 * Bars are aggregated until neighbours are between half this and this many
 * pixels apart, which leaves room to see each bar's open and close.
 */
export const OHLC_BAR_PIXELS = 8;

function floorPowerOfTwo(value: number): number {
  return 2 ** Math.floor(Math.log2(value));
}

/** The larger of two values, ignoring one that is not finite. */
function maxFinite(a: number, b: number): number {
  if (!Number.isFinite(a)) {
    return b;
  }
  return Number.isFinite(b) && b > a ? b : a;
}

function minFinite(a: number, b: number): number {
  if (!Number.isFinite(a)) {
    return b;
  }
  return Number.isFinite(b) && b < a ? b : a;
}

/**
 * Resamples `ohlc` and `candlestick` series into wider bars once there are
 * more than fit: each bin keeps its first open, highest high, lowest low, and
 * last close, at the x of its first bar. This is how prices are resampled to a
 * longer period, so nothing is lost but the detail inside a bar.
 *
 * Bins are anchored at zero and their width is a power of two, so panning
 * never moves a bar and zooming only regroups them at each doubling. Bins are
 * measured in the request's x scale, so on an axis without nights and
 * weekends a bar covers a span of business time. Requires `input` to be
 * sorted ascending by `x`. Series without open, high, and low are returned
 * unchanged.
 */
export const ohlcDownsampler: Downsampler = (input, request) => {
  const { viewport, pixelSize } = request;
  const { toX, min: xMin, max: xMax } = getXPlacement(request);
  const xSpan = xMax - xMin;
  if (
    !isOhlcSeriesData(input) ||
    !(xSpan > 0) ||
    !Number.isFinite(xSpan) ||
    !(pixelSize.width > 0)
  ) {
    return input;
  }
  const bin = floorPowerOfTwo((xSpan / pixelSize.width) * OHLC_BAR_PIXELS);
  // One bin past each edge, so bars cut by the edge are still drawn
  const firstBin = Math.floor(xMin / bin) - 1;
  const lastBin = Math.floor(xMax / bin) + 1;
  // Bins are in positions, so search for the value of the first one's start
  const firstValue =
    request.xScale == null
      ? firstBin * bin
      : request.xScale.fromPlot(firstBin * bin);
  const startIndex = Number.isFinite(firstValue)
    ? findLastIndexBefore(input, firstValue) + 1
    : 0;

  const output = createOhlcSeriesData(
    Math.min(input.length - startIndex, lastBin - firstBin + 1)
  );
  let bucket = Number.NaN;
  let count = 0;
  for (let i = startIndex; i < input.length; i += 1) {
    const x = input.x[i];
    const column = Math.floor(toX(x) / bin);
    if (column > lastBin) {
      break;
    }
    if (Number.isFinite(column)) {
      if (column !== bucket) {
        ensureSeriesCapacity(output, count + 1);
        bucket = column;
        output.x[count] = x;
        output.open[count] = input.open[i];
        output.high[count] = input.high[i];
        output.low[count] = input.low[i];
        output.y[count] = input.y[i];
        count += 1;
      } else {
        const last = count - 1;
        output.high[last] = maxFinite(output.high[last], input.high[i]);
        output.low[last] = minFinite(output.low[last], input.low[i]);
        // A bin closes with its last close, skipping any missing at the end
        if (Number.isFinite(input.y[i])) {
          output.y[last] = input.y[i];
        }
      }
    }
  }
  output.length = count;
  // Nothing merged or cut, so the caller can tell the data is complete
  return count === input.length ? input : output;
};
