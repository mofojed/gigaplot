/// <reference types="@webgpu/types" />
import {
  copySeriesData,
  createSeriesData,
  isOhlcSeriesData,
  isOhlcSeriesType,
  type Bounds,
  type PlotSeriesType,
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
import { parseColor } from '../../theme/parseColor';
import type {
  PlotRenderer,
  PlotRendererCapabilities,
  PlotRendererFactory,
  SeriesResolution,
} from '../PlotRenderer';
import { applyDeltaToSeriesData } from '../applyDeltaToSeriesData';
import { limitFillStops, MAX_FILL_STOPS, resolveAreaFill } from '../areaFill';
import { getOhlcBarSpacing, getOhlcHalfBarWidth } from '../ohlcBars';
import { getStalePixelGrid } from '../pixelGrid';
import {
  getSharedWebGpu,
  requestAdapter,
  type SharedWebGpu,
} from './sharedWebGpu';

const CAPABILITIES: PlotRendererCapabilities = {
  seriesTypes: ['scatter', 'line', 'area', 'ohlc', 'candlestick'],
  incrementalUpdates: true,
};

/** Floats per point in the storage buffer: x and y. */
const POINT_STRIDE = 2;

/** Floats per bar in the storage buffer: x, open, high, low, and close. */
const BAR_STRIDE = 5;

/** Floats per area point in the storage buffer: x, y, and base. */
const AREA_STRIDE = 3;

/**
 * Floats in the fill uniform struct: 16 vec4 stop colors, 4 vec4 of stop
 * offsets, vec4 gradient, and vec4 options.
 */
const FILL_UNIFORM_FLOAT_COUNT = MAX_FILL_STOPS * 4 + MAX_FILL_STOPS + 8;

/**
 * Area fills are drawn under every line, as plotly does, so a stacked area
 * does not cover the line of the one below.
 */
type Layer = 'fill' | 'data';

/**
 * Floats in the uniform struct: vec4 viewport, vec4 color, vec2 resolution,
 * size, snap, vec4 grid, vec4 decreasingColor, vec4 bar.
 */
const UNIFORM_FLOAT_COUNT = 24;

const MIN_CAPACITY = 1024;

interface SeriesResources {
  /** CPU mirror, used to re-upload when the GPU buffer has to grow. */
  data: SeriesData;
  /** Positions are stored relative to this point to keep f32 precision usable. */
  origin: { x: number; y: number };
  buffer: GPUBuffer;
  capacity: number;
  /**
   * Index in `buffer` of the first point. Trimming the front of a series
   * advances it rather than moving any data, and appends land after the end.
   */
  start: number;
  /** Floats per point in `buffer`: {@link POINT_STRIDE}, {@link BAR_STRIDE}, or {@link AREA_STRIDE}. */
  stride: number;
  /** Smallest x gap between bars, which sizes them. Only kept for bar data. */
  barSpacing?: number;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  /** Gradient stops of an area's fill, created when it is first filled. */
  fillUniformBuffer?: GPUBuffer;
  /** Binds the fill uniforms too. Dropped whenever `buffer` is replaced. */
  fillBindGroup?: GPUBindGroup;
  /** Number of points already uploaded to the GPU. */
  uploadedLength: number;
  /** Pixel grid the data was downsampled for, if any. */
  resolution?: SeriesResolution;
}

interface RetainedSeries {
  resources: SeriesResources;
  opacity: number;
}

function nextCapacity(required: number): number {
  let capacity = MIN_CAPACITY;
  while (capacity < required) {
    capacity *= 2;
  }
  return capacity;
}

/**
 * The origin positions are uploaded relative to: the first finite point, so
 * a series starting with a gap is not made all NaN by subtracting it.
 */
function getOrigin(data: SeriesData): { x: number; y: number } {
  const first = (values: ArrayLike<number>): number => {
    for (let i = 0; i < data.length; i += 1) {
      if (Number.isFinite(values[i])) {
        return values[i];
      }
    }
    return 0;
  };
  return { x: first(data.x), y: first(data.y) };
}

/** Bars are sized by their smallest x gap, which any change to them can move. */
function updateBarSpacing(resources: SeriesResources): void {
  // eslint-disable-next-line no-param-reassign
  resources.barSpacing = isOhlcSeriesData(resources.data)
    ? getOhlcBarSpacing(resources.data)
    : undefined;
}

/**
 * WebGPU renderer. This is the primary renderer for the package.
 *
 * Each series owns a storage buffer of points. Deltas are written straight into
 * that buffer at the relevant offset, so appending to a streaming series costs
 * one `writeBuffer` of just the new points rather than a full re-upload.
 * Trimming the front only moves where drawing starts, so a rolling window
 * uploads just the points it gains. Pan and zoom only change a uniform, so no
 * point data moves at all.
 *
 * The device and pipelines come from {@link getSharedWebGpu}, so a page can
 * hold many plots without running into the context limits that cap WebGL.
 */
export class WebGpuRenderer implements PlotRenderer {
  readonly name = 'webgpu';

  readonly capabilities = CAPABILITIES;

  private shared: SharedWebGpu | null = null;

  private context: GPUCanvasContext | null = null;

  private theme: PlotTheme = defaultPlotTheme;

  private descriptors: SeriesDescriptor[] = [];

  /** Picks the buffer layout of each series' data. */
  private seriesTypes = new Map<string, PlotSeriesType>();

  private resources = new Map<string, SeriesResources>();

  /** Data kept to fade out under the data that replaced it. */
  private retained = new Map<string, RetainedSeries>();

  private viewport: Bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

  private width = 0;

  private height = 0;

  private devicePixelRatio = 1;

  private uniformValues = new Float32Array(UNIFORM_FLOAT_COUNT);

  private fillUniformValues = new Float32Array(FILL_UNIFORM_FLOAT_COUNT);

  async initialize(canvas: HTMLCanvasElement, theme: PlotTheme): Promise<void> {
    this.theme = theme;

    const shared = await getSharedWebGpu();
    const context = canvas.getContext('webgpu');
    if (context == null) {
      throw new Error('Unable to acquire a webgpu canvas context');
    }

    this.shared = shared;
    this.context = context;
    context.configure({
      device: shared.device,
      format: shared.format,
      alphaMode: 'premultiplied',
    });
  }

  private createResources(
    seriesId: string,
    capacity: number
  ): SeriesResources | undefined {
    const { shared } = this;
    if (shared == null) {
      return undefined;
    }
    const { device, bindGroupLayout } = shared;
    const buffer = device.createBuffer({
      label: `plot-points-${seriesId}`,
      size: capacity * POINT_STRIDE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // eslint-disable-line no-bitwise
    });
    const uniformBuffer = device.createBuffer({
      label: `plot-uniforms-${seriesId}`,
      size: UNIFORM_FLOAT_COUNT * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, // eslint-disable-line no-bitwise
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer } },
      ],
    });
    return {
      data: createSeriesData(),
      origin: { x: 0, y: 0 },
      buffer,
      capacity,
      start: 0,
      stride: POINT_STRIDE,
      uniformBuffer,
      bindGroup,
      uploadedLength: 0,
    };
  }

  private getResources(seriesId: string): SeriesResources | undefined {
    let resources = this.resources.get(seriesId);
    if (resources == null) {
      resources = this.createResources(seriesId, MIN_CAPACITY);
      if (resources != null) {
        this.resources.set(seriesId, resources);
      }
    }
    return resources;
  }

  /* eslint-disable no-param-reassign -- these update the caller's resource record in place */
  /** Writes `count` points starting at `offset` from the CPU mirror into the GPU buffer. */
  private uploadRange(
    resources: SeriesResources,
    offset: number,
    count: number
  ): void {
    const device = this.shared?.device;
    if (device == null || count <= 0) {
      return;
    }
    const { data, origin, stride } = resources;
    const values = new Float32Array(count * stride);
    if (stride === BAR_STRIDE && isOhlcSeriesData(data)) {
      for (let i = 0; i < count; i += 1) {
        const index = offset + i;
        const base = i * BAR_STRIDE;
        values[base] = data.x[index] - origin.x;
        values[base + 1] = data.open[index] - origin.y;
        values[base + 2] = data.high[index] - origin.y;
        values[base + 3] = data.low[index] - origin.y;
        values[base + 4] = data.y[index] - origin.y;
      }
    } else if (stride === AREA_STRIDE) {
      for (let i = 0; i < count; i += 1) {
        const index = offset + i;
        values[i * 3] = data.x[index] - origin.x;
        values[i * 3 + 1] = data.y[index] - origin.y;
        values[i * 3 + 2] = (data.base?.[index] ?? 0) - origin.y;
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        values[i * 2] = data.x[offset + i] - origin.x;
        values[i * 2 + 1] = data.y[offset + i] - origin.y;
      }
    }
    device.queue.writeBuffer(
      resources.buffer,
      (resources.start + offset) * stride * 4,
      values.buffer,
      values.byteOffset,
      values.byteLength
    );
    resources.uploadedLength = Math.max(
      resources.uploadedLength,
      offset + count
    );
  }

  /**
   * Grows the buffer to hold `required` points of `stride` floats, discarding
   * its contents. Changing stride, between bars and points, always reallocates.
   *
   * @returns True if the buffer was replaced and must be uploaded again
   */
  private ensureCapacity(
    resources: SeriesResources,
    required: number,
    stride = resources.stride
  ): boolean {
    const { shared } = this;
    if (
      shared == null ||
      (required <= resources.capacity && stride === resources.stride)
    ) {
      return false;
    }
    const { device } = shared;
    const capacity = nextCapacity(required);
    resources.buffer.destroy();
    const buffer = device.createBuffer({
      size: capacity * stride * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // eslint-disable-line no-bitwise
    });
    resources.buffer = buffer;
    resources.capacity = capacity;
    resources.start = 0;
    resources.stride = stride;
    resources.uploadedLength = 0;
    resources.fillBindGroup = undefined;
    resources.bindGroup = device.createBindGroup({
      layout: shared.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer } },
        { binding: 1, resource: { buffer } },
      ],
    });
    return true;
  }

  /**
   * Uploads the whole series again from the front of the buffer, growing it
   * if it has to. A series that has been trimmed is a rolling window, so it is
   * given room for as many points again, which makes the next move at least
   * that many appends away and keeps the cost per point constant.
   */
  private relayout(resources: SeriesResources, stride: number): void {
    const { data } = resources;
    const isRolling = resources.start > 0;
    this.ensureCapacity(
      resources,
      isRolling ? data.length * 2 : data.length,
      stride
    );
    resources.start = 0;
    resources.uploadedLength = 0;
    // Re-baselining keeps a window that has rolled far from losing precision
    resources.origin = getOrigin(data);
    this.uploadRange(resources, 0, data.length);
  }
  /* eslint-enable no-param-reassign */

  private static destroyResources(resources: SeriesResources): void {
    resources.buffer.destroy();
    resources.uniformBuffer.destroy();
    resources.fillUniformBuffer?.destroy();
  }

  /** Bars are laid out by their data, and areas by their type, since a base is optional. */
  private getStride(seriesId: string, data: SeriesData): number {
    if (isOhlcSeriesData(data)) {
      return BAR_STRIDE;
    }
    return this.seriesTypes.get(seriesId) === 'area'
      ? AREA_STRIDE
      : POINT_STRIDE;
  }

  setShape(shape: PlotShape): void {
    this.descriptors = shape.series;
    this.seriesTypes = new Map(
      shape.series.map(series => [series.id, series.type])
    );
    const ids = new Set(shape.series.map(series => series.id));
    Array.from(this.resources.entries()).forEach(([id, resources]) => {
      if (!ids.has(id)) {
        WebGpuRenderer.destroyResources(resources);
        this.resources.delete(id);
      }
    });
    Array.from(this.retained.entries()).forEach(([id, retained]) => {
      if (!ids.has(id)) {
        WebGpuRenderer.destroyResources(retained.resources);
        this.retained.delete(id);
      }
    });
  }

  setSeriesData(seriesId: string, data: SeriesData): void {
    const resources = this.getResources(seriesId);
    if (resources == null) {
      return;
    }
    // Sources may hand back their own arrays, so keep a private copy to mutate
    resources.data = copySeriesData(data);
    // Re-baseline the origin whenever the whole series is replaced
    resources.origin = getOrigin(data);
    const isBars = isOhlcSeriesData(resources.data);
    resources.barSpacing = isBars
      ? getOhlcBarSpacing(resources.data)
      : undefined;
    resources.start = 0;
    this.ensureCapacity(
      resources,
      resources.data.length,
      this.getStride(seriesId, resources.data)
    );
    resources.uploadedLength = 0;
    this.uploadRange(resources, 0, resources.data.length);
  }

  applyDeltas(deltas: SeriesDelta[]): void {
    for (let i = 0; i < deltas.length; i += 1) {
      const delta = deltas[i];
      const resources = this.getResources(delta.seriesId);
      if (resources == null) {
        return;
      }
      if (delta.type === 'replace' || delta.type === 'clear') {
        this.setSeriesData(
          delta.seriesId,
          applyDeltaToSeriesData(resources.data, delta)
        );
      } else if (delta.type === 'trimStart') {
        const before = resources.data.length;
        resources.data = applyDeltaToSeriesData(resources.data, delta);
        const removed = before - resources.data.length;
        // The points stay in the buffer; drawing just starts after them
        resources.start =
          resources.data.length > 0 ? resources.start + removed : 0;
        resources.uploadedLength = Math.max(
          0,
          resources.uploadedLength - removed
        );
        updateBarSpacing(resources);
      } else {
        const offset =
          delta.type === 'append' ? resources.data.length : delta.offset;
        resources.data = applyDeltaToSeriesData(resources.data, delta);
        updateBarSpacing(resources);
        const stride = this.getStride(delta.seriesId, resources.data);
        // Bars arriving into a buffer laid out for points are laid out again
        if (
          stride !== resources.stride ||
          resources.start + resources.data.length > resources.capacity
        ) {
          this.relayout(resources, stride);
        } else {
          this.uploadRange(resources, offset, delta.data.length);
        }
      }
    }
  }

  setViewport(viewport: Bounds): void {
    this.viewport = viewport;
  }

  getSeriesData(seriesId: string): SeriesData | undefined {
    // Retaining hands the current data over until its replacement arrives
    return (
      this.resources.get(seriesId)?.data ??
      this.retained.get(seriesId)?.resources.data
    );
  }

  setSeriesResolution(
    seriesId: string,
    resolution: SeriesResolution | undefined
  ): void {
    const resources = this.resources.get(seriesId);
    if (resources != null) {
      resources.resolution = resolution;
    }
  }

  retainSeriesData(seriesId: string): void {
    const current = this.resources.get(seriesId);
    if (current == null) {
      return;
    }
    // Swap buffers rather than copy: the retained data keeps the current ones,
    // and the next data is written into whatever was retained before
    const previous = this.retained.get(seriesId);
    this.retained.set(seriesId, { resources: current, opacity: 1 });
    if (previous != null) {
      previous.resources.data = createSeriesData();
      previous.resources.uploadedLength = 0;
      previous.resources.start = 0;
      previous.resources.resolution = undefined;
      this.resources.set(seriesId, previous.resources);
    } else {
      this.resources.delete(seriesId);
    }
  }

  setRetainedSeriesOpacity(seriesId: string, opacity: number): void {
    const retained = this.retained.get(seriesId);
    if (retained == null) {
      return;
    }
    if (opacity > 0) {
      retained.opacity = opacity;
    } else {
      WebGpuRenderer.destroyResources(retained.resources);
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
    const canvas = this.context?.canvas;
    if (canvas != null) {
      canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    }
  }

  private writeUniforms(
    resources: SeriesResources,
    color: string,
    size: number,
    opacity: number,
    bar?: { halfWidth: number; isCandlestick: boolean }
  ): void {
    const { device } = this.shared as SharedWebGpu;
    const { viewport, devicePixelRatio, theme } = this;
    const values = this.uniformValues;
    const [red, green, blue, alpha] = parseColor(color);
    const deviceWidth = this.width * devicePixelRatio;
    const deviceHeight = this.height * devicePixelRatio;
    const grid = getStalePixelGrid(
      resources.resolution,
      viewport,
      this.width,
      this.height,
      devicePixelRatio
    );
    values[0] = viewport.xMin - resources.origin.x;
    values[1] = viewport.xMax - resources.origin.x;
    values[2] = viewport.yMin - resources.origin.y;
    values[3] = viewport.yMax - resources.origin.y;
    values[4] = red;
    values[5] = green;
    values[6] = blue;
    values[7] = alpha * opacity;
    values[8] = deviceWidth;
    values[9] = deviceHeight;
    values[10] = size * devicePixelRatio;
    values[11] = grid != null ? 1 : 0;
    values[12] = (grid?.x.origin ?? viewport.xMin) - resources.origin.x;
    values[13] = grid?.x.size ?? (viewport.xMax - viewport.xMin) / deviceWidth;
    values[14] = (grid?.y.origin ?? viewport.yMin) - resources.origin.y;
    values[15] = grid?.y.size ?? (viewport.yMax - viewport.yMin) / deviceHeight;
    const [downRed, downGreen, downBlue, downAlpha] = parseColor(
      theme.ohlcDecreasingColor
    );
    values[16] = downRed;
    values[17] = downGreen;
    values[18] = downBlue;
    values[19] = downAlpha * opacity;
    values[20] = bar?.halfWidth ?? 0;
    values[21] = bar?.isCandlestick === true ? 1 : 0;
    values[22] = 0;
    values[23] = 0;
    device.queue.writeBuffer(resources.uniformBuffer, 0, values);
  }

  /**
   * Writes the gradient of an area's fill, creating its uniform buffer and
   * bind group the first time.
   */
  /* eslint-disable no-param-reassign -- fill resources are created on demand */
  private writeFillUniforms(
    resources: SeriesResources,
    descriptor: SeriesDescriptor,
    color: string,
    opacity: number
  ): GPUBindGroup {
    const { device, fillBindGroupLayout } = this.shared as SharedWebGpu;
    const { theme, viewport } = this;
    if (resources.fillUniformBuffer == null) {
      resources.fillUniformBuffer = device.createBuffer({
        label: `plot-fill-${descriptor.id}`,
        size: FILL_UNIFORM_FLOAT_COUNT * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, // eslint-disable-line no-bitwise
      });
      resources.fillBindGroup = undefined;
    }
    if (resources.fillBindGroup == null) {
      resources.fillBindGroup = device.createBindGroup({
        layout: fillBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: resources.uniformBuffer } },
          { binding: 1, resource: { buffer: resources.buffer } },
          { binding: 2, resource: { buffer: resources.fillUniformBuffer } },
        ],
      });
    }
    const fill = resolveAreaFill(
      descriptor.style?.fill,
      color,
      theme.areaFillOpacity,
      viewport
    );
    const stops = limitFillStops(fill.stops);
    const values = this.fillUniformValues;
    values.fill(0);
    const offsetsStart = MAX_FILL_STOPS * 4;
    stops.forEach((stop, i) => {
      values.set(stop.color, i * 4);
      values[offsetsStart + i] = stop.offset;
    });
    const gradientStart = offsetsStart + MAX_FILL_STOPS;
    const origin = fill.axis === 'y' ? resources.origin.y : resources.origin.x;
    values[gradientStart] = stops.length;
    values[gradientStart + 1] = fill.axis === 'y' ? 1 : 0;
    values[gradientStart + 2] = fill.start - origin;
    values[gradientStart + 3] = fill.end - origin;
    values[gradientStart + 4] = opacity;
    device.queue.writeBuffer(resources.fillUniformBuffer, 0, values);
    return resources.fillBindGroup;
  }
  /* eslint-enable no-param-reassign */

  private drawSeries(
    pass: GPURenderPassEncoder,
    descriptor: SeriesDescriptor,
    resources: SeriesResources,
    color: string,
    opacity: number,
    layer: Layer
  ): void {
    const { shared, theme } = this;
    const { type } = descriptor;
    if (shared == null || (layer === 'fill' && type !== 'area')) {
      return;
    }
    const size =
      type === 'scatter'
        ? (descriptor.style?.pointSize ?? theme.pointSize)
        : (descriptor.style?.lineWidth ?? theme.lineWidth);
    if (type === 'area') {
      const segmentCount = resources.data.length - 1;
      // Data laid out for another type has not been replaced yet
      if (resources.stride !== AREA_STRIDE || segmentCount <= 0) {
        return;
      }
      this.writeUniforms(resources, color, size, opacity);
      if (layer === 'fill') {
        const bindGroup = this.writeFillUniforms(
          resources,
          descriptor,
          color,
          opacity
        );
        pass.setPipeline(shared.areaFillPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(4, segmentCount, 0, resources.start);
      } else if (size > 0) {
        pass.setPipeline(shared.areaLinePipeline);
        pass.setBindGroup(0, resources.bindGroup);
        pass.draw(4, segmentCount, 0, resources.start);
      }
      return;
    }
    if (isOhlcSeriesType(type)) {
      // Bar data has not arrived yet, so there is nothing this pipeline can read
      if (resources.stride !== BAR_STRIDE) {
        return;
      }
      const isCandlestick = type === 'candlestick';
      const { length } = resources.data;
      if (length <= 0) {
        return;
      }
      const { viewport } = this;
      this.writeUniforms(resources, theme.ohlcIncreasingColor, size, opacity, {
        halfWidth: getOhlcHalfBarWidth(
          resources.barSpacing,
          theme,
          (viewport.xMax - viewport.xMin) / Math.max(1, this.width)
        ),
        isCandlestick,
      });
      pass.setPipeline(shared.ohlcPipeline);
      pass.setBindGroup(0, resources.bindGroup);
      const parts = isCandlestick ? 2 : 3;
      pass.draw(4, length * parts, 0, resources.start * parts);
      return;
    }
    // Points are read as pairs, so bar data cannot be drawn as points
    if (resources.stride !== POINT_STRIDE) {
      return;
    }
    const isLine = type === 'line';
    const instanceCount = isLine
      ? resources.data.length - 1
      : resources.data.length;
    if (instanceCount <= 0) {
      return;
    }
    this.writeUniforms(resources, color, size, opacity);
    pass.setPipeline(isLine ? shared.linePipeline : shared.scatterPipeline);
    pass.setBindGroup(0, resources.bindGroup);
    // Instance indexes start at the first live point of a trimmed series
    pass.draw(4, instanceCount, 0, resources.start);
  }

  render(): void {
    const { context, shared, theme } = this;
    if (context == null || shared == null) {
      return;
    }
    const { device } = shared;

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    const { viewport } = this;
    const hasSpan =
      viewport.xMax > viewport.xMin && viewport.yMax > viewport.yMin;
    const layers: Layer[] = hasSpan ? ['fill', 'data'] : [];
    layers.forEach(layer => {
      for (let i = 0; i < this.descriptors.length; i += 1) {
        const descriptor = this.descriptors[i];
        const color = getSeriesColor(theme, i, descriptor.style?.color);
        const retained = this.retained.get(descriptor.id);
        if (retained != null) {
          this.drawSeries(
            pass,
            descriptor,
            retained.resources,
            color,
            retained.opacity,
            layer
          );
        }
        const resources = this.resources.get(descriptor.id);
        if (resources != null) {
          this.drawSeries(pass, descriptor, resources, color, 1, layer);
        }
      }
    });

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.resources.forEach(WebGpuRenderer.destroyResources);
    this.resources.clear();
    this.retained.forEach(retained =>
      WebGpuRenderer.destroyResources(retained.resources)
    );
    this.retained.clear();
    this.descriptors = [];
    // The device is shared with every other plot, so only this canvas is released
    this.context?.unconfigure();
    this.context = null;
    this.shared = null;
  }
}

export const webGpuRendererFactory: PlotRendererFactory = {
  name: 'webgpu',
  capabilities: CAPABILITIES,
  isSupported: async () => (await requestAdapter()) != null,
  create: () => new WebGpuRenderer(),
};

export default WebGpuRenderer;
