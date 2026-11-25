/// <reference types="@webgpu/types" />
import {
  copySeriesData,
  createSeriesData3D,
  type PlotShape,
  type SeriesData,
  type SeriesDelta,
  type SeriesDescriptor,
} from '../../model/PlotTypes';
import {
  MAX_PERSPECTIVE_POINT_SCALE,
  translateMatrix,
} from '../../scale/projection3d';
import {
  defaultPlotTheme,
  getSeriesColor,
  type PlotTheme,
} from '../../theme/PlotTheme';
import { parseColor } from '../../theme/parseColor';
import type {
  Plot3DRenderer,
  Plot3DRendererFactory,
  Plot3DScene,
} from '../Plot3DRenderer';
import type { PlotRendererCapabilities } from '../PlotRenderer';
import { applyDeltaToSeriesData } from '../applyDeltaToSeriesData';
import {
  DEPTH_FORMAT,
  getSharedWebGpu,
  requestAdapter,
  type SharedWebGpu,
} from './sharedWebGpu';

const CAPABILITIES: PlotRendererCapabilities = {
  seriesTypes: ['scatter3d', 'line3d'],
  incrementalUpdates: true,
};

/** Floats per point in the storage buffer: x, y, z, and 1 if it is drawn. */
const POINT_STRIDE = 4;

/**
 * Floats in the uniform struct: mat4x4 matrix, vec4 color, vec2 resolution,
 * size, referenceDepth, and vec4 fade.
 */
const UNIFORM_FLOAT_COUNT = 28;

const MIN_CAPACITY = 1024;

interface SeriesResources {
  /** CPU mirror, used to re-upload when the GPU buffer has to grow. */
  data: SeriesData;
  /** Positions are stored relative to this point to keep f32 precision usable. */
  origin: [number, number, number];
  buffer: GPUBuffer;
  capacity: number;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

function nextCapacity(required: number): number {
  let capacity = MIN_CAPACITY;
  while (capacity < required) {
    capacity *= 2;
  }
  return capacity;
}

/** The first point whose coordinates are all finite, to measure the others from. */
function findOrigin(data: SeriesData): [number, number, number] {
  const { x, y, z } = data;
  for (let i = 0; i < data.length; i += 1) {
    const zValue = z?.[i] ?? 0;
    if (
      Number.isFinite(x[i]) &&
      Number.isFinite(y[i]) &&
      Number.isFinite(zValue)
    ) {
      return [x[i], y[i], zValue];
    }
  }
  return [0, 0, 0];
}

/**
 * WebGPU renderer for 3D plots, the primary one.
 *
 * Shares the device of every other WebGPU plot through
 * {@link getSharedWebGpu}. Each series owns a storage buffer of points that
 * deltas are written into in place, so a ticking series uploads only what
 * changed, and rotating or zooming only rewrites a uniform.
 */
export class WebGpu3DRenderer implements Plot3DRenderer {
  readonly name = 'webgpu';

  readonly capabilities = CAPABILITIES;

  private shared: SharedWebGpu | null = null;

  private context: GPUCanvasContext | null = null;

  private depthTexture: GPUTexture | null = null;

  private theme: PlotTheme = defaultPlotTheme;

  private descriptors: SeriesDescriptor[] = [];

  private resources = new Map<string, SeriesResources>();

  private scene: Plot3DScene | undefined;

  private width = 0;

  private height = 0;

  private devicePixelRatio = 1;

  private uniformValues = new Float32Array(UNIFORM_FLOAT_COUNT);

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

