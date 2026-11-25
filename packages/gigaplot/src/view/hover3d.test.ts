import { seriesData3DFromArrays, type PlotShape } from '../model/PlotTypes';
import { createProjection3D } from '../scale/projection3d';
import { defaultPlotTheme } from '../theme/PlotTheme';
import { findHover3D, hover3DPointsEqual } from './hover3d';

const SHAPE: PlotShape = {
  series: [
    { id: 'a', name: 'A', type: 'scatter3d' },
    { id: 'b', name: 'B', type: 'scatter3d' },
  ],
};

// Looking along +y, so a larger y is farther away, and x and z both 0 is the middle
const PROJECTION = createProjection3D({
  bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1, zMin: -1, zMax: 1 },
  camera: { azimuth: -90, elevation: 0, fov: 35 },
  width: 200,
  height: 200,
});

function hoverAt(
  x: number,
  y: number,
  data: Record<string, ReturnType<typeof seriesData3DFromArrays>>
) {
  return findHover3D({
    shape: SHAPE,
    projection: PROJECTION,
    cursor: { x, y },
    theme: defaultPlotTheme,
    perspectivePoints: false,
    getSeriesData: id => data[id],
  });
}

it('finds the point under the cursor, with all three values', () => {
  const hover = hoverAt(101, 99, {
    a: seriesData3DFromArrays([0, 0.8], [0, 0], [0, 0.8]),
  });
  expect(hover).toMatchObject({
    seriesId: 'a',
    index: 0,
    name: 'A',
    x: 0,
    y: 0,
    z: 0,
  });
  expect(hover?.screenX).toBeCloseTo(100);
  expect(hover?.screenY).toBeCloseTo(100);
});

it('finds nothing away from every point', () => {
  expect(
    hoverAt(20, 20, { a: seriesData3DFromArrays([0], [0], [0]) })
  ).toBeUndefined();
});

it('prefers the point nearer the camera when two are under the cursor', () => {
  const hover = hoverAt(100, 100, {
    a: seriesData3DFromArrays([0], [0.5], [0]),
    b: seriesData3DFromArrays([0], [-0.5], [0]),
  });
  expect(hover?.seriesId).toBe('b');
});

it('compares hovered points by identity and value', () => {
  const data = { a: seriesData3DFromArrays([0], [0], [0]) };
  const first = hoverAt(100, 100, data);
  const second = hoverAt(101, 100, data);
  expect(hover3DPointsEqual(first, second)).toBe(true);
  expect(hover3DPointsEqual(first, undefined)).toBe(false);
  expect(hover3DPointsEqual(undefined, undefined)).toBe(true);
});
