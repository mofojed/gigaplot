import { seriesData3DFromArrays, type PlotShape } from '../../model/PlotTypes';
import { createProjection3D } from '../../scale/projection3d';
import { defaultPlotTheme } from '../../theme/PlotTheme';
import {
  Canvas3DRenderer,
  canvas3DRendererFactory,
  clipSegment,
} from './Canvas3DRenderer';

const SHAPE: PlotShape = {
  series: [
    {
      id: 'near',
      name: 'Near',
      type: 'scatter3d',
      style: { color: '#0000ff' },
    },
    { id: 'far', name: 'Far', type: 'scatter3d', style: { color: '#ff0000' } },
  ],
};

async function makeRenderer(): Promise<{
  renderer: Canvas3DRenderer;
  context: CanvasRenderingContext2D;
}> {
  const canvas = document.createElement('canvas');
  const renderer = new Canvas3DRenderer();
  await renderer.initialize(canvas, defaultPlotTheme);
  renderer.resize(100, 100, 1);
  renderer.setShape(SHAPE);
  // Looking along +y, so a larger y is farther away
  renderer.setScene({
    projection: createProjection3D({
      bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1, zMin: -1, zMax: 1 },
      camera: { azimuth: -90, elevation: 0, fov: 35 },
      width: 100,
      height: 100,
    }),
    perspectivePoints: false,
    depthFade: 0,
  });
  return {
    renderer,
    context: canvas.getContext('2d') as CanvasRenderingContext2D,
  };
}

it('reports support in a browser environment', async () => {
  expect(await canvas3DRendererFactory.isSupported()).toBe(true);
  expect(canvas3DRendererFactory.capabilities.seriesTypes).toEqual([
    'scatter3d',
    'line3d',
  ]);
});

it('does not mutate the data the source handed it', async () => {
  const { renderer } = await makeRenderer();
  const sourceData = seriesData3DFromArrays([0], [0], [0]);
  renderer.setSeriesData('near', sourceData);
  renderer.applyDeltas([
    {
      type: 'append',
      seriesId: 'near',
      data: seriesData3DFromArrays([1], [1], [1]),
    },
  ]);
  expect(sourceData.length).toBe(1);
  expect(renderer.getSeriesData('near')?.length).toBe(2);
});

it('paints farther points first, whatever order their series are in', async () => {
  const { renderer, context } = await makeRenderer();
  renderer.setSeriesData('near', seriesData3DFromArrays([0], [-0.5], [0]));
  renderer.setSeriesData('far', seriesData3DFromArrays([0], [0.5], [0]));
  renderer.render();

  const fills = (
    context as unknown as {
      __getEvents: () => { type: string; props: { value?: string } }[];
    }
  )
    .__getEvents()
    .filter(event => event.type === 'fillStyle')
    .map(event => event.props.value);
  expect(fills).toEqual(['#ff0000', '#0000ff']);
});

it('draws lines, and skips points and segments that are not finite', async () => {
  const { renderer } = await makeRenderer();
  renderer.setShape({
    series: [{ id: 'line', name: 'Line', type: 'line3d' }],
  });
  renderer.setSeriesData(
    'line',
    seriesData3DFromArrays(
      [0, 0.5, Number.NaN, 0],
      [0, 0, 0, 0.5],
      [0, 0, 0, 0]
    )
  );
  expect(() => renderer.render()).not.toThrow();
});

it('clips a segment crossing the near plane where it crosses', () => {
  const start = new Float64Array(4);
  const end = new Float64Array(4);
  expect(
    clipSegment(
      new Float64Array([0, 0, -1, 1]),
      new Float64Array([0, 0, 1, 3]),
      start,
      end
    )
  ).toBe(true);
  expect(Array.from(start)).toEqual([0, 0, 0, 2]);
  expect(Array.from(end)).toEqual([0, 0, 1, 3]);

  expect(
    clipSegment(
      new Float64Array([0, 0, -1, 1]),
      new Float64Array([0, 0, -2, 1]),
      start,
      end
    )
  ).toBe(false);
  expect(
    clipSegment(
      new Float64Array([Number.NaN, 0, 1, 1]),
      new Float64Array([0, 0, 1, 1]),
      start,
      end
    )
  ).toBe(false);
});
