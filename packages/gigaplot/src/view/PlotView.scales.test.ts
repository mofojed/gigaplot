import {
  seriesDataFromArrays,
  type PlotShape,
  type SeriesData,
  type SeriesDelta,
} from '../model/PlotTypes';
import type {
  PlotRenderer,
  PlotRendererFactory,
} from '../renderers/PlotRenderer';
import { RendererRegistry } from '../renderers/RendererRegistry';
import { createLogScale } from '../scale/continuousScales';
import { linearScale } from '../scale/PlotScale';
import { createRangeBreakScale } from '../scale/RangeBreakScale';
import {
  StaticDataSource,
  type StaticDataSourceOptions,
} from '../sources/StaticDataSource';
import { PlotView } from './PlotView';
import type { PlotHover } from './hover';

class TestDataSource extends StaticDataSource {
  push(deltas: SeriesDelta[]): void {
    this.fireDataChanged(deltas);
  }

  pushShape(shape: Partial<PlotShape>): void {
    this.fireShapeChanged({ ...this.buildShape(), ...shape });
  }
}

type MockRenderer = PlotRenderer & { data: Map<string, SeriesData> };

function makeRenderer(): MockRenderer {
  const data = new Map<string, SeriesData>();
  return {
    name: 'mock',
    capabilities: {
      seriesTypes: ['line', 'scatter'],
      incrementalUpdates: true,
    },
    data,
    initialize: jest.fn(async () => undefined),
    setShape: jest.fn(),
    setSeriesData: jest.fn((id: string, series: SeriesData) => {
      data.set(id, series);
    }),
    getSeriesData: (id: string) => data.get(id),
    applyDeltas: jest.fn(),
    setViewport: jest.fn(),
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

/** A break from 10 to 20, so 25 sits at 15. */
const breaks = createRangeBreakScale({
  breaks: [{ start: 10, end: 20 }],
  anchor: 0,
});

function makeSource(
  options: StaticDataSourceOptions = { xScale: breaks },
  x = [0, 5, 25, 30],
  y = [1, 2, 3, 4]
): TestDataSource {
  return new TestDataSource(
    [{ id: 'a', name: 'A', type: 'line', data: seriesDataFromArrays(x, y) }],
    options
  );
}

function waitForIdle(view: PlotView): Promise<void> {
  return new Promise(resolve => {
    view.addEventListener('idle', () => resolve());
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
  source: TestDataSource,
  renderer: MockRenderer,
  options: ConstructorParameters<typeof PlotView>[2] = {}
): Promise<PlotView> {
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
    ...options,
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;
  return view;
}

it('draws data at its positions on the scale, closing up breaks', async () => {
  const renderer = makeRenderer();
  const view = await start(makeSource(), renderer);

  expect(Array.from(renderer.data.get('a')?.x ?? [])).toEqual([0, 5, 15, 20]);
  // Everything that draws sees plot units, with ticks that label data values
  const shape = (renderer.setShape as jest.Mock).mock.calls.at(-1)[0];
  expect(shape.bounds).toEqual({ xMin: 0, xMax: 20, yMin: 1, yMax: 4 });
  // 10 is in the break, so it is left off
  const ticks = shape.xAxisTicks(0, 20, 5);
  expect(ticks).toEqual([
    { value: 0, label: '0' },
    { value: 10, label: '20' },
    { value: 20, label: '30' },
  ]);
  // The public viewport and shape stay in data units
  expect(view.getShape().bounds).toEqual({
    xMin: 0,
    xMax: 30,
    yMin: 1,
    yMax: 4,
  });
  expect(view.getViewport().xMax).toBeCloseTo(31);
  view.destroy();
});

it('asks the source for data units, with the scale to bin by', async () => {
  const source = makeSource();
  const request = jest.spyOn(source, 'requestSeriesData');
  const view = await start(source, makeRenderer());

  const { viewport, xScale } = request.mock.calls.at(-1)?.[0] ?? {};
  expect(xScale).toBe(breaks);
  expect(viewport?.xMin).toBeCloseTo(-1);
  expect(viewport?.xMax).toBeCloseTo(31);
  view.destroy();
});

it('reports viewport changes and takes viewports in data units', async () => {
  const view = await start(makeSource(), makeRenderer());
  const changed = jest.fn();
  view.addEventListener('viewportchanged', changed);
  view.setViewport({ xMin: 5, xMax: 25, yMin: 0, yMax: 5 });

  expect(changed).toHaveBeenCalledWith({
    viewport: { xMin: 5, xMax: 25, yMin: 0, yMax: 5 },
  });
  expect(view.getViewport()).toEqual({ xMin: 5, xMax: 25, yMin: 0, yMax: 5 });
  view.destroy();
});

it('places deltas on the scale before the renderer gets them', async () => {
  const source = makeSource();
  const renderer = makeRenderer();
  const view = await start(source, renderer);
  source.push([
    { type: 'append', seriesId: 'a', data: seriesDataFromArrays([40], [5]) },
  ]);
  const [deltas] = (renderer.applyDeltas as jest.Mock).mock.calls.at(-1);
  expect(Array.from(deltas[0].data.x)).toEqual([30]);
  view.destroy();
});

it('passes trims, which carry no data, to the renderer as they are', async () => {
  const source = makeSource();
  const renderer = makeRenderer();
  const view = await start(source, renderer);
  const trim: SeriesDelta = { type: 'trimStart', seriesId: 'a', count: 2 };
  source.push([trim]);
  expect(renderer.applyDeltas).toHaveBeenLastCalledWith([trim]);
  view.destroy();
});

it('fits home to the data when its bounds have no place on a log axis', async () => {
  const renderer = makeRenderer();
  const view = await start(
    makeSource({ yScale: createLogScale(10) }, [0, 1, 2], [0, 10, 1000]),
    renderer
  );
  // Zero has no position, so home comes from the points that do
  const y = renderer.data.get('a')?.y ?? [];
  expect(y[0]).toBeNaN();
  expect(y[1]).toBeCloseTo(1);
  expect(y[2]).toBeCloseTo(3);
  const { yMin, yMax } = view.getViewport();
  expect(yMin).toBeLessThan(10);
  expect(yMin).toBeGreaterThan(5);
  expect(yMax).toBeGreaterThan(1000);
  expect(yMax).toBeLessThan(2000);
  view.destroy();
});

it('reloads its data when its scales change', async () => {
  const renderer = makeRenderer();
  const view = await start(makeSource(), renderer);
  const idle = waitForIdle(view);
  view.setScales({ x: linearScale });
  await idle;

  expect(view.getScales().x).toBe(linearScale);
  expect(Array.from(renderer.data.get('a')?.x ?? [])).toEqual([0, 5, 25, 30]);
  expect(view.getViewport().xMax).toBeCloseTo(31.5);
  view.destroy();
});

it('moves to the scales of a new shape', async () => {
  const renderer = makeRenderer();
  const source = makeSource({});
  const view = await start(source, renderer);
  const idle = waitForIdle(view);
  source.pushShape({ xScale: breaks });
  await idle;

  expect(Array.from(renderer.data.get('a')?.x ?? [])).toEqual([0, 5, 15, 20]);
  view.destroy();
});

it('reports hovered points in data units', async () => {
  const renderer = makeRenderer();
  const view = await start(makeSource(), renderer);
  const hovers: (PlotHover | undefined)[] = [];
  view.addEventListener('hover', ({ hover }) => hovers.push(hover));
  const area = view.getPlotArea();
  // Position 15, which is x = 25
  const position = (15 - -1) / (21 - -1);
  container.dispatchEvent(
    new MouseEvent('pointermove', {
      clientX: area.left + area.width * position,
      clientY: area.top + area.height / 2,
    })
  );
  await new Promise(resolve => {
    requestAnimationFrame(() => resolve(undefined));
  });

  expect(hovers.at(-1)?.points[0]).toMatchObject({ x: 25, y: 3 });
  view.destroy();
});
