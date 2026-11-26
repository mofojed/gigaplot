import {
  PRIMARY_X_AXIS,
  PRIMARY_Y_AXIS,
  type AxisValueFormatter,
  type Bounds,
  type PlotAxisSide,
  type PlotShape,
} from '../model/PlotTypes';
import { formatValue } from '../scale/ticks';
import { parseColor } from '../theme/parseColor';
import type { PlotTheme } from '../theme/PlotTheme';
import type { PlotArea } from './AxisPainter';
import { getAxisSide, type PlacedAxis } from './plotAxes';
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
  /**
   * The viewports of series drawn against axes besides the primary ones, by
   * id. Other series use `viewport`.
   */
  seriesViewports?: ReadonlyMap<string, Bounds>;
  /**
   * The axes as laid out, for labelling hovered values on the axis each
   * series is drawn against. Defaults to the primary axes along the bottom
   * and left edges.
   */
  axes?: readonly PlacedAxis[];
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

/** Where a hovered point is drawn, and the axes it is measured on. */
interface VisiblePoint {
  point: PlotHoverPoint;
  x: number;
  y: number;
  xAxis: AxisInfo;
  yAxis: AxisInfo;
}

/** What hover needs of an axis to label a value on it. */
interface AxisInfo {
  id: string;
  side: PlotAxisSide;
  offset: number;
  label?: string;
  formatter?: AxisValueFormatter;
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
    if (hover == null || hover.points.length === 0 || !(xSpan > 0)) {
      return;
    }
    // Lines snap to their nearest point, which may sit just outside the view
    const visible = hover.points
      .map((point): VisiblePoint => ({
        point,
        x: HoverPainter.toScreenX(input, point, point.x),
        y: HoverPainter.toScreenY(input, point, point.y),
        xAxis: HoverPainter.getAxis(input, point.xAxis ?? PRIMARY_X_AXIS, 'x'),
        yAxis: HoverPainter.getAxis(input, point.yAxis ?? PRIMARY_Y_AXIS, 'y'),
      }))
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
      this.paintBox(
        input,
        HoverPainter.toScreenX(input, {}, hover.x),
        HoverPainter.toScreenY(input, {}, hover.y)
      );
    }
  }

  /** The viewport a point is drawn in: its series', or the plot's. */
  private static getViewport(
    { viewport, seriesViewports }: HoverPaintInput,
    point: { seriesId?: string }
  ): Bounds {
    return (
      (point.seriesId != null
        ? seriesViewports?.get(point.seriesId)
        : undefined) ?? viewport
    );
  }

  private static toScreenX(
    input: HoverPaintInput,
    point: { seriesId?: string },
    value: number
  ): number {
    const { area } = input;
    const { xMin, xMax } = HoverPainter.getViewport(input, point);
    return area.left + ((value - xMin) / (xMax - xMin)) * area.width;
  }

  private static toScreenY(
    input: HoverPaintInput,
    point: { seriesId?: string },
    value: number
  ): number {
    const { area } = input;
    const { yMin, yMax } = HoverPainter.getViewport(input, point);
    return (
      area.top + area.height - ((value - yMin) / (yMax - yMin)) * area.height
    );
  }

  /** The axis with an id, from the layout, or else the primary axes' defaults. */
  private static getAxis(
    input: HoverPaintInput,
    id: string,
    dimension: 'x' | 'y'
  ): AxisInfo {
    const placed = input.axes?.find(axis => axis.id === id);
    if (placed != null) {
      return placed;
    }
    const { shape } = input;
    const axis = shape.axes?.find(
      other => other.id === id && other.dimension === dimension
    );
    if (axis != null) {
      return {
        id,
        side: getAxisSide(axis),
        offset: 0,
        label: axis.label,
        formatter: axis.formatter,
      };
    }
    return dimension === 'y'
      ? {
          id,
          side: shape.yAxisSide === 'right' ? 'right' : 'left',
          offset: 0,
          label: shape.yAxisLabel,
          formatter: shape.yAxisFormatter,
        }
      : {
          id: PRIMARY_X_AXIS,
          side: shape.xAxisSide === 'top' ? 'top' : 'bottom',
          offset: 0,
          label: shape.xAxisLabel,
          formatter: shape.xAxisFormatter,
        };
  }

  private formatX(
    input: HoverPaintInput,
    point: PlotHoverPoint,
    value: number
  ): string {
    const { area } = input;
    const { xMin, xMax } = HoverPainter.getViewport(input, point);
    return HoverPainter.format(
      HoverPainter.getAxis(input, point.xAxis ?? PRIMARY_X_AXIS, 'x').formatter,
      value,
      (xMax - xMin) / area.width
    );
  }

  private formatY(
    input: HoverPaintInput,
    point: PlotHoverPoint,
    value: number
  ): string {
    const { area } = input;
    const { yMin, yMax } = HoverPainter.getViewport(input, point);
    return HoverPainter.format(
      HoverPainter.getAxis(input, point.yAxis ?? PRIMARY_Y_AXIS, 'y').formatter,
      value,
      (yMax - yMin) / area.height
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
    visible: VisiblePoint[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    context.save();
    context.beginPath();
    context.rect(area.left, area.top, area.width, area.height);
    context.clip();
    context.lineWidth = theme.hoverGuideWidth;
    context.setLineDash(theme.hoverGuideDash);
    const bottom = area.top + area.height;
    const right = area.left + area.width;
    for (let i = 0; i < visible.length; i += 1) {
      const { point, x, y, xAxis, yAxis } = visible[i];
      const crispX = Math.round(x) + 0.5;
      const crispY = Math.round(y) + 0.5;
      context.strokeStyle = point.color;
      context.beginPath();
      context.moveTo(crispX, xAxis.side === 'top' ? area.top : bottom);
      context.lineTo(crispX, crispY);
      context.moveTo(yAxis.side === 'right' ? right : area.left, crispY);
      context.lineTo(crispX, crispY);
      context.stroke();
    }
    context.restore();
  }

  private paintMarkers(
    { theme }: HoverPaintInput,
    visible: VisiblePoint[]
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
   * One label per distinct x on each x axis, centered under it, or over it
   * on an axis along the top, and nudged apart only where they would
   * overlap, such as a scatter point beside the x the lines snapped to.
   * Points within a pixel of each other share a label; see
   * {@link isSameColumn}.
   */
  private paintXAxisLabels(
    input: HoverPaintInput,
    visible: VisiblePoint[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { width, area, theme } = input;
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const labelHeight = theme.fontSize + theme.tooltipPadding;
    const byAxis = new Map<string, VisiblePoint[]>();
    visible.forEach(entry => {
      byAxis.set(entry.xAxis.id, [
        ...(byAxis.get(entry.xAxis.id) ?? []),
        entry,
      ]);
    });
    byAxis.forEach(entries => {
      const { side, offset } = entries[0].xAxis;
      const labels: { text: string; x: number; width: number }[] = [];
      for (let i = 0; i < entries.length; i += 1) {
        const { x, point } = entries[i];
        if (!labels.some(label => isSameColumn(label.x, x))) {
          const text = this.formatX(input, point, point.x);
          labels.push({
            text,
            x,
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
      const top =
        side === 'top'
          ? area.top - offset - labelHeight
          : area.top + area.height + offset;
      for (let i = 0; i < labels.length; i += 1) {
        this.paintLabel(
          {
            left: centers[i] - labels[i].width / 2,
            top,
            width: labels[i].width,
            height: labelHeight,
          },
          labels[i].text,
          theme.tooltipBackgroundColor,
          theme.tooltipBorderColor,
          theme.tooltipTextColor
        );
      }
    });
  }

  /**
   * One label per point against the y axis it is drawn on, level with its
   * value and filled with its series color, nudged apart only where labels
   * on the same edge would overlap.
   */
  private paintYAxisLabels(
    input: HoverPaintInput,
    visible: VisiblePoint[]
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { width, height, area, theme } = input;
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const labelHeight = theme.fontSize + theme.tooltipPadding;
    const textColors = [theme.backgroundColor, theme.tooltipTextColor];
    (['left', 'right'] as const).forEach(side => {
      const entries = visible.filter(entry => entry.yAxis.side === side);
      const centers = spreadLabels(
        entries.map(({ y }) => y),
        labelHeight + LABEL_GAP,
        labelHeight / 2,
        height - labelHeight / 2
      );
      for (let i = 0; i < entries.length; i += 1) {
        const { point, yAxis } = entries[i];
        const text = this.formatY(input, point, point.y);
        const labelWidth =
          context.measureText(text).width + theme.tooltipPadding * 2;
        const left =
          side === 'right'
            ? Math.min(
                width - labelWidth,
                area.left + area.width + yAxis.offset
              )
            : Math.max(0, area.left - yAxis.offset - labelWidth);
        this.paintLabel(
          {
            left,
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
    });
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
    const { width, height, theme, hover } = input;
    const points = (hover as PlotHover).points;
    const font = `${theme.fontSize}px ${theme.fontFamily}`;
    const headerFont = `bold ${font}`;
    const padding = theme.tooltipPadding;
    const lineHeight = Math.round(theme.fontSize * TOOLTIP_LINE_HEIGHT);
    const swatchSize = theme.legendSwatchSize;

    const toX = (point: PlotHoverPoint): number =>
      HoverPainter.toScreenX(input, point, point.x);
    const getXAxisId = (point: PlotHoverPoint): string =>
      point.xAxis ?? PRIMARY_X_AXIS;
    // Lines snapped along the primary x head the box, if any are hovered
    const isPrimaryX = (point: PlotHoverPoint): boolean =>
      getXAxisId(point) === PRIMARY_X_AXIS;
    const headerPoint =
      points.find(
        point => isSnappingSeriesType(point.type) && isPrimaryX(point)
      ) ??
      points.find(point => isSnappingSeriesType(point.type)) ??
      points[0];
    const headerX = this.formatX(input, headerPoint, headerPoint.x);
    const headerLabel = HoverPainter.getAxis(
      input,
      getXAxisId(headerPoint),
      'x'
    ).label;
    const header =
      headerLabel != null && headerLabel !== ''
        ? `${headerLabel}: ${headerX}`
        : headerX;
    const rows: TooltipRow[] = [];
    const addRows = (point: PlotHoverPoint): void => {
      const isHeaderX =
        getXAxisId(point) === getXAxisId(headerPoint) &&
        isSameColumn(toX(point), toX(headerPoint));
      if (point.open == null || point.high == null || point.low == null) {
        const y = this.formatY(input, point, point.value ?? point.y);
        rows.push({
          color: point.color,
          name: point.name,
          value: isHeaderX
            ? y
            : `(${this.formatX(input, point, point.x)}, ${y})`,
        });
        return;
      }
      // A bar lists each of its values on a row of its own, under its name
      rows.push({
        color: point.color,
        name: point.name,
        value: isHeaderX ? '' : this.formatX(input, point, point.x),
      });
      const values: [string, number][] = [
        ['Open', point.open],
        ['High', point.high],
        ['Low', point.low],
        ['Close', point.y],
      ];
      values.forEach(([name, value]) =>
        rows.push({ name, value: this.formatY(input, point, value) })
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
