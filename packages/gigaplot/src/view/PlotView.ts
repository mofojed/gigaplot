import Log from '@deephaven/log';
import { PlotEventEmitter } from '../model/PlotEventEmitter';
import type {
  PlotDataSource,
  SeriesDataRequest,
} from '../model/PlotDataSource';
import {
  boundsEqual,
  getSeriesBounds,
  padBounds,
  unionBounds,
  type Bounds,
  type PlotShape,
  type SeriesDelta,
} from '../model/PlotTypes';
import type { PlotRenderer, SeriesResolution } from '../renderers/PlotRenderer';
import { type RendererRegistry } from '../renderers/RendererRegistry';
import { defaultRendererRegistry } from '../renderers/defaultRendererRegistry';
import { STALE_STRETCH_THRESHOLD } from '../renderers/pixelGrid';
import {
  fromPlotBounds,
  isLinearScale,
  linearScale,
  toPlotBounds,
  toPlotSeriesData,
  toPlotShape,
  type PlotScale,
  type PlotScales,
} from '../scale/PlotScale';
import { panBounds, zoomBounds } from '../scale/viewportUtils';
import {
  createPlotThemeFromElement,
  plotThemesEqual,
  type PlotTheme,
  type PlotThemeOverrides,
} from '../theme/PlotTheme';
import { observeThemeChanges } from '../theme/observeThemeChanges';
import {
  AxisPainter,
  getBottomMargin,
  getYAxisTitleWidth,
  type PlotArea,
} from './AxisPainter';
import { HoverPainter } from './HoverPainter';
import { LegendPainter, type PlotLegendPosition } from './LegendPainter';
import {
  findHover,
  hoverPointsEqual,
  isTooltipVisible,
  resolveTooltipOptions,
  type PlotHover,
  type PlotTooltipOptions,
  type ResolvedTooltipOptions,
} from './hover';

const log = Log.module('PlotView');

const DEFAULT_VIEWPORT: Bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
const ZOOM_STEP = 1.1;
/** Space between the widest y tick label and the left edge, in pixels. */
const Y_TICK_LABEL_EDGE_GAP = 4;
/** The left margin grows in steps of this many pixels to fit y tick labels. */
const Y_TICK_LABEL_MARGIN_STEP = 8;
/** How long stale data takes to fade out under the finer data replacing it. */
const RETAINED_FADE_MS = 200;
/** Loads quicker than this never show the pending hatch, so it does not flash. */
const PENDING_SHOW_DELAY_MS = 100;
const PENDING_FADE_IN_MS = 150;
const PENDING_FADE_OUT_MS = 200;

type XRange = readonly [number, number];

/** Sorts and merges overlapping ranges. */
function mergeRanges(ranges: XRange[]): XRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    if (last != null && sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([sorted[i][0], sorted[i][1]]);
    }
  }
  return merged;
}

/** Hatched regions of the plot whose data has not loaded yet. */
interface PendingOverlay {
  ranges: XRange[];
  /** `performance.now()` when the regions first appeared. */
  shownAt: number;
  /** `performance.now()` when the regions loaded, once they have. */
  clearedAt?: number;
  /** Opacity when the regions loaded, which fades out from there. */
  clearedOpacity?: number;
}

export interface PlotViewOptions {
  registry?: RendererRegistry;
  /** Renderer names in order of preference. Defaults to WebGPU then Canvas. */
  rendererPreference?: readonly string[];
  /**
   * Applied on top of the theme read from the Deephaven chart CSS variables in
   * scope for the container, which fall back to {@link defaultPlotTheme}.
   */
  theme?: PlotThemeOverrides;
  /**
   * Re-reads the CSS theme whenever the page's stylesheets or theme attributes
   * change, so the plot follows a theme switch. Defaults to true.
   */
  followCssTheme?: boolean;
  /** Enables wheel zoom, drag pan, and double click reset. Defaults to true. */
  interactive?: boolean;
  /**
   * While zooming in past the resolution a downsampled series was loaded at,
   * draws it like its last frame scaled up as an image: blocky but in place,
   * so nothing jumps. Finer data fills in over it as it arrives, while the
   * blocky data fades out. Zooming out instead hatches the regions the loaded
   * data does not reach until they load. Defaults to true.
   */
  smoothZoom?: boolean;
  /**
   * What to draw while hovering the plot. Line series snap to the cursor's x;
   * scatter series need the cursor over a point. `true` or omitted draws a
   * tooltip box and markers, `false` draws nothing, and an object changes only
   * the parts it sets. The `hover` event fires either way.
   */
  tooltip?: boolean | PlotTooltipOptions;
  /**
   * Where to draw the legend: `overlay` across the top of the plot area, over
   * the data, or `right` in a column beside it. Defaults to `overlay`.
   */
  legendPosition?: PlotLegendPosition;
  /**
   * The x axis' scale, in place of the shape's `xScale`, such as a business
   * calendar that removes nights and weekends, or `linearScale` to show them.
   */
  xScale?: PlotScale;
  /** The y axis' scale, in place of the shape's `yScale`, such as a log scale. */
  yScale?: PlotScale;
}

/** A legend beside the plot never takes more than this share of its width. */
const MAX_LEGEND_WIDTH_FRACTION = 0.4;

export interface PlotViewEventMap {
  rendererchanged: { name: string };
  /** The viewport in data units. */
  viewportchanged: { viewport: Bounds };
  shapechanged: { shape: PlotShape };
  themechanged: { theme: PlotTheme };
  /** Fired after the renderer has drawn a frame. */
  frame: Record<string, never>;
  /** Fired once the plot has drawn all outstanding data requests. */
  idle: Record<string, never>;
  /**
   * Fired when the points under the cursor change, including to none.
   * Listening turns on hit testing even when no tooltip is drawn.
   */
  hover: { hover: PlotHover | undefined };
  error: { error: unknown };
}

