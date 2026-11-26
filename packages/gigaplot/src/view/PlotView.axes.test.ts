import {
  seriesDataFromArrays,
  type Bounds,
  type SeriesData,
} from '../model/PlotTypes';
import type {
  PlotRenderer,
  PlotRendererFactory,
} from '../renderers/PlotRenderer';
import { RendererRegistry } from '../renderers/RendererRegistry';
import { createLogScale } from '../scale/continuousScales';
import { LayeredDataSource } from '../sources/LayeredDataSource';
import { StaticDataSource } from '../sources/StaticDataSource';
import { PlotView } from './PlotView';
import type { PlotHover } from './hover';

type MockRenderer = PlotRenderer & {
  data: Map<string, SeriesData>;
  seriesViewports: () => ReadonlyMap<string, Bounds> | undefined;
};

function makeRenderer(): MockRenderer {
  const data = new Map<string, SeriesData>();
  const setViewport = jest.fn();
  return {
    name: 'mock',
    capabilities: {
      seriesTypes: ['line', 'scatter'],
      incrementalUpdates: true,
    },
    data,
    seriesViewports: () => setViewport.mock.lastCall?.[1],
    initialize: jest.fn(async () => undefined),
    setShape: jest.fn(),
    setSeriesData: jest.fn((id: string, series: SeriesData) => {
      data.set(id, series);
    }),
    getSeriesData: (id: string) => data.get(id),
    applyDeltas: jest.fn(),
    setViewport,
    setTheme: jest.fn(),
    resize: jest.fn(),
    render: jest.fn(),
    destroy: jest.fn(),
  };
}

function makeRegistry(renderer: PlotRenderer): RendererRegistry {
  const factory: PlotRendererFactory = {
    name: 'mock',
    capabilities: renderer.capabilities,
    isSupported: async () => true,
    create: () => renderer,
  };
  const registry = new RendererRegistry();
  registry.register(factory);
  return registry;
}

function makeLayer(id: string, y: number[]): StaticDataSource {
  return new StaticDataSource([
    {
      id,
      name: id,
      type: 'line',
      data: seriesDataFromArrays(
        y.map((_value, i) => i * 5),
        y
      ),
    },
  ]);
}

/** Prices from 100 to 110 on the left, and volumes from 0 to 1000 on the right. */
function makeSource(volume = makeLayer('v', [0, 1000, 500])) {
  return new LayeredDataSource([
    { source: makeLayer('p', [100, 110, 105]) },
    { source: volume, yAxis: 'volume' },
  ]);
}

function waitForIdle(view: PlotView): Promise<void> {
  return new Promise(resolve => {
    view.addEventListener('idle', () => resolve());
  });
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => resolve());
  });
}

let container: HTMLDivElement;
let boundingRectSpy: jest.SpyInstance;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  boundingRectSpy = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 800, 600));
});

afterEach(() => {
  boundingRectSpy.mockRestore();
  container.remove();
});

async function start(
  source: LayeredDataSource,
  renderer: MockRenderer
): Promise<PlotView> {
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;
  return view;
}

it('draws a series on a second y axis against that axis', async () => {
  const renderer = makeRenderer();
  const view = await start(makeSource(), renderer);

  expect(view.getViewport()).toMatchObject({ yMin: 99.5, yMax: 110.5 });
  // Home on each axis is its own data, padded the same way
  expect(renderer.seriesViewports()?.get('1:v')).toEqual({
    xMin: -0.5,
    xMax: 10.5,
    yMin: -50,
    yMax: 1050,
  });
  expect(view.getSeriesViewport('0:p')).toEqual(view.getViewport());
  view.destroy();
});

it('zooms and pans every axis together, and resets each to its home', async () => {
  const renderer = makeRenderer();
  const view = await start(makeSource(), renderer);

  // Halving the price range around its middle halves the volume range too
  view.setViewport({ xMin: 0, xMax: 5, yMin: 102.25, yMax: 107.75 });
  expect(view.getSeriesViewport('1:v')).toMatchObject({
    xMin: 0,
    xMax: 5,
    yMin: 225,
    yMax: 775,
  });

  view.resetViewport();
  expect(view.getSeriesViewport('1:v')).toMatchObject({
    yMin: -50,
    yMax: 1050,
  });
  view.destroy();
});

it('asks each layer for data in the units of its own axes', async () => {
  const volume = makeLayer('v', [0, 1000, 500]);
  const request = jest.spyOn(volume, 'requestSeriesData');
  const renderer = makeRenderer();
  const view = await start(makeSource(volume), renderer);

  expect(request.mock.lastCall?.[0].viewport).toMatchObject({
    yMin: -50,
    yMax: 1050,
  });
  view.destroy();
});

it('places data on the scale of its own axis', async () => {
  const log = createLogScale();
  const renderer = makeRenderer();
  const source = makeSource();
  const getShape = source.getShape.bind(source);
  jest.spyOn(source, 'getShape').mockImplementation(async () => {
    const shape = await getShape();
    return {
      ...shape,
      axes: shape.axes?.map(axis => ({
        ...axis,
        scale: log,
        range: { min: 10, max: 1000 },
      })),
    };
  });
  const view = await start(source, renderer);

  const volumes = Array.from(renderer.data.get('1:v')?.y ?? []);
  expect(volumes[0]).toBeNaN();
  expect(volumes[1]).toBeCloseTo(3);
  expect(volumes[2]).toBeCloseTo(Math.log10(500));
  // Prices stay as they are
  expect(Array.from(renderer.data.get('0:p')?.y ?? [])).toEqual([
    100, 110, 105,
  ]);
  expect(view.getSeriesViewport('1:v')?.yMax).toBeCloseTo(10 ** 3.1);
  view.destroy();
});

it('makes room beside the plot for a second y axis', async () => {
  const single = await start(
    new LayeredDataSource([{ source: makeLayer('p', [1, 2]) }]),
    makeRenderer()
  );
  const singleArea = single.getPlotArea();
  single.destroy();

  const view = await start(makeSource(), makeRenderer());
  const area = view.getPlotArea();

  expect(area.left).toBe(singleArea.left);
  expect(area.width).toBeLessThan(singleArea.width);
  view.destroy();
});

it('reports hovered points of a second axis in its units', async () => {
  const renderer = makeRenderer();
  const view = await start(makeSource(), renderer);
  const hovers: (PlotHover | undefined)[] = [];
  view.addEventListener('hover', ({ hover }) => hovers.push(hover));
  const area = view.getPlotArea();
  // x = 5, where the volume is 1000
  container.dispatchEvent(
    new MouseEvent('pointermove', {
      clientX: area.left + area.width * (5.5 / 11),
      clientY: area.top + area.height / 2,
    })
  );
  await waitForAnimationFrame();

  expect(hovers.at(-1)?.points).toEqual([
    expect.objectContaining({ seriesId: '0:p', x: 5, y: 110 }),
    expect.objectContaining({
      seriesId: '1:v',
      x: 5,
      y: 1000,
      yAxis: 'volume',
    }),
  ]);
  view.destroy();
});
