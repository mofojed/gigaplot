import type {
  AxisTick,
  AxisTickGenerator,
  Bounds,
  PlotShape,
} from '../model/PlotTypes';
import { linearTicks } from '../scale/ticks';
import type { PlotTheme } from '../theme/PlotTheme';

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
    }
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
    const xTicks = this.getFittedXTicks(
      shape.xAxisTicks ?? linearTicks,
      viewport,
      area.width
    );
    const yTicks = this.getYTicks(shape, viewport, area.height);
    const xSpan = viewport.xMax - viewport.xMin;
    const ySpan = viewport.yMax - viewport.yMin;

    context.strokeStyle = theme.gridColor;
    context.lineWidth = theme.gridLineWidth;
    context.beginPath();
    for (let i = 0; i < xTicks.length; i += 1) {
      const x =
        area.left +
        Math.round(((xTicks[i].value - viewport.xMin) / xSpan) * area.width) +
        0.5;
      context.moveTo(x, area.top);
      context.lineTo(x, area.top + area.height);
    }
    for (let i = 0; i < yTicks.length; i += 1) {
      const y =
        area.top +
        Math.round(
          area.height -
            ((yTicks[i].value - viewport.yMin) / ySpan) * area.height
        ) +
        0.5;
      context.moveTo(area.left, y);
      context.lineTo(area.left + area.width, y);
    }
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
    context.stroke();

    context.fillStyle = theme.tickLabelColor;
    context.textAlign = 'center';
    for (let i = 0; i < xTicks.length; i += 1) {
      const { label } = xTicks[i];
      // Keep labels at the ends of the axis on the canvas
      const halfWidth = context.measureText(label).width / 2;
      const x = Math.min(
        Math.max(
          area.left + ((xTicks[i].value - viewport.xMin) / xSpan) * area.width,
          halfWidth
        ),
        width - halfWidth
      );
      context.fillText(
        label,
        x,
        area.top + area.height + theme.tickLabelPadding + theme.fontSize / 2
      );
    }

    context.textAlign = 'right';
    for (let i = 0; i < yTicks.length; i += 1) {
      const y =
        area.top +
        area.height -
        ((yTicks[i].value - viewport.yMin) / ySpan) * area.height;
      context.fillText(yTicks[i].label, area.left - theme.tickLabelPadding, y);
    }

    this.paintAxisTitles(height, area, shape, theme);
  }

  /**
   * Centers the x title along the bottom edge and the y title, rotated, along
   * the left edge, in the space {@link getBottomMargin} and
   * {@link getYAxisTitleWidth} reserve. Long titles are squeezed to fit.
   */
  private paintAxisTitles(
    height: number,
    area: PlotArea,
    shape: PlotShape,
    theme: PlotTheme
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { xAxisLabel, yAxisLabel } = shape;
    if (!hasText(xAxisLabel) && !hasText(yAxisLabel)) {
      return;
    }
    const center = theme.axisTitlePadding + theme.axisTitleFontSize / 2;
    context.font = `${theme.axisTitleFontSize}px ${theme.fontFamily}`;
    context.fillStyle = theme.axisTitleColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (hasText(xAxisLabel)) {
      context.fillText(
        xAxisLabel,
        area.left + area.width / 2,
        height - center,
        area.width
      );
    }
    if (hasText(yAxisLabel)) {
      context.save();
      context.translate(center, area.top + area.height / 2);
      context.rotate(-Math.PI / 2);
      context.fillText(yAxisLabel, 0, 0, area.height);
      context.restore();
    }
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
    const { context } = this;
    if (context == null) {
      return 0;
    }
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const ticks = this.getYTicks(shape, viewport, areaHeight);
    let widest = 0;
    for (let i = 0; i < ticks.length; i += 1) {
      widest = Math.max(widest, context.measureText(ticks[i].label).width);
    }
    return widest;
  }

  private getYTicks(
    shape: PlotShape,
    viewport: Bounds,
    areaHeight: number
  ): AxisTick[] {
    return (shape.yAxisTicks ?? linearTicks)(
      viewport.yMin,
      viewport.yMax,
      clampTickCount(areaHeight / 45)
    );
  }

  /**
   * Generates x ticks, asking for fewer until the labels fit side by side.
   * Expects the context font to already be set for measuring.
   */
  private getFittedXTicks(
    generate: AxisTickGenerator,
    viewport: Bounds,
    width: number
  ): AxisTick[] {
    const context = this.context as CanvasRenderingContext2D;
    let targetCount = clampTickCount(width / 90);
    let ticks = generate(viewport.xMin, viewport.xMax, targetCount);
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
      ticks = generate(viewport.xMin, viewport.xMax, targetCount);
    }
    return ticks;
  }
}

export default AxisPainter;
