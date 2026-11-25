import type { PlotShape, SeriesData, SeriesDelta } from '../model/PlotTypes';
import type { Projection3D } from '../scale/projection3d';
import type { PlotTheme } from '../theme/PlotTheme';
import type { PlotRendererCapabilities } from './PlotRenderer';

/** Everything about the view a 3D renderer needs to draw a frame. */
export interface Plot3DScene {
  projection: Projection3D;
  /**
   * Scales points with their distance from the camera, as a perspective camera
   * would see them, rather than drawing every point at its own size.
   */
  perspectivePoints: boolean;
  /**
   * How much the farthest points and lines fade, from 0, not at all, to 1,
   * fully transparent, falling off linearly from the nearest corner of the box.
   */
  depthFade: number;
}

/**
 * Draws `scatter3d` and `line3d` series into a canvas covering the plot area.
 *
 * Like a 2D {@link PlotRenderer}, it draws data only. The box, its gridlines,
 * and its labels are drawn by `Axis3DPainter`, on a layer underneath.
 */
export interface Plot3DRenderer {
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
   * The data the renderer currently draws for a series, deltas applied, for
   * hit testing hover and fitting the box. Read only.
   */
  getSeriesData: (seriesId: string) => SeriesData | undefined;

  setScene: (scene: Plot3DScene) => void;

  setTheme: (theme: PlotTheme) => void;

  resize: (width: number, height: number, devicePixelRatio: number) => void;

  render: () => void;

  destroy: () => void;
}

export interface Plot3DRendererFactory {
  readonly name: string;
  readonly capabilities: PlotRendererCapabilities;
  /** Resolves false when the platform cannot run this renderer. */
  isSupported: () => Promise<boolean>;
  create: () => Plot3DRenderer;
}
