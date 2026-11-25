import type {
  AxisTick,
  AxisTickGenerator,
  PlotShape,
} from '../model/PlotTypes';
import {
  clipToPixel,
  isClipVisible,
  transformPoint,
  type Projection3D,
} from '../scale/projection3d';
import { linearTicks } from '../scale/ticks';
import type { PlotTheme } from '../theme/PlotTheme';
import type { PlotArea } from './AxisPainter';

/** Roughly how far apart ticks are along an edge, in pixels. */
const TICK_SPACING = 80;
const MIN_TICKS = 2;
const MAX_TICKS = 8;

/** A point in the cube from -1 to 1 on each axis. */
type CubePoint = [number, number, number];

/** Axis titles shown when the shape names none, so the axes can be told apart. */
const DEFAULT_TITLES = ['x', 'y', 'z'] as const;

/**
 * Draws the box of a 3D plot: the walls behind the data with their gridlines,
 * the edges around them, and tick labels and titles along an outside edge of
 * each axis. Painted on the layer under the data, so the walls never cover it.
 */
export class Axis3DPainter {
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
   * @param showAxes False draws only the background, for plots like a star
   *   field where the box would get in the way
   */
  paint(
    width: number,
    height: number,
    area: PlotArea,
    projection: Projection3D,
    shape: PlotShape,
    theme: PlotTheme,
    showAxes: boolean
  ): void {
    const { context } = this;
    if (context == null) {
      return;
    }
    context.clearRect(0, 0, width, height);
    context.fillStyle = theme.backgroundColor;
    context.fillRect(0, 0, width, height);
    if (!showAxes) {
      return;
    }

    const clip = new Float64Array(4);
    const { bounds } = projection;
    const mins = [bounds.xMin, bounds.yMin, bounds.zMin];
    const maxes = [bounds.xMax, bounds.yMax, bounds.zMax];
    // Box corners are projected from data space, the same way the data is
    const project = (point: CubePoint): [number, number] | undefined => {
      transformPoint(
        projection.matrix,
        mins[0] + ((point[0] + 1) / 2) * (maxes[0] - mins[0]),
        mins[1] + ((point[1] + 1) / 2) * (maxes[1] - mins[1]),
        mins[2] + ((point[2] + 1) / 2) * (maxes[2] - mins[2]),
        clip
      );
      if (!isClipVisible(clip)) {
        return undefined;
      }
      const [x, y] = clipToPixel(clip, area.width, area.height);
      return [area.left + x, area.top + y];
    };

    const generators: AxisTickGenerator[] = [
      shape.xAxisTicks ?? linearTicks,
      shape.yAxisTicks ?? linearTicks,
      shape.zAxisTicks ?? linearTicks,
    ];
    const ticks = [0, 1, 2].map(axis => {
      // Sized by the axis' longest projected edge, so labels do not crowd
      const edge = Axis3DPainter.getEdges(axis).reduce((longest, [a, b]) => {
        const start = project(a);
        const end = project(b);
        return start == null || end == null
          ? longest
          : Math.max(longest, Math.hypot(end[0] - start[0], end[1] - start[1]));
      }, 0);
      const count = Math.min(
        MAX_TICKS,
        Math.max(MIN_TICKS, Math.round(edge / TICK_SPACING))
      );
      return generators[axis](mins[axis], maxes[axis], count).filter(
        tick => tick.value >= mins[axis] && tick.value <= maxes[axis]
      );
    });
    const toCube = (axis: number, value: number): number =>
      ((value - mins[axis]) / (maxes[axis] - mins[axis])) * 2 - 1;

    // A wall is behind the data when the camera is on its inner side
    const { eye } = projection;
    for (let axis = 0; axis < 3; axis += 1) {
      for (let side = -1; side <= 1; side += 2) {
        if (side * eye[axis] < 1) {
          this.paintWall(axis, side, project, ticks, toCube, theme);
        }
      }
    }

    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    const center = project([0, 0, 0]);
    const titles = [shape.xAxisLabel, shape.yAxisLabel, shape.zAxisLabel];
    for (let axis = 0; axis < 3; axis += 1) {
      const edge = Axis3DPainter.pickLabelEdge(axis, project);
      if (edge != null && center != null) {
        this.paintAxisLabels(
          axis,
          edge,
          center,
          ticks[axis],
          project,
          toCube,
          titles[axis] ?? DEFAULT_TITLES[axis],
          theme
        );
      }
    }
  }

  /** The four edges of the cube running along `axis`. */
  private static getEdges(axis: number): [CubePoint, CubePoint][] {
    const edges: [CubePoint, CubePoint][] = [];
    const [first, second] = [0, 1, 2].filter(other => other !== axis);
    for (let a = -1; a <= 1; a += 2) {
      for (let b = -1; b <= 1; b += 2) {
        const start: CubePoint = [0, 0, 0];
        const end: CubePoint = [0, 0, 0];
        start[first] = a;
        end[first] = a;
        start[second] = b;
        end[second] = b;
        start[axis] = -1;
        end[axis] = 1;
        edges.push([start, end]);
      }
    }
    return edges;
  }