/** A hover in plot units to data units, for reporting it. */
function hoverToData(
  hover: PlotHover | undefined,
  { x, y }: PlotScales
): PlotHover | undefined {
  if (hover == null || (isLinearScale(x) && isLinearScale(y))) {
    return hover;
  }
  const toY = (value: number | undefined) =>
    value == null ? undefined : y.fromPlot(value);
  return {
    x: x.fromPlot(hover.x),
    y: y.fromPlot(hover.y),
    points: hover.points.map(point => ({
      ...point,
      x: x.fromPlot(point.x),
      y: y.fromPlot(point.y),
      value: toY(point.value),
      open: toY(point.open),
      high: toY(point.high),
      low: toY(point.low),
    })),
  };
}

interface SeriesState {
  /** True when the renderer holds every point, so deltas can be applied directly. */
  complete: boolean;
  /** Data units per pixel column of the request the held data was made for. */
  xPerPixel: number;
  /** X range the held data covers. Its start is a pixel column boundary. */
  xCoverage: { min: number; max: number };
  /**
   * Y pixel grid to pixelate the held data on once it is stale: the screen's,
   * as of the last frame it was drawn sharp.
   */
  yOrigin: number;
  yPerPixel: number;
  /** `performance.now()` when the stale data this replaced began fading out. */
  fadeStart?: number;
}

/**
 * Owns the DOM, the renderer, and the data request lifecycle for one plot.
 *
 * Framework free on purpose. `Plot` is a thin React wrapper around this.
 */
export class PlotView extends PlotEventEmitter<PlotViewEventMap> {
  private container: HTMLElement;

  private source: PlotDataSource;

  private options: PlotViewOptions;

  private registry: RendererRegistry;

  private axesCanvas: HTMLCanvasElement;

  private dataCanvas: HTMLCanvasElement;

  private axisPainter: AxisPainter;

  private legendCanvas: HTMLCanvasElement;

  private legendPainter: LegendPainter;

  private legendPosition: PlotLegendPosition;

  /** Width of the legend beside the plot, for the shape and theme it measured. */
  private legendWidthCache:
    { shape: PlotShape; theme: PlotTheme; width: number } | undefined;

  private hoverCanvas: HTMLCanvasElement;

  private hoverPainter: HoverPainter;

  private tooltip: ResolvedTooltipOptions;

  /** Cursor position relative to the container, while it is over it. */
  private pointer: { x: number; y: number } | undefined;

  private hover: PlotHover | undefined;

  /** True when only the hover overlay needs drawing. */
  private hoverDirty = false;

  private renderer: PlotRenderer | null = null;

  private theme: PlotTheme;

  private themeOverrides: PlotThemeOverrides | undefined;

  private unobserveTheme: (() => void) | undefined;

  /** The shape as the source describes it, in data units. */
  private dataShape: PlotShape = { series: [] };

  /**
   * The shape in plot units, which everything that draws reads. The same as
   * `dataShape` when both axes are linear.
   */
  private shape: PlotShape = { series: [] };

  private scales: PlotScales = { x: linearScale, y: linearScale };

  private seriesStates = new Map<string, SeriesState>();

  /** The region on screen, in plot units. */
  private viewport: Bounds = DEFAULT_VIEWPORT;

  private homeViewport: Bounds = DEFAULT_VIEWPORT;

  /**
   * True when the shape's bounds have no position on a scale, such as a log
   * axis whose data reaches zero, so home is fitted to the data loaded.
   */
  private isHomeFromData = false;

  private width = 0;

  private height = 0;

  /** Left margin the y tick labels need, which may exceed the theme's. */
  private yTickLabelMargin = 0;

  private frame: number | undefined;

  private dirty = false;

  private requestTimeout: ReturnType<typeof setTimeout> | undefined;

  /** Defers reporting idle until any stale data has faded out. */
  private idleTimeout: ReturnType<typeof setTimeout> | undefined;

  private pendingOverlay: PendingOverlay | undefined;

  /** True once the user has zoomed or panned, which stops viewport following. */
  private isViewportPinned = false;

  private resizeObserver: ResizeObserver | undefined;

  private abortController: AbortController | undefined;

  private requestRevision = 0;

  private pendingRequests = 0;

  private isDestroyed = false;

  private dragOrigin: { x: number; y: number } | undefined;

  constructor(
    container: HTMLElement,
    source: PlotDataSource,
    options: PlotViewOptions = {}
  ) {
    super();
    this.container = container;
    this.source = source;
    this.options = options;
    this.registry = options.registry ?? defaultRendererRegistry;
    this.themeOverrides = options.theme;
    this.theme = createPlotThemeFromElement(container, options.theme);

    this.container.style.position = 'relative';
    this.container.setAttribute('data-dh-plot-status', 'loading');

    this.axesCanvas = document.createElement('canvas');
    this.axesCanvas.setAttribute('data-dh-plot-layer', 'axes');
    this.axesCanvas.style.position = 'absolute';
    this.axesCanvas.style.inset = '0';
    this.axesCanvas.style.width = '100%';
    this.axesCanvas.style.height = '100%';

    this.dataCanvas = document.createElement('canvas');
    this.dataCanvas.setAttribute('data-dh-plot-layer', 'data');
    this.dataCanvas.style.position = 'absolute';

    // Above the data so series never cover the legend
    this.legendCanvas = document.createElement('canvas');
    this.legendCanvas.setAttribute('data-dh-plot-layer', 'legend');
    this.legendCanvas.style.position = 'absolute';
    this.legendCanvas.style.inset = '0';
    this.legendCanvas.style.width = '100%';
    this.legendCanvas.style.height = '100%';
    this.legendCanvas.style.pointerEvents = 'none';

    this.hoverCanvas = document.createElement('canvas');
    this.hoverCanvas.setAttribute('data-dh-plot-layer', 'hover');
    this.hoverCanvas.style.position = 'absolute';
    this.hoverCanvas.style.inset = '0';
    this.hoverCanvas.style.width = '100%';
    this.hoverCanvas.style.height = '100%';
    this.hoverCanvas.style.pointerEvents = 'none';

    this.container.appendChild(this.axesCanvas);
    this.container.appendChild(this.dataCanvas);
    this.container.appendChild(this.legendCanvas);
    this.container.appendChild(this.hoverCanvas);

    this.axisPainter = new AxisPainter(this.axesCanvas);
    this.legendPainter = new LegendPainter(this.legendCanvas);
    this.legendPosition = options.legendPosition ?? 'overlay';
    this.hoverPainter = new HoverPainter(this.hoverCanvas);
    this.tooltip = resolveTooltipOptions(options.tooltip);

    this.handleShapeChanged = this.handleShapeChanged.bind(this);
    this.handleDataChanged = this.handleDataChanged.bind(this);
    this.handleSourceError = this.handleSourceError.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
    this.handleHoverMove = this.handleHoverMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.renderFrame = this.renderFrame.bind(this);
    this.refreshTheme = this.refreshTheme.bind(this);

    if (options.followCssTheme !== false) {
      this.unobserveTheme = observeThemeChanges(this.refreshTheme);
    }
  }

