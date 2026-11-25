import type { PlotShape } from '../model/PlotTypes';
import { getSeriesSwatchColor, type PlotTheme } from '../theme/PlotTheme';
import type { PlotArea } from './AxisPainter';

/**
 * Where the legend is drawn. `overlay` lists the series in a row across the
 * top of the plot area, over the data. `right` lists them in a column beside
 * the plot area, which shrinks to make room.
 */
export type PlotLegendPosition = 'overlay' | 'right';

/** Space between a legend swatch and its label, in pixels. */
const SWATCH_LABEL_GAP = 4;

/** Inset of the overlay legend from the plot area's top left corner. */
const OVERLAY_INSET = 8;

/** Vertical space between rows of the legend beside the plot, in pixels. */
const ROW_GAP = 6;

/**
 * Draws the series legend on its own layer above the data, so series never
 * cover it.
 */
export class LegendPainter {
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
   * Width a legend beside the plot needs, including the gap separating it from
   * the plot area. Returns 0 with no series or if text cannot be measured.
   */
  measureWidth(shape: PlotShape, theme: PlotTheme): number {
    const { context } = this;
    if (context == null || shape.series.length === 0) {
      return 0;
    }
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    let widest = 0;
    for (let i = 0; i < shape.series.length; i += 1) {
      widest = Math.max(
        widest,
        context.measureText(shape.series[i].name).width
      );
    }
    return Math.ceil(
      theme.legendItemGap + theme.legendSwatchSize + SWATCH_LABEL_GAP + widest
    );
  }

  paint(
    width: number,
    height: number,
    area: PlotArea,
    shape: PlotShape,
    theme: PlotTheme,
    position: PlotLegendPosition
  ): void {
    const { context } = this;
    if (context == null) {
      return;
    }
    context.clearRect(0, 0, width, height);
    if (shape.series.length === 0) {
      return;
    }
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    if (position === 'right') {
      this.paintColumn(width, area, shape, theme);
    } else {
      this.paintRow(area, shape, theme);
    }
  }

  private paintRow(area: PlotArea, shape: PlotShape, theme: PlotTheme): void {
    const context = this.context as CanvasRenderingContext2D;
    const { legendSwatchSize: swatchSize } = theme;
    let x = area.left + OVERLAY_INSET;
    const y = area.top + Math.max(10, swatchSize / 2 + 6);
    for (let i = 0; i < shape.series.length; i += 1) {
      const series = shape.series[i];
      context.fillStyle = getSeriesSwatchColor(theme, i, series);
      context.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
      context.fillStyle = theme.legendTextColor;
      const labelX = x + swatchSize + SWATCH_LABEL_GAP;
      context.fillText(series.name, labelX, y);
      x = labelX + context.measureText(series.name).width + theme.legendItemGap;
    }
  }

  private paintColumn(
    width: number,
    area: PlotArea,
    shape: PlotShape,
    theme: PlotTheme
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const { legendSwatchSize: swatchSize } = theme;
    const rowHeight = Math.max(theme.fontSize, swatchSize) + ROW_GAP;
    const x = area.left + area.width + theme.legendItemGap;
    const labelX = x + swatchSize + SWATCH_LABEL_GAP;
    // Long names are squeezed to fit, like axis titles
    const labelWidth = Math.max(1, width - labelX);
    for (let i = 0; i < shape.series.length; i += 1) {
      const series = shape.series[i];
      const y = area.top + rowHeight * i + rowHeight / 2;
      context.fillStyle = getSeriesSwatchColor(theme, i, series);
      context.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
      context.fillStyle = theme.legendTextColor;
      context.fillText(series.name, labelX, y, labelWidth);
    }
  }
}

export default LegendPainter;
