import {
  seriesDataFromArrays,
  type Bounds,
  type PlotShape,
  type SeriesData,
  type SeriesDelta,
} from '../model/PlotTypes';
import type {
  PlotRenderer,
  PlotRendererFactory,
  SeriesResolution,
} from '../renderers/PlotRenderer';
import { RendererRegistry } from '../renderers/RendererRegistry';
import { zoomBounds } from '../scale/viewportUtils';
import { StaticDataSource } from '../sources/StaticDataSource';
import { generateSine } from '../sources/generators';
import { defaultPlotTheme } from '../theme/PlotTheme';
import { PlotView } from './PlotView';
import { AxisPainter } from './AxisPainter';

/** Exposes the protected notifications so tests can drive updates. */
class TestDataSource extends StaticDataSource {
  push(deltas: SeriesDelta[]): void {
    this.fireDataChanged(deltas);
  }

  pushBounds(bounds: Bounds): void {
    this.fireShapeChanged({ ...this.buildShape(), bounds });
  }

  pushShape(shape: Partial<PlotShape>): void {
    this.fireShapeChanged({ ...this.buildShape(), ...shape });
  }
}

function makeRenderer(): PlotRenderer {
  return {
    name: 'mock',
    capabilities: {
      seriesTypes: ['scatter', 'line'],
      incrementalUpdates: true,
    },
    initialize: jest.fn(async () => undefined),
    setShape: jest.fn(),
    setSeriesData: jest.fn(),
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

function makeSource(data?: SeriesData): TestDataSource {
  return new TestDataSource([
    {
      id: 'a',
      name: 'A',
      type: 'line',
      data: data ?? seriesDataFromArrays([0, 1, 2], [0, 1, 0]),
    },
  ]);
}

function waitForIdle(view: PlotView): Promise<void> {
  return new Promise(resolve => {
    view.addEventListener('idle', () => resolve());
  });
}

/** Data requests are coalesced onto a timer, so tests have to let it run. */
function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
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

it('resolves a renderer and marks it on the container', async () => {
  const renderer = makeRenderer();
  const view = new PlotView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  expect(view.getRendererName()).toBe('mock');
  expect(container.getAttribute('data-dh-plot-renderer')).toBe('mock');
  expect(container.getAttribute('data-dh-plot-status')).toBe('ready');
  view.destroy();
});

it('emits a frame event once the renderer has drawn', async () => {
  const renderer = makeRenderer();
  const view = new PlotView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const onFrame = jest.fn();
  view.addEventListener('frame', onFrame);

  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  await new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  expect(onFrame).toHaveBeenCalled();
  expect(renderer.render).toHaveBeenCalled();
  view.destroy();
});

it('uses bounds that arrive while the renderer is initializing', async () => {
  const renderer = makeRenderer();
  let finishInitialize: () => void = () => undefined;
  renderer.initialize = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finishInitialize = resolve;
      })
  );
  const source = makeSource();
  const requestSpy = jest.spyOn(source, 'requestSeriesData');
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const initialized = view.initialize();
  await nextFrame();
  expect(renderer.initialize).toHaveBeenCalled();

  const bounds = { xMin: 100, xMax: 200, yMin: -5, yMax: 5 };
  source.pushBounds(bounds);
  finishInitialize();
  await initialized;
  await nextFrame();

  const viewport = view.getViewport();
  expect(viewport.xMin).toBeLessThan(bounds.xMin);
  expect(viewport.xMax).toBeGreaterThan(bounds.xMax);
  expect(viewport.xMin).toBeGreaterThan(50);
  expect(renderer.setShape).toHaveBeenLastCalledWith(
    expect.objectContaining({ bounds })
  );
  expect(requestSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({ viewport })
  );
  view.destroy();
});

it('fails when no registered renderer supports the series types', async () => {
  const registry = new RendererRegistry();
  registry.register({
    name: 'scatter-only',
    capabilities: { seriesTypes: ['scatter'], incrementalUpdates: false },
    isSupported: async () => true,
    create: () => makeRenderer(),
  });

  const view = new PlotView(container, makeSource(), { registry });
  await expect(view.initialize()).rejects.toThrow(
    'No renderer could be used for this plot: scatter-only cannot draw line'
  );
  view.destroy();
});

