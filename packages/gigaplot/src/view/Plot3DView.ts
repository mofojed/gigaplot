import Log from '@deephaven/log';
import { PlotEventEmitter } from '../model/PlotEventEmitter';
import type {
  PlotDataSource,
  SeriesDataRequest,
} from '../model/PlotDataSource';
import {
  getSeriesBounds,
  isBounds3D,
  unionBounds,
  type Bounds,
  type Bounds3D,
  type PlotShape,
  type SeriesDelta,
} from '../model/PlotTypes';
import type {
  Plot3DRenderer,
  Plot3DRendererFactory,
} from '../renderers/Plot3DRenderer';
import type { RendererRegistry } from '../renderers/RendererRegistry';
import { defaultRenderer3DRegistry } from '../renderers/defaultRenderer3DRegistry';
import {
  createProjection3D,
  DEFAULT_PLOT_3D_CAMERA,
  type Plot3DCamera,
  type Projection3D,
} from '../scale/projection3d';
import {
  createPlotThemeFromElement,
  plotThemesEqual,
  type PlotTheme,
  type PlotThemeOverrides,
} from '../theme/PlotTheme';
import { observeThemeChanges } from '../theme/observeThemeChanges';
import { Axis3DPainter } from './Axis3DPainter';
import type { PlotArea } from './AxisPainter';
import { Hover3DPainter } from './Hover3DPainter';
import { LegendPainter, type PlotLegendPosition } from './LegendPainter';
import {
  findHover3D,
  hover3DPointsEqual,
  type Plot3DHoverPoint,
} from './hover3d';

const log = Log.module('Plot3DView');

/** The box drawn before any data or bounds have arrived. */
const DEFAULT_BOX: Bounds3D = {
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 1,
  zMin: 0,
  zMax: 1,
};

/** Degrees the camera turns per pixel dragged. */
const ROTATE_DEGREES_PER_PIXEL = 0.5;
const ZOOM_STEP = 1.1;
/** A legend beside the plot never takes more than this share of its width. */
const MAX_LEGEND_WIDTH_FRACTION = 0.4;

/**
 * How points are sized: `fixed` draws every point at its own size, and
 * `perspective` scales them with distance, so nearer points look bigger.
 */
export type Plot3DPointScaling = 'fixed' | 'perspective';

export interface Plot3DViewOptions {
  registry?: RendererRegistry<Plot3DRendererFactory>;
  /** Renderer names in order of preference. Defaults to WebGPU then Canvas. */
  rendererPreference?: readonly string[];
  /** Applied on top of the theme read from the Deephaven chart CSS variables. */
  theme?: PlotThemeOverrides;
  /** Follows page theme switches by re-reading CSS variables. Defaults to true. */
  followCssTheme?: boolean;
  /**
   * Enables dragging to rotate, wheel to zoom, and double click to reset the
   * camera. Defaults to true.
   */
  interactive?: boolean;
  /** Marks the point under the cursor and lists its values. Defaults to true. */
  tooltip?: boolean;
  /** Where to draw the legend. Defaults to `overlay`. */
  legendPosition?: PlotLegendPosition;
  /**
   * Where the camera starts, and returns to on double click. Unset values use
   * {@link DEFAULT_PLOT_3D_CAMERA}, and the distance fits the box in view.
   */
  camera?: Partial<Plot3DCamera>;
  /** Draws the box, its gridlines, and its labels. Defaults to true. */
  showAxes?: boolean;
  /** Defaults to `fixed`. */
  pointScaling?: Plot3DPointScaling;
  /**
   * How much the farthest data fades, from 0, not at all, the default, to 1,
   * fully transparent, so depth reads at a glance.
   */
  depthFade?: number;
}

