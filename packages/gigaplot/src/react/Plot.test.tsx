import { render, screen, waitFor } from '@testing-library/react';
import { seriesDataFromArrays } from '../model/PlotTypes';
import type {
  PlotRenderer,
  PlotRendererFactory,
} from '../renderers/PlotRenderer';
import { RendererRegistry } from '../renderers/RendererRegistry';
import { StaticDataSource } from '../sources/StaticDataSource';
import { Plot } from './Plot';

function makeRenderer(name: string): PlotRenderer {
  return {
    name,
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

function makeFactory(
  name: string,
  supported: boolean,
  renderer: PlotRenderer
): PlotRendererFactory {
  return {
    name,
    capabilities: renderer.capabilities,
    isSupported: async () => supported,
    create: () => renderer,
  };
}

function makeSource(): StaticDataSource {
  return new StaticDataSource([
    {
      id: 'a',
      name: 'A',
      type: 'line',
      data: seriesDataFromArrays([0, 1, 2], [0, 1, 0]),
    },
  ]);
}

let boundingRectSpy: jest.SpyInstance;

beforeEach(() => {
  boundingRectSpy = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 800, 600));
});

afterEach(() => {
  boundingRectSpy.mockRestore();
});

it('renders the plot with the preferred renderer', async () => {
  const registry = new RendererRegistry();
  registry.register(makeFactory('webgpu', true, makeRenderer('webgpu')));
  registry.register(makeFactory('canvas', true, makeRenderer('canvas')));
  const onRendererChanged = jest.fn();

  render(
    <Plot
      source={makeSource()}
      registry={registry}
      rendererPreference={['webgpu', 'canvas']}
      onRendererChanged={onRendererChanged}
    />
  );

  await waitFor(() => expect(onRendererChanged).toHaveBeenCalledWith('webgpu'));
});

it('falls back when the preferred renderer is unsupported', async () => {
  const registry = new RendererRegistry();
  registry.register(makeFactory('webgpu', false, makeRenderer('webgpu')));
  registry.register(makeFactory('canvas', true, makeRenderer('canvas')));
  const onRendererChanged = jest.fn();

  render(
    <Plot
      source={makeSource()}
      registry={registry}
      rendererPreference={['webgpu', 'canvas']}
      onRendererChanged={onRendererChanged}
    />
  );

  await waitFor(() => expect(onRendererChanged).toHaveBeenCalledWith('canvas'));
});

it('reports an error when nothing can render', async () => {
  const registry = new RendererRegistry();
  registry.register(makeFactory('webgpu', false, makeRenderer('webgpu')));
  const onError = jest.fn();

  render(
    <Plot
      source={makeSource()}
      registry={registry}
      rendererPreference={['webgpu']}
      onError={onError}
    />
  );

  await waitFor(() => expect(onError).toHaveBeenCalled());
});

it('tears the renderer down on unmount', async () => {
  const renderer = makeRenderer('canvas');
  const registry = new RendererRegistry();
  registry.register(makeFactory('canvas', true, renderer));
  const onRendererChanged = jest.fn();

  const { unmount } = render(
    <Plot
      source={makeSource()}
      registry={registry}
      rendererPreference={['canvas']}
      onRendererChanged={onRendererChanged}
    />
  );
  await waitFor(() => expect(onRendererChanged).toHaveBeenCalled());

  unmount();
  expect(renderer.destroy).toHaveBeenCalled();
});

it('applies a className to the container', () => {
  const { container } = render(
    <Plot
      source={makeSource()}
      registry={new RendererRegistry()}
      className="test-plot"
    />
  );
  expect(container.querySelector('.test-plot')).not.toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('applies theme overrides without recreating the view', async () => {
  const renderer = makeRenderer('canvas');
  const registry = new RendererRegistry();
  registry.register(makeFactory('canvas', true, renderer));
  const onRendererChanged = jest.fn();
  const source = makeSource();

  const { rerender } = render(
    <Plot
      source={source}
      registry={registry}
      theme={{ gridColor: 'red' }}
      onRendererChanged={onRendererChanged}
    />
  );
  await waitFor(() => expect(onRendererChanged).toHaveBeenCalled());
  expect(renderer.initialize).toHaveBeenCalledWith(
    expect.any(HTMLCanvasElement),
    expect.objectContaining({ gridColor: 'red' })
  );

  rerender(
    <Plot
      source={source}
      registry={registry}
      theme={{ gridColor: 'blue' }}
      onRendererChanged={onRendererChanged}
    />
  );
  await waitFor(() =>
    expect(renderer.setTheme).toHaveBeenCalledWith(
      expect.objectContaining({ gridColor: 'blue' })
    )
  );
  expect(renderer.initialize).toHaveBeenCalledTimes(1);
});

it('reports hover, and changes the tooltip without recreating the view', async () => {
  const data = seriesDataFromArrays([0, 1, 2], [0, 1, 0]);
  const renderer: PlotRenderer = {
    ...makeRenderer('canvas'),
    getSeriesData: jest.fn(() => data),
  };
  const registry = new RendererRegistry();
  registry.register(makeFactory('canvas', true, renderer));
  const onRendererChanged = jest.fn();
  const onHover = jest.fn();
  const source = makeSource();

  const { container, rerender } = render(
    <Plot
      source={source}
      registry={registry}
      tooltip={false}
      onRendererChanged={onRendererChanged}
      onHover={onHover}
    />
  );
  await waitFor(() => expect(onRendererChanged).toHaveBeenCalled());
  const plot = container.firstElementChild as HTMLElement;
  plot.dispatchEvent(
    new MouseEvent('pointermove', { clientX: 400, clientY: 300 })
  );
  await waitFor(() =>
    expect(onHover).toHaveBeenCalledWith(
      expect.objectContaining({
        points: [expect.objectContaining({ seriesId: 'a', x: 1, y: 1 })],
      })
    )
  );

  rerender(
    <Plot
      source={source}
      registry={registry}
      tooltip={{ yAxisLabels: true }}
      onRendererChanged={onRendererChanged}
      onHover={onHover}
    />
  );
  expect(renderer.initialize).toHaveBeenCalledTimes(1);
});
