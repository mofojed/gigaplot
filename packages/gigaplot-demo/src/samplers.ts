import type { Point } from './sources/RollingScatterSource';

/** Approximately normal with a standard deviation of 0.5, which is plenty for demos. */
function gaussian(random: () => number): number {
  return random() + random() + random() - 1.5;
}

/** A gaussian cloud whose center orbits the origin. */
export function orbitingCluster({
  radius,
  speed,
  phase = 0,
  spread = 1,
}: {
  radius: number;
  /** Radians per tick. */
  speed: number;
  phase?: number;
  spread?: number;
}): (time: number, random: () => number, out: Point) => void {
  return (time, random, out) => {
    const angle = phase + time * speed;
    // eslint-disable-next-line no-param-reassign
    out.x = radius * Math.cos(angle) + gaussian(random) * spread;
    // eslint-disable-next-line no-param-reassign
    out.y = radius * Math.sin(angle) + gaussian(random) * spread;
  };
}

/** One arm of a rotating spiral galaxy. */
export function spiralArm({
  angle,
  radius,
  speed,
  twist = 0.55,
  spread = 0.35,
}: {
  angle: number;
  radius: number;
  /** Radians per tick. */
  speed: number;
  twist?: number;
  spread?: number;
}): (time: number, random: () => number, out: Point) => void {
  return (time, random, out) => {
    const r = radius * random() ** 0.7;
    const theta = angle + r * twist - time * speed;
    const jitter = spread * (0.4 + r / radius);
    // eslint-disable-next-line no-param-reassign
    out.x = r * Math.cos(theta) + gaussian(random) * jitter;
    // eslint-disable-next-line no-param-reassign
    out.y = r * Math.sin(theta) + gaussian(random) * jitter;
  };
}

/** Traces a slowly precessing Lissajous figure. */
export function lissajous({
  a,
  b,
  speed,
  drift = 0.01,
}: {
  a: number;
  b: number;
  /** Curve parameter advanced per tick. */
  speed: number;
  /** Phase drift per tick, which makes the figure tumble. */
  drift?: number;
}): (time: number, random: () => number, out: Point) => void {
  return (time, random, out) => {
    const u = time * speed;
    // eslint-disable-next-line no-param-reassign
    out.x = Math.sin(a * u + time * drift) + (random() - 0.5) * 0.02;
    // eslint-disable-next-line no-param-reassign
    out.y = Math.sin(b * u) + (random() - 0.5) * 0.02;
  };
}

/** A random walk. Each call returns a fresh walk with its own state. */
export function randomWalk(
  volatility: number,
  start = 0
): (x: number, random: () => number) => number {
  let value = start;
  return (_x, random) => {
    value += (random() - 0.5) * volatility;
    return value;
  };
}

function bump(
  position: number,
  center: number,
  width: number,
  amplitude: number
): number {
  const distance = (position - center) / width;
  return amplitude * Math.exp(-distance * distance);
}

/** A stylized ECG trace: P wave, QRS complex, and T wave. */
export function heartbeat(
  period: number,
  offset = 0
): (x: number, random: () => number) => number {
  return (x, random) => {
    const p = ((x + offset) % period) / period;
    return (
      bump(p, 0.18, 0.04, 0.12) +
      bump(p, 0.37, 0.012, -0.15) +
      bump(p, 0.4, 0.014, 1.15) +
      bump(p, 0.43, 0.012, -0.3) +
      bump(p, 0.66, 0.06, 0.3) +
      (random() - 0.5) * 0.03
    );
  };
}

/** The center of the flux capacitor, where its three arms meet. */
export const FLUX_CENTER: Point = { x: 0, y: 0.05 };

/** The outer ends of the flux capacitor's arms, a Y. */
export const FLUX_ARM_ENDS: readonly Point[] = [
  { x: -0.82, y: 0.82 },
  { x: 0.82, y: 0.82 },
  { x: 0, y: -0.95 },
];

/** Half the width of the flux capacitor's housing. */
const FLUX_HOUSING = 1.1;