export interface Plot3DViewEventMap {
  rendererchanged: { name: string };
  shapechanged: { shape: PlotShape };
  themechanged: { theme: PlotTheme };
  /** Fired when the camera rotates or zooms. */
  camerachanged: { camera: Plot3DCamera };
  /** Fired after the renderer has drawn a frame. */
  frame: Record<string, never>;
  /** Fired once the plot has drawn all outstanding data requests. */
  idle: Record<string, never>;
  /** Fired when the point under the cursor changes, including to none. */
  hover: { hover: Plot3DHoverPoint | undefined };
  error: { error: unknown };
}

function resolveCamera(
  camera: Partial<Plot3DCamera> | undefined
): Plot3DCamera {
  return {
    azimuth: camera?.azimuth ?? DEFAULT_PLOT_3D_CAMERA.azimuth,
    elevation: camera?.elevation ?? DEFAULT_PLOT_3D_CAMERA.elevation,
    distance: camera?.distance,
    fov: camera?.fov ?? DEFAULT_PLOT_3D_CAMERA.fov,
  };
}

/**
 * Owns the DOM, the renderer, and the data for one 3D plot of `scatter3d` and
 * `line3d` series. The camera orbits the data's bounding box.
 *
 * Builds the same layers as `PlotView`, with the same `data-dh-plot-*`
 * attributes, and reads any {@link PlotDataSource}. 3D data is not
 * downsampled, so it asks for each series once and then applies the source's
 * deltas, the way `PlotView` treats a complete series.
 *
 * Framework free on purpose. `Plot3D` is a thin React wrapper around this.
 */
export class Plot3DView extends PlotEventEmitter<Plot3DViewEventMap> {
  private container: HTMLElement;

  private source: PlotDataSource;

  private options: Plot3DViewOptions;

  private registry: RendererRegistry<Plot3DRendererFactory>;

  private axesCanvas: HTMLCanvasElement;

  private dataCanvas: HTMLCanvasElement;

  private legendCanvas: HTMLCanvasElement;

  private hoverCanvas: HTMLCanvasElement;

  private axisPainter: Axis3DPainter;

  private legendPainter: LegendPainter;

  private hoverPainter: Hover3DPainter;

  private legendPosition: PlotLegendPosition;

  private renderer: Plot3DRenderer | null = null;

  private theme: PlotTheme;

  private themeOverrides: PlotThemeOverrides | undefined;

  private unobserveTheme: (() => void) | undefined;

  private shape: PlotShape = { series: [] };

  /** Whether the renderer holds every point of each series it has data for. */
  private complete = new Map<string, boolean>();

  /** The box fitted to the data, when the shape gives none. Reset when data changes. */
  private dataBox: Bounds3D | undefined;

  private camera: Plot3DCamera;

  private homeCamera: Plot3DCamera;

  private projection: Projection3D | undefined;

  private width = 0;

  private height = 0;

  private tooltip: boolean;

  private pointer: { x: number; y: number } | undefined;

  private hover: Plot3DHoverPoint | undefined;

  private frame: number | undefined;

  private dirty = false;

  private hoverDirty = false;

  private requestTimeout: ReturnType<typeof setTimeout> | undefined;

  private abortController: AbortController | undefined;

  private requestRevision = 0;

  private pendingRequests = 0;

  private resizeObserver: ResizeObserver | undefined;

  private dragOrigin: { x: number; y: number } | undefined;

  private isDestroyed = false;

  constructor(
    container: HTMLElement,
    source: PlotDataSource,
    options: Plot3DViewOptions = {}
  ) {
    super();
    this.container = container;
    this.source = source;
    this.options = options;
    this.registry = options.registry ?? defaultRenderer3DRegistry;
    this.themeOverrides = options.theme;
    this.theme = createPlotThemeFromElement(container, options.theme);
    this.homeCamera = resolveCamera(options.camera);
    this.camera = this.homeCamera;
    this.tooltip = options.tooltip !== false;
    this.legendPosition = options.legendPosition ?? 'overlay';

    this.container.style.position = 'relative';
    this.container.setAttribute('data-dh-plot-status', 'loading');

    const createLayer = (name: string, isFull: boolean): HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-dh-plot-layer', name);
      canvas.style.position = 'absolute';
      if (isFull) {
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }
      return canvas;
    };
    this.axesCanvas = createLayer('axes', true);
    this.dataCanvas = createLayer('data', false);
    this.legendCanvas = createLayer('legend', true);
    this.legendCanvas.style.pointerEvents = 'none';
    this.hoverCanvas = createLayer('hover', true);
    this.hoverCanvas.style.pointerEvents = 'none';
    this.container.appendChild(this.axesCanvas);
    this.container.appendChild(this.dataCanvas);
    this.container.appendChild(this.legendCanvas);
    this.container.appendChild(this.hoverCanvas);

