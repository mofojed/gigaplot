import type { Bounds3D } from '../model/PlotTypes';
import {
  clipToPixel,
  createProjection3D,
  getDepthFadeOpacity,
  getFitDistance,
  getPointSizeAtDepth,
  MAX_PERSPECTIVE_POINT_SCALE,
  projectPoint,
  transformPoint,
  translateMatrix,
  type ClipPoint,
} from './projection3d';

const BOX: Bounds3D = {
  xMin: 0,
  xMax: 10,
  yMin: -5,
  yMax: 5,
  zMin: 100,
  zMax: 200,
};

function project(
  camera: Parameters<typeof createProjection3D>[0]['camera'],
  x: number,
  y: number,
  z: number
) {
  const projection = createProjection3D({
    bounds: BOX,
    camera,
    width: 400,
    height: 300,
  });
  return projectPoint(projection, x, y, z);
}

it('puts the center of the box in the middle of the plot', () => {
  const point = project({ azimuth: -60, elevation: 25, fov: 35 }, 5, 0, 150);
  expect(point?.x).toBeCloseTo(200);
  expect(point?.y).toBeCloseTo(150);
});

it('looks along +y with x to the right and z up at an azimuth of -90', () => {
  const camera = { azimuth: -90, elevation: 0, fov: 35 };
  const center = project(camera, 5, 0, 150);
  const right = project(camera, 10, 0, 150);
  const up = project(camera, 5, 0, 200);
  const far = project(camera, 5, 5, 150);
  const near = project(camera, 5, -5, 150);

  expect(right?.x).toBeGreaterThan(center?.x ?? Infinity);
  expect(right?.y).toBeCloseTo(center?.y ?? NaN);
  // Screen y runs down
  expect(up?.y).toBeLessThan(center?.y ?? -Infinity);
  expect(far?.depth).toBeGreaterThan(near?.depth ?? Infinity);
});

it('keeps a well defined up when looking straight down', () => {
  const camera = { azimuth: -90, elevation: 90, fov: 35 };
  const center = project(camera, 5, 0, 150);
  const right = project(camera, 10, 0, 150);
  const ahead = project(camera, 5, 5, 150);

  expect(center?.x).toBeCloseTo(200);
  expect(right?.x).toBeGreaterThan(center?.x ?? Infinity);
  expect(ahead?.y).toBeLessThan(center?.y ?? -Infinity);
});

it('fits every corner of the box in view by default', () => {
  const projection = createProjection3D({
    bounds: BOX,
    camera: { azimuth: -30, elevation: 40, fov: 35 },
    width: 400,
    height: 300,
  });
  for (let corner = 0; corner < 8; corner += 1) {
    /* eslint-disable no-bitwise */
    const point = projectPoint(
      projection,
      corner & 1 ? BOX.xMax : BOX.xMin,
      corner & 2 ? BOX.yMax : BOX.yMin,
      corner & 4 ? BOX.zMax : BOX.zMin
    );
    /* eslint-enable no-bitwise */
    expect(point).toBeDefined();
    expect(point?.x).toBeGreaterThanOrEqual(0);
    expect(point?.x).toBeLessThanOrEqual(400);
    expect(point?.y).toBeGreaterThanOrEqual(0);
    expect(point?.y).toBeLessThanOrEqual(300);
  }
  expect(projection.distance).toBeCloseTo(getFitDistance(35, 400 / 300));
});

it('reports points behind the camera as not visible', () => {
  // Inside the box, at its top, looking down
  const camera = { azimuth: -90, elevation: 90, distance: 0.5, fov: 60 };
  expect(project(camera, 5, 0, 190)).toBeUndefined();
  expect(project(camera, 5, 0, 120)).toBeDefined();
});

it('gives a flat box some depth rather than dividing by zero', () => {
  const projection = createProjection3D({
    bounds: { ...BOX, zMin: 7, zMax: 7 },
    camera: { azimuth: -60, elevation: 25, fov: 35 },
    width: 100,
    height: 100,
  });
  expect(projection.bounds.zMin).toBe(6.5);
  expect(projection.bounds.zMax).toBe(7.5);
  expect(Array.from(projection.matrix).every(Number.isFinite)).toBe(true);
});

it('translates a matrix so it takes coordinates relative to an origin', () => {
  const { matrix } = createProjection3D({
    bounds: BOX,
    camera: { azimuth: 10, elevation: 20, fov: 35 },
    width: 100,
    height: 100,
  });
  const origin: [number, number, number] = [3, -2, 140];
  const translated = translateMatrix(matrix, ...origin);
  const absolute: ClipPoint = [0, 0, 0, 0];
  const relative: ClipPoint = [0, 0, 0, 0];
  transformPoint(matrix, 4, 1, 170, absolute);
  transformPoint(translated, 4 - 3, 1 + 2, 170 - 140, relative);
  for (let i = 0; i < 4; i += 1) {
    expect(relative[i]).toBeCloseTo(absolute[i]);
  }
  expect(clipToPixel(relative, 100, 100)[0]).toBeCloseTo(
    clipToPixel(absolute, 100, 100)[0]
  );
});

it('scales points with perspective, up to a limit', () => {
  expect(getPointSizeAtDepth(4, 2, 4, false)).toBe(4);
  expect(getPointSizeAtDepth(4, 4, 4, true)).toBe(4);
  expect(getPointSizeAtDepth(4, 8, 4, true)).toBe(2);
  expect(getPointSizeAtDepth(4, 1e-6, 4, true)).toBe(
    4 * MAX_PERSPECTIVE_POINT_SCALE
  );
});

it('fades points linearly from the nearest to the farthest depth', () => {
  expect(getDepthFadeOpacity(5, [2, 10], 0)).toBe(1);
  expect(getDepthFadeOpacity(2, [2, 10], 1)).toBe(1);
  expect(getDepthFadeOpacity(6, [2, 10], 1)).toBeCloseTo(0.5);
  expect(getDepthFadeOpacity(10, [2, 10], 0.8)).toBeCloseTo(0.2);
  expect(getDepthFadeOpacity(20, [2, 10], 1)).toBe(0);
});
