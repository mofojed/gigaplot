import type { AxisTick, AxisTickGenerator } from '../model/PlotTypes';
import type { PlotScale } from './PlotScale';
import { formatTick, generateTicks, linearTicks } from './ticks';

/** Labels a power of the base, such as `1000` or `1e+9`. */
function formatPower(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-4)) {
    return value.toExponential(0);
  }
  return `${Number(value.toPrecision(12))}`;
}

/**
 * Ticks for a log axis: a tick per power of the base, every few powers when
 * there are many, and the 2 and 5 multiples between them when there are few.
 */
export function logTicks(base: number): AxisTickGenerator {
  return (min, max, targetCount) => {
    if (!(min > 0) || !(max > min) || !Number.isFinite(max)) {
      return [];
    }
    const logBase = Math.log(base);
    const first = Math.floor(Math.log(min) / logBase);
    const last = Math.ceil(Math.log(max) / logBase);
    const powers = last - first;
    const ticks: AxisTick[] = [];
    if (base === 10 && powers <= targetCount / 3) {
      for (let power = first; power <= last; power += 1) {
        [1, 2, 5].forEach(multiple => {
          const value = multiple * 10 ** power;
          if (value >= min && value <= max) {
            ticks.push({ value, label: formatPower(value) });
          }
        });
      }
    }
    if (ticks.length >= 2) {
      return ticks;
    }
    const step = Math.max(1, Math.ceil(powers / Math.max(1, targetCount)));
    for (
      let power = Math.ceil(first / step) * step;
      power <= last;
      power += step
    ) {
      const value = base ** power;
      if (value >= min && value <= max) {
        ticks.push({ value, label: formatPower(value) });
      }
    }
    return ticks.length >= 2 ? ticks : linearTicks(min, max, targetCount);
  };
}

/**
 * Ticks for an axis where a linear spacing of values bunches up, such as an
 * exponential one: readable values, thinned until no two are closer than a
 * fraction of the axis.
 */
export function thinnedTicks(
  toPlot: (value: number) => number
): AxisTickGenerator {
  return (min, max, targetCount) => {
    if (!(max > min)) {
      return [];
    }
    const candidates = generateTicks(min, max, targetCount * 4);
    const plotMin = toPlot(min);
    const plotMax = toPlot(max);
    const gap = Math.abs(plotMax - plotMin) / (targetCount * 1.5);
    const fine = candidates.length > 1 ? candidates[1] - candidates[0] : 1;
    // Rounder values are kept first: multiples of 10, 5, then 2 fine steps
    const roundness = (value: number): number => {
      const multiple = Math.round(value / fine);
      return [10, 5, 2].findIndex(factor => multiple % factor === 0);
    };
    const rank = (value: number): number => {
      const index = roundness(value);
      return index < 0 ? 3 : index;
    };
    // Within a roundness, start from the end the scale spreads apart, so the
    // ticks there are not crowded out by those bunched up at the other end
    const last = candidates.length - 1;
    const isFromTop =
      last < 1 ||
      !(
        Math.abs(toPlot(candidates[1]) - toPlot(candidates[0])) >
        Math.abs(toPlot(candidates[last]) - toPlot(candidates[last - 1]))
      );
    const ordered = [...candidates].sort(
      (a, b) => rank(a) - rank(b) || (isFromTop ? b - a : a - b)
    );
    const kept: number[] = [];
    ordered.forEach(value => {
      const position = toPlot(value);
      if (
        Number.isFinite(position) &&
        kept.every(other => Math.abs(toPlot(other) - position) >= gap)
      ) {
        kept.push(value);
      }
    });
    kept.sort((a, b) => a - b);
    // Labels need only as many decimals as the closest kept ticks
    let step = max - min;
    for (let i = 1; i < kept.length; i += 1) {
      step = Math.min(step, kept[i] - kept[i - 1]);
    }
    return kept.map(value => ({ value, label: formatTick(value, step) }));
  };
}

/**
 * A logarithmic scale: each power of `base` is the same distance apart, so
 * exponential growth is a straight line. Values at or below zero have no
 * position, and are left out of lines as gaps.
 */
export function createLogScale(base = 10): PlotScale {
  if (!(base > 0) || base === 1) {
    throw new Error(
      `A log scale needs a positive base other than 1, got ${base}`
    );
  }
  const logBase = Math.log(base);
  return {
    type: 'log',
    toPlot: value => (value > 0 ? Math.log(value) / logBase : Number.NaN),
    fromPlot: position => base ** position,
    ticks: logTicks(base),
  };
}

/**
 * An exponential scale, the inverse of a log scale: a value `v` sits at
 * `base ** v`, so larger values are spread out and smaller ones bunched up.
 * Data that is itself a logarithm, such as decibels or pH, is drawn in
 * proportion to the quantity it measures.
 */
export function createExponentialScale(base = Math.E): PlotScale {
  if (!(base > 0) || base === 1) {
    throw new Error(
      `An exponential scale needs a positive base other than 1, got ${base}`
    );
  }
  const logBase = Math.log(base);
  const toPlot = (value: number): number => base ** value;
  return {
    type: 'exp',
    toPlot,
    fromPlot: position =>
      position > 0 ? Math.log(position) / logBase : Number.NEGATIVE_INFINITY,
    ticks: thinnedTicks(toPlot),
  };
}

/**
 * A power scale: a value `v` sits at `v ** exponent`, keeping its sign, so
 * an exponent above 1 spreads out large values and one below 1, such as 0.5
 * for a square root, spreads out small ones.
 */
export function createPowerScale(exponent: number): PlotScale {
  if (!(exponent > 0) || !Number.isFinite(exponent)) {
    throw new Error(`A power scale needs a positive exponent, got ${exponent}`);
  }
  const toPlot = (value: number): number =>
    Math.sign(value) * Math.abs(value) ** exponent;
  return {
    type: 'pow',
    toPlot,
    fromPlot: position =>
      Math.sign(position) * Math.abs(position) ** (1 / exponent),
    ticks: thinnedTicks(toPlot),
  };
}
