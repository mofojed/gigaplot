import type {
  Bounds,
  PlotSeriesType,
  PlotShape,
  SeriesData,
  SeriesDelta,
} from '../model/PlotTypes';
import type { PlotTheme } from '../theme/PlotTheme';

export interface PlotRendererCapabilities {
  /** Series types this renderer knows how to draw. */
  seriesTypes: readonly PlotSeriesType[];
  /**
   * True when `applyDeltas` updates only the changed points. Renderers that
   * return false still accept deltas, they just redraw everything.
   */
  incrementalUpdates: boolean;
}

/**
 * A grid of CSS pixels in data units, such as the one a downsampled series was
 * made for. Pixel boundaries fall at `origin + n * perPixel` on each axis.
 */
export interface SeriesResolution {
  xOrigin: number;
  xPerPixel: number;
  yOrigin: number;
  yPerPixel: number;
}

/**
 * Draws series into a canvas.
 *
 * A renderer only ever draws the data area. Axes, gridlines, and labels are
 * drawn by the shared `AxisPainter` so every renderer looks identical outside
 * the data itself.
 */
export interface PlotRenderer {
  readonly name: string;
  readonly capabilities: PlotRendererCapabilities;

  initialize: (canvas: HTMLCanvasElement, theme: PlotTheme) => Promise<void>;

  /** Declares the series to draw. Existing data for series still present is kept. */
  setShape: (shape: PlotShape) => void;

  /** Replaces all data for a series. */
  setSeriesData: (seriesId: string, data: SeriesData) => void;

  /** Applies incremental changes. May fall back to a full redraw. */
  applyDeltas: (deltas: SeriesDelta[]) => void;

  /**
   * The region the plot area shows. A series drawn against axes besides the
   * primary ones has a region of its own, by id in `seriesViewports`, in the
   * units of its axes; every other series uses `viewport`.
   */
  setViewport: (
    viewport: Bounds,
    seriesViewports?: ReadonlyMap<string, Bounds>
  ) => void;

  /**
   * The pixel grid a downsampled series' data was made for. While the viewport
   * is zoomed in past it, such as before more detailed data has arrived, the
   * series is drawn the way its frame at that resolution would look scaled up
   * like an image: blocky and thick, but in place, so the detail can fill in
   * without anything jumping. `undefined`, the default, always draws sharp, as
   * do renderers that omit this.
   */
  setSeriesResolution?: (
    seriesId: string,
    resolution: SeriesResolution | undefined
  ) => void;

  /**
   * Keeps drawing the series' current data, at its current resolution, under
   * whatever `setSeriesData` replaces it with, so the old data can fade out as
   * the new data arrives. Retaining again replaces what was kept.
   */
  retainSeriesData?: (seriesId: string) => void;

  /** Opacity of the data kept by `retainSeriesData`. 0 releases it. */
  setRetainedSeriesOpacity?: (seriesId: string, opacity: number) => void;

  /**
   * The data the renderer currently draws for a series, deltas applied, for
   * hit testing hover. Read only: it is the renderer's own copy. Renderers
   * that omit this get no tooltips.
   */
  getSeriesData?: (seriesId: string) => SeriesData | undefined;

  setTheme: (theme: PlotTheme) => void;

  resize: (width: number, height: number, devicePixelRatio: number) => void;

  render: () => void;

  destroy: () => void;
}

export interface PlotRendererFactory {
  readonly name: string;
  readonly capabilities: PlotRendererCapabilities;
  /** Resolves false when the platform cannot run this renderer. */
  isSupported: () => Promise<boolean>;
  create: () => PlotRenderer;
}
