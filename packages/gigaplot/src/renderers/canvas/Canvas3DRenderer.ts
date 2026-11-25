import {
  copySeriesData,
  type PlotShape,
  type SeriesData,
  type SeriesDelta,
  type SeriesDescriptor,
} from '../../model/PlotTypes';
import {
  clipToPixel,
  getDepthFadeOpacity,
  getPointSizeAtDepth,
  isClipVisible,
  transformPoint,
} from '../../scale/projection3d';
import {
  defaultPlotTheme,
  getSeriesColor,
  type PlotTheme,
} from '../../theme/PlotTheme';
import type {
  Plot3DRenderer,
  Plot3DRendererFactory,
  Plot3DScene,
} from '../Plot3DRenderer';
import type { PlotRendererCapabilities } from '../PlotRenderer';
import { applyDeltaToSeriesData } from '../applyDeltaToSeriesData';

const CAPABILITIES: PlotRendererCapabilities = {
  seriesTypes: ['scatter3d', 'line3d'],
  incrementalUpdates: false,
};

/** Depth faded opacity is rounded to this many levels, so items batch into paths. */
const OPACITY_LEVELS = 32;

const KIND_POINT = 0;
const KIND_SEGMENT = 1;

/**
 * Clips the segment from `a` to `b`, in clip space, to the near plane, writing
 * the visible part to `start` and `end`.
 *
 * @returns False if the segment is entirely behind the camera or not finite
 */
export function clipSegment(
  a: Float64Array,
  b: Float64Array,
  start: Float64Array,
  end: Float64Array
): boolean {
  for (let i = 0; i < 4; i += 1) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      return false;
    }
  }
  // Clip space z runs from 0 at the near plane, so negative is behind it
  if (a[2] < 0 && b[2] < 0) {
    return false;
  }
  start.set(a);
  end.set(b);
  if (a[2] < 0) {
    const t = a[2] / (a[2] - b[2]);
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-param-reassign
      start[i] = a[i] + (b[i] - a[i]) * t;
    }
  } else if (b[2] < 0) {
    const t = b[2] / (b[2] - a[2]);
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-param-reassign
      end[i] = b[i] + (a[i] - b[i]) * t;
    }
  }
  return start[3] > 0 && end[3] > 0;
}

/**
 * Canvas 2D renderer for 3D plots. Projects every point on the CPU and paints
 * points and line segments back to front, which stands in for a depth buffer.
 * It exists so 3D plots work everywhere, and as the reference for what the
 * WebGPU renderer should draw.
 */
export class Canvas3DRenderer implements Plot3DRenderer {
  readonly name = 'canvas';

  readonly capabilities = CAPABILITIES;

  private canvas: HTMLCanvasElement | null = null;

  private context: CanvasRenderingContext2D | null = null;

  private theme: PlotTheme = defaultPlotTheme;

  private descriptors: SeriesDescriptor[] = [];

  private data = new Map<string, SeriesData>();

  private scene: Plot3DScene | undefined;

  private width = 0;

  private height = 0;

  private devicePixelRatio = 1;

  async initialize(canvas: HTMLCanvasElement, theme: PlotTheme): Promise<void> {
    const context = canvas.getContext('2d');
    if (context == null) {
      throw new Error('Unable to acquire a 2d canvas context');
    }
    this.canvas = canvas;
    this.context = context;
    this.theme = theme;
  }

  setShape(shape: PlotShape): void {
    this.descriptors = shape.series;
    const ids = new Set(shape.series.map(series => series.id));
    Array.from(this.data.keys()).forEach(id => {
      if (!ids.has(id)) {
        this.data.delete(id);
      }
    });
  }

  setSeriesData(seriesId: string, data: SeriesData): void {
    // Sources may hand back their own arrays, so keep a private copy
    this.data.set(seriesId, copySeriesData(data));
  }

  applyDeltas(deltas: SeriesDelta[]): void {
    for (let i = 0; i < deltas.length; i += 1) {
      const delta = deltas[i];
      if (delta.type === 'replace') {
        this.setSeriesData(delta.seriesId, delta.data);
      } else {
        this.data.set(
          delta.seriesId,
          applyDeltaToSeriesData(this.data.get(delta.seriesId), delta)
        );
      }
    }
  }

  getSeriesData(seriesId: string): SeriesData | undefined {
    return this.data.get(seriesId);
  }

  setScene(scene: Plot3DScene): void {
    this.scene = scene;
  }

