import {
  appendSeriesData,
  copySeriesData,
  createSeriesData,
  getSeriesBounds,
  seriesDataFromArrays,
  stackSeriesData,
  type SeriesData,
} from './PlotTypes';
import { applyDeltaToSeriesData } from '../renderers/applyDeltaToSeriesData';

function withBase(data: SeriesData, base: number[]): SeriesData {
  return { ...data, base: Float64Array.from(base) };
}

describe('base column', () => {
  it('is copied with the rest of the series', () => {
    const data = withBase(seriesDataFromArrays([0, 1], [3, 4]), [1, 2]);

    const copy = copySeriesData(data);

    expect(Array.from(copy.base ?? [])).toEqual([1, 2]);
    expect(copy.base).not.toBe(data.base);
  });

  it('grows and appends in step with x and y', () => {
    const target = withBase(seriesDataFromArrays([0], [3]), [1]);

    appendSeriesData(
      target,
      withBase(seriesDataFromArrays([1, 2], [4, 5]), [2, 3])
    );

    expect(target.length).toBe(3);
    expect(Array.from(target.base ?? []).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('fills a base missing from appended points with zero', () => {
    const target = withBase(seriesDataFromArrays([0], [3]), [1]);

    appendSeriesData(target, seriesDataFromArrays([1], [4]));

    expect(target.base?.[1]).toBe(0);
  });

  it('survives an update delta', () => {
    const existing = withBase(seriesDataFromArrays([0, 1], [3, 4]), [1, 2]);

    const updated = applyDeltaToSeriesData(existing, {
      type: 'update',
      seriesId: 'a',
      offset: 1,
      data: withBase(seriesDataFromArrays([1], [6]), [5]),
    });

    expect(Array.from(updated.base ?? []).slice(0, 2)).toEqual([1, 5]);
  });
});

describe('getSeriesBounds', () => {
  it('includes the base', () => {
    const data = withBase(seriesDataFromArrays([0, 1], [3, 4]), [-2, 1]);

    expect(getSeriesBounds(data)).toEqual({
      xMin: 0,
      xMax: 1,
      yMin: -2,
      yMax: 4,
    });
  });

  it('includes the zero an area without a base fills to', () => {
    const data = seriesDataFromArrays([0, 1], [3, 4]);

    expect(getSeriesBounds(data, 'area')?.yMin).toBe(0);
    expect(getSeriesBounds(data, 'line')?.yMin).toBe(3);
  });
});

describe('stackSeriesData', () => {
  it('sits each series on the total of the ones before it', () => {
    const [a, b, c] = stackSeriesData([
      seriesDataFromArrays([0, 1], [1, 2]),
      seriesDataFromArrays([0, 1], [3, 4]),
      seriesDataFromArrays([0, 1], [5, 6]),
    ]);

    expect(Array.from(a.base ?? [])).toEqual([0, 0]);
    expect(Array.from(a.y)).toEqual([1, 2]);
    expect(Array.from(b.base ?? [])).toEqual([1, 2]);
    expect(Array.from(b.y)).toEqual([4, 6]);
    expect(Array.from(c.base ?? [])).toEqual([4, 6]);
    expect(Array.from(c.y)).toEqual([9, 12]);
    expect(Array.from(c.x)).toEqual([0, 1]);
  });

  it('counts missing values as zero', () => {
    const [, b] = stackSeriesData([
      seriesDataFromArrays([0, 1], [1, Number.NaN]),
      seriesDataFromArrays([0, 1], [3, 4]),
    ]);

    expect(Array.from(b.base ?? [])).toEqual([1, 0]);
    expect(Array.from(b.y)).toEqual([4, 4]);
  });

  it('normalizes each point to a percent of its total', () => {
    const [a, b] = stackSeriesData(
      [
        seriesDataFromArrays([0, 1], [1, 3]),
        seriesDataFromArrays([0, 1], [3, 1]),
      ],
      'percent'
    );

    expect(Array.from(a.y)).toEqual([25, 75]);
    expect(Array.from(b.base ?? [])).toEqual([25, 75]);
    expect(Array.from(b.y)).toEqual([100, 100]);
  });

  it('leaves the inputs unchanged', () => {
    const input = seriesDataFromArrays([0], [1]);

    stackSeriesData([input, createSeriesData()]);

    expect(input.base).toBeUndefined();
    expect(Array.from(input.y)).toEqual([1]);
  });
});