    this.axisPainter = new Axis3DPainter(this.axesCanvas);
    this.legendPainter = new LegendPainter(this.legendCanvas);
    this.hoverPainter = new Hover3DPainter(this.hoverCanvas);

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
    // Listen before awaiting anything, so a shape or data change while the
    // renderer starts is not lost
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
      this.shape = initialShape;
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

    // The shape may have changed while the renderer was starting
    renderer.setShape(this.shape);
    this.emit('shapechanged', { shape: this.shape });

    this.observeSize();
    this.container.addEventListener('pointermove', this.handleHoverMove);
    this.container.addEventListener('pointerleave', this.handlePointerLeave);
    if (this.options.interactive !== false) {
      this.container.addEventListener('wheel', this.handleWheel, {
        passive: false,
      });
      this.container.addEventListener('pointerdown', this.handlePointerDown);
      this.container.addEventListener('pointermove', this.handlePointerMove);
      this.container.addEventListener('pointerup', this.handlePointerUp);
      this.container.addEventListener('pointercancel', this.handlePointerUp);
      this.container.addEventListener('dblclick', this.handleDoubleClick);
    }
    this.scheduleDataRequest();
  }

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

  getRendererName(): string | undefined {
    return this.renderer?.name;
  }

  getShape(): PlotShape {
    return this.shape;
  }

  getTheme(): PlotTheme {
    return this.theme;
  }

  getCamera(): Plot3DCamera {
    return this.camera;
  }

  /** The projection of the last frame drawn, if any. */
  getProjection(): Projection3D | undefined {
    return this.projection;
  }

  getHover(): Plot3DHoverPoint | undefined {
    return this.hover;
  }

  /**
   * The plot area: the whole container, less a legend beside it. The 3D box
   * is fitted inside with room for its labels, so there are no axis margins.
   */
  getPlotArea(): PlotArea {
    return {
      left: 0,
      top: 0,
      width: Math.max(1, this.width - this.getLegendWidth()),
      height: Math.max(1, this.height),
    };
  }

  private getLegendWidth(): number {
    if (this.legendPosition !== 'right') {
      return 0;
    }
    const width = this.legendPainter.measureWidth(this.shape, this.theme);
    return Math.min(width, Math.floor(this.width * MAX_LEGEND_WIDTH_FRACTION));
  }

  /** The data box the camera orbits: the shape's bounds, or the data's. */
  getBox(): Bounds3D {
    if (isBounds3D(this.shape.bounds)) {
      return this.shape.bounds;
    }
    if (this.dataBox == null) {
      let bounds: Bounds | undefined;
      const { renderer } = this;
      this.shape.series.forEach(series => {
        const data = renderer?.getSeriesData(series.id);
        if (data != null) {
          bounds = unionBounds(bounds, getSeriesBounds(data));
        }
      });
      this.dataBox = isBounds3D(bounds) ? bounds : DEFAULT_BOX;
    }
    return this.dataBox;
  }

  /**
   * Moves the camera. Unset values keep their current value, and the next
   * double click still returns to the starting camera.
   */
  setCamera(camera: Partial<Plot3DCamera>): void {
    this.camera = {
      ...this.camera,
      ...camera,
      elevation: Math.max(
        -90,
        Math.min(90, camera.elevation ?? this.camera.elevation)
      ),
    };
    this.emit('camerachanged', { camera: this.camera });
    this.invalidate();
  }

  /** Returns the camera to where it started. */
  resetCamera(): void {
    this.setCamera({ ...this.homeCamera });
  }

  setTooltip(tooltip: boolean | undefined): void {
    this.tooltip = tooltip !== false;
    this.invalidateHover();
  }

  setLegendPosition(position: PlotLegendPosition | undefined): void {
    const next = position ?? 'overlay';
    if (next === this.legendPosition) {
      return;
    }
    this.legendPosition = next;
    this.layout();
  }

  setTheme(overrides: PlotThemeOverrides | undefined): void {
    this.themeOverrides = overrides;
    this.refreshTheme();
  }

  /** Re-reads the CSS theme and applies it if anything changed. */
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
    this.theme = theme;
    this.renderer?.setTheme(theme);
    this.emit('themechanged', { theme });
    this.layout();
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.layout();
  }

  private layout(): void {
    const { width, height } = this;
    if (width <= 0 || height <= 0) {
      return;
    }
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const area = this.getPlotArea();
    this.axisPainter.resize(width, height, ratio);
    this.legendPainter.resize(width, height, ratio);
    this.hoverPainter.resize(width, height, ratio);
    this.dataCanvas.style.left = `${area.left}px`;
    this.dataCanvas.style.top = `${area.top}px`;
    this.dataCanvas.style.width = `${area.width}px`;
    this.dataCanvas.style.height = `${area.height}px`;
    this.renderer?.resize(area.width, area.height, ratio);
    this.invalidate();
  }

  /** Queues a redraw on the next animation frame. */
  invalidate(): void {
    this.dirty = true;
    this.scheduleFrame();
  }

  private invalidateHover(): void {
    this.hoverDirty = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.frame == null && !this.isDestroyed) {
      this.frame = requestAnimationFrame(this.renderFrame);
    }
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
    if (isHoverDirty) {
      this.renderHover();
    }
  }

  private renderData(): void {
    const { renderer } = this;
    if (renderer == null || this.width <= 0 || this.height <= 0) {
      return;
    }
    const area = this.getPlotArea();
    const projection = createProjection3D({
      bounds: this.getBox(),
      camera: this.camera,
      width: area.width,
      height: area.height,
    });
    this.projection = projection;
    this.axisPainter.paint(
      this.width,
      this.height,
      area,
      projection,
      this.shape,
      this.theme,
      this.options.showAxes !== false
    );
    this.legendPainter.paint(
      this.width,
      this.height,
      area,
      this.shape,
      this.theme,
      this.legendPosition
    );
    renderer.setScene({
      projection,
      perspectivePoints: this.options.pointScaling === 'perspective',
      depthFade: this.options.depthFade ?? 0,
    });
    renderer.render();
    this.emit('frame', {});
  }

  private renderHover(): void {
    const { pointer, renderer, projection } = this;
    let hover: Plot3DHoverPoint | undefined;
    if (
      pointer != null &&
      renderer != null &&
      projection != null &&
      (this.tooltip || this.hasListeners('hover'))
    ) {
      const area = this.getPlotArea();
      hover = findHover3D({
        shape: this.shape,
        projection,
        cursor: { x: pointer.x - area.left, y: pointer.y - area.top },
        theme: this.theme,
        perspectivePoints: this.options.pointScaling === 'perspective',
        getSeriesData: id => renderer.getSeriesData(id),
      });
    }
    const previous = this.hover;
    this.hover = hover;
    if (projection != null) {
      this.hoverPainter.paint({
        width: this.width,
        height: this.height,
        area: this.getPlotArea(),
        projection,
        shape: this.shape,
        theme: this.theme,
        hover,
        isVisible: this.tooltip,
      });
    }
    if (!hover3DPointsEqual(previous, hover)) {
      this.emit('hover', { hover });
    }
  }

  /**
   * Queues a data request. Ticking sources can fire several times in a turn,
   * so they collapse into one.
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

  /** Asks the source for every point of every series. */
  requestData(): void {
    if (this.renderer == null) {
      return;
    }
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.requestRevision += 1;
    const revision = this.requestRevision;
    // 3D data is never downsampled, so the viewport only says what is wanted
    const viewport: Bounds = this.shape.bounds ?? this.getBox();
    const area = this.getPlotArea();

    this.container.setAttribute('data-dh-plot-status', 'loading');
    this.pendingRequests += 1;
    const requests = this.shape.series.map(async descriptor => {
      const request: SeriesDataRequest = {
        seriesId: descriptor.id,
        viewport,
        pixelSize: { width: area.width, height: area.height },
        style: descriptor.style ?? {},
        signal: abortController.signal,
      };
      const result = await this.source.requestSeriesData(request);
      const { renderer } = this;
      if (
        revision === this.requestRevision &&
        !this.isDestroyed &&
        renderer != null
      ) {
        this.complete.set(descriptor.id, result.complete);
        renderer.setSeriesData(descriptor.id, result.data);
        this.dataBox = undefined;
      }
    });

    Promise.all(requests)
      .then(() => {
        if (revision === this.requestRevision) {
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
        if (this.pendingRequests === 0 && !this.isDestroyed) {
          this.container.setAttribute('data-dh-plot-status', 'ready');
          this.emit('idle', {});
        }
      });
  }

  private handleShapeChanged({ shape }: { shape: PlotShape }): void {
    const previousIds = new Set(this.shape.series.map(series => series.id));
    this.shape = shape;
    this.dataBox = undefined;
    const { renderer } = this;
    if (renderer == null) {
      return;
    }
    renderer.setShape(shape);
    this.complete.forEach((_complete, id) => {
      if (!shape.series.some(series => series.id === id)) {
        this.complete.delete(id);
      }
    });
    if (
      shape.series.some(
        series =>
          !previousIds.has(series.id) || this.complete.get(series.id) !== true
      )
    ) {
      this.scheduleDataRequest();
    }
    // A legend beside the plot may need a different width
    if (this.legendPosition === 'right') {
      this.layout();
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
    // renderer holds all of it
    const applicable = deltas.filter(
      delta => this.complete.get(delta.seriesId) === true
    );
    if (applicable.length > 0) {
      renderer.applyDeltas(applicable);
      this.dataBox = undefined;
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
    const distance =
      this.projection?.distance ?? this.camera.distance ?? undefined;
    if (distance == null) {
      return;
    }
    const factor = event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.setCamera({ distance: distance * factor });
  }

  private handlePointerDown(event: PointerEvent): void {
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.container.setPointerCapture(event.pointerId);
    this.setPointer(undefined);
  }

  private handlePointerMove(event: PointerEvent): void {
    const { dragOrigin } = this;
    if (dragOrigin == null) {
      return;
    }
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    // Dragging turns the box the way the cursor moves
    this.setCamera({
      azimuth:
        this.camera.azimuth -
        (event.clientX - dragOrigin.x) * ROTATE_DEGREES_PER_PIXEL,
      elevation:
        this.camera.elevation +
        (event.clientY - dragOrigin.y) * ROTATE_DEGREES_PER_PIXEL,
    });
  }

  private handlePointerUp(event: PointerEvent): void {
    this.dragOrigin = undefined;
    if (this.container.hasPointerCapture(event.pointerId)) {
      this.container.releasePointerCapture(event.pointerId);
    }
  }

  private handleDoubleClick(): void {
    this.resetCamera();
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

  destroy(): void {
    this.isDestroyed = true;
    this.unobserveTheme?.();
    this.unobserveTheme = undefined;
    this.abortController?.abort();
    if (this.requestTimeout != null) {
      clearTimeout(this.requestTimeout);
      this.requestTimeout = undefined;
    }
    this.resizeObserver?.disconnect();
    this.container.removeEventListener('wheel', this.handleWheel);
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerup', this.handlePointerUp);
    this.container.removeEventListener('pointercancel', this.handlePointerUp);
    this.container.removeEventListener('dblclick', this.handleDoubleClick);
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

export default Plot3DView;