  /** Resolves a renderer, loads the shape, and draws the first frame. */
  async initialize(): Promise<void> {
    // Listen before awaiting anything: resolving a renderer can take long
    // enough for the source to load its bounds, and a missed shape change
    // would leave the plot requesting data for the placeholder viewport.
    let isShapeChanged = false;
    const markShapeChanged = () => {
      isShapeChanged = true;
    };
    this.source.addEventListener('shapechanged', markShapeChanged);
    this.source.addEventListener('shapechanged', this.handleShapeChanged);
    this.source.addEventListener('datachanged', this.handleDataChanged);
    this.source.addEventListener('error', this.handleSourceError);

    let initialShape: PlotShape;
    try {
      initialShape = await this.source.getShape();
    } finally {
      this.source.removeEventListener('shapechanged', markShapeChanged);
    }
    if (this.isDestroyed) {
      return;
    }
    if (!isShapeChanged) {
      this.setDataShape(initialShape);
    }

    const seriesTypes = Array.from(
      new Set(this.shape.series.map(series => series.type))
    );
    const factory = await this.registry.resolve({
      preference: this.options.rendererPreference,
      seriesTypes,
    });
    if (this.isDestroyed) {
      return;
    }
    if (factory == null) {
      const reason = await this.registry.describeUnavailable({
        preference: this.options.rendererPreference,
        seriesTypes,
      });
      throw new Error(`No renderer could be used for this plot: ${reason}`);
    }

    const renderer = factory.create();
    // The container may not have been in the document when constructed
    this.theme = createPlotThemeFromElement(
      this.container,
      this.themeOverrides
    );
    await renderer.initialize(this.dataCanvas, this.theme);
    if (this.isDestroyed) {
      renderer.destroy();
      return;
    }
    this.renderer = renderer;
    this.container.setAttribute('data-dh-plot-renderer', renderer.name);
    this.emit('rendererchanged', { name: renderer.name });

    // The shape may have changed while the renderer was resolving
    const { shape } = this;
    this.updateHomeViewport();
    if (!this.isViewportPinned) {
      this.viewport = this.homeViewport;
    }
    renderer.setShape(shape);
    renderer.setViewport(this.viewport);
    this.emit('shapechanged', { shape: this.dataShape });

    this.observeSize();
    // Hover is independent of zoom and pan, so it works on static plots too
    this.container.addEventListener('pointermove', this.handleHoverMove);
    this.container.addEventListener('pointerleave', this.handlePointerLeave);
    if (this.options.interactive !== false) {
      this.addInteractionListeners();
    }

    this.scheduleDataRequest();
  }

