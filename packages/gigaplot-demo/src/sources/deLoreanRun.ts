/** One run of the DeLorean from a standing start to 88 miles per hour. */
export interface DeLoreanRun {
  /** Ticks the run takes. */
  ticks: number;
  /** Seconds the run takes, at the ticks per second it was made for. */
  seconds: number;
  /** Speed in miles per hour at each tick, from 0 at tick 0 to 88 at the last. */
  speed: Float64Array;
  /** Fraction of the run's distance covered at each tick, from 0 to 1. */
  distance: Float64Array;
}

/** Top speed in each gear, beyond which it is time to shift. */
const GEAR_TOPS = [30, 52, 74, 100];

/** How long a shift takes, in the simulation's own seconds, coasting. */
const SHIFT_TIME = 0.8;

/**
 * Shifts up through the gears until it hits 88, squeezed into `ticks` so the
 * same run drives the car and its speedometer.
 *
 * The simulation runs in its own time, which is then scaled to fit, so the
 * gear changes keep their shape however long the run is made.
 */
export function createDeLoreanRun(
  ticks: number,
  ticksPerSecond = 60,
): DeLoreanRun {
  const step = 0.001;
  const times = [0];
  const speeds = [0];
  const distances = [0];
  let gear = 0;
  let shifting = 0;
  let speed = 0;
  let distance = 0;
  let time = 0;
  while (speed < 88) {
    if (shifting > 0) {
      // The clutch is in, so it coasts
      speed -= 3 * step;
      shifting -= step;
    } else {
      const top = GEAR_TOPS[gear];
      speed += 14 * (1 - speed / top) * step;
      if (speed > top * 0.9 && gear < GEAR_TOPS.length - 1) {
        gear += 1;
        shifting = SHIFT_TIME;
      }
    }
    speed = Math.min(speed, 88);
    distance += speed * step;
    time += step;
    times.push(time);
    speeds.push(speed);
    distances.push(distance);
  }

  const run: DeLoreanRun = {
    ticks,
    seconds: ticks / ticksPerSecond,
    speed: new Float64Array(ticks + 1),
    distance: new Float64Array(ticks + 1),
  };
  let sample = 0;
  for (let tick = 0; tick <= ticks; tick += 1) {
    const at = (tick / ticks) * time;
    while (sample < times.length - 1 && times[sample + 1] < at) {
      sample += 1;
    }
    run.speed[tick] = speeds[sample];
    run.distance[tick] = distances[sample] / distance;
  }
  run.speed[ticks] = 88;
  run.distance[ticks] = 1;
  return run;
}
