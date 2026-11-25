import type { AxisTick } from '../model/PlotTypes';

/**
 * Picks a "nice" step size (1, 2, 5, or 10 times a power of ten) that is at
 * least `roughStep`.
 */
function niceStep(roughStep: number): number {
  if (roughStep <= 0 || !Number.isFinite(roughStep)) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(roughStep));
  const magnitude = 10 ** exponent;
  const fraction = roughStep / magnitude;
  let niceFraction = 10;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  }
  return niceFraction * magnitude;
}

/** Generates evenly spaced, human readable tick values covering `[min, max]`. */
export function generateTicks(
  min: number,
  max: number,
  targetCount = 6
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [];
  }
  const step = niceStep((max - min) / Math.max(1, targetCount));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 1e-9; value += step) {
    // Snap to the step grid to avoid floating point drift in labels
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
}

/** Formats a tick value with a precision appropriate for the spacing between ticks. */
export function formatTick(value: number, step: number): string {
  if (value === 0) {
    return '0';
  }
  const magnitude = Math.max(Math.abs(value), step);
  if (magnitude >= 1e6 || magnitude < 1e-4) {
    return value.toExponential(2);
  }
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + 1));
  return value.toFixed(decimals);
}

/** The default {@link AxisTickGenerator}: evenly spaced, human readable numbers. */
export function linearTicks(
  min: number,
  max: number,
  targetCount: number
): AxisTick[] {
  const values = generateTicks(min, max, targetCount);
  const step = values.length > 1 ? values[1] - values[0] : 1;
  return values.map(value => ({ value, label: formatTick(value, step) }));
}

/** Most decimals {@link formatValue} shows, however far the plot is zoomed in. */
const MAX_VALUE_DECIMALS = 10;

/**
 * The default {@link AxisValueFormatter}: a single value, such as a hovered
 * one, with just enough decimals to tell apart values a pixel apart. Unlike
 * tick labels, large values keep every digit rather than switching to
 * exponents, since the exact value is the point of a tooltip.
 */
export function formatValue(value: number, resolution: number): string {
  if (!Number.isFinite(value)) {
    return `${value}`;
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 1e21 || (magnitude > 0 && magnitude < 1e-6)) {
    return value.toExponential(4);
  }
  const decimals =
    resolution > 0 && Number.isFinite(resolution)
      ? Math.min(
          MAX_VALUE_DECIMALS,
          Math.max(0, Math.ceil(-Math.log10(resolution)))
        )
      : MAX_VALUE_DECIMALS;
  const text = value.toFixed(decimals);
  // Avoid "-0.0" for tiny negatives that round to zero
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}
