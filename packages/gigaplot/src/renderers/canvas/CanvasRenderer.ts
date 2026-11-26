import {
  copySeriesData,
  createSeriesData,
  isOhlcSeriesData,
  isOhlcSeriesType,
  type Bounds,
  type OhlcSeriesData,
  type PlotShape,
  type SeriesData,
  type SeriesDelta,
  type SeriesDescriptor,
} from '../../model/PlotTypes';
import {
  defaultPlotTheme,
  getSeriesColor,
  type PlotTheme,
} from '../../theme/PlotTheme';
import type {
  PlotRenderer,
  PlotRendererCapabilities,
  PlotRendererFactory,
  SeriesResolution,
} from '../PlotRenderer';
import { applyDeltaToSeriesData } from '../applyDeltaToSeriesData';
import { resolveAreaFill, rgbaToCss, type ResolvedAreaFill } from '../areaFill';
import {
  getOhlcBarSpacing,
  getOhlcHalfBarWidth,
  isOhlcBarIncreasing,
} from '../ohlcBars';
import { getStalePixelGrid } from '../pixelGrid';

/** Points filled per path when drawing scatter series. */
const SCATTER_PATH_BATCH = 10000;

type Context2d = CanvasRenderingContext2D;

/** Maps a data point to canvas coordinates. */
type Projection = (x: number, y: number) => [number, number];

/** The shortest gradient line, in pixels, an area fill is drawn with. */
const MIN_GRADIENT_PIXELS = 1;

/** How to draw the bars of an `ohlc` or `candlestick` series. */
interface BarStyle {
  /** Half a bar's width, in data units. */
  halfWidth: number;
  increasingColor: string;
  decreasingColor: string;
}

/**
 * Area fills are drawn under every line, as plotly does, so a stacked area
 * does not cover the line of the one below.
 */
type Layer = 'fill' | 'data';

interface RetainedSeries {
  data: SeriesData;
  resolution?: SeriesResolution;
  opacity: number;
}

const CAPABILITIES: PlotRendererCapabilities = {
  seriesTypes: ['scatter', 'line', 'area', 'ohlc', 'candlestick'],
  incrementalUpdates: false,
};

/**
 * Canvas 2D renderer.
 *
 * Deliberately naive: every `render` redraws the whole scene. It exists as the
 * universally available fallback and as the reference for what the WebGPU
 * renderer should produce.
 */
export class CanvasRenderer implements PlotRenderer {
  readonly name = 'canvas';

  readonly capabilities = CAPABILITIES;

  private context: CanvasRenderingContext2D | null = null;

  private theme: PlotTheme = defaultPlotTheme;

  private descriptors: SeriesDescriptor[] = [];

  private seriesData = new Map<string, SeriesData>();

  private seriesResolution = new Map<string, SeriesResolution>();

  /** Data kept to fade out under the data that replaced it. */
  private retained = new Map<string, RetainedSeries>();

  /** Stale series are drawn at their own resolution here, then scaled up. */
  private scratch: HTMLCanvasElement | null = null;

  private viewport: Bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

  /** Viewports of series on axes besides the primary ones. */
  private seriesViewports: ReadonlyMap<string, Bounds> | undefined;

  private width = 0;

  private height = 0;

  private devicePixelRatio = 1;

  async initialize(canvas: HTMLCanvasElement, theme: PlotTheme): Promise<void> {
    const context = canvas.getContext('2d');
    if (context == null) {
      throw new Error('Unable to acquire a 2d canvas context');
    }
    this.context = context;
    this.theme = theme;
  }

  setShape(shape: PlotShape): void {
    this.descriptors = shape.series;
    const ids = new Set(shape.series.map(series => series.id));
    Array.from(this.seriesData.keys()).forEach(id => {
      if (!ids.has(id)) {
        this.seriesData.delete(id);
        this.seriesResolution.delete(id);
      }
    });
    Array.from(this.retained.keys()).forEach(id => {
      if (!ids.has(id)) {
        this.retained.delete(id);
      }
    });
  }

  setSeriesData(seriesId: string, data: SeriesData): void {
    // Sources may hand back their own arrays, so keep a private copy to mutate
    this.seriesData.set(seriesId, copySeriesData(data));
  }

  applyDeltas(deltas: SeriesDelta[]): void {
    for (let i = 0; i < deltas.length; i += 1) {
      const delta = deltas[i];
      this.seriesData.set(
        delta.seriesId,
        applyDeltaToSeriesData(this.seriesData.get(delta.seriesId), delta)
      );
    }
  }

  setViewport(
    viewport: Bounds,
    seriesViewports?: ReadonlyMap<string, Bounds>
  ): void {
    this.viewport = viewport;
    this.seriesViewports = seriesViewports;
  }

