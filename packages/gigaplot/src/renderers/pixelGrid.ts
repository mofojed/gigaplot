import type { Bounds } from '../model/PlotTypes';
import type { SeriesResolution } from './PlotRenderer';

/**
 * Zooming in less than this past a series' resolution still draws it sharp, so
 * float noise at the data's own resolution does not pixelate it.
 */
export const STALE_STRETCH_THRESHOLD = 1.001;

export interface PixelGridAxis {
  /** A pixel boundary, in data units. */
  origin: number;
  /** Data units per device pixel. */
  size: number;
}

export interface PixelGrid {
  x: PixelGridAxis;
  y: PixelGridAxis;
}

/**
 * The coarse device pixel grid to draw a series on while the viewport is
 * zoomed in past the resolution its data was made for, or `undefined` to draw
 * it sharp on the screen's own pixels.
 *
 * Pixelation follows x, the downsampled axis. Y takes the resolution's pixels
 * where they are coarser than the screen's, so lines thicken with the zoom.
 */
export function getStalePixelGrid(
  resolution: SeriesResolution | undefined,
  viewport: Bounds,
  width: number,
  height: number,
  devicePixelRatio: number
): PixelGrid | undefined {
  if (resolution == null) {
    return undefined;
  }
  const xScreen = (viewport.xMax - viewport.xMin) / (width * devicePixelRatio);
  const yScreen = (viewport.yMax - viewport.yMin) / (height * devicePixelRatio);
  const xData = resolution.xPerPixel / devicePixelRatio;
  const yData = resolution.yPerPixel / devicePixelRatio;
  if (
    !(xScreen > 0) ||
    !(yScreen > 0) ||
    !Number.isFinite(xData) ||
    !(xData > xScreen * STALE_STRETCH_THRESHOLD)
  ) {
    return undefined;
  }
  return {
    x: { origin: resolution.xOrigin, size: xData },
    y:
      Number.isFinite(yData) && yData > yScreen
        ? { origin: resolution.yOrigin, size: yData }
        : { origin: viewport.yMin, size: yScreen },
  };
}
