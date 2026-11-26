import {
  PRIMARY_X_AXIS,
  PRIMARY_Y_AXIS,
  type AxisTickGenerator,
  type AxisValueFormatter,
  type Bounds,
  type PlotAxis,
  type PlotAxisSide,
  type PlotShape,
  type SeriesDescriptor,
} from '../model/PlotTypes';
import type { PlotTheme } from '../theme/PlotTheme';

/** An axis of a 2D plot, primary or not, with the edge it is drawn along. */
export interface ResolvedAxis {
  id: string;
  dimension: 'x' | 'y';
  side: PlotAxisSide;
  label?: string;
  ticks?: AxisTickGenerator;
  formatter?: AxisValueFormatter;
  /** True for the primary `x` and `y` axes, whose ticks draw the gridlines. */
  isPrimary: boolean;
}

/** An axis laid out beside the plot area, and the range it shows. */
export interface PlacedAxis extends ResolvedAxis {
  /**
   * Pixels from the edge of the plot area to the inner edge of the axis. Axes
   * sharing an edge are stacked outward, so only the first has none.
   */
  offset: number;
  /** Pixels the axis takes outward from `offset`, for its tick labels and title. */
  size: number;
  /** The range the axis shows, in plot units. */
  min: number;
  max: number;
}

/** Space around the plot area, in pixels. */
export interface AxisMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function hasText(value: string | undefined): value is string {
  return value != null && value !== '';
}

function isValidSide(dimension: 'x' | 'y', side: PlotAxisSide): boolean {
  return dimension === 'x'
    ? side === 'top' || side === 'bottom'
    : side === 'left' || side === 'right';
}

/** The edge an axis besides the primary ones is drawn along. */
export function getAxisSide(axis: PlotAxis): PlotAxisSide {
  if (axis.side != null && isValidSide(axis.dimension, axis.side)) {
    return axis.side;
  }
  return axis.dimension === 'x' ? 'top' : 'right';
}

/**
 * Drops axes that cannot be told apart, such as a second `x` or a repeated
 * id, and axis names on series that do not name an axis of the right
 * dimension, which puts those series on the primary axes.
 */
export function normalizeShapeAxes(shape: PlotShape): PlotShape {
  const hasSeriesAxes = shape.series.some(
    descriptor => descriptor.xAxis != null || descriptor.yAxis != null
  );
  if (shape.axes == null && !hasSeriesAxes) {
    return shape;
  }
  const dimensions = new Map<string, 'x' | 'y'>();
  const axes: PlotAxis[] = [];
  (shape.axes ?? []).forEach(axis => {
    if (
      axis.id !== PRIMARY_X_AXIS &&
      axis.id !== PRIMARY_Y_AXIS &&
      !dimensions.has(axis.id)
    ) {
      dimensions.set(axis.id, axis.dimension);
      axes.push(axis);
    }
  });
  const series = shape.series.map((descriptor): SeriesDescriptor => {
    const { xAxis, yAxis, ...rest } = descriptor;
    const result: SeriesDescriptor = rest;
    if (xAxis != null && dimensions.get(xAxis) === 'x') {
      result.xAxis = xAxis;
    }
    if (yAxis != null && dimensions.get(yAxis) === 'y') {
      result.yAxis = yAxis;
    }
    return result;
  });
  return {
    ...shape,
    series,
    axes: axes.length > 0 ? axes : undefined,
  };
}

/** True if a series is drawn against an axis besides the primary ones. */
export function hasSecondaryAxis(
  descriptor: Pick<SeriesDescriptor, 'xAxis' | 'yAxis'>
): boolean {
  return (
    (descriptor.xAxis != null && descriptor.xAxis !== PRIMARY_X_AXIS) ||
    (descriptor.yAxis != null && descriptor.yAxis !== PRIMARY_Y_AXIS)
  );
}

