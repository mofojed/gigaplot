import {
  ohlcSeriesDataFromArrays,
  seriesDataFromArrays,
  type PlotFill,
  type PlotShape,
  type SeriesData,
} from '../../model/PlotTypes';
import { defaultPlotTheme } from '../../theme/PlotTheme';
import { CanvasRenderer, canvasRendererFactory } from './CanvasRenderer';

const SHAPE: PlotShape = {
  series: [{ id: 'a', name: 'A', type: 'line' }],
};

async function makeRenderer(data: SeriesData): Promise<CanvasRenderer> {
  const renderer = new CanvasRenderer();
  await renderer.initialize(document.createElement('canvas'), defaultPlotTheme);
  renderer.resize(100, 100, 1);
  renderer.setShape(SHAPE);
  renderer.setSeriesData('a', data);
  return renderer;
}

it('reports support in a browser environment', async () => {
  expect(await canvasRendererFactory.isSupported()).toBe(true);
});

it('does not mutate the data the source handed it', async () => {
  // Sources are allowed to return their own arrays, so a delta applied by the
  // renderer must not append into them
  const sourceData = seriesDataFromArrays([0, 1, 2], [0, 1, 0]);
  const renderer = await makeRenderer(sourceData);

  renderer.applyDeltas([
    { type: 'append', seriesId: 'a', data: seriesDataFromArrays([3], [1]) },
  ]);

  expect(sourceData.length).toBe(3);
});

it('drops data for series removed from the shape', async () => {
  const renderer = await makeRenderer(seriesDataFromArrays([0, 1], [0, 1]));
  renderer.setShape({ series: [] });
  renderer.setViewport({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });

  expect(() => renderer.render()).not.toThrow();
});

it('renders scatter and line series without a viewport span', async () => {
  const renderer = await makeRenderer(seriesDataFromArrays([0, 1], [0, 1]));
  renderer.setShape({
    series: [
      { id: 'a', name: 'A', type: 'line' },
      { id: 'b', name: 'B', type: 'scatter' },
    ],
  });
  renderer.setSeriesData('b', seriesDataFromArrays([0, 1], [1, 0]));
  renderer.setViewport({ xMin: 0, xMax: 0, yMin: 0, yMax: 0 });

  expect(() => renderer.render()).not.toThrow();
});

it('skips non finite points', async () => {
  const renderer = await makeRenderer(
    seriesDataFromArrays([0, NaN, 2], [0, 1, 0])
  );
  renderer.setViewport({ xMin: 0, xMax: 2, yMin: 0, yMax: 1 });

  expect(() => renderer.render()).not.toThrow();
});

it('draws ohlc and candlestick bars in their direction colors', async () => {
  const canvas = document.createElement('canvas');
  const renderer = new CanvasRenderer();
  await renderer.initialize(canvas, defaultPlotTheme);
  renderer.resize(100, 100, 1);
  renderer.setShape({
    series: [
      { id: 'o', name: 'O', type: 'ohlc' },
      { id: 'c', name: 'C', type: 'candlestick' },
    ],
  });
  const bars = ohlcSeriesDataFromArrays(
    [0, 1, 2],
    [1, 3, NaN],
    [4, 4, 4],
    [0, 0, 0],
    [3, 1, 2]
  );
  renderer.setSeriesData('o', bars);
  renderer.setSeriesData('c', bars);
  renderer.setViewport({ xMin: -1, xMax: 3, yMin: 0, yMax: 4 });
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const strokes: unknown[] = [];
  jest.spyOn(context, 'stroke').mockImplementation(() => {
    strokes.push(context.strokeStyle);
  });
  const fill = jest.spyOn(context, 'fill');

  renderer.render();

  // Each series strokes its increasing bars, then its decreasing ones
  expect(strokes).toEqual([
    defaultPlotTheme.ohlcIncreasingColor,
    defaultPlotTheme.ohlcDecreasingColor,
    defaultPlotTheme.ohlcIncreasingColor,
    defaultPlotTheme.ohlcDecreasingColor,
  ]);
  // Only candlesticks have bodies to fill
  expect(fill).toHaveBeenCalledTimes(2);
});

