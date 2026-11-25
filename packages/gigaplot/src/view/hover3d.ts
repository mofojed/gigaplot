import type { PlotSeriesType, PlotShape, SeriesData } from '../model/PlotTypes';
import {
  clipToPixel,
  getPointSizeAtDepth,
  isClipVisible,
  transformPoint,
  type Projection3D,
} from '../scale/projection3d';
import { getSeriesColor, type PlotTheme } from '../theme/PlotTheme';

/** The data point under the cursor of a 3D plot. */
export interface Plot3DHoverPoint {
  seriesId: string;
  /** Index of the series in the shape, which picks its colorway color. */
  seriesIndex: number;
  /** Index of the point in the data the renderer holds. */
  index: number;
  name: string;
  type: PlotSeriesType;
  color: string;
  x: number;
  y: number;
  z: number;
  /** Where the point is drawn, in pixels from the top left of the plot area. */
  screenX: number;
  screenY: number;
  /** Diameter the point is drawn at, in pixels. */
  size: number;
}

export interface Hover3DHitTestInput {
  shape: PlotShape;
  projection: Projection3D;
  /** Cursor position in pixels from the top left of the plot area. */
  cursor: { x: number; y: number };
  theme: PlotTheme;
  perspectivePoints: boolean;
  getSeriesData: (seriesId: string) => SeriesData | undefined;
}

/**
 * Finds the point drawn under the cursor. A point is under it within half its
 * drawn size plus the theme's `hoverDistance`, and line vertices within half
 * the line's width plus that. Where several are, the nearest the cursor wins,
 * then the nearest the camera, since it is drawn on top.
 *
 * A linear scan of every point, like 2D hover, which costs about the same as
 * the Canvas renderer drawing them.
 */
export function findHover3D({
  shape,
  projection,
  cursor,
  theme,
  perspectivePoints,
  getSeriesData,
}: Hover3DHitTestInput): Plot3DHoverPoint | undefined {
  const clip = new Float64Array(4);
  const { matrix, width, height, distance } = projection;
  let best: Plot3DHoverPoint | undefined;
  let bestDistance = Infinity;
  let bestDepth = Infinity;
  for (let s = 0; s < shape.series.length; s += 1) {
    const descriptor = shape.series[s];
    const data = getSeriesData(descriptor.id);
    const z = data?.z;
    if (data != null && z != null) {
      const isLine = descriptor.type === 'line3d';
      const size = isLine
        ? (descriptor.style?.lineWidth ?? theme.lineWidth)
        : (descriptor.style?.pointSize ?? theme.pointSize);
      for (let i = 0; i < data.length; i += 1) {
        transformPoint(matrix, data.x[i], data.y[i], z[i], clip);
        if (isClipVisible(clip)) {
          const [px, py] = clipToPixel(clip, width, height);
          const drawn = isLine
            ? size
            : getPointSizeAtDepth(size, clip[3], distance, perspectivePoints);
          const offset = Math.hypot(px - cursor.x, py - cursor.y);
          const depth = clip[3];
          if (
            offset <= drawn / 2 + theme.hoverDistance &&
            (offset < bestDistance - 0.5 ||
              (offset <= bestDistance + 0.5 && depth < bestDepth))
          ) {
            bestDistance = offset;
            bestDepth = depth;
            best = {
              seriesId: descriptor.id,
              seriesIndex: s,
              index: i,
              name: descriptor.name,
              type: descriptor.type,
              color: getSeriesColor(theme, s, descriptor.style?.color),
              x: data.x[i],
              y: data.y[i],
              z: z[i],
              screenX: px,
              screenY: py,
              size: drawn,
            };
          }
        }
      }
    }
  }
  return best;
}

/** True if both refer to the same point with the same values. */
export function hover3DPointsEqual(
  a: Plot3DHoverPoint | undefined,
  b: Plot3DHoverPoint | undefined
): boolean {
  if (a == null || b == null) {
    return a === b;
  }
  return (
    a.seriesId === b.seriesId &&
    a.index === b.index &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z
  );
}
