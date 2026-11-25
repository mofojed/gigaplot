import type { SeriesData } from '../../model/PlotTypes';
import { seriesDataFromArrays } from '../../model/PlotTypes';
import { defaultPlotTheme } from '../../theme/PlotTheme';
import { getSharedWebGpu } from './sharedWebGpu';
import { WebGpuRenderer } from './WebGpuRenderer';

jest.mock('./sharedWebGpu', () => ({
  getSharedWebGpu: jest.fn(),
  requestAdapter: jest.fn(),
}));

/**
 * jsdom has no WebGPU, so these drive the renderer against a fake device that
 * records the point uploads and draw calls, to check where data lands in the
 * storage buffer and which instances are drawn from it.
 */
class FakeBuffer {
  destroyed = false;

  constructor(
    readonly size: number,
    readonly label = ''
  ) {}

  destroy(): void {
    this.destroyed = true;
  }
}

interface PointWrite {
  buffer: FakeBuffer;
  /** First point written, from the byte offset. */
  index: number;
  values: number[];
}

interface Draw {
  instanceCount: number;
  firstInstance: number;
}

const STRIDE = 2;

let writes: PointWrite[];
let draws: Draw[];

function isPointBuffer(buffer: FakeBuffer): boolean {
  return (
    !buffer.label.startsWith('plot-uniforms') &&
    !buffer.label.startsWith('plot-fill')
  );
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).GPUBufferUsage = {
    STORAGE: 128,
    COPY_DST: 8,
    UNIFORM: 64,
  };
});

beforeEach(() => {
  writes = [];
  draws = [];
  const pass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    draw: (
      _vertexCount: number,
      instanceCount: number,
      _firstVertex = 0,
      firstInstance = 0
    ) => draws.push({ instanceCount, firstInstance }),
    end: jest.fn(),
  };
  const device = {
    createBuffer: ({ size, label }: { size: number; label?: string }) =>
      new FakeBuffer(size, label),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (
        buffer: FakeBuffer,
        offset: number,
        data: ArrayBuffer,
        dataOffset = 0,
        size?: number
      ) => {
        if (!isPointBuffer(buffer)) {
          return;
        }
        const floats = new Float32Array(
          data,
          dataOffset,
          (size ?? data.byteLength) / 4
        );
        writes.push({
          buffer,
          index: offset / 4 / STRIDE,
          values: Array.from(floats),
        });
      },
      submit: jest.fn(),
    },
  };
  (getSharedWebGpu as jest.Mock).mockResolvedValue({
    device,
    format: 'bgra8unorm',
    bindGroupLayout: {},
    fillBindGroupLayout: {},
    scatterPipeline: 'scatter',
    linePipeline: 'line',
    ohlcPipeline: 'ohlc',
    areaLinePipeline: 'areaLine',
    areaFillPipeline: 'areaFill',
  });
});

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_unused, i) => start + i);
}

function series(xs: number[]): SeriesData {
  return seriesDataFromArrays(
    xs,
    xs.map(x => x * 10)
  );
}

async function createRenderer(type: 'line' | 'scatter' = 'line') {
  const context = {
    configure: jest.fn(),
    unconfigure: jest.fn(),
    getCurrentTexture: () => ({ createView: () => ({}) }),
    canvas: { width: 0, height: 0 },
  };
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const renderer = new WebGpuRenderer();
  await renderer.initialize(canvas, defaultPlotTheme);
  renderer.resize(100, 100, 1);
  renderer.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
  renderer.setShape({ series: [{ id: 'a', name: 'A', type }] });
  return renderer;
}

/** Appends `count` points after `last` and trims as many, like a rolling window. */
function roll(renderer: WebGpuRenderer, last: number, count: number): void {
  renderer.applyDeltas([
    { type: 'append', seriesId: 'a', data: series(range(last + 1, count)) },
    { type: 'trimStart', seriesId: 'a', count },
  ]);
}