/** Writes the point a fraction `u` along an arm, from the center out, offset across it. */
function alongArm(arm: number, u: number, across: number, out: Point): void {
  const end = FLUX_ARM_ENDS[arm];
  const dx = end.x - FLUX_CENTER.x;
  const dy = end.y - FLUX_CENTER.y;
  const length = Math.hypot(dx, dy);
  // eslint-disable-next-line no-param-reassign
  out.x = FLUX_CENTER.x + dx * u - (dy / length) * across;
  // eslint-disable-next-line no-param-reassign
  out.y = FLUX_CENTER.y + dy * u + (dx / length) * across;
}

/**
 * The flux capacitor's box, glass tubes, and electrodes. Time does not move
 * it, so a rolling buffer of it keeps the same shape.
 */
export function fluxHousing(): (
  time: number,
  random: () => number,
  out: Point
) => void {
  return (_time, random, out) => {
    const pick = random();
    if (pick < 0.5) {
      // The edge of the box, walked as one loop of its perimeter
      const t = random() * 4;
      const side = Math.floor(t);
      const along = (t - side) * 2 - 1;
      const inset = 1 + gaussian(random) * 0.01;
      const [x, y] = [
        [along, inset],
        [inset, -along],
        [-along, -inset],
        [-inset, along],
      ][side];
      // eslint-disable-next-line no-param-reassign
      out.x = x * FLUX_HOUSING;
      // eslint-disable-next-line no-param-reassign
      out.y = y * FLUX_HOUSING;
      return;
    }
    const arm = Math.floor(random() * FLUX_ARM_ENDS.length);
    if (pick < 0.85) {
      // The two walls of the arm's glass tube
      const wall = random() < 0.5 ? -1 : 1;
      alongArm(
        arm,
        0.12 + random() * 0.88,
        wall * 0.075 + gaussian(random) * 0.006,
        out
      );
      return;
    }
    // A ring electrode at the outer end of the arm
    const angle = random() * 2 * Math.PI;
    const radius = 0.09 + gaussian(random) * 0.01;
    const end = FLUX_ARM_ENDS[arm];
    // eslint-disable-next-line no-param-reassign
    out.x = end.x + Math.cos(angle) * radius;
    // eslint-disable-next-line no-param-reassign
    out.y = end.y + Math.sin(angle) * radius;
  };
}

/**
 * Pulses of light chasing down the flux capacitor's arms into its center, as
 * it fluxes. A rolling buffer keeps the last few ticks, which smears each
 * pulse into a streak.
 */
export function fluxPulses({
  speed,
  pulses = 3,
  width = 0.035,
  spread = 0.018,
}: {
  /** Fraction of an arm a pulse travels per tick. */
  speed: number;
  /** Pulses on each arm at once. */
  pulses?: number;
  /** Length of a pulse, as a fraction of the arm. */
  width?: number;
  /** How far points stray across the arm. */
  spread?: number;
}): (time: number, random: () => number, out: Point) => void {
  return (time, random, out) => {
    const arm = Math.floor(random() * FLUX_ARM_ENDS.length);
    const pulse = Math.floor(random() * pulses);
    const head = (((pulse / pulses - time * speed) % 1) + 1) % 1;
    // A few points light the whole tube faintly between pulses
    const u =
      random() < 0.12
        ? 0.1 + random() * 0.9
        : Math.min(1, Math.max(0.08, head + gaussian(random) * width));
    alongArm(arm, u, gaussian(random) * spread, out);
  };
}

/** The glow where the arms meet, swelling as each pulse arrives. */
export function fluxCore({
  speed,
  pulses = 3,
  radius = 0.07,
}: {
  /** Must match the pulses' speed for the core to swell in time with them. */
  speed: number;
  pulses?: number;
  radius?: number;
}): (time: number, random: () => number, out: Point) => void {
  return (time, random, out) => {
    const phase = (((time * speed * pulses) % 1) + 1) % 1;
    const swell = 1 + 1.4 * Math.exp(-phase * 8);
    const angle = random() * 2 * Math.PI;
    const r = Math.abs(gaussian(random)) * radius * swell;
    // eslint-disable-next-line no-param-reassign
    out.x = FLUX_CENTER.x + Math.cos(angle) * r;
    // eslint-disable-next-line no-param-reassign
    out.y = FLUX_CENTER.y + Math.sin(angle) * r;
  };
}