  setTheme(theme: PlotTheme): void {
    this.theme = theme;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.devicePixelRatio = devicePixelRatio;
    const { canvas, context } = this;
    if (canvas == null || context == null) {
      return;
    }
    canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  render(): void {
    const { context, scene, width, height, theme } = this;
    if (context == null) {
      return;
    }
    context.setTransform(
      this.devicePixelRatio,
      0,
      0,
      this.devicePixelRatio,
      0,
      0
    );
    context.clearRect(0, 0, width, height);
    if (scene == null) {
      return;
    }
    const { projection, perspectivePoints, depthFade } = scene;
    const { matrix, distance, depthRange } = projection;

    let capacity = 0;
    const series = this.descriptors.map(descriptor => {
      const data = this.data.get(descriptor.id);
      const z = data?.z;
      const count = data == null || z == null ? 0 : data.length;
      capacity += count;
      return { descriptor, data, count };
    });
    if (capacity === 0) {
      return;
    }

    const kind = new Uint8Array(capacity);
    const seriesIndex = new Uint16Array(capacity);
    const depth = new Float64Array(capacity);
    const ax = new Float32Array(capacity);
    const ay = new Float32Array(capacity);
    const bx = new Float32Array(capacity);
    const by = new Float32Array(capacity);
    const radius = new Float32Array(capacity);
    const opacity = new Float32Array(capacity);
    let count = 0;

    const a = new Float64Array(4);
    const b = new Float64Array(4);
    const start = new Float64Array(4);
    const end = new Float64Array(4);
    for (let s = 0; s < series.length; s += 1) {
      const { descriptor, data } = series[s];
      const z = data?.z;
      if (data != null && z != null) {
        const { x, y } = data;
        if (descriptor.type === 'scatter3d') {
          const size = descriptor.style?.pointSize ?? theme.pointSize;
          for (let i = 0; i < data.length; i += 1) {
            transformPoint(matrix, x[i], y[i], z[i], a);
            if (isClipVisible(a)) {
              const [px, py] = clipToPixel(a, width, height);
              kind[count] = KIND_POINT;
              seriesIndex[count] = s;
              depth[count] = a[3];
              ax[count] = px;
              ay[count] = py;
              radius[count] =
                getPointSizeAtDepth(size, a[3], distance, perspectivePoints) /
                2;
              opacity[count] = getDepthFadeOpacity(a[3], depthRange, depthFade);
              count += 1;
            }
          }
        } else if (descriptor.type === 'line3d') {
          const lineWidth = descriptor.style?.lineWidth ?? theme.lineWidth;
          transformPoint(matrix, x[0], y[0], z[0], b);
          for (let i = 1; i < data.length; i += 1) {
            a.set(b);
            transformPoint(matrix, x[i], y[i], z[i], b);
            if (lineWidth > 0 && clipSegment(a, b, start, end)) {
              kind[count] = KIND_SEGMENT;
              seriesIndex[count] = s;
              depth[count] = (start[3] + end[3]) / 2;
              const [startX, startY] = clipToPixel(start, width, height);
              const [endX, endY] = clipToPixel(end, width, height);
              ax[count] = startX;
              ay[count] = startY;
              bx[count] = endX;
              by[count] = endY;
              radius[count] = lineWidth;
              opacity[count] = getDepthFadeOpacity(
                depth[count],
                depthRange,
                depthFade
              );
              count += 1;
            }
          }
        }
      }
    }

    const order = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) {
      order[i] = i;
    }
    // Farthest first, so nearer data paints over it
    order.sort((left, right) => depth[right] - depth[left]);

    const colors = series.map(({ descriptor }, s) =>
      getSeriesColor(theme, s, descriptor.style?.color)
    );
    context.lineCap = 'round';
    let batchKey = -1;
    let batchKind = KIND_POINT;
    const flush = (): void => {
      if (batchKey < 0) {
        return;
      }
      if (batchKind === KIND_POINT) {
        context.fill();
      } else {
        context.stroke();
      }
    };
    for (let o = 0; o < count; o += 1) {
      const i = order[o];
      const level = Math.round(opacity[i] * OPACITY_LEVELS);
      // eslint-disable-next-line no-mixed-operators
      const key = (seriesIndex[i] * (OPACITY_LEVELS + 1) + level) * 2 + kind[i];
      if (level > 0) {
        if (key !== batchKey) {
          flush();
          batchKey = key;
          batchKind = kind[i];
          context.globalAlpha = level / OPACITY_LEVELS;
          context.beginPath();
          if (batchKind === KIND_POINT) {
            context.fillStyle = colors[seriesIndex[i]];
          } else {
            context.strokeStyle = colors[seriesIndex[i]];
            context.lineWidth = radius[i];
          }
        }
        if (kind[i] === KIND_POINT) {
          context.moveTo(ax[i] + radius[i], ay[i]);
          context.arc(ax[i], ay[i], radius[i], 0, Math.PI * 2);
        } else {
          context.moveTo(ax[i], ay[i]);
          context.lineTo(bx[i], by[i]);
        }
      }
    }
    flush();
    context.globalAlpha = 1;
  }

  destroy(): void {
    this.data.clear();
    this.descriptors = [];
    this.scene = undefined;
    this.context = null;
    this.canvas = null;
  }
}

export const canvas3DRendererFactory: Plot3DRendererFactory = {
  name: 'canvas',
  capabilities: CAPABILITIES,
  isSupported: async () => typeof document !== 'undefined',
  create: () => new Canvas3DRenderer(),
};

export default Canvas3DRenderer;
