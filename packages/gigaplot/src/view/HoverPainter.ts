import type { AxisValueFormatter, Bounds, PlotShape } from '../model/PlotTypes';
import { formatValue } from '../scale/ticks';
import { parseColor } from '../theme/parseColor';
import type { PlotTheme } from '../theme/PlotTheme';
import type { PlotArea } from './AxisPainter';
import {
  isSnappingSeriesType,
  type PlotHover,
  type PlotHoverPoint,
  type ResolvedTooltipOptions,
} from './hover';

/** Text rows in the tooltip box are this many times the font size apart. */
const TOOLTIP_LINE_HEIGHT = 1.5;
/** Space between a swatch and its series name, in pixels. */
const SWATCH_GAP = 4;
/** Space kept between axis labels nudged apart so they do not overlap. */
const LABEL_GAP = 1;

export interface HoverPaintInput {
  width: number;
  height: number;
  area: PlotArea;
  viewport: Bounds;
  shape: PlotShape;
  theme: PlotTheme;
  hover: PlotHover | undefined;
  options: ResolvedTooltipOptions;
}

/** A row of the tooltip box. Rows without a color have no swatch. */
interface TooltipRow {
  color?: string;
  name: string;
  value: string;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * True if two screen x positions are within a pixel, which is as close as the
 * plot can tell apart. Downsampled lines keep their own points in each pixel
 * column, so lines snapped to the cursor rarely share an exact x.
 */
function isSameColumn(a: number, b: number): boolean {
  return Math.abs(a - b) < 1;
}

function relativeLuminance(color: string): number {
  const [r, g, b] = parseColor(color).map(channel =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whichever of the candidates reads best on `background`. */
function pickContrastingColor(
  background: string,
  candidates: readonly string[]
): string {
  const backgroundLuminance = relativeLuminance(background);
  let best = candidates[0];
  let bestContrast = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    const luminance = relativeLuminance(candidates[i]);
    const contrast =
      (Math.max(luminance, backgroundLuminance) + 0.05) /
      (Math.min(luminance, backgroundLuminance) + 0.05);
    if (contrast > bestContrast) {
      best = candidates[i];
      bestContrast = contrast;
    }
  }
  return best;
}

/**
 * Moves the centers of labels `size` tall apart just enough that they do not
 * overlap, keeping them within `[min, max]`. Labels that do not collide stay
 * exactly where they were asked to be, level with their values.
 */
export function spreadLabels(
  centers: readonly number[],
  size: number,
  min: number,
  max: number
): number[] {
  const order = centers.map((_center, i) => i);
  order.sort((a, b) => centers[a] - centers[b]);
  const placed = order.map(i => Math.min(max, Math.max(min, centers[i])));
  for (let i = 1; i < placed.length; i += 1) {
    placed[i] = Math.max(placed[i], placed[i - 1] + size);
  }
  // Labels pushed past the bottom push their neighbours back up
  if (placed.length > 0 && placed[placed.length - 1] > max) {
    placed[placed.length - 1] = max;
    for (let i = placed.length - 2; i >= 0; i -= 1) {
      placed[i] = Math.min(placed[i], placed[i + 1] - size);
    }
  }
  const result: number[] = new Array(centers.length);
  for (let i = 0; i < order.length; i += 1) {
    result[order[i]] = placed[i];
  }
  return result;
}

/**
 * Draws the hover overlay: markers on the hovered points, guide lines to the
 * axes, labels on the axes, and a tooltip box. Drawn on its own canvas above
 * the data, so moving the cursor never redraws the data or the axes.
 */
export class HoverPainter {
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

  paint(input: HoverPaintInput): void {
    const { context } = this;
    if (context == null) {
      return;
    }
    const { width, height, area, viewport, hover, options } = input;
    context.clearRect(0, 0, width, height);
    const xSpan = viewport.xMax - viewport.xMin;
    const ySpan = viewport.yMax - viewport.yMin;
    if (hover == null || hover.points.length === 0 || !(xSpan > 0)) {
      return;
    }
    const toX = (value: number): number =>
      area.left + ((value - viewport.xMin) / xSpan) * area.width;
    const toY = (value: number): number =>
      area.top + area.height - ((value - viewport.yMin) / ySpan) * area.height;
    // Lines snap to their nearest point, which may sit just outside the view
    const visible = hover.points
      .map(point => ({ point, x: toX(point.x), y: toY(point.y) }))
      .filter(
        ({ x, y }) =>
          x >= area.left &&
          x <= area.left + area.width &&
          y >= area.top &&
          y <= area.top + area.height
      );

    if (options.guides) {
      this.paintGuides(input, visible);
    }
    if (options.markers) {
      this.paintMarkers(input, visible);
    }
    if (options.xAxisLabel) {
      this.paintXAxisLabels(input, visible);
    }
    if (options.yAxisLabels) {
      this.paintYAxisLabels(input, visible);
    }
    if (options.box) {
      this.paintBox(input, toX(hover.x), toY(hover.y));
    }
  }

  private formatX(input: HoverPaintInput, value: number): string {
    const { shape, viewport, area } = input;
    return HoverPainter.format(
      shape.xAxisFormatter,
      value,
      (viewport.xMax - viewport.xMin) / area.width
    );
  }

  private formatY(input: HoverPaintInput, value: number): string {
    const { shape, viewport, area } = input;
    return HoverPainter.format(
      shape.yAxisFormatter,
      value,
      (viewport.yMax - viewport.yMin) / area.height
    );
  }

  private static format(
    formatter: AxisValueFormatter | undefined,
    value: number,
    resolution: number
  ): string {
    return (formatter ?? formatValue)(value, resolution);
  }

  /**
   * Dashes start at the axis, so the lines of points sharing an x lie on top
   * of each other exactly rather than interleaving.
   */
  private paintGuides(
    { area, theme }: HoverPaintInput,
    visible: { point: { color: string }; x: number; y: number }[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    context.save();
    context.beginPath();
    context.rect(area.left, area.top, area.width, area.height);
    context.clip();
    context.lineWidth = theme.hoverGuideWidth;
    context.setLineDash(theme.hoverGuideDash);
    const bottom = area.top + area.height;
    for (let i = 0; i < visible.length; i += 1) {
      const { point, x, y } = visible[i];
      const crispX = Math.round(x) + 0.5;
      const crispY = Math.round(y) + 0.5;
      context.strokeStyle = point.color;
      context.beginPath();
      context.moveTo(crispX, bottom);
      context.lineTo(crispX, crispY);
      context.moveTo(area.left, crispY);
      context.lineTo(crispX, crispY);
      context.stroke();
    }
    context.restore();
  }

  private paintMarkers(
    { theme }: HoverPaintInput,
    visible: { point: { color: string }; x: number; y: number }[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    context.lineWidth = theme.hoverGuideWidth;
    context.strokeStyle = theme.plotBackgroundColor;
    for (let i = 0; i < visible.length; i += 1) {
      const { point, x, y } = visible[i];
      context.fillStyle = point.color;
      context.beginPath();
      context.arc(x, y, theme.hoverMarkerSize / 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  /** Fills and outlines a label box, then centers `text` in it. */
  private paintLabel(
    box: Box,
    text: string,
    fill: string,
    border: string | undefined,
    textColor: string
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    context.fillStyle = fill;
    context.fillRect(box.left, box.top, box.width, box.height);
    if (border != null) {
      context.strokeStyle = border;
      context.lineWidth = 1;
      context.strokeRect(
        box.left + 0.5,
        box.top + 0.5,
        box.width - 1,
        box.height - 1
      );
    }
    context.fillStyle = textColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, box.left + box.width / 2, box.top + box.height / 2);
  }

  /**
   * One label per distinct x on the x axis, centered under it, and nudged
   * apart only where they would overlap, such as a scatter point beside the
   * x the lines snapped to. Points within a pixel of each other share a
   * label; see {@link isSameColumn}.
   */
  private paintXAxisLabels(
    input: HoverPaintInput,
    visible: { point: { x: number }; x: number }[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { width, area, theme } = input;
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const labelHeight = theme.fontSize + theme.tooltipPadding;
    const labels: { text: string; x: number; width: number }[] = [];
    for (let i = 0; i < visible.length; i += 1) {
      const { x } = visible[i];
      if (!labels.some(label => isSameColumn(label.x, x))) {
        const text = this.formatX(input, visible[i].point.x);
        labels.push({
          text,
          x: visible[i].x,
          width: context.measureText(text).width + theme.tooltipPadding * 2,
        });
      }
    }
    // Spread by the widest, which keeps the narrower ones clear as well
    const labelWidth = Math.max(0, ...labels.map(label => label.width));
    const centers = spreadLabels(
      labels.map(label => label.x),
      labelWidth + LABEL_GAP,
      labelWidth / 2,
      width - labelWidth / 2
    );
    for (let i = 0; i < labels.length; i += 1) {
      this.paintLabel(
        {
          left: centers[i] - labels[i].width / 2,
          top: area.top + area.height,
          width: labels[i].width,
          height: labelHeight,
        },
        labels[i].text,
        theme.tooltipBackgroundColor,
        theme.tooltipBorderColor,
        theme.tooltipTextColor
      );
    }
  }

  /**
   * One label per point against the y axis, level with its value and filled
   * with its series color, nudged apart only where they would overlap.
   */
  private paintYAxisLabels(
    input: HoverPaintInput,
    visible: { point: { y: number; color: string }; y: number }[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { height, area, theme } = input;
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const labelHeight = theme.fontSize + theme.tooltipPadding;
    const centers = spreadLabels(
      visible.map(({ y }) => y),
      labelHeight + LABEL_GAP,
      labelHeight / 2,
      height - labelHeight / 2
    );
    const textColors = [theme.backgroundColor, theme.tooltipTextColor];
    for (let i = 0; i < visible.length; i += 1) {
      const { point } = visible[i];
      const text = this.formatY(input, point.y);
      const labelWidth =
        context.measureText(text).width + theme.tooltipPadding * 2;
      this.paintLabel(
        {
          left: Math.max(0, area.left - labelWidth),
          top: centers[i] - labelHeight / 2,
          width: labelWidth,
          height: labelHeight,
        },
        text,
        point.color,
        undefined,
        pickContrastingColor(point.color, textColors)
      );
    }
  }

  /**
   * Lists the hovered values beside the cursor, flipping to its left near the
   * right edge. The x of the lines snapped to the cursor heads the box. Any
   * point off that x, such as a scatter point, lists both of its values.
   */
  private paintBox(
    input: HoverPaintInput,
    cursorX: number,
    cursorY: number
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { width, height, shape, theme, hover } = input;
    const points = (hover as PlotHover).points;
    const font = `${theme.fontSize}px ${theme.fontFamily}`;
    const headerFont = `bold ${font}`;
    const padding = theme.tooltipPadding;
    const lineHeight = Math.round(theme.fontSize * TOOLTIP_LINE_HEIGHT);
    const swatchSize = theme.legendSwatchSize;

    const { viewport, area } = input;
    const toX = (value: number): number =>
      ((value - viewport.xMin) / (viewport.xMax - viewport.xMin)) * area.width;
    const headerPoint =
      points.find(point => isSnappingSeriesType(point.type)) ?? points[0];
    const headerX = this.formatX(input, headerPoint.x);
    const header =
      shape.xAxisLabel != null && shape.xAxisLabel !== ''
        ? `${shape.xAxisLabel}: ${headerX}`
        : headerX;
    const rows: TooltipRow[] = [];
    const addRows = (point: PlotHoverPoint): void => {
      const isHeaderX = isSameColumn(toX(point.x), toX(headerPoint.x));
      if (point.open == null || point.high == null || point.low == null) {
        const y = this.formatY(input, point.value ?? point.y);
        rows.push({
          color: point.color,
          name: point.name,
          value: isHeaderX ? y : `(${this.formatX(input, point.x)}, ${y})`,
        });
        return;
      }
      // A bar lists each of its values on a row of its own, under its name
      rows.push({
        color: point.color,
        name: point.name,
        value: isHeaderX ? '' : this.formatX(input, point.x),
      });
      const values: [string, number][] = [
        ['Open', point.open],
        ['High', point.high],
        ['Low', point.low],
        ['Close', point.y],
      ];
      values.forEach(([name, value]) =>
        rows.push({ name, value: this.formatY(input, value) })
      );
    };
    points.forEach(addRows);

    context.font = headerFont;
    const headerWidth = context.measureText(header).width;
    context.font = font;
    let nameWidth = 0;
    let valueWidth = 0;
    for (let i = 0; i < rows.length; i += 1) {
      nameWidth = Math.max(nameWidth, context.measureText(rows[i].name).width);
      valueWidth = Math.max(
        valueWidth,
        context.measureText(rows[i].value).width
      );
    }
    const rowWidth =
      swatchSize + SWATCH_GAP + nameWidth + theme.legendItemGap + valueWidth;
    const boxWidth = Math.ceil(Math.max(headerWidth, rowWidth) + padding * 2);
    const boxHeight = lineHeight * (rows.length + 1) + padding * 2;

    let left = cursorX + theme.tooltipOffset;
    if (left + boxWidth > width) {
      left = cursorX - theme.tooltipOffset - boxWidth;
    }
    left = Math.round(Math.max(0, left));
    const top = Math.round(
      Math.min(Math.max(0, cursorY - boxHeight / 2), height - boxHeight)
    );

    context.fillStyle = theme.tooltipBackgroundColor;
    context.fillRect(left, top, boxWidth, boxHeight);
    context.strokeStyle = theme.tooltipBorderColor;
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, top + 0.5, boxWidth - 1, boxHeight - 1);

    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = theme.tooltipTextColor;
    context.font = headerFont;
    context.fillText(header, left + padding, top + padding + lineHeight / 2);

    context.font = font;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const centerY = top + padding + lineHeight * (i + 1.5);
      if (row.color != null) {
        context.fillStyle = row.color;
        context.fillRect(
          left + padding,
          centerY - swatchSize / 2,
          swatchSize,
          swatchSize
        );
      }
      context.fillStyle = theme.tooltipTextColor;
      context.textAlign = 'left';
      context.fillText(
        row.name,
        left + padding + swatchSize + SWATCH_GAP,
        centerY
      );
      context.textAlign = 'right';
      context.fillText(row.value, left + boxWidth - padding, centerY);
    }
  }
}

export default HoverPainter;