  private getSeriesViewport(seriesId: string): Bounds {
    return this.seriesViewports?.get(seriesId) ?? this.viewport;
  }

  getSeriesData(seriesId: string): SeriesData | undefined {
    return this.seriesData.get(seriesId) ?? this.retained.get(seriesId)?.data;
  }

  setSeriesResolution(
    seriesId: string,
    resolution: SeriesResolution | undefined
  ): void {
    if (resolution != null) {
      this.seriesResolution.set(seriesId, resolution);
    } else {
      this.seriesResolution.delete(seriesId);
    }
  }

  retainSeriesData(seriesId: string): void {
    const data = this.seriesData.get(seriesId);
    if (data == null) {
      return;
    }
    this.retained.set(seriesId, {
      data,
      resolution: this.seriesResolution.get(seriesId),
      opacity: 1,
    });
    this.seriesResolution.delete(seriesId);
  }

  setRetainedSeriesOpacity(seriesId: string, opacity: number): void {
    const retained = this.retained.get(seriesId);
    if (retained == null) {
      return;
    }
    if (opacity > 0) {
      retained.opacity = opacity;
    } else {
      this.retained.delete(seriesId);
    }
  }

  setTheme(theme: PlotTheme): void {
    this.theme = theme;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.devicePixelRatio = devicePixelRatio;
    const { context } = this;
    if (context == null) {
      return;
    }
    context.canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    context.canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  private toScreenX(value: number, viewport: Bounds): number {
    const span = viewport.xMax - viewport.xMin;
    if (span === 0) {
      return 0;
    }
    return ((value - viewport.xMin) / span) * this.width;
  }

  private toScreenY(value: number, viewport: Bounds): number {
    const span = viewport.yMax - viewport.yMin;
    if (span === 0) {
      return this.height;
    }
    return this.height - ((value - viewport.yMin) / span) * this.height;
  }

  private static drawLine(
    context: Context2d,
    data: SeriesData,
    project: Projection,
    color: string,
    lineWidth: number
  ): void {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    let started = false;
    for (let i = 0; i < data.length; i += 1) {
      const x = data.x[i];
      const y = data.y[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        started = false;
      } else {
        const [screenX, screenY] = project(x, y);
        if (started) {
          context.lineTo(screenX, screenY);
        } else {
          context.moveTo(screenX, screenY);
          started = true;
        }
      }
    }
    context.stroke();
  }

  /**
   * Fills between each run of finite points and its base, or zero. Where the
   * two cross, both lobes are filled.
   */
  private static drawAreaFill(
    context: Context2d,
    data: SeriesData,
    project: Projection,
    fill: ResolvedAreaFill
  ): void {
    const { stops } = fill;
    if (stops.length === 1) {
      context.fillStyle = rgbaToCss(stops[0].color);
    } else {
      const isVertical = fill.axis === 'y';
      const toPixel = (value: number): number =>
        project(value, value)[isVertical ? 1 : 0];
      let from = toPixel(fill.start);
      let to = toPixel(fill.end);
      if (!(Math.abs(to - from) >= MIN_GRADIENT_PIXELS)) {
        // A hard edge in data units spans a tiny fraction of a pixel, which
        // a canvas paints as nothing, so spread it over a pixel instead
        const center = (from + to) / 2;
        const direction = Math.sign(toPixel(fill.start + 1) - from) || 1;
        from = center - (direction * MIN_GRADIENT_PIXELS) / 2;
        to = center + (direction * MIN_GRADIENT_PIXELS) / 2;
      }
      const gradient = isVertical
        ? context.createLinearGradient(0, from, 0, to)
        : context.createLinearGradient(from, 0, to, 0);
      stops.forEach(stop =>
        gradient.addColorStop(stop.offset, rgbaToCss(stop.color))
      );
      context.fillStyle = gradient;
    }
    const { base } = data;
    const isFinitePoint = (i: number): boolean =>
      Number.isFinite(data.x[i]) &&
      Number.isFinite(data.y[i]) &&
      (base == null || Number.isFinite(base[i]));
    context.beginPath();
    let start = 0;
    while (start < data.length) {
      while (start < data.length && !isFinitePoint(start)) {
        start += 1;
      }
      let end = start;
      while (end < data.length && isFinitePoint(end)) {
        end += 1;
      }
      if (end > start) {
        for (let i = start; i < end; i += 1) {
          const [screenX, screenY] = project(data.x[i], data.y[i]);
          if (i === start) {
            context.moveTo(screenX, screenY);
          } else {
            context.lineTo(screenX, screenY);
          }
        }
        for (let i = end - 1; i >= start; i -= 1) {
          const [screenX, screenY] = project(data.x[i], base?.[i] ?? 0);
          context.lineTo(screenX, screenY);
        }
        context.closePath();
      }
      start = end;
    }
    context.fill();
  }

  private static drawScatter(
    context: Context2d,
    data: SeriesData,
    project: Projection,
    color: string,
    size: number
  ): void {
    const radius = size / 2;
    context.fillStyle = color;
    context.beginPath();
    for (let i = 0; i < data.length; i += 1) {
      const x = data.x[i];
      const y = data.y[i];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const [screenX, screenY] = project(x, y);
        context.moveTo(screenX + radius, screenY);
        context.arc(screenX, screenY, radius, 0, Math.PI * 2);
        // Very large paths can silently fail to rasterize on accelerated canvases
        if (i % SCATTER_PATH_BATCH === SCATTER_PATH_BATCH - 1) {
          context.fill();
          context.beginPath();
        }
      }
    }
    context.fill();
  }

