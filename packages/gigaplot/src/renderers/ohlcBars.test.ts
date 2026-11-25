import { ohlcSeriesDataFromArrays } from '../model/PlotTypes';
import { createPlotTheme } from '../theme/PlotTheme';
import {
  getOhlcBarSpacing,
  getOhlcHalfBarWidth,
  isOhlcBarIncreasing,
} from './ohlcBars';

function bars(x: number[]) {
  const zeros = x.map(() => 0);
  return ohlcSeriesDataFromArrays(x, zeros, zeros, zeros, zeros);
}

describe('getOhlcBarSpacing', () => {
  it('is the smallest gap between neighbouring bars', () => {
    expect(getOhlcBarSpacing(bars([0, 10, 12, 20]))).toBe(2);
  });

  it('skips missing x values and repeats', () => {
    expect(getOhlcBarSpacing(bars([0, Number.NaN, 4, 4, 9]))).toBe(4);
  });

  it('is undefined without two distinct bars', () => {
    expect(getOhlcBarSpacing(bars([3]))).toBeUndefined();
    expect(getOhlcBarSpacing(bars([3, 3]))).toBeUndefined();
  });
});

describe('getOhlcHalfBarWidth', () => {
  const theme = createPlotTheme({ ohlcBarWidth: 0.5 });

  it('is a fraction of the spacing, halved', () => {
    expect(getOhlcHalfBarWidth(8, theme, 1)).toBe(2);
  });

  it('gives a lone bar a fixed width in pixels', () => {
    expect(getOhlcHalfBarWidth(undefined, theme, 1)).toBe(
      getOhlcHalfBarWidth(undefined, theme, 2) / 2
    );
  });
});

it('treats a bar that closes at its open as increasing', () => {
  expect(isOhlcBarIncreasing(1, 1)).toBe(true);
  expect(isOhlcBarIncreasing(1, 2)).toBe(true);
  expect(isOhlcBarIncreasing(2, 1)).toBe(false);
});