it('says a renderer is unavailable rather than blaming the series type', async () => {
  const registry = new RendererRegistry();
  registry.register({
    name: 'webgpu',
    capabilities: {
      seriesTypes: ['scatter', 'line'],
      incrementalUpdates: true,
    },
    isSupported: async () => false,
    create: () => makeRenderer(),
  });

  const view = new PlotView(container, makeSource(), {
    registry,
    rendererPreference: ['webgpu'],
  });
  await expect(view.initialize()).rejects.toThrow(
    'No renderer could be used for this plot: webgpu is not available in this browser'
  );
  view.destroy();
});

it('sizes the data canvas to the plot area inside the axis margins', async () => {
  const renderer = makeRenderer();
  const view = new PlotView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const area = view.getPlotArea();
  expect(area).toEqual({ left: 56, top: 16, width: 728, height: 552 });
  expect(renderer.resize).toHaveBeenCalledWith(728, 552, 1);
  view.destroy();
});

it('makes room for axis titles', async () => {
  const renderer = makeRenderer();
  const source = new TestDataSource(
    [
      {
        id: 'a',
        name: 'A',
        type: 'line',
        data: seriesDataFromArrays([0, 1], [0, 1]),
      },
    ],
    { xAxisLabel: 'Time', yAxisLabel: 'Price' }
  );
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  // 20px of title on the left; tick labels plus title need 37px below
  expect(view.getPlotArea()).toEqual({
    left: 76,
    top: 16,
    width: 708,
    height: 547,
  });
  expect(renderer.resize).toHaveBeenLastCalledWith(708, 547, 1);
  view.destroy();
});

it('lays the plot out again when axis titles are added or removed', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  source.pushShape({ yAxisLabel: 'Price' });
  expect(view.getPlotArea().left).toBe(76);
  expect(renderer.resize).toHaveBeenLastCalledWith(708, 552, 1);
  const dataCanvas = container.querySelector<HTMLCanvasElement>(
    'canvas[data-dh-plot-layer=data]'
  );
  expect(dataCanvas?.style.left).toBe('76px');

  source.pushShape({ yAxisLabel: undefined });
  expect(view.getPlotArea().left).toBe(56);
  expect(renderer.resize).toHaveBeenLastCalledWith(728, 552, 1);
  view.destroy();
});

