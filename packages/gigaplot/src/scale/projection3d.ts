import type { Bounds3D } from '../model/PlotTypes';

/**
 * Where a 3D plot is viewed from. The camera orbits the center of the plot's
 * box, which is scaled to a cube from -1 to 1 on every axis, with z up.
 */
export interface Plot3DCamera {
  /**
   * Angle around the z axis in degrees, counterclockwise from the +x axis
   * looking down. -90 looks along +y, with x to the right.
   */
  azimuth: number;
  /** Angle above the x-y plane in degrees, from -90 below to 90 above. */
  elevation: number;
  /**
   * Distance from the center of the box, in units of half the box's edge, so
   * below 1 is inside the box. Defaults to the distance that fits the box in
   * view.
   */
  distance?: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

export const DEFAULT_PLOT_3D_CAMERA: Readonly<
  Required<Omit<Plot3DCamera, 'distance'>>
> = Object.freeze({ azimuth: -60, elevation: 25, fov: 35 });

/** Radius of the sphere around the box, which the default distance fits in view. */
const BOX_RADIUS = Math.sqrt(3);

/** Distance from the box center at which the whole box fits the view. */
export function getFitDistance(fov: number, aspect: number): number {
  const halfVertical = (Math.max(1, Math.min(179, fov)) * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const half = Math.min(halfVertical, halfHorizontal);
  return BOX_RADIUS / Math.sin(half);
}

/**
 * Transforms data into clip space for a 3D plot, and back out to the pixels
 * of the plot area. Matrices are column major, as WGSL reads them, and kept in
 * 64 bit floats until a renderer folds in its own origin.
 */
export interface Projection3D {
  /** Data coordinates to clip space. */
  matrix: Float64Array;
  /** Size of the plot area in CSS pixels. */
  width: number;
  height: number;
  /** The data box mapped onto the cube from -1 to 1. */
  bounds: Bounds3D;
  /** Camera position in cube coordinates. */
  eye: [number, number, number];
  /** Distance from the camera to the center of the box. */
  distance: number;
  /** Depths in front of the camera of the nearest and farthest box corners. */
  depthRange: [number, number];
}

/** A point in clip space: x, y, z, w. */
export type ClipPoint = [number, number, number, number];

function normalize(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
}

function cross(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** `a * b` for column major 4x4 matrices. */
export function multiplyMatrices(
  a: Float64Array,
  b: Float64Array
): Float64Array {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * `matrix` applied after translating by `origin`, so it takes coordinates
 * relative to `origin`. This is how renderers keep f32 positions precise.
 */
export function translateMatrix(
  matrix: Float64Array,
  x: number,
  y: number,
  z: number
): Float64Array {
  const out = new Float64Array(matrix);
  for (let row = 0; row < 4; row += 1) {
    out[12 + row] =
      matrix[row] * x +
      matrix[4 + row] * y +
      matrix[8 + row] * z +
      matrix[12 + row];
  }
  return out;
}

/** Writes `matrix * (x, y, z, 1)` into `out`. */
export function transformPoint(
  matrix: Float64Array,
  x: number,
  y: number,
  z: number,
  out: ClipPoint | Float64Array
): void {
  for (let row = 0; row < 4; row += 1) {
    // eslint-disable-next-line no-param-reassign
    out[row] =
      matrix[row] * x +
      matrix[4 + row] * y +
      matrix[8 + row] * z +
      matrix[12 + row];
  }
}

/** Gives a zero span a width, so a flat box still maps to a cube. */
function getRange(min: number, max: number): [number, number] {
  if (!(max > min)) {
    const center = Number.isFinite(min) ? min : 0;
    return [center - 0.5, center + 0.5];
  }
  return [min, max];
}

/** The camera's position in cube coordinates. */
export function getCameraEye(
  azimuth: number,
  elevation: number,
  distance: number
): [number, number, number] {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [
    distance * Math.cos(el) * Math.cos(az),
    distance * Math.cos(el) * Math.sin(az),
    distance * Math.sin(el),
  ];
}

export interface Projection3DInput {
  bounds: Bounds3D;
  camera: Plot3DCamera;
  width: number;
  height: number;
}

/** Builds the projection of a data box seen from `camera`. */
export function createProjection3D({
  bounds,
  camera,
  width,
  height,
}: Projection3DInput): Projection3D {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const distance = Math.max(
    1e-3,
    camera.distance ?? getFitDistance(camera.fov, aspect)
  );
  const elevation = Math.max(-90, Math.min(90, camera.elevation));
  const eye = getCameraEye(camera.azimuth, elevation, distance);

  // The up vector leans back with the elevation, so looking straight down
  // still has a well defined up rather than a degenerate cross product
  const az = (camera.azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const up: [number, number, number] = [
    -Math.sin(el) * Math.cos(az),
    -Math.sin(el) * Math.sin(az),
    Math.cos(el),
  ];
  const forward = normalize([-eye[0], -eye[1], -eye[2]]);
  const right = normalize(cross(forward, up));
  const trueUp = cross(right, forward);

  // Anything nearer than this is clipped, so it must stay positive even when
  // the camera is inside the box
  const far = distance + BOX_RADIUS * 2;
  const near = Math.max(far * 1e-4, Math.min(distance - BOX_RADIUS, 0.05));

  // prettier-ignore
  const view = new Float64Array([
    right[0], trueUp[0], -forward[0], 0,
    right[1], trueUp[1], -forward[1], 0,
    right[2], trueUp[2], -forward[2], 0,
    -dot(right, eye), -dot(trueUp, eye), dot(forward, eye), 1,
  ]);

  const focal =
    1 / Math.tan((Math.max(1, Math.min(179, camera.fov)) * Math.PI) / 360);
  // WebGPU clip space depth runs from 0 at the near plane to 1 at the far
  // prettier-ignore
  const projection = new Float64Array([
    focal / aspect, 0, 0, 0,
    0, focal, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ]);

  const [xMin, xMax] = getRange(bounds.xMin, bounds.xMax);
  const [yMin, yMax] = getRange(bounds.yMin, bounds.yMax);
  const [zMin, zMax] = getRange(bounds.zMin, bounds.zMax);
  const xScale = 2 / (xMax - xMin);
  const yScale = 2 / (yMax - yMin);
  const zScale = 2 / (zMax - zMin);
  // prettier-ignore
  const model = new Float64Array([
    xScale, 0, 0, 0,
    0, yScale, 0, 0,
    0, 0, zScale, 0,
    -(xMin + xMax) * 0.5 * xScale, -(yMin + yMax) * 0.5 * yScale, -(zMin + zMax) * 0.5 * zScale, 1,
  ]);

  const matrix = multiplyMatrices(projection, multiplyMatrices(view, model));

  let nearest = Infinity;
  let farthest = -Infinity;
  for (let corner = 0; corner < 8; corner += 1) {
    /* eslint-disable no-bitwise */
    const point: [number, number, number] = [
      corner & 1 ? 1 : -1,
      corner & 2 ? 1 : -1,
      corner & 4 ? 1 : -1,
    ];
    /* eslint-enable no-bitwise */
    const depth = dot(forward, [
      point[0] - eye[0],
      point[1] - eye[1],
      point[2] - eye[2],
    ]);
    nearest = Math.min(nearest, depth);
    farthest = Math.max(farthest, depth);
  }

  return {
    matrix,
    width,
    height,
    bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
    eye,
    distance,
    depthRange: [Math.max(near, nearest), farthest],
  };
}

/** Clip space point in front of the near plane to CSS pixels, y down. */
export function clipToPixel(
  clip: ClipPoint | Float64Array,
  width: number,
  height: number
): [number, number] {
  return [
    ((clip[0] / clip[3]) * 0.5 + 0.5) * width,
    (0.5 - (clip[1] / clip[3]) * 0.5) * height,
  ];
}

/** True if a clip space point is in front of the camera and before the far plane. */
export function isClipVisible(clip: ClipPoint | Float64Array): boolean {
  return clip[3] > 0 && clip[2] >= 0 && clip[2] <= clip[3];
}

/**
 * Projects a data point to CSS pixels of the plot area, y down, with its
 * depth in front of the camera. Undefined if it is behind the camera.
 */
export function projectPoint(
  projection: Projection3D,
  x: number,
  y: number,
  z: number
): { x: number; y: number; depth: number } | undefined {
  const clip: ClipPoint = [0, 0, 0, 0];
  transformPoint(projection.matrix, x, y, z, clip);
  if (!isClipVisible(clip)) {
    return undefined;
  }
  const [px, py] = clipToPixel(clip, projection.width, projection.height);
  return { x: px, y: py, depth: clip[3] };
}

/**
 * Most a point drawn with perspective scaling grows as it nears the camera,
 * as a multiple of its size at the center of the box.
 */
export const MAX_PERSPECTIVE_POINT_SCALE = 8;

/**
 * Diameter to draw a point of `size` at `depth`. With perspective scaling it
 * is `size` at the center of the box and grows nearer the camera.
 */
export function getPointSizeAtDepth(
  size: number,
  depth: number,
  distance: number,
  isPerspective: boolean
): number {
  if (!isPerspective || !(depth > 0)) {
    return size;
  }
  return size * Math.min(MAX_PERSPECTIVE_POINT_SCALE, distance / depth);
}

/**
 * Opacity of a point at `depth` when fading with distance: 1 at the nearest
 * corner of the box, down to `1 - depthFade` at the farthest.
 */
export function getDepthFadeOpacity(
  depth: number,
  depthRange: readonly [number, number],
  depthFade: number
): number {
  if (!(depthFade > 0)) {
    return 1;
  }
  const [near, far] = depthRange;
  const t = far > near ? (depth - near) / (far - near) : 0;
  return 1 - Math.min(1, Math.max(0, depthFade)) * Math.min(1, Math.max(0, t));
}
