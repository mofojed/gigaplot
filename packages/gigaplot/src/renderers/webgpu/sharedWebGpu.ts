/// <reference types="@webgpu/types" />
import Log from '@deephaven/log';
import {
  AREA_FILL_SHADER,
  AREA_LINE_SHADER,
  LINE_SHADER,
  OHLC_SHADER,
  SCATTER_SHADER,
} from './shaders';
import { LINE_3D_SHADER, SCATTER_3D_SHADER } from './shaders3d';

const log = Log.module('sharedWebGpu');

/** Depth buffer format of the 3D pipelines. */
export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export interface SharedWebGpu {
  device: GPUDevice;
  format: GPUTextureFormat;
  bindGroupLayout: GPUBindGroupLayout;
  scatterPipeline: GPURenderPipeline;
  linePipeline: GPURenderPipeline;
  /** Draws both `ohlc` and `candlestick` series. */
  ohlcPipeline: GPURenderPipeline;
  /** The line along the top of an `area` series. */
  areaLinePipeline: GPURenderPipeline;
  /** The bind group layout plus the fill uniforms at binding 2. */
  fillBindGroupLayout: GPUBindGroupLayout;
  areaFillPipeline: GPURenderPipeline;
  /** Writes the depth of the opaque part of `scatter3d` points, and no color. */
  scatter3DDepthPipeline: GPURenderPipeline;
  /** Draws `scatter3d` points, depth tested against what the depth pass wrote. */
  scatter3DPipeline: GPURenderPipeline;
  /** Writes the depth of the opaque part of `line3d` segments, and no color. */
  line3DDepthPipeline: GPURenderPipeline;
  /** Draws `line3d` segments, depth tested against what the depth pass wrote. */
  line3DPipeline: GPURenderPipeline;
}

let sharedPromise: Promise<SharedWebGpu> | undefined;

function createPipelines(
  device: GPUDevice,
  format: GPUTextureFormat
): Omit<SharedWebGpu, 'device' | 'format'> {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, // eslint-disable-line no-bitwise
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });
  const fillBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, // eslint-disable-line no-bitwise
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const fillLayout = device.createPipelineLayout({
    bindGroupLayouts: [fillBindGroupLayout],
  });

  const blend: GPUBlendState = {
    // Fragment shaders output premultiplied alpha
    color: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
    alpha: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
  };

  const shaderModules = new Map<string, GPUShaderModule>();
  const createPipeline = (
    code: string,
    pipelineLayout = layout,
    {
      depthStencil,
      fragmentEntry = 'fragmentMain',
      isColorWritten = true,
    }: {
      depthStencil?: GPUDepthStencilState;
      fragmentEntry?: string;
      isColorWritten?: boolean;
    } = {}
  ): GPURenderPipeline => {
    let shaderModule = shaderModules.get(code);
    if (shaderModule == null) {
      shaderModule = device.createShaderModule({ code });
      shaderModules.set(code, shaderModule);
    }
    return device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: {
        module: shaderModule,
        entryPoint: fragmentEntry,
        targets: [{ format, blend, writeMask: isColorWritten ? 0xf : 0 }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil,
    });
  };

  // 3D data is drawn twice: once writing the depth of its opaque pixels, then
  // in color tested against it. Less or equal, so what wrote the depth draws.
  const depthPass = {
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
    fragmentEntry: 'depthMain',
    isColorWritten: false,
  } as const;
  const colorPass = {
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
  } as const;

  return {
    bindGroupLayout,
    scatterPipeline: createPipeline(SCATTER_SHADER),
    linePipeline: createPipeline(LINE_SHADER),
    ohlcPipeline: createPipeline(OHLC_SHADER),
    areaLinePipeline: createPipeline(AREA_LINE_SHADER),
    fillBindGroupLayout,
    areaFillPipeline: createPipeline(AREA_FILL_SHADER, fillLayout),
    scatter3DDepthPipeline: createPipeline(
      SCATTER_3D_SHADER,
      layout,
      depthPass
    ),
    scatter3DPipeline: createPipeline(SCATTER_3D_SHADER, layout, colorPass),
    line3DDepthPipeline: createPipeline(LINE_3D_SHADER, layout, depthPass),
    line3DPipeline: createPipeline(LINE_3D_SHADER, layout, colorPass),
  };
}

/**
 * Requests an adapter, falling back to a software one.
 *
 * Plenty of otherwise capable browsers return null for the default adapter,
 * usually because the GPU is blocklisted or the browser was started without GPU
 * access. A software adapter still beats having no WebGPU at all.
 */
export async function requestAdapter(): Promise<GPUAdapter | null> {
  if (typeof navigator === 'undefined' || navigator.gpu == null) {
    return null;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter != null) {
    return adapter;
  }
  return navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
}

async function createShared(): Promise<SharedWebGpu> {
  const adapter = await requestAdapter();
  if (adapter == null) {
    throw new Error(
      'WebGPU is not available: the browser returned no GPU adapter'
    );
  }
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();

  device.lost
    .then(info => {
      log.warn('WebGPU device lost', info.reason, info.message);
      // Drop the cache so the next plot builds a fresh device
      sharedPromise = undefined;
    })
    .catch(error => log.error('Error waiting on device loss', error));

  // Validation errors are asynchronous, so without this they vanish silently
  device.addEventListener('uncapturederror', event => {
    log.error('WebGPU error', (event as GPUUncapturedErrorEvent).error.message);
  });

  return { device, format, ...createPipelines(device, format) };
}

/**
 * Resolves the one device, shader modules, and pipelines that every WebGPU plot
 * on the page shares.
 *
 * Sharing is what lets a page hold many plots at once. WebGL caps a document at
 * roughly 8-16 live contexts and silently drops the oldest beyond that, whereas
 * WebGPU canvas contexts are cheap views onto a single device. Sharing also
 * means shaders are compiled once rather than once per plot.
 */
export function getSharedWebGpu(): Promise<SharedWebGpu> {
  if (sharedPromise == null) {
    sharedPromise = createShared().catch(error => {
      sharedPromise = undefined;
      throw error;
    });
  }
  return sharedPromise;
}

/** Drops the cached device. Exposed for tests; plots never need to call it. */
export function resetSharedWebGpu(): void {
  sharedPromise = undefined;
}
