import type { AxisValueFormatter, PlotShape } from '../model/PlotTypes';
import type { Projection3D } from '../scale/projection3d';
import { formatValue } from '../scale/ticks';
import type { PlotTheme } from '../theme/PlotTheme';
import type { PlotArea } from './AxisPainter';
import type { Plot3DHoverPoint } from './hover3d';

/** Text rows in the tooltip box are this many times the font size apart. */
const TOOLTIP_LINE_HEIGHT = 1.5;
/** Space between a swatch and its series name, in pixels. */
const SWATCH_GAP = 4;

export interface Hover3DPaintInput {
  width: number;
  height: number;
  area: PlotArea;
  projection: Projection3D;
  shape: PlotShape;
  theme: PlotTheme;
  hover: Plot3DHoverPoint | undefined;
  /** Draws a marker on the point and a box listing its values. */
  isVisible: boolean;
}

/**
 * Draws the hovered point of a 3D plot: a marker over it and a box beside it
 * with the series name and the point's x, y, and z. Drawn on its own canvas
 * above the data, so moving the cursor never redraws the data.
 */
export class Hover3DPainter {
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

  paint({
    width,
    height,
    area,
    projection,
    shape,
    theme,
    hover,
    isVisible,
  }: Hover3DPaintInput): void {
    const { context } = this;
    if (context == null) {
      return;
    }
    context.clearRect(0, 0, width, height);
    if (hover == null || !isVisible) {
      return;
    }
    const x = area.left + hover.screenX;
    const y = area.top + hover.screenY;

    context.lineWidth = theme.hoverGuideWidth;
    context.strokeStyle = theme.plotBackgroundColor;
    context.fillStyle = hover.color;
    context.beginPath();
    context.arc(
      x,
      y,
      Math.max(theme.hoverMarkerSize, hover.size) / 2,
      0,
      Math.PI * 2
    );
    context.fill();
    context.stroke();

    // Values are shown to about a pixel's worth of the box's edge
    const pixels = Math.max(1, Math.min(area.width, area.height));
    const { bounds } = projection;
    const format = (
      formatter: AxisValueFormatter | undefined,
      value: number,
      span: number
    ): string => (formatter ?? formatValue)(value, span / pixels);
    const rows: [string, string][] = [
      [
        shape.xAxisLabel || 'x',
        format(shape.xAxisFormatter, hover.x, bounds.xMax - bounds.xMin),
      ],
      [
        shape.yAxisLabel || 'y',
        format(shape.yAxisFormatter, hover.y, bounds.yMax - bounds.yMin),
      ],
      [
        shape.zAxisLabel || 'z',
        format(shape.zAxisFormatter, hover.z, bounds.zMax - bounds.zMin),
      ],
    ];

    const font = `${theme.fontSize}px ${theme.fontFamily}`;
    const headerFont = `bold ${font}`;
    const padding = theme.tooltipPadding;
    const lineHeight = Math.round(theme.fontSize * TOOLTIP_LINE_HEIGHT);
    const swatchSize = theme.legendSwatchSize;

    context.font = headerFont;
    const headerWidth =
      swatchSize + SWATCH_GAP + context.measureText(hover.name).width;
    context.font = font;
    let nameWidth = 0;
    let valueWidth = 0;
    rows.forEach(([name, value]) => {
      nameWidth = Math.max(nameWidth, context.measureText(name).width);
      valueWidth = Math.max(valueWidth, context.measureText(value).width);
    });
    const rowWidth = nameWidth + theme.legendItemGap + valueWidth;
    const boxWidth = Math.ceil(Math.max(headerWidth, rowWidth) + padding * 2);
    const boxHeight = lineHeight * (rows.length + 1) + padding * 2;

    let left = x + theme.tooltipOffset;
    if (left + boxWidth > width) {
      left = x - theme.tooltipOffset - boxWidth;
    }
    left = Math.round(Math.max(0, left));
    const top = Math.round(
      Math.min(Math.max(0, y - boxHeight / 2), height - boxHeight)
    );

    context.fillStyle = theme.tooltipBackgroundColor;
    context.fillRect(left, top, boxWidth, boxHeight);
    context.strokeStyle = theme.tooltipBorderColor;
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, top + 0.5, boxWidth - 1, boxHeight - 1);

    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const headerY = top + padding + lineHeight / 2;
    context.fillStyle = hover.color;
    context.fillRect(
      left + padding,
      headerY - swatchSize / 2,
      swatchSize,
      swatchSize
    );
    context.fillStyle = theme.tooltipTextColor;
    context.font = headerFont;
    context.fillText(
      hover.name,
      left + padding + swatchSize + SWATCH_GAP,
      headerY
    );

    context.font = font;
    rows.forEach(([name, value], i) => {
      const rowY = top + padding + lineHeight * (i + 1.5);
      context.textAlign = 'left';
      context.fillText(name, left + padding, rowY);
      context.textAlign = 'right';
      context.fillText(value, left + boxWidth - padding, rowY);
    });
  }
}

export default Hover3DPainter;