  /**
   * Sizes the plot to the container's layout box. The bounding client rect is
   * avoided where possible because it reports the transformed box, so a plot
   * on a rotated or scaled element would size itself to its projection.
   */
  private observeSize(): void {
    const { offsetWidth, offsetHeight } = this.container;
    if (offsetWidth > 0 && offsetHeight > 0) {
      this.setSize(offsetWidth, offsetHeight);
    } else {
      const rect = this.container.getBoundingClientRect();
      this.setSize(rect.width, rect.height);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        const entry = entries[entries.length - 1];
        const box = entry?.borderBoxSize?.[0];
        if (box != null) {
          this.setSize(box.inlineSize, box.blockSize);
        } else if (entry != null) {
          this.setSize(entry.contentRect.width, entry.contentRect.height);
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  private addInteractionListeners(): void {
    this.container.addEventListener('wheel', this.handleWheel, {
      passive: false,
    });
    this.container.addEventListener('pointerdown', this.handlePointerDown);
    this.container.addEventListener('pointermove', this.handlePointerMove);
    this.container.addEventListener('pointerup', this.handlePointerUp);
    this.container.addEventListener('pointercancel', this.handlePointerUp);
    this.container.addEventListener('dblclick', this.handleDoubleClick);
  }

  private removeInteractionListeners(): void {
    this.container.removeEventListener('wheel', this.handleWheel);
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerup', this.handlePointerUp);
    this.container.removeEventListener('pointercancel', this.handlePointerUp);
    this.container.removeEventListener('dblclick', this.handleDoubleClick);
  }

  getPlotArea(): PlotArea {
    const { margin } = this.theme;
    const left =
      Math.max(margin.left, this.yTickLabelMargin) +
      getYAxisTitleWidth(this.shape, this.theme);
    const bottom = getBottomMargin(this.shape, this.theme);
    const right = margin.right + this.getLegendWidth();
    return {
      left,
      top: margin.top,
      width: Math.max(1, this.width - left - right),
      height: Math.max(1, this.height - margin.top - bottom),
    };
  }

  /** Space reserved beside the plot area for the legend, or 0 for an overlay. */
  private getLegendWidth(): number {
    if (this.legendPosition !== 'right') {
      return 0;
    }
    const { shape, theme } = this;
    const cache = this.legendWidthCache;
    let width: number;
    if (cache != null && cache.shape === shape && cache.theme === theme) {
      width = cache.width;
    } else {
      width = this.legendPainter.measureWidth(shape, theme);
      this.legendWidthCache = { shape, theme, width };
    }
    return Math.min(width, Math.floor(this.width * MAX_LEGEND_WIDTH_FRACTION));
  }

  /** Lays the plot out again if the plot area moved or resized since `previous`. */
  private layoutIfAreaChanged(previous: PlotArea): void {
    const area = this.getPlotArea();
    if (
      area.left !== previous.left ||
      area.top !== previous.top ||
      area.width !== previous.width ||
      area.height !== previous.height
    ) {
      this.layout();
    }
  }

  /**
   * Widens the left margin when custom y tick labels, such as dates, would not
   * fit in it. Never narrower than the theme margin, and numeric axes keep
   * the theme margin exactly.
   */
  private fitYTickLabels(): void {
    if (this.shape.yAxisTicks == null) {
      if (this.yTickLabelMargin !== 0) {
        this.yTickLabelMargin = 0;
        this.layout();
      }
      return;
    }
    const { tickLabelPadding } = this.theme;
    const labelWidth = this.axisPainter.measureYTickLabels(
      this.viewport,
      this.shape,
      this.theme,
      this.getPlotArea().height
    );
    // Rounded up so labels changing width slightly while panning do not resize
    const labelMargin =
      Math.ceil(
        (labelWidth + tickLabelPadding + Y_TICK_LABEL_EDGE_GAP) /
          Y_TICK_LABEL_MARGIN_STEP
      ) * Y_TICK_LABEL_MARGIN_STEP;
    if (labelMargin === this.yTickLabelMargin) {
      return;
    }
    const previousLeft = this.getPlotArea().left;
    this.yTickLabelMargin = labelMargin;
    if (this.getPlotArea().left !== previousLeft) {
      this.layout();
    }
  }

  getRendererName(): string | undefined {
    return this.renderer?.name;
  }

  /** The region on screen, in data units. */
  getViewport(): Bounds {
    return fromPlotBounds(this.viewport, this.scales);
  }

  /** The shape as the source describes it, in data units. */
  getShape(): PlotShape {
    return this.dataShape;
  }

  /** The scale of each axis: the options', else the shape's, else linear. */
  getScales(): PlotScales {
    return this.scales;
  }

  /** The scales the options and a shape call for. */
  private resolveScales(shape: PlotShape): PlotScales {
    return {
      x: this.options.xScale ?? shape.xScale ?? linearScale,
      y: this.options.yScale ?? shape.yScale ?? linearScale,
    };
  }

  /**
   * Takes a shape from the source, and moves to new scales if it brings them.
   *
   * @returns True if the scales changed
   */
  private setDataShape(shape: PlotShape): boolean {
    const scales = this.resolveScales(shape);
    const isRescaled = scales.x !== this.scales.x || scales.y !== this.scales.y;
    const previousViewport = isRescaled
      ? fromPlotBounds(this.viewport, this.scales)
      : undefined;
    this.dataShape = shape;
    this.scales = scales;
    this.shape = toPlotShape(shape, scales);
    if (previousViewport != null) {
      // Keep showing the same data under the new scales
      const viewport = toPlotBounds(previousViewport, scales);
      if (viewport != null) {
        this.viewport = viewport;
      }
    }
    return isRescaled;
  }

  /**
   * Replaces the axes' scales, in place of the shape's. Pass `undefined` to
   * go back to the shape's scale for an axis. The plot reloads its data, since
   * where every point sits has changed.
   */
  setScales({ x, y }: { x?: PlotScale; y?: PlotScale }): void {
    if (x === this.options.xScale && y === this.options.yScale) {
      return;
    }
    this.options = { ...this.options, xScale: x, yScale: y };
    if (this.setDataShape(this.dataShape)) {
      this.handleRescale();
    }
  }

  /** Data already held is in the old scales' units, so load it all again. */
  private handleRescale(): void {
    const previousArea = this.getPlotArea();
    this.seriesStates.clear();
    this.renderer?.setShape(this.shape);
    this.updateHomeViewport();
    if (!this.isViewportPinned) {
      this.viewport = this.homeViewport;
    }
    this.renderer?.setViewport(this.viewport);
    this.yTickLabelMargin = 0;
    this.layoutIfAreaChanged(previousArea);
    this.emit('viewportchanged', { viewport: this.getViewport() });
    this.scheduleDataRequest();
    this.invalidate();
  }

  /**
   * Home is the shape's bounds in plot units, or else the bounds of the data
   * loaded, for bounds that have no position on a scale.
   */
  private updateHomeViewport(): void {
    const { bounds } = this.shape;
    this.isHomeFromData = bounds == null && this.dataShape.bounds != null;
    if (bounds != null) {
      this.homeViewport = padBounds(bounds);
      return;
    }
    let dataBounds: Bounds | undefined;
    if (this.isHomeFromData) {
      const { renderer } = this;
      this.shape.series.forEach(series => {
        const data = renderer?.getSeriesData?.(series.id);
        if (data != null) {
          dataBounds = unionBounds(dataBounds, getSeriesBounds(data));
        }
      });
    }
    this.homeViewport =
      dataBounds != null ? padBounds(dataBounds) : DEFAULT_VIEWPORT;
  }

  getTheme(): PlotTheme {
    return this.theme;
  }

  /** The points under the cursor, if any, in data units. */
  getHover(): PlotHover | undefined {
    return hoverToData(this.hover, this.scales);
  }

  /** Changes what is drawn while hovering. See {@link PlotViewOptions.tooltip}. */
  setTooltip(tooltip: boolean | PlotTooltipOptions | undefined): void {
    this.tooltip = resolveTooltipOptions(tooltip);
    this.invalidateHover();
  }

  getLegendPosition(): PlotLegendPosition {
    return this.legendPosition;
  }

  /** Moves the legend. See {@link PlotViewOptions.legendPosition}. */
  setLegendPosition(position: PlotLegendPosition | undefined): void {
    const next = position ?? 'overlay';
    if (next === this.legendPosition) {
      return;
    }
    const previousArea = this.getPlotArea();
    this.legendPosition = next;
    this.layoutIfAreaChanged(previousArea);
    this.invalidate();
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.layout();
  }

  /** Sizes and positions the canvases for the current size and margins. */
  private layout(): void {
    const { width, height } = this;
    if (width <= 0 || height <= 0) {
      return;
    }

    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const area = this.getPlotArea();
    this.axesCanvas.style.width = `${width}px`;
    this.axesCanvas.style.height = `${height}px`;
    this.axisPainter.resize(width, height, ratio);
    this.legendPainter.resize(width, height, ratio);
    this.hoverPainter.resize(width, height, ratio);
    this.invalidateHover();

    this.dataCanvas.style.left = `${area.left}px`;
    this.dataCanvas.style.top = `${area.top}px`;
    this.dataCanvas.style.width = `${area.width}px`;
    this.dataCanvas.style.height = `${area.height}px`;
    this.renderer?.resize(area.width, area.height, ratio);

    // The pixel budget changed, so even complete series may need more detail
    this.scheduleDataRequest();
  }

  /** Shows a region, given in data units. */
  setViewport(viewport: Bounds): void {
    const plotViewport = toPlotBounds(viewport, this.scales);
    if (plotViewport != null) {
      this.setPlotViewport(plotViewport);
    }
  }

  private setPlotViewport(viewport: Bounds): void {
    // An explicit viewport stops the plot from following incoming data
    this.isViewportPinned = true;
    this.applyViewport(viewport);
  }

  private applyViewport(viewport: Bounds): void {
    if (boundsEqual(viewport, this.viewport)) {
      return;
    }
    this.viewport = viewport;
    this.renderer?.setViewport(viewport);
    this.emit('viewportchanged', { viewport: this.getViewport() });
    // A series the renderer holds in full cannot yield more data for a new
    // viewport, so panning and zooming it costs nothing but a redraw
    if (this.hasIncompleteSeries()) {
      this.scheduleDataRequest();
    }
    this.invalidate();
  }

  private hasIncompleteSeries(): boolean {
    return this.shape.series.some(
      descriptor => this.seriesStates.get(descriptor.id)?.complete !== true
    );
  }

  resetViewport(): void {
    this.isViewportPinned = false;
    this.applyViewport(this.homeViewport);
  }

  /**
   * Replaces the theme overrides. They are applied on top of the CSS theme, so
   * passing `undefined` returns the plot to following the page theme.
   */
  setTheme(overrides: PlotThemeOverrides | undefined): void {
    this.themeOverrides = overrides;
    this.refreshTheme();
  }

  /**
   * Re-reads the CSS theme and applies it if anything changed. Called
   * automatically on page theme changes unless `followCssTheme` is false; call
   * it directly after changing CSS variables on an ancestor of the container.
   */
  refreshTheme(): void {
    if (this.isDestroyed) {
      return;
    }
    const theme = createPlotThemeFromElement(
      this.container,
      this.themeOverrides
    );
    if (plotThemesEqual(theme, this.theme)) {
      return;
    }
    const previousArea = this.getPlotArea();
    this.theme = theme;
    this.renderer?.setTheme(theme);
    this.layoutIfAreaChanged(previousArea);
    this.emit('themechanged', { theme });
    this.invalidate();
  }

  /** Queues a redraw on the next animation frame. */
  invalidate(): void {
    this.dirty = true;
    this.scheduleFrame();
  }

  /** Queues a redraw of only the hover overlay, leaving the data alone. */
  private invalidateHover(): void {
    this.hoverDirty = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.frame == null && !this.isDestroyed) {
      this.frame = requestAnimationFrame(this.renderFrame);
    }
  }

  /**
   * Queues a data request.
   *
   * A ticking source can fire several times in a turn, and each request
   * supersedes the last anyway, so they collapse into one. This deliberately
   * does not use `requestAnimationFrame`: that never fires in a hidden tab, and
   * a plot should still have its data ready when the tab is brought forward.
   */
  private scheduleDataRequest(): void {
    if (this.requestTimeout != null || this.isDestroyed) {
      return;
    }
    this.requestTimeout = setTimeout(() => {
      this.requestTimeout = undefined;
      this.requestData();
    }, 0);
  }

  private renderFrame(): void {
    this.frame = undefined;
    if (this.isDestroyed) {
      return;
    }
    const isHoverDirty = this.hoverDirty || this.dirty;
    this.hoverDirty = false;
    if (this.dirty) {
      this.dirty = false;
      this.renderData();
    }
    // The data or viewport may have moved under a cursor that has not
    if (isHoverDirty) {
      this.renderHover();
    }
  }

  private renderData(): void {
    this.fitYTickLabels();
    const now = performance.now();
    const overlay = this.updatePendingOverlay(now);
    this.axisPainter.paint(
      this.width,
      this.height,
      this.getPlotArea(),
      this.viewport,
      this.shape,
      this.theme,
      overlay == null
        ? undefined
        : {
            ranges: overlay.ranges,
            opacity: this.getPendingOpacity(overlay, now),
          }
    );
    this.legendPainter.paint(
      this.width,
      this.height,
      this.getPlotArea(),
      this.shape,
      this.theme,
      this.legendPosition
    );
    const isFading = this.updateSeriesResolutions(now);
    this.renderer?.render();
    this.emit('frame', {});
    if (isFading || this.isPendingOverlayAnimating(now)) {
      this.invalidate();
    }
  }

  /**
   * Hit tests the cursor and draws the hover overlay. Hit testing scans the
   * data the renderer holds, so it is skipped when nothing would show it.
   */
  private renderHover(): void {
    const { pointer, renderer } = this;
    const area = this.getPlotArea();
    let hover: PlotHover | undefined;
    if (
      pointer != null &&
      renderer?.getSeriesData != null &&
      (isTooltipVisible(this.tooltip) || this.hasListeners('hover'))
    ) {
      hover = findHover({
        shape: this.shape,
        viewport: this.viewport,
        area,
        cursor: { x: pointer.x - area.left, y: pointer.y - area.top },
        theme: this.theme,
        getSeriesData: id => renderer.getSeriesData?.(id),
      });
      hover = this.toPlotStackedValues(hover);
    }
    const previous = this.hover;
    this.hover = hover;
    this.hoverPainter.paint({
      width: this.width,
      height: this.height,
      area,
      viewport: this.viewport,
      shape: this.shape,
      theme: this.theme,
      hover,
      options: this.tooltip,
    });
    if (!hoverPointsEqual(previous, hover)) {
      this.emit('hover', { hover: hoverToData(hover, this.scales) });
    }
  }

  /**
   * A stacked area's own value is its top less its base in data units, which
   * on a scale that is not linear is not the difference of their positions.
   * The tooltip formats positions, so the value is given as the position of
   * that difference.
   */
  private toPlotStackedValues(
    hover: PlotHover | undefined
  ): PlotHover | undefined {
    const { y } = this.scales;
    if (hover == null || isLinearScale(y)) {
      return hover;
    }
    return {
      ...hover,
      points: hover.points.map(point =>
        point.value == null
          ? point
          : {
              ...point,
              value: y.toPlot(
                y.fromPlot(point.y) - y.fromPlot(point.y - point.value)
              ),
            }
      ),
    };
  }

  /**
   * X ranges in view where a downsampled series has data that its loaded
   * table does not cover yet, such as the edges uncovered by zooming out.
   */
  private getPendingRanges(): XRange[] {
    if (this.options.smoothZoom === false) {
      return [];
    }
    const { xMin, xMax } = this.viewport;
    const area = this.getPlotArea();
    const minWidth = area.width > 0 ? (xMax - xMin) / area.width : 0;
    const ranges: XRange[] = [];
    const add = (min: number, max: number): void => {
      // Slivers under a pixel are rounding, not missing data
      if (max - min > minWidth) {
        ranges.push([min, max]);
      }
    };
    for (let i = 0; i < this.shape.series.length; i += 1) {
      const descriptor = this.shape.series[i];
      const state = this.seriesStates.get(descriptor.id);
      const bounds = descriptor.bounds ?? this.shape.bounds;
      if (state != null && !state.complete && bounds != null) {
        const low = Math.max(xMin, bounds.xMin);
        const high = Math.min(xMax, bounds.xMax);
        const { min, max } = state.xCoverage;
        add(low, Math.min(high, min));
        add(Math.max(low, max), high);
      }
    }
    return mergeRanges(ranges);
  }

  private getPendingOpacity(overlay: PendingOverlay, now: number): number {
    if (overlay.clearedAt != null) {
      const progress = (now - overlay.clearedAt) / PENDING_FADE_OUT_MS;
      return (overlay.clearedOpacity ?? 0) * Math.max(0, 1 - progress);
    }
    const progress =
      (now - overlay.shownAt - PENDING_SHOW_DELAY_MS) / PENDING_FADE_IN_MS;
    return Math.min(1, Math.max(0, progress));
  }

  /** Brings the pending overlay up to date with the data held. */
  private updatePendingOverlay(now: number): PendingOverlay | undefined {
    const ranges = this.getPendingRanges();
    const overlay = this.pendingOverlay;
    if (ranges.length > 0) {
      if (overlay == null) {
        this.pendingOverlay = { ranges, shownAt: now };
      } else if (overlay.clearedAt != null) {
        // Pick the fade in back up from wherever the fade out had got to
        const opacity = this.getPendingOpacity(overlay, now);
        this.pendingOverlay = {
          ranges,
          shownAt: now - PENDING_SHOW_DELAY_MS - opacity * PENDING_FADE_IN_MS,
        };
      } else {
        overlay.ranges = ranges;
      }
    } else if (overlay != null && overlay.clearedAt == null) {
      overlay.clearedOpacity = this.getPendingOpacity(overlay, now);
      overlay.clearedAt = now;
    }
    if (
      this.pendingOverlay?.clearedAt != null &&
      this.getPendingOpacity(this.pendingOverlay, now) <= 0
    ) {
      this.pendingOverlay = undefined;
    }
    return this.pendingOverlay;
  }

  private isPendingOverlayAnimating(now: number): boolean {
    const overlay = this.pendingOverlay;
    if (overlay == null) {
      return false;
    }
    const opacity = this.getPendingOpacity(overlay, now);
    return overlay.clearedAt != null ? opacity > 0 : opacity < 1;
  }

  /** Data units per CSS pixel on screen, on each axis. */
  private getScreenPerPixel(): { x: number; y: number } {
    const { width, height } = this.getPlotArea();
    const { viewport } = this;
    return {
      x: width > 0 ? (viewport.xMax - viewport.xMin) / width : 0,
      y: height > 0 ? (viewport.yMax - viewport.yMin) / height : 0,
    };
  }

  /** How far the viewport is zoomed in past the resolution of a series' data. */
  private getStretch(state: SeriesState): number {
    const { x } = this.getScreenPerPixel();
    return x > 0 ? state.xPerPixel / x : 1;
  }

  /** The pixel grid to tell the renderer a series' data was made for. */
  private getResolution(state: SeriesState): SeriesResolution | undefined {
    // Complete data is exact at any zoom, so only downsampled data goes stale
    if (this.options.smoothZoom === false || state.complete) {
      return undefined;
    }
    return {
      xOrigin: state.xCoverage.min,
      xPerPixel: state.xPerPixel,
      yOrigin: state.yOrigin,
      yPerPixel: state.yPerPixel,
    };
  }

  private static getRetainedOpacity(state: SeriesState, now: number): number {
    if (state.fadeStart == null) {
      return 0;
    }
    const progress = (now - state.fadeStart) / RETAINED_FADE_MS;
    return progress < 1 ? (1 - progress) ** 2 : 0;
  }

  /** Milliseconds until all retained data and pending overlay have faded out. */
  private getRemainingFadeMs(now: number): number {
    let remaining = 0;
    const overlay = this.pendingOverlay;
    if (overlay?.clearedAt != null && (overlay.clearedOpacity ?? 0) > 0) {
      remaining = overlay.clearedAt + PENDING_FADE_OUT_MS - now;
    }
    this.seriesStates.forEach(state => {
      if (state.fadeStart != null) {
        remaining = Math.max(
          remaining,
          state.fadeStart + RETAINED_FADE_MS - now
        );
      }
    });
    return remaining;
  }

  /**
   * Pushes each series' resolution and the opacity of any stale data fading
   * out under it to the renderer. Returns true while anything is still fading.
   */
  private updateSeriesResolutions(now: number): boolean {
    const { renderer, viewport } = this;
    const screen = this.getScreenPerPixel();
    let isFading = false;
    for (let i = 0; i < this.shape.series.length; i += 1) {
      const { id } = this.shape.series[i];
      const state = this.seriesStates.get(id);
      if (state != null) {
        if (this.getStretch(state) < STALE_STRETCH_THRESHOLD) {
          state.yOrigin = viewport.yMin;
          state.yPerPixel = screen.y;
        }
        renderer?.setSeriesResolution?.(id, this.getResolution(state));
        if (state.fadeStart != null) {
          const opacity = PlotView.getRetainedOpacity(state, now);
          renderer?.setRetainedSeriesOpacity?.(id, opacity);
          if (opacity > 0) {
            isFading = true;
          } else {
            state.fadeStart = undefined;
          }
        }
      }
    }
    return isFading;
  }

  /**
   * Asks the source for the data needed to draw the current viewport at the
   * current size. In-flight requests are aborted so only the latest wins.
   */
  requestData(): void {
    if (this.renderer == null || this.width <= 0 || this.height <= 0) {
      return;
    }
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.requestRevision += 1;
    const revision = this.requestRevision;
    const area = this.getPlotArea();
    const pixelSize = { width: area.width, height: area.height };
    const { viewport, scales } = this;
    const dataViewport = fromPlotBounds(viewport, scales);
    const xPerPixel = (viewport.xMax - viewport.xMin) / area.width;

    this.container.setAttribute('data-dh-plot-status', 'loading');
    this.pendingRequests += 1;

    const requests = this.shape.series.map(async descriptor => {
      const request: SeriesDataRequest = {
        seriesId: descriptor.id,
        viewport: dataViewport,
        pixelSize,
        style: descriptor.style ?? {},
        signal: abortController.signal,
        ...(isLinearScale(scales.x) ? {} : { xScale: scales.x }),
        ...(isLinearScale(scales.y) ? {} : { yScale: scales.y }),
      };
      const result = await this.source.requestSeriesData(request);
      const { renderer } = this;
      if (
        revision === this.requestRevision &&
        !this.isDestroyed &&
        renderer != null &&
        // Data for scales since replaced would land in the wrong place
        scales === this.scales
      ) {
        const { id } = descriptor;
        const previous = this.seriesStates.get(id);
        const xResolution = result.xResolution ?? xPerPixel;
        const coverage = result.xCoverage;
        const coverageMin = coverage && scales.x.toPlot(coverage.min);
        const coverageMax = coverage && scales.x.toPlot(coverage.max);
        const state: SeriesState = {
          complete: result.complete,
          xPerPixel: xResolution,
          xCoverage:
            coverageMin != null &&
            coverageMax != null &&
            Number.isFinite(coverageMin) &&
            Number.isFinite(coverageMax)
              ? { min: coverageMin, max: coverageMax }
              : { min: viewport.xMin, max: viewport.xMax },
          // Scale the y grid with the x resolution, so lines of data that is
          // still stale stay as thick relative to its blocks as before
          yOrigin: previous?.yOrigin ?? this.viewport.yMin,
          yPerPixel:
            previous != null
              ? previous.yPerPixel * (xResolution / previous.xPerPixel)
              : this.getScreenPerPixel().y,
          fadeStart: previous?.fadeStart,
        };
        // Finer data fills in over the stale data it replaces, which fades out
        if (
          previous != null &&
          renderer.retainSeriesData != null &&
          this.getResolution(previous) != null &&
          xResolution < previous.xPerPixel &&
          this.getStretch(previous) >= STALE_STRETCH_THRESHOLD
        ) {
          renderer.retainSeriesData(id);
          state.fadeStart = performance.now();
        }
        this.seriesStates.set(id, state);
        renderer.setSeriesData(id, toPlotSeriesData(result.data, scales));
        renderer.setSeriesResolution?.(id, this.getResolution(state));
      }
    });

    Promise.all(requests)
      .then(() => {
        if (revision === this.requestRevision) {
          this.fitHomeToData();
          this.invalidate();
        }
      })
      .catch(error => {
        if (!abortController.signal.aborted) {
          log.error('Failed to load plot data', error);
          this.emit('error', { error });
        }
      })
      .finally(() => {
        this.pendingRequests -= 1;
        this.reportIdleWhenSettled();
      });
  }

  /**
   * Moves home to the data loaded, when the shape's bounds have no position
   * on the scales, and follows it there until the user takes control.
   */
  private fitHomeToData(): void {
    if (!this.isHomeFromData) {
      return;
    }
    const previous = this.homeViewport;
    this.updateHomeViewport();
    if (!this.isViewportPinned && !boundsEqual(previous, this.homeViewport)) {
      this.applyViewport(this.homeViewport);
    }
  }

  /**
   * Reports the plot ready once no requests are outstanding and any stale data
   * has faded out, so a ready plot is showing its final, sharp data.
   */
  private reportIdleWhenSettled(): void {
    if (this.idleTimeout != null) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = undefined;
    }
    if (this.pendingRequests !== 0 || this.isDestroyed) {
      return;
    }
    const now = performance.now();
    // The overlay is otherwise only updated on the next frame
    this.updatePendingOverlay(now);
    const remaining = this.getRemainingFadeMs(now);
    if (remaining > 0) {
      this.idleTimeout = setTimeout(() => {
        this.idleTimeout = undefined;
        this.reportIdleWhenSettled();
      }, remaining);
      return;
    }
    this.container.setAttribute('data-dh-plot-status', 'ready');
    this.emit('idle', {});
  }

  private handleShapeChanged({ shape }: { shape: PlotShape }): void {
    const previousArea = this.getPlotArea();
    if (this.setDataShape(shape)) {
      this.emit('shapechanged', { shape });
      this.handleRescale();
      return;
    }
    this.renderer?.setShape(this.shape);
    // Axis titles and a legend beside the plot change the space around the data
    this.layoutIfAreaChanged(previousArea);
    if (this.shape.bounds != null) {
      this.updateHomeViewport();
      // Until the user takes control, keep newly appended data in view
      if (!this.isViewportPinned) {
        this.applyViewport(this.homeViewport);
      }
    } else if (shape.bounds != null) {
      this.isHomeFromData = true;
    }
    this.emit('shapechanged', { shape });
    this.invalidate();
  }

  private handleDataChanged({ deltas }: { deltas: SeriesDelta[] }): void {
    const { renderer } = this;
    if (renderer == null) {
      return;
    }
    // Deltas index into the source's data, so they only line up when the
    // renderer is holding a complete copy of the series
    const applicable = deltas.filter(
      delta => this.seriesStates.get(delta.seriesId)?.complete === true
    );
    if (applicable.length > 0) {
      const { scales } = this;
      renderer.applyDeltas(
        applicable.map(delta =>
          delta.type === 'clear' || delta.type === 'trimStart'
            ? delta
            : { ...delta, data: toPlotSeriesData(delta.data, scales) }
        )
      );
      this.fitHomeToData();
      this.invalidate();
    }
    if (applicable.length < deltas.length) {
      this.scheduleDataRequest();
    }
  }

  private handleSourceError({ error }: { error: unknown }): void {
    log.error('Plot data source error', error);
    this.emit('error', { error });
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const area = this.getPlotArea();
    const rect = this.container.getBoundingClientRect();
    const anchorX = (event.clientX - rect.left - area.left) / area.width;
    const anchorY = 1 - (event.clientY - rect.top - area.top) / area.height;
    const factor = event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.setPlotViewport(
      zoomBounds(
        this.viewport,
        factor,
        Math.min(1, Math.max(0, anchorX)),
        Math.min(1, Math.max(0, anchorY))
      )
    );
  }

  private handlePointerDown(event: PointerEvent): void {
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.container.setPointerCapture(event.pointerId);
    // A tooltip would trail the cursor across the data while panning
    this.setPointer(undefined);
  }

  private handleHoverMove(event: PointerEvent): void {
    if (this.dragOrigin != null) {
      return;
    }
    const rect = this.container.getBoundingClientRect();
    this.setPointer({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  private handlePointerLeave(): void {
    this.setPointer(undefined);
  }

  private setPointer(pointer: { x: number; y: number } | undefined): void {
    if (pointer == null && this.pointer == null) {
      return;
    }
    this.pointer = pointer;
    this.invalidateHover();
  }

  private handlePointerMove(event: PointerEvent): void {
    const { dragOrigin } = this;
    if (dragOrigin == null) {
      return;
    }
    const area = this.getPlotArea();
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.setPlotViewport(
      panBounds(
        this.viewport,
        event.clientX - dragOrigin.x,
        event.clientY - dragOrigin.y,
        { width: area.width, height: area.height }
      )
    );
  }

  private handlePointerUp(event: PointerEvent): void {
    this.dragOrigin = undefined;
    if (this.container.hasPointerCapture(event.pointerId)) {
      this.container.releasePointerCapture(event.pointerId);
    }
  }

  private handleDoubleClick(): void {
    this.resetViewport();
  }

  destroy(): void {
    this.isDestroyed = true;
    this.unobserveTheme?.();
    this.unobserveTheme = undefined;
    this.abortController?.abort();
    if (this.requestTimeout != null) {
      clearTimeout(this.requestTimeout);
      this.requestTimeout = undefined;
    }
    if (this.idleTimeout != null) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = undefined;
    }
    this.resizeObserver?.disconnect();
    this.removeInteractionListeners();
    this.container.removeEventListener('pointermove', this.handleHoverMove);
    this.container.removeEventListener('pointerleave', this.handlePointerLeave);
    this.source.removeEventListener('shapechanged', this.handleShapeChanged);
    this.source.removeEventListener('datachanged', this.handleDataChanged);
    this.source.removeEventListener('error', this.handleSourceError);
    if (this.frame != null) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.axesCanvas.remove();
    this.dataCanvas.remove();
    this.legendCanvas.remove();
    this.hoverCanvas.remove();
    this.removeAllListeners();
  }
}

export default PlotView;