describe('legend position', () => {
  let getContextSpy: jest.SpyInstance;

  beforeEach(() => {
    // jsdom cannot measure text, so give the canvases a context that can
    const context = new Proxy(
      { measureText: (text: string) => ({ width: text.length * 7 }) },
      { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) }
    );
    getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as never);
  });

  afterEach(() => {
    getContextSpy.mockRestore();
  });

  function makeNamedSource(): TestDataSource {
    return new TestDataSource([
      {
        id: 'a',
        name: 'Short',
        type: 'line',
        data: seriesDataFromArrays([0, 1], [0, 1]),
      },
      {
        id: 'b',
        name: 'Much longer',
        type: 'line',
        data: seriesDataFromArrays([0, 1], [1, 0]),
      },
    ]);
  }

  it('keeps the full plot area for a legend over the plot', async () => {
    const renderer = makeRenderer();
    const view = new PlotView(container, makeNamedSource(), {
      registry: makeRegistry(renderer),
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;

    expect(view.getLegendPosition()).toBe('overlay');
    expect(view.getPlotArea().width).toBe(728);
    view.destroy();
  });

  it('narrows the plot area to fit a legend beside it', async () => {
    const renderer = makeRenderer();
    const view = new PlotView(container, makeNamedSource(), {
      registry: makeRegistry(renderer),
      legendPosition: 'right',
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;

    // Item gap, swatch, swatch gap, and 11 characters at 7px
    expect(view.getPlotArea().width).toBe(728 - (16 + 8 + 4 + 77));
    expect(renderer.resize).toHaveBeenLastCalledWith(623, 552, 1);
    view.destroy();
  });

  it('lays the plot out again when the legend moves', async () => {
    const renderer = makeRenderer();
    const view = new PlotView(container, makeNamedSource(), {
      registry: makeRegistry(renderer),
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;

    view.setLegendPosition('right');
    expect(view.getPlotArea().width).toBe(623);
    expect(renderer.resize).toHaveBeenLastCalledWith(623, 552, 1);

    view.setLegendPosition(undefined);
    expect(view.getPlotArea().width).toBe(728);
    expect(renderer.resize).toHaveBeenLastCalledWith(728, 552, 1);
    view.destroy();
  });

  it('never gives a legend beside the plot more than 40% of the width', async () => {
    const renderer = makeRenderer();
    const source = new TestDataSource([
      {
        id: 'a',
        name: 'x'.repeat(200),
        type: 'line',
        data: seriesDataFromArrays([0, 1], [0, 1]),
      },
    ]);
    const view = new PlotView(container, source, {
      registry: makeRegistry(renderer),
      legendPosition: 'right',
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;

    expect(view.getPlotArea().width).toBe(728 - 320);
    view.destroy();
  });
});

it('widens the left margin to fit long y tick labels', async () => {
  // jsdom cannot measure text, so give the axes canvas a context that can
  const context = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 7 }) },
    { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) }
  );
  const getContextSpy = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as never);
  const source = new TestDataSource(
    [
      {
        id: 'a',
        name: 'A',
        type: 'line',
        data: seriesDataFromArrays([0], [0]),
      },
    ],
    {
      yAxisTicks: (min, max) => [
        { value: min, label: '2024-01-01 00:00:00' },
        { value: max, label: '2024-01-02 00:00:00' },
      ],
    }
  );
  const renderer = makeRenderer();
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;
  await new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  // 19 characters at 7px, plus the tick label padding and edge gap, in 8px steps
  expect(view.getPlotArea().left).toBe(144);
  expect(renderer.resize).toHaveBeenLastCalledWith(640, 552, 1);
  view.destroy();
  getContextSpy.mockRestore();
});

it('sizes to the layout box rather than the transformed bounding box', async () => {
  // A container rotated in 3D reports a squashed projection as its bounding rect
  boundingRectSpy.mockReturnValue(new DOMRect(0, 0, 80, 600));
  Object.defineProperty(container, 'offsetWidth', { value: 800 });
  Object.defineProperty(container, 'offsetHeight', { value: 600 });

  const renderer = makeRenderer();
  const view = new PlotView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  expect(view.getPlotArea()).toEqual({
    left: 56,
    top: 16,
    width: 728,
    height: 552,
  });
  view.destroy();
});

it('requests data for the initial viewport and hands it to the renderer', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const requestSpy = jest.spyOn(source, 'requestSeriesData');
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  expect(requestSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      seriesId: 'a',
      pixelSize: { width: 728, height: 552 },
      viewport: view.getViewport(),
    })
  );
  expect(renderer.setSeriesData).toHaveBeenCalledWith(
    'a',
    expect.objectContaining({ length: 3 })
  );
  view.destroy();
});

it('starts at the padded bounds of the data and resets back to them', async () => {
  const renderer = makeRenderer();
  const view = new PlotView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const home = view.getViewport();
  expect(home.xMin).toBeLessThan(0);
  expect(home.xMax).toBeGreaterThan(2);

  view.setViewport({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
  expect(view.getViewport()).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });

  view.resetViewport();
  expect(view.getViewport()).toEqual(home);
  view.destroy();
});

it('follows growing data until the user takes control of the viewport', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  source.pushBounds({ xMin: 0, xMax: 100, yMin: 0, yMax: 1 });
  expect(view.getViewport().xMax).toBeGreaterThan(100);

  // Zooming pins the viewport, so later data must not move it
  view.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 1 });
  source.pushBounds({ xMin: 0, xMax: 500, yMin: 0, yMax: 1 });
  expect(view.getViewport()).toEqual({ xMin: 0, xMax: 10, yMin: 0, yMax: 1 });

  // Resetting hands control back
  view.resetViewport();
  source.pushBounds({ xMin: 0, xMax: 900, yMin: 0, yMax: 1 });
  expect(view.getViewport().xMax).toBeGreaterThan(900);
  view.destroy();
});

