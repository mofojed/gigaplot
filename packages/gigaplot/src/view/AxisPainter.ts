import type {
  AxisTick,
  AxisTickGenerator,
  Bounds,
  PlotShape,
} from '../model/PlotTypes';
import { linearTicks } from '../scale/ticks';
import type { PlotTheme } from '../theme/PlotTheme';
import {
  getShapeAxes,
  getViewportRange,
  placeAxes,
  type PlacedAxis,
} from './plotAxes';

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Minimum space between neighbouring x tick labels, in pixels. */
const X_LABEL_GAP = 16;

/** Gap between the stripes hatching a region that is still loading, in pixels. */
const PENDING_STRIPE_SPACING = 8;

function clampTickCount(value: number): number {
  return Math.max(2, Math.min(10, Math.round(value)));
}

function hasText(value: string | undefined): value is string {
  return value != null && value !== '';
}

/** Width the y axis title takes at the left edge of the plot, or 0 without one. */
export function getYAxisTitleWidth(shape: PlotShape, theme: PlotTheme): number {
  return hasText(shape.yAxisLabel)
    ? theme.axisTitleFontSize + theme.axisTitlePadding * 2
    : 0;
}

/**
 * Space below the data area, fitting the x tick labels and, if there is one,
 * the x axis title. Never less than the theme's bottom margin.
 */
export function getBottomMargin(shape: PlotShape, theme: PlotTheme): number {
  if (!hasText(shape.xAxisLabel)) {
    return theme.margin.bottom;
  }
  return Math.max(
    theme.margin.bottom,
    theme.tickLabelPadding +
      theme.fontSize +
      theme.axisTitleFontSize +
      theme.axisTitlePadding * 2
  );
}

/**
 * The primary axes of a shape, laid out with the theme's margins, for
 * painting without a plot to lay them out.
 */
export function getDefaultPlacedAxes(
  shape: PlotShape,
  viewport: Bounds,
  theme: PlotTheme
): PlacedAxis[] {
  return placeAxes(
    getShapeAxes({ ...shape, axes: undefined }),
    theme,
    new Map()
  ).axes.map(axis => {
    const [min, max] = getViewportRange(viewport, axis.dimension);
    return { ...axis, min, max };
  });
}

/**
 * Draws everything under the series data: background, gridlines, axis ticks,
 * and labels. The legend is drawn above the data by `LegendPainter`.
 *
 * Shared by every renderer so the chrome looks identical no matter which one
 * draws the data.
 */
export class AxisPainter {
  private context: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d');
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    const { context } = this;
    if (context == null) {
      return;
    }
    this.canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  /**
   * Hatches x ranges of the plot area whose data is still loading, such as the
   * edges uncovered by zooming out. Painted over the grid but under the axis
   * frame, labels, data, and legend layers.
   */
  paintPending(
    area: PlotArea,
    viewport: Bounds,
    ranges: ReadonlyArray<readonly [number, number]>,
    opacity: number,
    theme: PlotTheme
  ): void {
    const { context } = this;
    const xSpan = viewport.xMax - viewport.xMin;
    if (context == null || opacity <= 0 || !(xSpan > 0)) {
      return;
    }
    context.save();
    context.beginPath();
    for (let i = 0; i < ranges.length; i += 1) {
      const left =
        area.left + ((ranges[i][0] - viewport.xMin) / xSpan) * area.width;
      const right =
        area.left + ((ranges[i][1] - viewport.xMin) / xSpan) * area.width;
      context.rect(left, area.top, right - left, area.height);
    }
    context.clip();

    context.globalAlpha = opacity * 0.6;
    context.fillStyle = theme.backgroundColor;
    context.fillRect(area.left, area.top, area.width, area.height);

    // Diagonal stripes anchored to the plot area so they stay put while panning
    context.globalAlpha = opacity;
    context.strokeStyle = theme.gridColor;
    context.lineWidth = 1;
    context.beginPath();
    for (
      let offset = -area.height;
      offset < area.width;
      offset += PENDING_STRIPE_SPACING
    ) {
      context.moveTo(area.left + offset, area.top + area.height);
      context.lineTo(area.left + offset + area.height, area.top);
    }
    context.stroke();
    context.restore();
  }

