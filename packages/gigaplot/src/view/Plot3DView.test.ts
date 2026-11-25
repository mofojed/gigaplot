import {
  seriesData3DFromArrays,
  type Bounds,
  type PlotShape,
  type SeriesData,
  type SeriesDelta,
} from '../model/PlotTypes';
import type {
  Plot3DRenderer,
  Plot3DRendererFactory,
  Plot3DScene,
} from '../renderers/Plot3DRenderer';
import { RendererRegistry } from '../renderers/RendererRegistry';
import { StaticDataSource } from '../sources/StaticDataSource';
import { Plot3DView } from './Plot3DView';

/** Exposes the protected notifications so tests can drive updates. */
class TestDataSource extends StaticDataSource {
  push(deltas: SeriesDelta[]): void {
    this.fireDataChanged(deltas);
  }

  pushShape(shape: Partial<PlotShape>): void {
    this.fireShapeChanged({ ...this.buildShape(), ...shape });
  }
}

type MockRenderer = Plot3DRenderer & {
  data: Map<string, SeriesData>;
  scenes: Plot3DScene[];
};

function makeRenderer(
  initialize: () => Promise<void> = async () => undefined
): MockRenderer {
  const data = new Map<string, SeriesData>();
  const scenes: Plot3DScene[] = [];
  return {
    name: 'mock',
    capabilities: {
      seriesTypes: ['scatter3d', 'line3d'],
      incrementalUpdates: true,
    },
    data,
    scenes,
    initialize: jest.fn(initialize),
    setShape: jest.fn(),
    setSeriesData: jest.fn((id: string, series: SeriesData) => {
      data.set(id, series);
    }),
    applyDeltas: jest.fn(),
    getSeriesData: (id: string) => data.get(id),
    setScene: jest.fn((scene: Plot3DScene) => {
      scenes.push(scene);
    }),
    setTheme: jest.fn(),
    resize: jest.fn(),
    render: jest.fn(),
    destroy: jest.fn(),
  };
}

function makeRegistry(
  renderer: Plot3DRenderer
): RendererRegistry<Plot3DRendererFactory> {
  const registry = new RendererRegistry<Plot3DRendererFactory>();
  registry.register({
    name: 'mock',
    capabilities: renderer.capabilities,
    isSupported: async () => true,
    create: () => renderer,
  });
  return registry;
}

function makeSource(): TestDataSource {
  return new TestDataSource([
    {
      id: 'a',
      name: 'A',
      type: 'scatter3d',
      data: seriesData3DFromArrays([0, 10], [0, 20], [0, 30]),
    },
  ]);
}

function waitForIdle(view: Plot3DView): Promise<void> {
  return new Promise(resolve => {
    view.addEventListener('idle', () => resolve());
  });
}

function nextFrame(): Promise<void> {
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

it('loads every series and draws it in a box fitted to its bounds', async () => {
  const renderer = makeRenderer();
  const view = new Plot3DView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;
  await nextFrame();

  expect(container.getAttribute('data-dh-plot-renderer')).toBe('mock');
  expect(container.getAttribute('data-dh-plot-status')).toBe('ready');
  expect(renderer.data.get('a')?.length).toBe(2);
  expect(renderer.render).toHaveBeenCalled();
  const scene = renderer.scenes[renderer.scenes.length - 1];
  expect(scene.projection.bounds).toMatchObject({
    xMin: 0,
    xMax: 10,
    zMin: 0,
    zMax: 30,
  });
  expect(scene.perspectivePoints).toBe(false);
  expect(container.querySelectorAll('canvas[data-dh-plot-layer]')).toHaveLength(
    4
  );
  view.destroy();
});

it('fits the box to the data when the source gives no z range', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const view = new Plot3DView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;
  const bounds: Bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  source.pushShape({ bounds });

  expect(view.getBox()).toMatchObject({ zMin: 0, zMax: 30 });
  view.destroy();
});

it('applies deltas to series it holds in full', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const view = new Plot3DView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const delta: SeriesDelta = {
    type: 'append',
    seriesId: 'a',
    data: seriesData3DFromArrays([1], [1], [1]),
  };
  source.push([delta]);
  expect(renderer.applyDeltas).toHaveBeenCalledWith([delta]);
  view.destroy();
});

it('does not lose a shape that changes while the renderer starts', async () => {
  let finishInitialize: () => void = () => undefined;
  const renderer = makeRenderer(
    () =>
      new Promise(resolve => {
        finishInitialize = resolve;
      })
  );
  const source = makeSource();
  const view = new Plot3DView(container, source, {
    registry: makeRegistry(renderer),
  });
  const initialized = view.initialize();
  // Let the shape and renderer resolve, leaving initialize pending
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  source.pushShape({ title: 'Changed' });
  finishInitialize();
  await initialized;

  expect(view.getShape().title).toBe('Changed');
  expect(renderer.setShape).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Changed' })
  );
  view.destroy();
});

it('rotates the camera on drag and resets it on double click', async () => {
  const renderer = makeRenderer();
  const view = new Plot3DView(container, makeSource(), {
    registry: makeRegistry(renderer),
    camera: { azimuth: 0, elevation: 10 },
  });
  await view.initialize();
  container.setPointerCapture = jest.fn();
  container.hasPointerCapture = jest.fn(() => true);
  container.releasePointerCapture = jest.fn();
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    container.dispatchEvent(event);
  };

  pointer('pointerdown', 100, 100);
  pointer('pointermove', 140, 80);
  pointer('pointerup', 140, 80);
  expect(view.getCamera().azimuth).toBe(-20);
  expect(view.getCamera().elevation).toBe(0);

  pointer('pointerdown', 100, 100);
  pointer('pointermove', 100, 1000);
  pointer('pointerup', 100, 1000);
  expect(view.getCamera().elevation).toBe(90);

  container.dispatchEvent(new MouseEvent('dblclick'));
  expect(view.getCamera()).toMatchObject({ azimuth: 0, elevation: 10 });
  view.destroy();
});

it('passes perspective points and depth fade to the renderer', async () => {
  const renderer = makeRenderer();
  const view = new Plot3DView(container, makeSource(), {
    registry: makeRegistry(renderer),
    pointScaling: 'perspective',
    depthFade: 0.75,
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;
  await nextFrame();

  const scene = renderer.scenes[renderer.scenes.length - 1];
  expect(scene.perspectivePoints).toBe(true);
  expect(scene.depthFade).toBe(0.75);
  view.destroy();
});

it('reports when no renderer can draw 3D series', async () => {
  const view = new Plot3DView(container, makeSource(), {
    registry: new RendererRegistry<Plot3DRendererFactory>(),
  });
  await expect(view.initialize()).rejects.toThrow(/No renderer/);
  view.destroy();
});
