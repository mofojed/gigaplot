import type { SeriesData } from '../model/PlotTypes';
import type { PlotTheme } from '../theme/PlotTheme';

/** Width in pixels of a lone bar, which has no neighbour to size it by. */
const LONE_BAR_WIDTH = 8;

/**
 * The smallest gap along x between neighbouring bars, which sizes every bar so
 * none overlap. Undefined with fewer than two distinct x values.
 */
export function getOhlcBarSpacing(data: SeriesData): number | undefined {
  let spacing = Infinity;
  let previous = Number.NaN;
  for (let i = 0; i < data.length; i += 1) {
    const x = data.x[i];
    if (Number.isFinite(x)) {
      const gap = Math.abs(x - previous);
      if (gap > 0 && gap < spacing) {
        spacing = gap;
      }
      previous = x;
    }
  }
  return Number.isFinite(spacing) ? spacing : undefined;
}

/**
 * Half the width of a bar in data units: the length of an `ohlc` tick, or half
 * a `candlestick` body.
 *
 * @param spacing From {@link getOhlcBarSpacing}
 * @param xPerPixel Data units along x per CSS pixel
 */
export function getOhlcHalfBarWidth(
  spacing: number | undefined,
  theme: PlotTheme,
  xPerPixel: number
): number {
  if (spacing == null) {
    return (LONE_BAR_WIDTH / 2) * xPerPixel;
  }
  return (spacing * theme.ohlcBarWidth) / 2;
}

/** True if a bar closes at or above its open, and so is drawn increasing. */
export function isOhlcBarIncreasing(open: number, close: number): boolean {
  return !(close < open);
}
