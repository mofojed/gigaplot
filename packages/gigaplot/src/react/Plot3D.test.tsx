import { render, waitFor } from '@testing-library/react';
import { seriesData3DFromArrays } from '../model/PlotTypes';
import { StaticDataSource } from '../sources/StaticDataSource';
import { Plot3D } from './Plot3D';

let boundingRectSpy: jest.SpyInstance;

beforeEach(() => {
  boundingRectSpy = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 800, 600));
});

afterEach(() => {
  boundingRectSpy.mockRestore();
});

it('draws 3D series with the default registry, falling back to canvas', async () => {
  const onRendererChanged = jest.fn();
  const onFrame = jest.fn();
  const source = new StaticDataSource([
    {
      id: 'a',
      name: 'A',
      type: 'line3d',
      data: seriesData3DFromArrays([0, 1, 2], [0, 1, 0], [2, 1, 0]),
    },
  ]);
  const { container, unmount } = render(
    <Plot3D
      source={source}
      onRendererChanged={onRendererChanged}
      onFrame={onFrame}
    />
  );

  // WebGPU is unavailable in jsdom
  await waitFor(() => expect(onRendererChanged).toHaveBeenCalledWith('canvas'));
  await waitFor(() =>
    expect(
      container.querySelector('[data-dh-plot-status=ready]')
    ).not.toBeNull()
  );
  await waitFor(() => expect(onFrame).toHaveBeenCalled());
  unmount();
  expect(container.querySelector('canvas')).toBeNull();
});
