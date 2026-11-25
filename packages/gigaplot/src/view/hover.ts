import {
  isOhlcSeriesData,
  type Bounds,
  type PixelSize,
  type PlotSeriesType,
  type PlotShape,
  type SeriesData,
} from '../model/PlotTypes';
import { isOhlcBarIncreasing } from '../renderers/ohlcBars';
import { getSeriesColor, type PlotTheme } from '../theme/PlotTheme';

/** Which parts of the hover overlay to draw. */
export interface PlotTooltipOptions {
  /** A box beside the cursor listing each hovered value. */
  box?: boolean;
  /** A marker on each hovered point. */
  markers?: boolean;
  /** Dashed lines from each hovered point to the x and y axes. */
  guides?: boolean;
  /** The hovered x value, labelled on the x axis. */
  xAxisLabel?: boolean;
  /** Each hovered y value, labelled on the y axis in its series' color. */
  yAxisLabels?: boolean;
}

export type ResolvedTooltipOptions = Required<PlotTooltipOptions>;

export const DEFAULT_TOOLTIP_OPTIONS: Readonly<ResolvedTooltipOptions> =
  Object.freeze({
    box: true,
    markers: true,
    guides: false,
    xAxisLabel: false,
    yAxisLabels: false,
  });

/**
 * `true` or `undefined` uses the defaults, `false` draws nothing, and an object
 * changes only the parts it sets.
 */
export function resolveTooltipOptions(
  tooltip: boolean | PlotTooltipOptions | undefined
): ResolvedTooltipOptions {
  if (tooltip === false) {
    return {
      box: false,
      markers: false,
      guides: false,
      xAxisLabel: false,
      yAxisLabels: false,
    };
  }
  if (tooltip == null || tooltip === true) {
    return { ...DEFAULT_TOOLTIP_OPTIONS };
  }
  const resolved = { ...DEFAULT_TOOLTIP_OPTIONS };
  const keys = Object.keys(resolved) as (keyof ResolvedTooltipOptions)[];
  for (let i = 0; i < keys.length; i += 1) {
    const value = tooltip[keys[i]];
    if (value != null) {
      resolved[keys[i]] = value;
    }
  }
  return resolved;
}

export function isTooltipVisible(options: ResolvedTooltipOptions): boolean {
  return Object.values(options).some(Boolean);
}

/** A data point under the cursor. */
export interface PlotHoverPoint {
  seriesId: string;
  /** Index of the series in the shape, which picks its colorway color. */
  seriesIndex: number;
  name: string;
  type: PlotSeriesType;
  /**
   * The color the point is drawn with. For a bar, its increasing or
   * decreasing color.
   */
  color: string;
  x: number;
  /** Where the point is drawn: the value, a bar's close, or the top of a stacked area. */
  y: number;
  /**
   * The series' own value, when it is not `y`. A stacked area is drawn at
   * the running total, so this is that less the total below.
   */
  value?: number;
  /** Present for `ohlc` and `candlestick` series. */
  open?: number;
  high?: number;
  low?: number;
}

/** True for series that snap to the cursor's x rather than needing a hit. */
export function isSnappingSeriesType(type: PlotSeriesType): boolean {
  return type !== 'scatter';
}

/** What the cursor is over. */
export interface PlotHover {
  /** The cursor position in data space. */
  x: number;
  y: number;
  /** One point per hovered series, in series order. */
  points: PlotHoverPoint[];
}

export interface HoverHitTestInput {
  shape: PlotShape;
  viewport: Bounds;
  /** Size of the plot area. */
  area: PixelSize;
  /** Cursor position in pixels from the top left of the plot area. */
  cursor: { x: number; y: number };
  theme: PlotTheme;
  getSeriesData: (seriesId: string) => SeriesData | undefined;
}

/**
 * The point of a line series nearest the cursor along x. Points sharing that
 * x, such as the min and max a downsampler keeps for one pixel column, are
 * told apart by the one nearest the cursor along y.
 *
 * A linear scan rather than a binary search: lines are not guaranteed to be
 * sorted, and the renderer only holds about as many points as there are
 * pixels unless the data is complete.
 */
