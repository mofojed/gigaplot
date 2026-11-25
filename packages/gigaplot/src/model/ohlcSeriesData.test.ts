import { applyDeltaToSeriesData } from '../renderers/applyDeltaToSeriesData';
import {
  appendSeriesData,
  copySeriesData,
  createOhlcSeriesData,
  getSeriesBounds,
  isOhlcSeriesData,
  isOhlcSeriesType,
  ohlcSeriesDataFromArrays,
  seriesDataFromArrays,
  type SeriesData,
} from './PlotTypes';

function columns(data: SeriesData) {
  const { length } = data;
  return {
    x: Array.from(data.x.subarray(0, length)),
    open: Array.from(data.open?.subarray(0, length) ?? []),
    high: Array.from(data.high?.subarray(0, length) ?? []),
    low: Array.from(data.low?.subarray(0, length) ?? []),
    close: Array.from(data.y.subarray(0, length)),
  };
}

const BARS = ohlcSeriesDataFromArrays(
  [0, 1, 2],
  [10, 11, 12],
  [15, 16, 17],
  [5, 6, 7],
  [11, 12, 13]
);

describe('OHLC series data', () => {
  it('knows which types and data are bars', () => {
    expect(isOhlcSeriesType('ohlc')).toBe(true);
    expect(isOhlcSeriesType('candlestick')).toBe(true);
    expect(isOhlcSeriesType('line')).toBe(false);
    expect(isOhlcSeriesData(BARS)).toBe(true);
    expect(isOhlcSeriesData(seriesDataFromArrays([0], [1]))).toBe(false);
  });

  it('stores the close as y', () => {
    expect(columns(BARS)).toEqual({
      x: [0, 1, 2],
      open: [10, 11, 12],
      high: [15, 16, 17],
      low: [5, 6, 7],
      close: [11, 12, 13],
    });
  });

  it('copies every column', () => {
    const copy = copySeriesData(BARS);
    expect(copy.open).not.toBe(BARS.open);
    expect(columns(copy)).toEqual(columns(BARS));
  });

  it('grows every column when appending', () => {
    const target = createOhlcSeriesData(1);
    appendSeriesData(target, BARS);
    appendSeriesData(target, BARS);
    expect(columns(target).high).toEqual([15, 16, 17, 15, 16, 17]);
    expect(columns(target).close).toEqual([11, 12, 13, 11, 12, 13]);
  });

  it('spans from the lowest low to the highest high', () => {
    expect(getSeriesBounds(BARS)).toEqual({
      xMin: 0,
      xMax: 2,
      yMin: 5,
      yMax: 17,
    });
  });

  it('keeps bar columns through append and update deltas', () => {
    const appended = applyDeltaToSeriesData(undefined, {
      type: 'append',
      seriesId: 'a',
      data: BARS,
    });
    expect(isOhlcSeriesData(appended)).toBe(true);
    const updated = applyDeltaToSeriesData(copySeriesData(BARS), {
      type: 'update',
      seriesId: 'a',
      offset: 1,
      data: ohlcSeriesDataFromArrays([1], [20], [30], [1], [25]),
    });
    expect(columns(updated)).toEqual({
      x: [0, 1, 2],
      open: [10, 20, 12],
      high: [15, 30, 17],
      low: [5, 1, 7],
      close: [11, 25, 13],
    });
    const cleared = applyDeltaToSeriesData(updated, {
      type: 'clear',
      seriesId: 'a',
    });
    expect(cleared.length).toBe(0);
    expect(isOhlcSeriesData(cleared)).toBe(true);
  });
});