it('does not refetch on viewport change when the renderer holds every point', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const requestSpy = jest.spyOn(source, 'requestSeriesData');
  view.setViewport({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
  await nextFrame();

  expect(requestSpy).not.toHaveBeenCalled();
  expect(renderer.setViewport).toHaveBeenCalled();
  view.destroy();
});

it('refetches on viewport change when the data was downsampled', async () => {
  const renderer = makeRenderer();
  const source = makeSource(generateSine(200_000, { frequency: 0.001 }));
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const requestSpy = jest.spyOn(source, 'requestSeriesData');
  view.setViewport({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });
  await nextFrame();

  expect(requestSpy).toHaveBeenCalled();
  view.destroy();
});

it('applies deltas directly when the renderer holds complete data', async () => {
  const renderer = makeRenderer();
  const source = makeSource();
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const delta: SeriesDelta = {
    type: 'append',
    seriesId: 'a',
    data: seriesDataFromArrays([3], [1]),
  };
  source.push([delta]);

  expect(renderer.applyDeltas).toHaveBeenCalledWith([delta]);
  view.destroy();
});

it('refetches instead of applying deltas when the data was downsampled', async () => {
  const renderer = makeRenderer();
  const source = makeSource(generateSine(200_000, { frequency: 0.001 }));
  const view = new PlotView(container, source, {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  const requestSpy = jest.spyOn(source, 'requestSeriesData');
  source.push([
    {
      type: 'append',
      seriesId: 'a',
      data: seriesDataFromArrays([1], [1]),
    },
  ]);
  await nextFrame();

  expect(renderer.applyDeltas).not.toHaveBeenCalled();
  expect(requestSpy).toHaveBeenCalled();
  view.destroy();
});

describe('smooth zoom', () => {
  function waitForAnimationFrame(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => resolve());
    });
  }

  function zoomIn(bounds: Bounds, factor: number): Bounds {
    const center = (bounds.xMin + bounds.xMax) / 2;
    const halfSpan = (bounds.xMax - bounds.xMin) / 2 / factor;
    return { ...bounds, xMin: center - halfSpan, xMax: center + halfSpan };
  }

  function makeStaleRenderer(): PlotRenderer {
    return {
      ...makeRenderer(),
      setSeriesResolution: jest.fn(),
      retainSeriesData: jest.fn(),
      setRetainedSeriesOpacity: jest.fn(),
    };
  }

  function lastResolution(
    renderer: PlotRenderer
  ): SeriesResolution | undefined {
    const { calls } = (renderer.setSeriesResolution as jest.Mock).mock;
    return calls.length > 0 ? calls[calls.length - 1][1] : undefined;
  }

  /** How far the view is zoomed in past the resolution last sent to the renderer. */
  function getStretch(view: PlotView, renderer: PlotRenderer): number {
    const { xMin, xMax } = view.getViewport();
    const screen = (xMax - xMin) / view.getPlotArea().width;
    return (lastResolution(renderer)?.xPerPixel ?? 0) / screen;
  }

  /** Starts a view whose later data requests wait until `release` is called. */
  async function createSlowView(
    data: SeriesData,
    options: ConstructorParameters<typeof PlotView>[2] = {}
  ): Promise<{ view: PlotView; renderer: PlotRenderer; release: () => void }> {
    const renderer = makeStaleRenderer();
    const source = makeSource(data);
    const view = new PlotView(container, source, {
      registry: makeRegistry(renderer),
      ...options,
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;

    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const original = source.requestSeriesData.bind(source);
    jest
      .spyOn(source, 'requestSeriesData')
      .mockImplementation(async request => {
        await gate;
        return original(request);
      });
    return { view, renderer, release };
  }

  it('pixelates downsampled data on its own grid while zooming in', async () => {
    const { view, renderer } = await createSlowView(
      generateSine(200_000, { frequency: 0.001 })
    );
    const home = view.getViewport();
    const area = view.getPlotArea();

    view.setViewport(zoomIn(home, 4));
    await waitForAnimationFrame();

    expect(getStretch(view, renderer)).toBeCloseTo(4);
    expect(lastResolution(renderer)).toEqual({
      xOrigin: home.xMin,
      xPerPixel: expect.closeTo((home.xMax - home.xMin) / area.width),
      yOrigin: home.yMin,
      yPerPixel: expect.closeTo((home.yMax - home.yMin) / area.height),
    });
    view.destroy();
  });

  it('keeps the y grid of the last sharp frame while stale', async () => {
    const { view, renderer } = await createSlowView(
      generateSine(200_000, { frequency: 0.001 })
    );
    const home = view.getViewport();
    const area = view.getPlotArea();

    // Zoom both axes, as the wheel does, so lines should thicken in y too
    view.setViewport(zoomBounds(home, 0.25, 0.5, 0.5));
    await waitForAnimationFrame();

    expect(lastResolution(renderer)?.yPerPixel).toBeCloseTo(
      (home.yMax - home.yMin) / area.height
    );
    view.destroy();
  });

  it('fades stale data out under finer data before reporting ready', async () => {
    const { view, renderer, release } = await createSlowView(
      generateSine(200_000, { frequency: 0.001 })
    );
    view.setViewport(zoomIn(view.getViewport(), 2));
    await waitForAnimationFrame();
    expect(getStretch(view, renderer)).toBeCloseTo(2);

    const idle = waitForIdle(view);
    const start = performance.now();
    release();
    await idle;

    expect(performance.now() - start).toBeGreaterThanOrEqual(150);
    expect(container.getAttribute('data-dh-plot-status')).toBe('ready');
    expect(renderer.retainSeriesData).toHaveBeenCalledTimes(1);
    expect(renderer.retainSeriesData).toHaveBeenCalledWith('a');
    await waitForAnimationFrame();
    const opacities = (
      renderer.setRetainedSeriesOpacity as jest.Mock
    ).mock.calls.map(call => call[1]);
    expect(opacities.length).toBeGreaterThan(1);
    expect(opacities[opacities.length - 1]).toBe(0);
    expect(getStretch(view, renderer)).toBeCloseTo(1);
    view.destroy();
  });

  it('does not fade data that was not stale when replaced', async () => {
    const { view, renderer, release } = await createSlowView(
      generateSine(200_000, { frequency: 0.001 })
    );
    view.setViewport(zoomIn(view.getViewport(), 0.5));
    const idle = waitForIdle(view);
    release();
    await idle;

    expect(renderer.retainSeriesData).not.toHaveBeenCalled();
    view.destroy();
  });

  it('pixelates data a source answers with before its detailed data is ready', async () => {
    const renderer = makeStaleRenderer();
    const source = makeSource(generateSine(200_000, { frequency: 0.001 }));
    const view = new PlotView(container, source, {
      registry: makeRegistry(renderer),
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;

    // Like a server backed source: answer at once with the data already
    // loaded, at the resolution it was loaded for
    const home = view.getViewport();
    const loadedResolution = (home.xMax - home.xMin) / view.getPlotArea().width;
    const original = source.requestSeriesData.bind(source);
    jest.spyOn(source, 'requestSeriesData').mockImplementation(async () => ({
      ...(await original({
        seriesId: 'a',
        viewport: home,
        pixelSize: { width: 728, height: 552 },
        style: {},
      })),
      xResolution: loadedResolution,
      xCoverage: { min: home.xMin, max: home.xMax },
    }));

    const zoomed = waitForIdle(view);
    view.setViewport(zoomIn(home, 4));
    await zoomed;
    await waitForAnimationFrame();

    expect(getStretch(view, renderer)).toBeCloseTo(4);
    // Answering with the same data again is not new detail to fade in
    expect(renderer.retainSeriesData).not.toHaveBeenCalled();
    view.destroy();
  });

  describe('zooming out', () => {
    let paintSpy: jest.SpyInstance;

    beforeEach(() => {
      paintSpy = jest.spyOn(AxisPainter.prototype, 'paint');
    });

    afterEach(() => {
      paintSpy.mockRestore();
    });

    function wait(ms: number): Promise<void> {
      return new Promise(resolve => {
        setTimeout(resolve, ms);
      });
    }

    function getPendings(): (
      { ranges: unknown; opacity: number } | undefined
    )[] {
      return paintSpy.mock.calls.map(call => call[6]);
    }

    function lastPending(): { ranges: unknown; opacity: number } | undefined {
      const pendings = getPendings();
      return pendings[pendings.length - 1];
    }

    it('hatches the regions the loaded data does not cover until they load', async () => {
      const renderer = makeRenderer();
      const source = makeSource(generateSine(200_000, { frequency: 0.001 }));
      const view = new PlotView(container, source, {
        registry: makeRegistry(renderer),
      });
      const idle = waitForIdle(view);
      await view.initialize();
      await idle;

      // Zoom in and load data covering only the middle
      view.setViewport({ xMin: 50_000, xMax: 150_000, yMin: -1, yMax: 1 });
      await waitForIdle(view);
      const original = source.requestSeriesData.bind(source);
      const requestSpy = jest
        .spyOn(source, 'requestSeriesData')
        .mockImplementation(async request => ({
          ...(await original(request)),
          xCoverage: { min: 50_000, max: 150_000 },
        }));

      // Zoom back out while only the middle is loaded
      view.setViewport({ xMin: 0, xMax: 200_000, yMin: -1, yMax: 1 });
      await wait(400);
      expect(lastPending()).toEqual({
        ranges: [
          [0, 50_000],
          [150_000, 199_999],
        ],
        opacity: 1,
      });

      // The full range loads, so the hatch fades out before the plot is ready
      requestSpy.mockRestore();
      const loaded = waitForIdle(view);
      const start = performance.now();
      view.requestData();
      await loaded;
      expect(performance.now() - start).toBeGreaterThanOrEqual(150);
      paintSpy.mockClear();
      view.invalidate();
      await waitForAnimationFrame();
      expect(paintSpy).toHaveBeenCalled();
      expect(lastPending()).toBeUndefined();
      view.destroy();
    });

    it('does not flash the hatch when data loads quickly', async () => {
      const renderer = makeRenderer();
      const source = makeSource(generateSine(200_000, { frequency: 0.001 }));
      const view = new PlotView(container, source, {
        registry: makeRegistry(renderer),
      });
      const idle = waitForIdle(view);
      await view.initialize();
      await idle;

      view.setViewport({ xMin: 50_000, xMax: 150_000, yMin: -1, yMax: 1 });
      await waitForIdle(view);
      view.resetViewport();
      await waitForIdle(view);
      await wait(300);

      expect(
        getPendings().every(pending => (pending?.opacity ?? 0) === 0)
      ).toBe(true);
      view.destroy();
    });
  });

  it('never pixelates data the renderer holds in full', async () => {
    const { view, renderer } = await createSlowView(
      seriesDataFromArrays([0, 1, 2], [0, 1, 0])
    );

    view.setViewport(zoomIn(view.getViewport(), 4));
    await waitForAnimationFrame();

    expect(renderer.setSeriesResolution).toHaveBeenCalled();
    expect(lastResolution(renderer)).toBeUndefined();
    view.destroy();
  });

  it('does not pixelate when smoothZoom is disabled', async () => {
    const { view, renderer } = await createSlowView(
      generateSine(200_000, { frequency: 0.001 }),
      { smoothZoom: false }
    );

    view.setViewport(zoomIn(view.getViewport(), 4));
    await waitForAnimationFrame();

    expect(renderer.setSeriesResolution).toHaveBeenCalled();
    expect(lastResolution(renderer)).toBeUndefined();
    view.destroy();
  });
});

it('stops listening and destroys the renderer on destroy', async () => {
  const renderer = makeRenderer();
  const view = new PlotView(container, makeSource(), {
    registry: makeRegistry(renderer),
  });
  const idle = waitForIdle(view);
  await view.initialize();
  await idle;

  view.destroy();

  expect(renderer.destroy).toHaveBeenCalled();
  expect(container.querySelector('canvas')).toBeNull();
});

describe('theming', () => {
  async function createView(
    options: ConstructorParameters<typeof PlotView>[2] = {}
  ): Promise<{ view: PlotView; renderer: PlotRenderer }> {
    const renderer = makeRenderer();
    const view = new PlotView(container, makeSource(), {
      registry: makeRegistry(renderer),
      ...options,
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;
    return { view, renderer };
  }

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('defaults to the Deephaven dark theme', async () => {
    const { view, renderer } = await createView();
    expect(view.getTheme()).toEqual(defaultPlotTheme);
    expect(renderer.initialize).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      view.getTheme()
    );
    view.destroy();
  });

  it('reads the Deephaven chart CSS variables, then applies overrides', async () => {
    container.style.setProperty('--dh-color-chart-bg', '#010101');
    container.style.setProperty('--dh-color-chart-colorway', '#aaa #bbb');
    const { view } = await createView({ theme: { colorway: ['red'] } });
    expect(view.getTheme().backgroundColor).toBe('#010101');
    expect(view.getTheme().colorway).toEqual(['red']);
    view.destroy();
  });

  it('follows a page theme switch', async () => {
    const { view, renderer } = await createView();
    const onThemeChanged = jest.fn();
    view.addEventListener('themechanged', onThemeChanged);

    container.style.setProperty('--dh-color-chart-grid', '#123456');
    document.documentElement.classList.add('theme-light');
    await nextFrame();

    expect(view.getTheme().gridColor).toBe('#123456');
    expect(renderer.setTheme).toHaveBeenCalledWith(view.getTheme());
    expect(onThemeChanged).toHaveBeenCalledWith({ theme: view.getTheme() });
    view.destroy();
  });

  it('does not re-theme when nothing changed', async () => {
    const { view, renderer } = await createView();
    document.documentElement.classList.add('theme-light');
    await nextFrame();
    view.refreshTheme();
    expect(renderer.setTheme).not.toHaveBeenCalled();
    view.destroy();
  });

  it('ignores page theme switches when followCssTheme is false', async () => {
    const { view } = await createView({ followCssTheme: false });
    container.style.setProperty('--dh-color-chart-grid', '#123456');
    document.documentElement.classList.add('theme-light');
    await nextFrame();
    expect(view.getTheme().gridColor).toBe(defaultPlotTheme.gridColor);

    view.refreshTheme();
    expect(view.getTheme().gridColor).toBe('#123456');
    view.destroy();
  });

  it('lays the plot out again when the margin changes', async () => {
    const { view, renderer } = await createView();
    view.setTheme({ margin: { left: 20, top: 4 } });

    expect(view.getPlotArea()).toEqual({
      left: 20,
      top: 4,
      width: 764,
      height: 564,
    });
    expect(renderer.resize).toHaveBeenLastCalledWith(764, 564, 1);
    const dataCanvas = container.querySelector<HTMLCanvasElement>(
      'canvas[data-dh-plot-layer=data]'
    );
    expect(dataCanvas?.style.left).toBe('20px');
    expect(dataCanvas?.style.top).toBe('4px');

    view.setTheme(undefined);
    expect(view.getPlotArea().left).toBe(defaultPlotTheme.margin.left);
    view.destroy();
  });

  it('stops following the page theme once destroyed', async () => {
    const { view, renderer } = await createView();
    view.destroy();
    container.style.setProperty('--dh-color-chart-grid', '#123456');
    document.documentElement.classList.add('theme-light');
    await nextFrame();
    expect(renderer.setTheme).not.toHaveBeenCalled();
  });
});

describe('hover', () => {
  /** A mock renderer that keeps its data, so hover can hit test it. */
  function makeDataRenderer(): PlotRenderer {
    const data = new Map<string, SeriesData>();
    return {
      ...makeRenderer(),
      setSeriesData: jest.fn((id: string, seriesData: SeriesData) => {
        data.set(id, seriesData);
      }),
      getSeriesData: jest.fn((id: string) => data.get(id)),
    };
  }

  function animationFrame(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => resolve());
    });
  }

  /** Moves the pointer to a point in data space, with the viewport pinned. */
  function pointAt(view: PlotView, x: number, y: number): void {
    const area = view.getPlotArea();
    const { xMin, xMax, yMin, yMax } = view.getViewport();
    container.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: area.left + ((x - xMin) / (xMax - xMin)) * area.width,
        clientY: area.top + ((yMax - y) / (yMax - yMin)) * area.height,
      })
    );
  }

  async function createView(
    renderer: PlotRenderer,
    tooltip?: boolean
  ): Promise<PlotView> {
    const source = new TestDataSource([
      {
        id: 'a',
        name: 'A',
        type: 'line',
        data: seriesDataFromArrays([0, 1, 2], [0, 1, 0]),
      },
      {
        id: 'b',
        name: 'B',
        type: 'line',
        data: seriesDataFromArrays([0, 1, 2], [2, 3, 2]),
      },
    ]);
    const view = new PlotView(container, source, {
      registry: makeRegistry(renderer),
      tooltip,
    });
    const idle = waitForIdle(view);
    await view.initialize();
    await idle;
    view.setViewport({ xMin: 0, xMax: 2, yMin: 0, yMax: 3 });
    await animationFrame();
    return view;
  }

  it('adds legend and hover layers above the data', async () => {
    const view = await createView(makeDataRenderer());
    const layers = Array.from(container.querySelectorAll('canvas')).map(
      canvas => canvas.getAttribute('data-dh-plot-layer')
    );
    expect(layers).toEqual(['axes', 'data', 'legend', 'hover']);
    view.destroy();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('reports every line at the x under the cursor, then none on leave', async () => {
    const view = await createView(makeDataRenderer());
    const onHover = jest.fn();
    view.addEventListener('hover', onHover);

    pointAt(view, 0.9, 0.5);
    await animationFrame();
    expect(onHover).toHaveBeenCalledTimes(1);
    const { hover } = onHover.mock.calls[0][0];
    expect(
      hover.points.map(({ seriesId, x, y }: { [key: string]: unknown }) => [
        seriesId,
        x,
        y,
      ])
    ).toEqual([
      ['a', 1, 1],
      ['b', 1, 3],
    ]);
    expect(view.getHover()).toBe(hover);

    // Moving within the same points does not report again
    pointAt(view, 1.1, 2);
    await animationFrame();
    expect(onHover).toHaveBeenCalledTimes(1);

    container.dispatchEvent(new MouseEvent('pointerleave'));
    await animationFrame();
    expect(onHover).toHaveBeenLastCalledWith({ hover: undefined });
    expect(view.getHover()).toBeUndefined();
    view.destroy();
  });

  it('redraws only the hover layer when the cursor moves', async () => {
    const renderer = makeDataRenderer();
    const view = await createView(renderer);
    const renders = (renderer.render as jest.Mock).mock.calls.length;
    pointAt(view, 1, 1);
    await animationFrame();
    expect(view.getHover()).toBeDefined();
    expect(renderer.render).toHaveBeenCalledTimes(renders);
    view.destroy();
  });

  it('follows data that changes under a still cursor', async () => {
    const renderer = makeDataRenderer();
    const view = await createView(renderer);
    pointAt(view, 1, 1);
    await animationFrame();
    expect(view.getHover()?.points[0].y).toBe(1);

    renderer.setSeriesData('a', seriesDataFromArrays([0, 1, 2], [0, 2, 0]));
    view.invalidate();
    await animationFrame();
    expect(view.getHover()?.points[0].y).toBe(2);
    view.destroy();
  });

  it('skips hit testing when no tooltip is drawn and nobody listens', async () => {
    const renderer = makeDataRenderer();
    const view = await createView(renderer, false);
    pointAt(view, 1, 1);
    await animationFrame();
    expect(renderer.getSeriesData).not.toHaveBeenCalled();
    expect(view.getHover()).toBeUndefined();

    // A listener alone is enough to hit test
    const onHover = jest.fn();
    view.addEventListener('hover', onHover);
    pointAt(view, 1, 1.5);
    await animationFrame();
    expect(onHover).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('turns the tooltip on without recreating the view', async () => {
    const renderer = makeDataRenderer();
    const view = await createView(renderer, false);
    pointAt(view, 1, 1);
    await animationFrame();
    expect(view.getHover()).toBeUndefined();

    view.setTooltip({ guides: true });
    await animationFrame();
    expect(view.getHover()?.points).toHaveLength(2);
    view.destroy();
  });
});