  /**
   * The edge to label an axis along. Horizontal axes are labelled along their
   * lowest edge on screen and the vertical axis along its leftmost, which are
   * always on the outline of the box, so labels sit outside it.
   */
  private static pickLabelEdge(
    axis: number,
    project: (point: CubePoint) => [number, number] | undefined
  ): [CubePoint, CubePoint] | undefined {
    let best: [CubePoint, CubePoint] | undefined;
    let bestScore = -Infinity;
    Axis3DPainter.getEdges(axis).forEach(edge => {
      const start = project(edge[0]);
      const end = project(edge[1]);
      if (start != null && end != null) {
        const score = axis === 2 ? -(start[0] + end[0]) : start[1] + end[1];
        if (score > bestScore) {
          bestScore = score;
          best = edge;
        }
      }
    });
    return best;
  }

  private paintWall(
    axis: number,
    side: number,
    project: (point: CubePoint) => [number, number] | undefined,
    ticks: AxisTick[][],
    toCube: (axis: number, value: number) => number,
    theme: PlotTheme
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const [first, second] = [0, 1, 2].filter(other => other !== axis);
    const corner = (a: number, b: number): CubePoint => {
      const point: CubePoint = [0, 0, 0];
      point[axis] = side;
      point[first] = a;
      point[second] = b;
      return point;
    };
    const corners = [
      corner(-1, -1),
      corner(1, -1),
      corner(1, 1),
      corner(-1, 1),
    ].map(project);
    if (corners.some(point => point == null)) {
      return;
    }
    const outline = corners as [number, number][];
    context.beginPath();
    outline.forEach(([x, y], i) =>
      i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
    );
    context.closePath();
    context.fillStyle = theme.plotBackgroundColor;
    context.fill();

    context.beginPath();
    const line = (start: CubePoint, end: CubePoint): void => {
      const a = project(start);
      const b = project(end);
      if (a != null && b != null) {
        context.moveTo(a[0], a[1]);
        context.lineTo(b[0], b[1]);
      }
    };
    ticks[first].forEach(tick => {
      const value = toCube(first, tick.value);
      line(corner(value, -1), corner(value, 1));
    });
    ticks[second].forEach(tick => {
      const value = toCube(second, tick.value);
      line(corner(-1, value), corner(1, value));
    });
    context.strokeStyle = theme.gridColor;
    context.lineWidth = theme.gridLineWidth;
    context.stroke();

    context.beginPath();
    outline.forEach(([x, y], i) =>
      i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
    );
    context.closePath();
    context.strokeStyle = theme.axisColor;
    context.lineWidth = theme.axisLineWidth;
    context.stroke();
  }

  private paintAxisLabels(
    axis: number,
    [start, end]: [CubePoint, CubePoint],
    center: [number, number],
    ticks: AxisTick[],
    project: (point: CubePoint) => [number, number] | undefined,
    toCube: (axis: number, value: number) => number,
    title: string,
    theme: PlotTheme
  ): void {
    const context = this.context as CanvasRenderingContext2D;
    const middle: CubePoint = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ];
    const midpoint = project(middle);
    if (midpoint == null) {
      return;
    }
    // Labels are pushed away from the middle of the box, so they sit outside it
    let dx = midpoint[0] - center[0];
    let dy = midpoint[1] - center[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      return;
    }
    dx /= length;
    dy /= length;
    context.textAlign = Axis3DPainter.getTextAlign(dx);
    context.textBaseline = Axis3DPainter.getTextBaseline(dy);

    const offset = theme.tickLabelPadding + 2;
    let widest = 0;
    context.font = `${theme.fontSize}px ${theme.fontFamily}`;
    context.fillStyle = theme.tickLabelColor;
    ticks.forEach(tick => {
      const point: CubePoint = [...start];
      point[axis] = toCube(axis, tick.value);
      const position = project(point);
      if (position != null) {
        context.fillText(
          tick.label,
          position[0] + dx * offset,
          position[1] + dy * offset
        );
        widest = Math.max(widest, context.measureText(tick.label).width);
      }
    });

    if (title === '') {
      return;
    }
    // Clear of the labels whichever way they extend from the edge
    const labelExtent = Math.abs(dx) * widest + Math.abs(dy) * theme.fontSize;
    const titleOffset =
      offset + labelExtent + theme.axisTitlePadding * 2 + theme.fontSize / 2;
    context.font = `${theme.axisTitleFontSize}px ${theme.fontFamily}`;
    context.fillStyle = theme.axisTitleColor;
    context.fillText(
      title,
      midpoint[0] + dx * titleOffset,
      midpoint[1] + dy * titleOffset
    );
  }

  private static getTextAlign(dx: number): CanvasTextAlign {
    if (dx > 0.3) {
      return 'left';
    }
    return dx < -0.3 ? 'right' : 'center';
  }

  private static getTextBaseline(dy: number): CanvasTextBaseline {
    if (dy > 0.3) {
      return 'top';
    }
    return dy < -0.3 ? 'bottom' : 'middle';
  }
}

export default Axis3DPainter;