describe('area', () => {
  async function makeAreaRenderer(
    fill?: PlotFill
  ): Promise<{ renderer: CanvasRenderer; context: CanvasRenderingContext2D }> {
    const canvas = document.createElement('canvas');
    const renderer = new CanvasRenderer();
    await renderer.initialize(canvas, defaultPlotTheme);
    renderer.resize(100, 100, 1);
    renderer.setShape({
      series: [
        { id: 'a', name: 'A', type: 'area', style: { fill, color: '#ff0000' } },
        { id: 'b', name: 'B', type: 'line', style: { color: '#00ff00' } },
      ],
    });
    renderer.setSeriesData('a', seriesDataFromArrays([0, 10], [5, 10]));
    renderer.setSeriesData('b', seriesDataFromArrays([0, 10], [1, 2]));
    renderer.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { renderer, context };
  }

  it('fills every area before drawing any line', async () => {
    const { renderer, context } = await makeAreaRenderer();
    const calls: string[] = [];
    jest.spyOn(context, 'fill').mockImplementation(() => {
      calls.push(`fill ${String(context.fillStyle)}`);
    });
    jest.spyOn(context, 'stroke').mockImplementation(() => {
      calls.push(`stroke ${String(context.strokeStyle)}`);
    });

    renderer.render();

    expect(calls).toEqual([
      'fill rgba(255, 0, 0, 0.5)',
      'stroke #ff0000',
      'stroke #00ff00',
    ]);
  });

  it('fills down to zero, or the base', async () => {
    const { renderer, context } = await makeAreaRenderer();
    const lineTo = jest.spyOn(context, 'lineTo');
    jest.spyOn(context, 'stroke').mockImplementation(() => undefined);

    renderer.render();
    // Along the top to (10, 10), then back along zero, at the bottom
    expect(lineTo.mock.calls.slice(0, 3)).toEqual([
      [100, 0],
      [100, 100],
      [0, 100],
    ]);

    lineTo.mockClear();
    renderer.setSeriesData('a', {
      ...seriesDataFromArrays([0, 10], [5, 10]),
      base: Float64Array.from([2, 4]),
    });
    renderer.render();
    expect(lineTo.mock.calls.slice(0, 3)).toEqual([
      [100, 0],
      [100, 60],
      [0, 80],
    ]);
  });

  it('fills with a gradient between the stops', async () => {
    const { renderer, context } = await makeAreaRenderer({
      type: 'linear',
      units: 'data',
      stops: [
        { offset: 0, opacity: 0 },
        { offset: 10, color: '#0000ff' },
      ],
    });
    const createLinearGradient = jest.spyOn(context, 'createLinearGradient');

    renderer.render();

    // From y = 0 at the bottom to y = 10 at the top
    expect(createLinearGradient).toHaveBeenCalledWith(0, 100, 0, 0);
    const gradient = createLinearGradient.mock.results[0]
      .value as CanvasGradient;
    expect(context.fillStyle).toBe(gradient);
  });

  it('spreads a hard edge in data units over a pixel', async () => {
    const { renderer, context } = await makeAreaRenderer({
      type: 'linear',
      units: 'data',
      stops: [
        { offset: 5, color: '#ff0000' },
        { offset: 5, color: '#00ff00' },
      ],
    });
    const createLinearGradient = jest.spyOn(context, 'createLinearGradient');

    renderer.render();

    // Centered on y = 5, running up the plot like the axis
    const [x0, y0, x1, y1] = createLinearGradient.mock.calls[0];
    expect([x0, x1]).toEqual([0, 0]);
    expect(y0).toBeCloseTo(50.5);
    expect(y1).toBeCloseTo(49.5);
  });

  it('skips the line of an area with no line width', async () => {
    const { renderer, context } = await makeAreaRenderer();
    renderer.setShape({
      series: [{ id: 'a', name: 'A', type: 'area', style: { lineWidth: 0 } }],
    });
    const stroke = jest.spyOn(context, 'stroke');

    renderer.render();

    expect(stroke).not.toHaveBeenCalled();
  });
});

describe('stale resolution', () => {
  const VIEWPORT = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

  function getContext(renderer: CanvasRenderer): CanvasRenderingContext2D {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (renderer as any).context;
  }

  it('draws on the coarse grid and scales it up without smoothing', async () => {
    const renderer = await makeRenderer(seriesDataFromArrays([0, 10], [0, 10]));
    renderer.setViewport(VIEWPORT);
    // Four screen pixels per data pixel in both directions
    renderer.setSeriesResolution('a', {
      xOrigin: 0,
      xPerPixel: 0.4,
      yOrigin: 0,
      yPerPixel: 0.4,
    });
    const context = getContext(renderer);
    const smoothing: boolean[] = [];
    jest.spyOn(context, 'drawImage').mockImplementation(() => {
      smoothing.push(context.imageSmoothingEnabled);
    });

    renderer.render();

    expect(context.drawImage).toHaveBeenCalledTimes(1);
    const [image, x, y, width, height] = (context.drawImage as jest.Mock).mock
      .calls[0];
    expect(image).toBeInstanceOf(HTMLCanvasElement);
    expect((image as HTMLCanvasElement).width).toBe(25);
    expect((image as HTMLCanvasElement).height).toBe(25);
    expect([x, y, width, height]).toEqual([0, 0, 100, 100]);
    expect(smoothing).toEqual([false]);
    expect(context.imageSmoothingEnabled).toBe(true);
  });

  it('draws sharp when the data is as fine as the screen', async () => {
    const renderer = await makeRenderer(seriesDataFromArrays([0, 10], [0, 10]));
    renderer.setViewport(VIEWPORT);
    renderer.setSeriesResolution('a', {
      xOrigin: 0,
      xPerPixel: 0.1,
      yOrigin: 0,
      yPerPixel: 0.1,
    });
    const context = getContext(renderer);
    const drawImage = jest.spyOn(context, 'drawImage');

    renderer.render();

    expect(drawImage).not.toHaveBeenCalled();
  });

  it('draws retained data faded under the current data until released', async () => {
    const renderer = await makeRenderer(seriesDataFromArrays([0, 10], [0, 10]));
    renderer.setViewport(VIEWPORT);
    renderer.retainSeriesData('a');
    renderer.setSeriesData('a', seriesDataFromArrays([0, 10], [10, 0]));
    renderer.setRetainedSeriesOpacity('a', 0.5);
    const context = getContext(renderer);
    const alphas: number[] = [];
    jest.spyOn(context, 'stroke').mockImplementation(() => {
      alphas.push(context.globalAlpha);
    });

    renderer.render();
    expect(alphas).toEqual([0.5, 1]);

    alphas.length = 0;
    renderer.setRetainedSeriesOpacity('a', 0);
    renderer.render();
    expect(alphas).toEqual([1]);
  });
});