  paint(
    width: number,
    height: number,
    area: PlotArea,
    viewport: Bounds,
    shape: PlotShape,
    theme: PlotTheme,
    pending?: {
      ranges: ReadonlyArray<readonly [number, number]>;
      opacity: number;
    },
    axes: readonly PlacedAxis[] = getDefaultPlacedAxes(shape, viewport, theme)
  ): void {
    const { context } = this;
    if (context == null) {
      return;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = theme.backgroundColor;
    context.fillRect(0, 0, width, height);
    context.fillStyle = theme.plotBackgroundColor;
    context.fillRect(area.left, area.top, area.width, area.height);

    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    context.textBaseline = 'middle';

    // Tick density follows the plot area so labels do not collide when small
    const ticks = axes.map(axis =>
      axis.dimension === 'x'
        ? this.getFittedXTicks(
            axis.ticks ?? linearTicks,
            axis.min,
            axis.max,
            area.width
          )
        : AxisPainter.getYTicks(axis.ticks, axis.min, axis.max, area.height)
    );

    // Only the primary axes draw gridlines, which would not line up otherwise
    context.strokeStyle = theme.gridColor;
    context.lineWidth = theme.gridLineWidth;
    context.beginPath();
    axes.forEach((axis, a) => {
      if (!axis.isPrimary) {
        return;
      }
      const axisTicks = ticks[a];
      for (let i = 0; i < axisTicks.length; i += 1) {
        if (axis.dimension === 'x') {
          const x =
            Math.round(AxisPainter.toScreen(axis, axisTicks[i].value, area)) +
            0.5;
          context.moveTo(x, area.top);
          context.lineTo(x, area.top + area.height);
        } else {
          const y =
            Math.round(AxisPainter.toScreen(axis, axisTicks[i].value, area)) +
            0.5;
          context.moveTo(area.left, y);
          context.lineTo(area.left + area.width, y);
        }
      }
    });
    context.stroke();

    if (pending != null) {
      this.paintPending(area, viewport, pending.ranges, pending.opacity, theme);
    }

    context.strokeStyle = theme.axisColor;
    context.lineWidth = theme.axisLineWidth;
    context.beginPath();
    context.rect(
      area.left + 0.5,
      area.top + 0.5,
      area.width - 1,
      area.height - 1
    );
    // Axes stacked outside another one get a line along their inner edge
    axes.forEach(axis => {
      if (axis.offset > 0) {
        AxisPainter.traceAxisLine(context, axis, area);
      }
    });
    context.stroke();

    context.fillStyle = theme.tickLabelColor;
    axes.forEach((axis, a) =>
      this.paintTickLabels(width, area, axis, ticks[a], theme)
    );

    this.paintAxisTitles(area, axes, theme);
  }

  /** Where a value on an axis falls on screen, along the axis. */
  private static toScreen(
    axis: Pick<PlacedAxis, 'dimension' | 'min' | 'max'>,
    value: number,
    area: PlotArea
  ): number {
    const fraction = (value - axis.min) / (axis.max - axis.min);
    return axis.dimension === 'x'
      ? area.left + fraction * area.width
      : area.top + area.height - fraction * area.height;
  }

  private static traceAxisLine(
    context: CanvasRenderingContext2D,
    axis: PlacedAxis,
    area: PlotArea
  ): void {
    const right = area.left + area.width;
    const bottom = area.top + area.height;
    switch (axis.side) {
      case 'left':
        context.moveTo(area.left - axis.offset + 0.5, area.top);
        context.lineTo(area.left - axis.offset + 0.5, bottom);
        break;
      case 'right':
        context.moveTo(right + axis.offset - 0.5, area.top);
        context.lineTo(right + axis.offset - 0.5, bottom);
        break;
      case 'top':
        context.moveTo(area.left, area.top - axis.offset + 0.5);
        context.lineTo(right, area.top - axis.offset + 0.5);
        break;
      default:
        context.moveTo(area.left, bottom + axis.offset - 0.5);
        context.lineTo(right, bottom + axis.offset - 0.5);
    }
  }

  private paintTickLabels(
    width: number,
    area: PlotArea,
    axis: PlacedAxis,
    ticks: readonly AxisTick[],
    theme: PlotTheme
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { side, offset } = axis;
    if (axis.dimension === 'x') {
      context.textAlign = 'center';
      const y =
        side === 'top'
          ? area.top - offset - theme.tickLabelPadding - theme.fontSize / 2
          : area.top +
            area.height +
            offset +
            theme.tickLabelPadding +
            theme.fontSize / 2;
      for (let i = 0; i < ticks.length; i += 1) {
        const { label } = ticks[i];
        // Keep labels at the ends of the axis on the canvas
        const halfWidth = context.measureText(label).width / 2;
        const x = Math.min(
          Math.max(AxisPainter.toScreen(axis, ticks[i].value, area), halfWidth),
          width - halfWidth
        );
        context.fillText(label, x, y);
      }
      return;
    }
    const isRight = side === 'right';
    context.textAlign = isRight ? 'left' : 'right';
    const x = isRight
      ? area.left + area.width + offset + theme.tickLabelPadding
      : area.left - offset - theme.tickLabelPadding;
    for (let i = 0; i < ticks.length; i += 1) {
      context.fillText(
        ticks[i].label,
        x,
        AxisPainter.toScreen(axis, ticks[i].value, area)
      );
    }
  }

  /**
   * Centers each axis title along its axis, at the outer edge of the space
   * the axis takes. Y titles are rotated to read along the axis, toward the
   * plot area. Long titles are squeezed to fit.
   */
  private paintAxisTitles(
    area: PlotArea,
    axes: readonly PlacedAxis[],
    theme: PlotTheme
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const titled = axes.filter(axis => hasText(axis.label));
    if (titled.length === 0) {
      return;
    }
    const center = theme.axisTitlePadding + theme.axisTitleFontSize / 2;
    context.font = `${theme.axisTitleFontSize}px ${theme.fontFamily}`;
    context.fillStyle = theme.axisTitleColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    titled.forEach(axis => {
      const label = axis.label as string;
      const outer = axis.offset + axis.size - center;
      switch (axis.side) {
        case 'bottom':
          context.fillText(
            label,
            area.left + area.width / 2,
            area.top + area.height + outer,
            area.width
          );
          break;
        case 'top':
          context.fillText(
            label,
            area.left + area.width / 2,
            area.top - outer,
            area.width
          );
          break;
        default: {
          const isRight = axis.side === 'right';
          context.save();
          context.translate(
            isRight ? area.left + area.width + outer : area.left - outer,
            area.top + area.height / 2
          );
          context.rotate(isRight ? Math.PI / 2 : -Math.PI / 2);
          context.fillText(label, 0, 0, area.height);
          context.restore();
        }
      }
    });
  }

  /**
   * Width of the widest y tick label, so the plot can leave room for them.
   * Returns 0 if text cannot be measured.
   */
  measureYTickLabels(
    viewport: Bounds,
    shape: PlotShape,
    theme: PlotTheme,
    areaHeight: number
  ): number {
    return this.measureTickLabels(
      shape.yAxisTicks,
      viewport.yMin,
      viewport.yMax,
      theme,
      areaHeight
    );
  }

  /**
   * Width of the widest tick label of a y axis showing `[min, max]`. Returns
   * 0 if text cannot be measured.
   */
  measureTickLabels(
    generate: AxisTickGenerator | undefined,
    min: number,
    max: number,
    theme: PlotTheme,
    areaHeight: number
  ): number {
    const { context } = this;
    if (context == null) {
      return 0;
    }
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const ticks = AxisPainter.getYTicks(generate, min, max, areaHeight);
    let widest = 0;
    for (let i = 0; i < ticks.length; i += 1) {
      widest = Math.max(widest, context.measureText(ticks[i].label).width);
    }
    return widest;
  }

  private static getYTicks(
    generate: AxisTickGenerator | undefined,
    min: number,
    max: number,
    areaHeight: number
  ): AxisTick[] {
    return (generate ?? linearTicks)(min, max, clampTickCount(areaHeight / 45));
  }

  /**
   * Generates x ticks, asking for fewer until the labels fit side by side.
   * Expects the context font to already be set for measuring.
   */
  private getFittedXTicks(
    generate: AxisTickGenerator,
    min: number,
    max: number,
    width: number
  ): AxisTick[] {
    const context = this.context as CanvasRenderingContext2D;
    let targetCount = clampTickCount(width / 90);
    let ticks = generate(min, max, targetCount);
    while (ticks.length > 2 && targetCount > 2) {
      let widest = 0;
      for (let i = 0; i < ticks.length; i += 1) {
        widest = Math.max(widest, context.measureText(ticks[i].label).width);
      }
      const fitCount = Math.floor(width / (widest + X_LABEL_GAP));
      if (ticks.length <= fitCount) {
        break;
      }
      targetCount = Math.max(2, Math.min(targetCount - 1, fitCount));
      ticks = generate(min, max, targetCount);
    }
    return ticks;
  }
}

export default AxisPainter;