function findLinePoint(
  data: SeriesData,
  cursorX: number,
  cursorY: number,
  maxXDistance: number
): number {
  let best = -1;
  let bestDx = Infinity;
  let bestDy = Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let i = 0; i < data.length; i += 1) {
    const x = data.x[i];
    const y = data.y[i];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      const dx = Math.abs(x - cursorX);
      if (dx < bestDx) {
        best = i;
        bestDx = dx;
        bestDy = Math.abs(y - cursorY);
      } else if (dx === bestDx) {
        const dy = Math.abs(y - cursorY);
        if (dy < bestDy) {
          best = i;
          bestDy = dy;
        }
      }
    }
  }
  // Past the ends of a line there is nothing to snap to
  if (cursorX < xMin - maxXDistance || cursorX > xMax + maxXDistance) {
    return -1;
  }
  return best;
}

/** The scatter point nearest the cursor, if any is within `radius` pixels. */
function findScatterPoint(
  data: SeriesData,
  cursorX: number,
  cursorY: number,
  xPerPixel: number,
  yPerPixel: number,
  radius: number
): number {
  let best = -1;
  let bestDistance = radius * radius;
  for (let i = 0; i < data.length; i += 1) {
    const dx = (data.x[i] - cursorX) / xPerPixel;
    if (Math.abs(dx) <= radius) {
      const dy = (data.y[i] - cursorY) / yPerPixel;
      const distance = dx * dx + dy * dy;
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function getPointColor(
  theme: PlotTheme,
  data: SeriesData,
  index: number,
  seriesIndex: number,
  color: string | undefined
): string {
  if (isOhlcSeriesData(data)) {
    return isOhlcBarIncreasing(data.open[index], data.y[index])
      ? theme.ohlcIncreasingColor
      : theme.ohlcDecreasingColor;
  }
  return getSeriesColor(theme, seriesIndex, color);
}

/**
 * Finds what the cursor is over. Line and bar series snap to the cursor's x,
 * so every one is reported wherever the cursor is along it. Scatter series
 * are only reported when the cursor is over one of their points.
 */
export function findHover({
  shape,
  viewport,
  area,
  cursor,
  theme,
  getSeriesData,
}: HoverHitTestInput): PlotHover | undefined {
  const xSpan = viewport.xMax - viewport.xMin;
  const ySpan = viewport.yMax - viewport.yMin;
  if (
    !(xSpan > 0) ||
    !(ySpan > 0) ||
    !(area.width > 0) ||
    !(area.height > 0) ||
    cursor.x < 0 ||
    cursor.y < 0 ||
    cursor.x > area.width ||
    cursor.y > area.height
  ) {
    return undefined;
  }
  const xPerPixel = xSpan / area.width;
  const yPerPixel = ySpan / area.height;
  const x = viewport.xMin + cursor.x * xPerPixel;
  const y = viewport.yMax - cursor.y * yPerPixel;

  const points: PlotHoverPoint[] = [];
  for (let i = 0; i < shape.series.length; i += 1) {
    const descriptor = shape.series[i];
    const data = getSeriesData(descriptor.id);
    if (data != null && data.length > 0) {
      const index = isSnappingSeriesType(descriptor.type)
        ? findLinePoint(data, x, y, theme.hoverDistance * xPerPixel)
        : findScatterPoint(
            data,
            x,
            y,
            xPerPixel,
            yPerPixel,
            (descriptor.style?.pointSize ?? theme.pointSize) / 2 +
              theme.hoverDistance
          );
      if (index >= 0) {
        const point: PlotHoverPoint = {
          seriesId: descriptor.id,
          seriesIndex: i,
          name: descriptor.name,
          type: descriptor.type,
          color: getPointColor(theme, data, index, i, descriptor.style?.color),
          x: data.x[index],
          y: data.y[index],
        };
        if (descriptor.stacked === true && data.base != null) {
          point.value = data.y[index] - data.base[index];
        }
        if (isOhlcSeriesData(data)) {
          point.open = data.open[index];
          point.high = data.high[index];
          point.low = data.low[index];
        }
        points.push(point);
      }
    }
  }
  return points.length > 0 ? { x, y, points } : undefined;
}

/** True if both hovers are over the same points, wherever the cursor is. */
export function hoverPointsEqual(
  a: PlotHover | undefined,
  b: PlotHover | undefined
): boolean {
  if (a == null || b == null) {
    return a === b;
  }
  return (
    a.points.length === b.points.length &&
    a.points.every((point, i) => {
      const other = b.points[i];
      return (
        point.seriesId === other.seriesId &&
        point.x === other.x &&
        point.y === other.y &&
        point.color === other.color
      );
    })
  );
}