it('trims by drawing from later in the buffer, without moving data', async () => {
  const renderer = await createRenderer();
  renderer.setSeriesData('a', series(range(0, 4)));
  writes = [];

  roll(renderer, 3, 2);

  // Only the two new points are uploaded, after the four already there
  expect(writes).toHaveLength(1);
  expect(writes[0].index).toBe(4);
  expect(writes[0].values).toEqual([4, 40, 5, 50]);

  renderer.render();
  // Four points left make three segments, starting after the two trimmed
  expect(draws).toEqual([{ instanceCount: 3, firstInstance: 2 }]);
  const data = renderer.getSeriesData('a') as SeriesData;
  expect(Array.from(data.x.subarray(0, data.length))).toEqual([2, 3, 4, 5]);
});

it('draws scatter points from the first one kept', async () => {
  const renderer = await createRenderer('scatter');
  renderer.setSeriesData('a', series(range(0, 5)));
  renderer.applyDeltas([{ type: 'trimStart', seriesId: 'a', count: 3 }]);
  renderer.render();
  expect(draws).toEqual([{ instanceCount: 2, firstInstance: 3 }]);
});

it('lays a rolling window out again rarely, with room to roll', async () => {
  const renderer = await createRenderer();
  const length = 1000;
  renderer.setSeriesData('a', series(range(0, length)));
  writes = [];

  // The buffer starts at 1024 points, so the window soon reaches its end
  let last = length - 1;
  for (let i = 0; i < 100; i += 1) {
    roll(renderer, last, 10);
    last += 10;
  }

  const fullUploads = writes.filter(write => write.values.length > 20);
  expect(fullUploads).toHaveLength(1);
  const [relayout] = fullUploads;
  // The tick's append runs past the end, before its trim
  const laidOut = length + 10;
  expect(relayout.index).toBe(0);
  expect(relayout.values).toHaveLength(laidOut * STRIDE);
  // The new buffer leaves as much room again as the window holds
  expect(relayout.buffer.size).toBeGreaterThanOrEqual(2 * laidOut * STRIDE * 4);
  // Positions are re-baselined on the first point kept
  expect(relayout.values.slice(0, 4)).toEqual([0, 0, 1, 10]);

  // One upload per tick: the relayout stood in for its tick's append
  expect(writes).toHaveLength(100);

  renderer.render();
  const data = renderer.getSeriesData('a') as SeriesData;
  expect(data.length).toBe(length);
  expect(data.x[0]).toBe(last - length + 1);
  const [draw] = draws;
  expect(draw.instanceCount).toBe(length - 1);
  // Drawing starts at the first point kept since the relayout
  const lastWrite = writes[writes.length - 1];
  expect(draw.firstInstance + length).toBe(lastWrite.index + 10);
});

it('starts from the front of the buffer when data is replaced', async () => {
  const renderer = await createRenderer();
  renderer.setSeriesData('a', series(range(0, 10)));
  renderer.applyDeltas([{ type: 'trimStart', seriesId: 'a', count: 4 }]);
  renderer.applyDeltas([
    { type: 'replace', seriesId: 'a', data: series(range(0, 3)) },
  ]);
  renderer.render();
  expect(draws).toEqual([{ instanceCount: 2, firstInstance: 0 }]);
});

it('starts from the front of the buffer once trimmed to empty', async () => {
  const renderer = await createRenderer();
  renderer.setSeriesData('a', series(range(0, 3)));
  renderer.applyDeltas([{ type: 'trimStart', seriesId: 'a', count: 5 }]);
  writes = [];
  renderer.applyDeltas([
    { type: 'append', seriesId: 'a', data: series(range(10, 2)) },
  ]);
  expect(writes[0].index).toBe(0);
  renderer.render();
  expect(draws).toEqual([{ instanceCount: 1, firstInstance: 0 }]);
});

it('keeps the points after a gap at the start of a series', async () => {
  const renderer = await createRenderer();
  writes = [];
  renderer.setSeriesData(
    'a',
    seriesDataFromArrays([0, 1, 2], [Number.NaN, 10, 20])
  );

  // Positioned from the first finite point, so only the gap is NaN
  const [write] = writes;
  expect(write.values.slice(2)).toEqual([1, 0, 2, 10]);
  expect(write.values[1]).toBeNaN();
});