/** Every axis of a shape: the primary x and y, then the rest in order. */
export function getShapeAxes(shape: PlotShape): ResolvedAxis[] {
  const axes: ResolvedAxis[] = [
    {
      id: PRIMARY_X_AXIS,
      dimension: 'x',
      side: shape.xAxisSide === 'top' ? 'top' : 'bottom',
      label: shape.xAxisLabel,
      ticks: shape.xAxisTicks,
      formatter: shape.xAxisFormatter,
      isPrimary: true,
    },
    {
      id: PRIMARY_Y_AXIS,
      dimension: 'y',
      side: shape.yAxisSide === 'right' ? 'right' : 'left',
      label: shape.yAxisLabel,
      ticks: shape.yAxisTicks,
      formatter: shape.yAxisFormatter,
      isPrimary: true,
    },
  ];
  (shape.axes ?? []).forEach(axis => {
    axes.push({
      id: axis.id,
      dimension: axis.dimension,
      side: getAxisSide(axis),
      label: axis.label,
      ticks: axis.ticks,
      formatter: axis.formatter,
      isPrimary: false,
    });
  });
  return axes;
}

/** Width the title of a y axis takes beside its tick labels, or 0 without one. */
export function getAxisTitleSize(
  label: string | undefined,
  theme: PlotTheme
): number {
  return hasText(label)
    ? theme.axisTitleFontSize + theme.axisTitlePadding * 2
    : 0;
}

/**
 * Space an x axis takes, fitting its tick labels and, if it has one, its
 * title. Never less than the theme's bottom margin.
 */
export function getXAxisSize(
  label: string | undefined,
  theme: PlotTheme
): number {
  if (!hasText(label)) {
    return theme.margin.bottom;
  }
  return Math.max(
    theme.margin.bottom,
    theme.tickLabelPadding + theme.fontSize + getAxisTitleSize(label, theme)
  );
}

/**
 * Space a y axis takes: room for its tick labels, then its title. The primary
 * y axis keeps at least the theme's left margin for its labels, while other
 * axes take what their labels measure, `tickLabelMargins` by id, once known.
 */
export function getYAxisSize(
  axis: ResolvedAxis,
  theme: PlotTheme,
  tickLabelMargins: ReadonlyMap<string, number>
): number {
  const measured = tickLabelMargins.get(axis.id);
  const labels = axis.isPrimary
    ? Math.max(theme.margin.left, measured ?? 0)
    : (measured ?? theme.margin.left);
  return labels + getAxisTitleSize(axis.label, theme);
}

/**
 * Lays the axes out around the plot area, stacking those that share an edge
 * outward in order. An edge without an axis keeps the theme's margin for an
 * edge without one: the top margin for the top or bottom, and the right for
 * the left or right.
 */
export function placeAxes(
  axes: readonly ResolvedAxis[],
  theme: PlotTheme,
  tickLabelMargins: ReadonlyMap<string, number>
): { axes: Omit<PlacedAxis, 'min' | 'max'>[]; margins: AxisMargins } {
  const used: AxisMargins = { top: 0, right: 0, bottom: 0, left: 0 };
  const placed = axes.map(axis => {
    const size =
      axis.dimension === 'x'
        ? getXAxisSize(axis.label, theme)
        : getYAxisSize(axis, theme, tickLabelMargins);
    const offset = used[axis.side];
    used[axis.side] += size;
    return { ...axis, offset, size };
  });
  return {
    axes: placed,
    margins: {
      top: used.top > 0 ? used.top : theme.margin.top,
      bottom: used.bottom > 0 ? used.bottom : theme.margin.top,
      left: used.left > 0 ? used.left : theme.margin.right,
      right: used.right > 0 ? used.right : theme.margin.right,
    },
  };
}

/** The range an axis shows within a viewport, for axes on the primary ones. */
export function getViewportRange(
  viewport: Bounds,
  dimension: 'x' | 'y'
): [number, number] {
  return dimension === 'x'
    ? [viewport.xMin, viewport.xMax]
    : [viewport.yMin, viewport.yMax];
}