  /**
   * Draws the bars of one direction, so each color is a single path. An `ohlc`
   * bar is a line from low to high, with ticks to the left at the open and to
   * the right at the close. A `candlestick` bar is the same line with a body
   * from open to close, outlined so even a flat body shows.
   */
  private static drawBars(
    context: Context2d,
    data: OhlcSeriesData,
    project: Projection,
    isCandlestick: boolean,
    halfWidth: number,
    isIncreasing: boolean,
    color: string,
    size: number
  ): void {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = size;
    context.lineJoin = 'miter';
    context.lineCap = 'butt';
    const finish = (): void => {
      if (isCandlestick) {
        context.fill();
      }
      context.stroke();
    };
    context.beginPath();
    for (let i = 0; i < data.length; i += 1) {
      const x = data.x[i];
      const open = data.open[i];
      const high = data.high[i];
      const low = data.low[i];
      const close = data.y[i];
      if (
        Number.isFinite(x) &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close) &&
        isOhlcBarIncreasing(open, close) === isIncreasing
      ) {
        const [screenX, screenHigh] = project(x, high);
        const [, screenLow] = project(x, low);
        const [left, screenOpen] = project(x - halfWidth, open);
        const [right, screenClose] = project(x + halfWidth, close);
        context.moveTo(screenX, screenHigh);
        context.lineTo(screenX, screenLow);
        if (isCandlestick) {
          const top = Math.min(screenOpen, screenClose);
          context.rect(
            left,
            top,
            right - left,
            Math.max(screenOpen, screenClose) - top
          );
        } else {
          context.moveTo(left, screenOpen);
          context.lineTo(screenX, screenOpen);
          context.moveTo(screenX, screenClose);
          context.lineTo(right, screenClose);
        }
        // Very large paths can silently fail to rasterize on accelerated canvases
        if (i % SCATTER_PATH_BATCH === SCATTER_PATH_BATCH - 1) {
          finish();
          context.beginPath();
        }
      }
    }
    finish();
  }

  private static drawData(
    context: Context2d,
    descriptor: SeriesDescriptor,
    data: SeriesData,
    project: Projection,
    color: string,
    size: number,
    bars: BarStyle,
    layer: Layer,
    fill: ResolvedAreaFill | undefined
  ): void {
    if (layer === 'fill') {
      if (fill != null) {
        CanvasRenderer.drawAreaFill(context, data, project, fill);
      }
    } else if (isOhlcSeriesType(descriptor.type)) {
      if (isOhlcSeriesData(data)) {
        const isCandlestick = descriptor.type === 'candlestick';
        CanvasRenderer.drawBars(
          context,
          data,
          project,
          isCandlestick,
          bars.halfWidth,
          true,
          bars.increasingColor,
          size
        );
        CanvasRenderer.drawBars(
          context,
          data,
          project,
          isCandlestick,
          bars.halfWidth,
          false,
          bars.decreasingColor,
          size
        );
      }
    } else if (descriptor.type === 'line' || descriptor.type === 'area') {
      if (size > 0) {
        CanvasRenderer.drawLine(context, data, project, color, size);
      }
    } else {
      CanvasRenderer.drawScatter(context, data, project, color, size);
    }
  }

  private getScratchContext(width: number, height: number): Context2d | null {
    if (this.scratch == null) {
      this.scratch = document.createElement('canvas');
    }
    // Resizing also clears it
    this.scratch.width = width;
    this.scratch.height = height;
    return this.scratch.getContext('2d');
  }

  private drawSeries(
    descriptor: SeriesDescriptor,
    data: SeriesData,
    resolution: SeriesResolution | undefined,
    color: string,
    opacity: number,
    layer: Layer
  ): void {
    const isArea = descriptor.type === 'area';
    if (layer === 'fill' && !isArea) {
      return;
    }
    const context = this.context as Context2d;
    const { theme, devicePixelRatio } = this;
    const viewport = this.getSeriesViewport(descriptor.id);
    const fill =
      layer === 'fill'
        ? resolveAreaFill(
            descriptor.style?.fill,
            color,
            theme.areaFillOpacity,
            viewport
          )
        : undefined;
    const size =
      descriptor.type === 'scatter'
        ? (descriptor.style?.pointSize ?? theme.pointSize)
        : (descriptor.style?.lineWidth ?? theme.lineWidth);
    const bars: BarStyle = {
      halfWidth: isOhlcSeriesType(descriptor.type)
        ? getOhlcHalfBarWidth(
            getOhlcBarSpacing(data),
            theme,
            (viewport.xMax - viewport.xMin) / Math.max(1, this.width)
          )
        : 0,
      increasingColor: theme.ohlcIncreasingColor,
      decreasingColor: theme.ohlcDecreasingColor,
    };
    context.globalAlpha = opacity;
    const grid = getStalePixelGrid(
      resolution,
      viewport,
      this.width,
      this.height,
      devicePixelRatio
    );
    if (grid == null) {
      CanvasRenderer.drawData(
        context,
        descriptor,
        data,
        (x, y) => [this.toScreenX(x, viewport), this.toScreenY(y, viewport)],
        color,
        size,
        bars,
        layer,
        fill
      );
      return;
    }

    // Draw on the coarse grid the data was made for, then scale that up like
    // an image so it pixelates in place
    const left = Math.floor((viewport.xMin - grid.x.origin) / grid.x.size);
    const right = Math.ceil((viewport.xMax - grid.x.origin) / grid.x.size);
    const bottom = Math.floor((viewport.yMin - grid.y.origin) / grid.y.size);
    const top = Math.ceil((viewport.yMax - grid.y.origin) / grid.y.size);
    const columns = right - left;
    const rows = top - bottom;
    const scratch =
      columns > 0 && rows > 0 ? this.getScratchContext(columns, rows) : null;
    if (scratch == null || this.scratch == null) {
      return;
    }
    CanvasRenderer.drawData(
      scratch,
      descriptor,
      data,
      (x, y) => [
        (x - grid.x.origin) / grid.x.size - left,
        top - (y - grid.y.origin) / grid.y.size,
      ],
      color,
      size * devicePixelRatio,
      bars,
      layer,
      fill
    );
    const screenLeft = this.toScreenX(
      grid.x.origin + left * grid.x.size,
      viewport
    );
    const screenTop = this.toScreenY(
      grid.y.origin + top * grid.y.size,
      viewport
    );
    context.imageSmoothingEnabled = false;
    context.drawImage(
      this.scratch,
      screenLeft,
      screenTop,
      this.toScreenX(grid.x.origin + right * grid.x.size, viewport) -
        screenLeft,
      this.toScreenY(grid.y.origin + bottom * grid.y.size, viewport) - screenTop
    );
    context.imageSmoothingEnabled = true;
  }

  render(): void {
    const { context, theme } = this;
    if (context == null) {
      return;
    }
    context.clearRect(0, 0, this.width, this.height);

    const layers: Layer[] = ['fill', 'data'];
    layers.forEach(layer => {
      for (let i = 0; i < this.descriptors.length; i += 1) {
        const descriptor = this.descriptors[i];
        const color = getSeriesColor(theme, i, descriptor.style?.color);
        const retained = this.retained.get(descriptor.id);
        if (retained != null && retained.data.length > 0) {
          this.drawSeries(
            descriptor,
            retained.data,
            retained.resolution,
            color,
            retained.opacity,
            layer
          );
        }
        const data = this.seriesData.get(descriptor.id) ?? createSeriesData();
        if (data.length > 0) {
          this.drawSeries(
            descriptor,
            data,
            this.seriesResolution.get(descriptor.id),
            color,
            1,
            layer
          );
        }
      }
    });
    context.globalAlpha = 1;
  }

  destroy(): void {
    this.seriesData.clear();
    this.seriesResolution.clear();
    this.retained.clear();
    this.scratch = null;
    this.descriptors = [];
    this.context = null;
  }
}

export const canvasRendererFactory: PlotRendererFactory = {
  name: 'canvas',
  capabilities: CAPABILITIES,
  isSupported: async () =>
    typeof document !== 'undefined' &&
    typeof document.createElement('canvas').getContext === 'function',
  create: () => new CanvasRenderer(),
};

export default CanvasRenderer;
