import { createRandom, createSeriesData3D, type SeriesData3D } from "gigaplot";

/** Approximately normal with a standard deviation of 0.5, which is plenty for demos. */
function gaussian(random: () => number): number {
  return random() + random() + random() - 1.5;
}

/** A gaussian cloud of points in 3D. Deterministic for a given seed. */
export function generateCluster3D(
  count: number,
  {
    seed = 1,
    center = [0, 0, 0],
    spread = [1, 1, 1],
  }: {
    seed?: number;
    center?: [number, number, number];
    spread?: [number, number, number];
  } = {},
): SeriesData3D {
  const random = createRandom(seed);
  const data = createSeriesData3D(count);
  for (let i = 0; i < count; i += 1) {
    data.x[i] = center[0] + gaussian(random) * spread[0];
    data.y[i] = center[1] + gaussian(random) * spread[1];
    data.z[i] = center[2] + gaussian(random) * spread[2];
  }
  data.length = count;
  return data;
}

export type Vector3 = [number, number, number];

/** The Lorenz system's classic chaotic parameters. */
const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;

/** Advances `state` along the Lorenz attractor by `dt`, in place, with RK4. */
export function stepLorenz(state: Vector3, dt: number): void {
  const derivative = ([x, y, z]: Vector3): Vector3 => [
    SIGMA * (y - x),
    x * (RHO - z) - y,
    x * y - BETA * z,
  ];
  const offset = (v: Vector3, d: Vector3, scale: number): Vector3 => [
    v[0] + d[0] * scale,
    v[1] + d[1] * scale,
    v[2] + d[2] * scale,
  ];
  const k1 = derivative(state);
  const k2 = derivative(offset(state, k1, dt / 2));
  const k3 = derivative(offset(state, k2, dt / 2));
  const k4 = derivative(offset(state, k3, dt));
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-param-reassign
    state[i] += ((k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * dt) / 6;
  }
}

/** A trajectory of `count` points along the Lorenz attractor from `start`. */
export function generateLorenz(
  count: number,
  { start = [1, 1, 1], dt = 0.005 }: { start?: Vector3; dt?: number } = {},
): SeriesData3D {
  const data = createSeriesData3D(count);
  const state: Vector3 = [...start];
  for (let i = 0; i < count; i += 1) {
    data.x[i] = state[0];
    data.y[i] = state[1];
    data.z[i] = state[2];
    stepLorenz(state, dt);
  }
  data.length = count;
  return data;
}

/** A helix around the z axis, `turns` times around from z = 0 to `height`. */
export function generateHelix(
  count: number,
  {
    radius = 1,
    turns = 5,
    height = 10,
    phase = 0,
  }: { radius?: number; turns?: number; height?: number; phase?: number } = {},
): SeriesData3D {
  const data = createSeriesData3D(count);
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    const angle = phase + t * turns * Math.PI * 2;
    data.x[i] = radius * Math.cos(angle);
    data.y[i] = radius * Math.sin(angle);
    data.z[i] = t * height;
  }
  data.length = count;
  return data;
}
