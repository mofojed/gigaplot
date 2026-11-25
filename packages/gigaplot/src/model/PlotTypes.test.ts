import {
  appendSeriesData,
  boundsEqual,
  createSeriesData,
  ensureSeriesCapacity,
  getSeriesBounds,
  ohlcSeriesDataFromArrays,
  padBounds,
  seriesDataFromArrays,
  trimSeriesData,
  unionBounds,
} from './PlotTypes';

describe('seriesDataFromArrays', () => {
  it('copies both arrays and uses the shorter length', () => {
    const data = seriesDataFromArrays([1, 2, 3], [4, 5]);
    expect(data.length).toBe(2);
    expect(Array.from(data.x.subarray(0, 2))).toEqual([1, 2]);
    expect(Array.from(data.y.subarray(0, 2))).toEqual([4, 5]);
  });
});

describe('ensureSeriesCapacity', () => {
  it('grows by doubling and preserves existing values', () => {
    const data = seriesDataFromArrays([1, 2], [3, 4]);
    ensureSeriesCapacity(data, 5);
    expect(data.x.length).toBeGreaterThanOrEqual(5);
    expect(data.x[0]).toBe(1);
    expect(data.y[1]).toBe(4);
    expect(data.length).toBe(2);
  });

  it('does nothing when capacity is already sufficient', () => {
    const data = createSeriesData(10);
    const { x } = data;
    ensureSeriesCapacity(data, 4);
    expect(data.x).toBe(x);
  });
});

describe('appendSeriesData', () => {
  it('appends and grows as needed', () => {
    const target = seriesDataFromArrays([1], [10]);
    appendSeriesData(target, seriesDataFromArrays([2, 3], [20, 30]));
    expect(target.length).toBe(3);
    expect(Array.from(target.x.subarray(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(target.y.subarray(0, 3))).toEqual([10, 20, 30]);
  });
});

describe('getSeriesBounds', () => {
  it('returns undefined for empty data', () => {
    expect(getSeriesBounds(createSeriesData(4))).toBeUndefined();
  });

  it('ignores non finite values', () => {
    const data = seriesDataFromArrays([1, NaN, 3], [5, 100, 7]);
    expect(getSeriesBounds(data)).toEqual({
      xMin: 1,
      xMax: 3,
      yMin: 5,
      yMax: 7,
    });
  });
});

describe('unionBounds', () => {
  it('returns the other side when one is undefined', () => {
    const bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    expect(unionBounds(undefined, bounds)).toBe(bounds);
    expect(unionBounds(bounds, undefined)).toBe(bounds);
  });

  it('expands to contain both', () => {
    expect(
      unionBounds(
        { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
        { xMin: -1, xMax: 0.5, yMin: 2, yMax: 3 }
      )
    ).toEqual({ xMin: -1, xMax: 1, yMin: 0, yMax: 3 });
  });
});

describe('padBounds', () => {
  it('expands degenerate bounds so a single point is still visible', () => {
    expect(padBounds({ xMin: 5, xMax: 5, yMin: 5, yMax: 5 })).toEqual({
      xMin: 4.5,
      xMax: 5.5,
      yMin: 4.5,
      yMax: 5.5,
    });
  });

  it('applies a proportional margin', () => {
    expect(padBounds({ xMin: 0, xMax: 10, yMin: 0, yMax: 20 }, 0.1)).toEqual({
      xMin: -1,
      xMax: 11,
      yMin: -2,
      yMax: 22,
    });
  });
});

describe('boundsEqual', () => {
  it('treats tiny differences as equal', () => {
    const a = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    const b = { xMin: 1e-12, xMax: 100, yMin: 0, yMax: 100 };
    expect(boundsEqual(a, b)).toBe(true);
  });

  it('detects real differences', () => {
    expect(
      boundsEqual(
        { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
        { xMin: 0, xMax: 2, yMin: 0, yMax: 1 }
      )
    ).toBe(false);
  });
});

describe('trimSeriesData', () => {
  it('drops points from the start without copying', () => {
    const data = seriesDataFromArrays([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]);
    const { x } = data;
    trimSeriesData(data, 2);
    expect(data.x.buffer).toBe(x.buffer);
    expect(data.length).toBe(3);
    expect(Array.from(data.x.subarray(0, 3))).toEqual([3, 4, 5]);
    expect(Array.from(data.y.subarray(0, 3))).toEqual([30, 40, 50]);
  });

  it('keeps every column in step', () => {
    const data = ohlcSeriesDataFromArrays(
      [1, 2, 3],
      [5, 6, 7],
      [8, 9, 10],
      [1, 2, 3],
      [4, 5, 6]
    );
    trimSeriesData(data, 1);
    expect(Array.from(data.open.subarray(0, 2))).toEqual([6, 7]);
    expect(Array.from(data.high.subarray(0, 2))).toEqual([9, 10]);
    expect(Array.from(data.low.subarray(0, 2))).toEqual([2, 3]);
    expect(Array.from(data.y.subarray(0, 2))).toEqual([5, 6]);
  });

  it('reclaims the trimmed room when an append grows the arrays', () => {
    const data = seriesDataFromArrays([1, 2, 3, 4], [10, 20, 30, 40]);
    trimSeriesData(data, 3);
    appendSeriesData(data, seriesDataFromArrays([5, 6], [50, 60]));
    expect(data.x.byteOffset).toBe(0);
    expect(Array.from(data.x.subarray(0, data.length))).toEqual([4, 5, 6]);
    expect(Array.from(data.y.subarray(0, data.length))).toEqual([40, 50, 60]);
  });

  it('clamps the count to the points there are', () => {
    const data = seriesDataFromArrays([1, 2], [10, 20]);
    trimSeriesData(data, -1);
    expect(data.length).toBe(2);
    trimSeriesData(data, 10);
    expect(data.length).toBe(0);
  });
});