  private createBuffers(
    seriesId: string,
    capacity: number,
    uniformBuffer?: GPUBuffer
  ): Omit<SeriesResources, 'data' | 'origin'> | undefined {
    const { shared } = this;
    if (shared == null) {
      return undefined;
    }
    const { device, bindGroupLayout } = shared;
    const buffer = device.createBuffer({
      label: `plot3d-points-${seriesId}`,
      size: capacity * POINT_STRIDE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // eslint-disable-line no-bitwise
    });
    const uniforms =
      uniformBuffer ??
      device.createBuffer({
        label: `plot3d-uniforms-${seriesId}`,
        size: UNIFORM_FLOAT_COUNT * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, // eslint-disable-line no-bitwise
      });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer } },
      ],
    });
    return { buffer, capacity, uniformBuffer: uniforms, bindGroup };
  }

  private getResources(seriesId: string): SeriesResources | undefined {
    let resources = this.resources.get(seriesId);
    if (resources == null) {
      const buffers = this.createBuffers(seriesId, MIN_CAPACITY);
      if (buffers == null) {
        return undefined;
      }
      resources = { ...buffers, data: createSeriesData3D(), origin: [0, 0, 0] };
      this.resources.set(seriesId, resources);
    }
    return resources;
  }

  /**
   * Grows the buffer to hold `required` points, discarding its contents.
   *
   * @returns True if the buffer was replaced and must be uploaded again
   */
  private ensureCapacity(
    seriesId: string,
    resources: SeriesResources,
    required: number
  ): boolean {
    if (required <= resources.capacity) {
      return false;
    }
    const buffers = this.createBuffers(
      seriesId,
      nextCapacity(required),
      resources.uniformBuffer
    );
    if (buffers == null) {
      return false;
    }
    resources.buffer.destroy();
    Object.assign(resources, buffers);
    return true;
  }

  /** Writes `count` points starting at `offset` from the CPU mirror to the GPU. */
  private uploadRange(
    resources: SeriesResources,
    offset: number,
    count: number
  ): void {
    const device = this.shared?.device;
    if (device == null || count <= 0) {
      return;
    }
    const { data, origin } = resources;
    const { x, y, z } = data;
    const values = new Float32Array(count * POINT_STRIDE);
    for (let i = 0; i < count; i += 1) {
      const index = offset + i;
      const xValue = x[index] - origin[0];
      const yValue = y[index] - origin[1];
      const zValue = (z?.[index] ?? Number.NaN) - origin[2];
      const isDrawn =
        Number.isFinite(xValue) &&
        Number.isFinite(yValue) &&
        Number.isFinite(zValue);
      const base = i * POINT_STRIDE;
      values[base] = isDrawn ? xValue : 0;
      values[base + 1] = isDrawn ? yValue : 0;
      values[base + 2] = isDrawn ? zValue : 0;
      values[base + 3] = isDrawn ? 1 : 0;
    }
    device.queue.writeBuffer(
      resources.buffer,
      offset * POINT_STRIDE * 4,
      values.buffer,
      values.byteOffset,
      values.byteLength
    );
  }

  private static destroyResources(resources: SeriesResources): void {
    resources.buffer.destroy();
    resources.uniformBuffer.destroy();
  }

  setShape(shape: PlotShape): void {
    this.descriptors = shape.series;
    const ids = new Set(shape.series.map(series => series.id));
    Array.from(this.resources.entries()).forEach(([id, resources]) => {
      if (!ids.has(id)) {
        WebGpu3DRenderer.destroyResources(resources);
        this.resources.delete(id);
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
    resources.origin = findOrigin(resources.data);
    this.ensureCapacity(seriesId, resources, resources.data.length);
    this.uploadRange(resources, 0, resources.data.length);
  }

  applyDeltas(deltas: SeriesDelta[]): void {
    for (let i = 0; i < deltas.length; i += 1) {
      const delta = deltas[i];
      const resources = this.getResources(delta.seriesId);
      if (resources != null) {
        // A trimmed series is uploaded again, as 3D plots rarely roll
        if (
          delta.type === 'replace' ||
          delta.type === 'clear' ||
          delta.type === 'trimStart'
        ) {
          this.setSeriesData(
            delta.seriesId,
            applyDeltaToSeriesData(resources.data, delta)
          );
        } else {
          const offset =
            delta.type === 'append' ? resources.data.length : delta.offset;
          resources.data = applyDeltaToSeriesData(resources.data, delta);
          if (
            this.ensureCapacity(
              delta.seriesId,
              resources,
              resources.data.length
            )
          ) {
            this.uploadRange(resources, 0, resources.data.length);
          } else {
            this.uploadRange(resources, offset, delta.data.length);
          }
        }
      }
    }
  }

  getSeriesData(seriesId: string): SeriesData | undefined {
    return this.resources.get(seriesId)?.data;
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
    const canvas = this.context?.canvas;
    if (canvas != null) {
      canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    }
  }

  /** The depth buffer, recreated whenever the canvas changes size. */
  private getDepthView(texture: GPUTexture): GPUTextureView | undefined {
    const { shared } = this;
    if (shared == null) {
      return undefined;
    }
    const { depthTexture } = this;
    if (
      depthTexture == null ||
      depthTexture.width !== texture.width ||
      depthTexture.height !== texture.height
    ) {
      depthTexture?.destroy();
      this.depthTexture = shared.device.createTexture({
        label: 'plot3d-depth',
        size: { width: texture.width, height: texture.height },
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return this.depthTexture?.createView();
  }

  private writeUniforms(
    resources: SeriesResources,
    scene: Plot3DScene,
    color: string,
    size: number
  ): void {
    const { device } = this.shared as SharedWebGpu;
    const { devicePixelRatio } = this;
    const { projection, perspectivePoints, depthFade } = scene;
    const values = this.uniformValues;
    values.set(translateMatrix(projection.matrix, ...resources.origin), 0);
    const [red, green, blue, alpha] = parseColor(color);
    values[16] = red;
    values[17] = green;
    values[18] = blue;
    values[19] = alpha;
    values[20] = this.width * devicePixelRatio;
    values[21] = this.height * devicePixelRatio;
    values[22] = size * devicePixelRatio;
    values[23] = perspectivePoints ? projection.distance : 0;
    values[24] = projection.depthRange[0];
    values[25] = projection.depthRange[1];
    values[26] = Math.min(1, Math.max(0, depthFade));
    values[27] = size * devicePixelRatio * MAX_PERSPECTIVE_POINT_SCALE;
    device.queue.writeBuffer(resources.uniformBuffer, 0, values);
  }

  render(): void {
    const { context, shared, theme, scene } = this;
    if (context == null || shared == null) {
      return;
    }
    const { device } = shared;
    const texture = context.getCurrentTexture();
    const depthView = this.getDepthView(texture);
    if (depthView == null) {
      return;
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    if (scene != null) {
      const draws: {
        isLine: boolean;
        bindGroup: GPUBindGroup;
        instanceCount: number;
      }[] = [];
      for (let i = 0; i < this.descriptors.length; i += 1) {
        const descriptor = this.descriptors[i];
        const resources = this.resources.get(descriptor.id);
        const { length } = resources?.data ?? { length: 0 };
        const isLine = descriptor.type === 'line3d';
        const instanceCount = isLine ? length - 1 : length;
        const size = isLine
          ? (descriptor.style?.lineWidth ?? theme.lineWidth)
          : (descriptor.style?.pointSize ?? theme.pointSize);
        if (resources != null && instanceCount > 0 && size > 0) {
          const color = getSeriesColor(theme, i, descriptor.style?.color);
          this.writeUniforms(resources, scene, color, size);
          draws.push({ isLine, bindGroup: resources.bindGroup, instanceCount });
        }
      }
      // Every series' depth goes down before any color, so each series is
      // hidden by nearer data in the series drawn after it as well as before
      [true, false].forEach(isDepthPass => {
        draws.forEach(({ isLine, bindGroup, instanceCount }) => {
          if (isLine) {
            pass.setPipeline(
              isDepthPass ? shared.line3DDepthPipeline : shared.line3DPipeline
            );
          } else {
            pass.setPipeline(
              isDepthPass
                ? shared.scatter3DDepthPipeline
                : shared.scatter3DPipeline
            );
          }
          pass.setBindGroup(0, bindGroup);
          pass.draw(4, instanceCount);
        });
      });
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.resources.forEach(WebGpu3DRenderer.destroyResources);
    this.resources.clear();
    this.depthTexture?.destroy();
    this.depthTexture = null;
    this.descriptors = [];
    // The device is shared with every other plot, so only this canvas is released
    this.context?.unconfigure();
    this.context = null;
    this.shared = null;
  }
}

export const webGpu3DRendererFactory: Plot3DRendererFactory = {
  name: 'webgpu',
  capabilities: CAPABILITIES,
  isSupported: async () => (await requestAdapter()) != null,
  create: () => new WebGpu3DRenderer(),
};

export default WebGpu3DRenderer;
