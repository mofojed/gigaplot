import type { SeriesDataRequest } from '../model/PlotDataSource';
import {
  isOhlcSeriesData,
  ohlcSeriesDataFromArrays,
  seriesDataFromArrays,
  type SeriesData,
} from '../model/PlotTypes';
import {
  OHLC_BAR_PIXELS,
  identityDownsampler,
  lttbDownsampler,
  minMaxDownsampler,
  ohlcDownsampler,
} from './Downsampler';
import { createRangeBreakScale } from '../scale/RangeBreakScale';

function makeRequest(
  width: number,
  xMin: number,
  xMax: number
): SeriesDataRequest {
  return {
    seriesId: 'test',
    viewport: { xMin, xMax, yMin: -1000, yMax: 1000 },
    pixelSize: { width, height: 100 },
    style: {},
  };
}

function makeRamp(count: number): SeriesData {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = i;
    y[i] = Math.sin(i / 100);
  }
  return seriesDataFromArrays(x, y);
}

describe('identityDownsampler', () => {
  it('returns the input untouched', () => {
    const data = makeRamp(10);
    expect(identityDownsampler(data, makeRequest(100, 0, 10))).toBe(data);
  });
});

describe('minMaxDownsampler', () => {
  it('returns the input when it already fits the pixel budget', () => {
    const data = makeRamp(100);
    expect(minMaxDownsampler(data, makeRequest(100, 0, 100))).toBe(data);
  });

  it('reduces a large series but keeps it far smaller than the input', () => {
    const data = makeRamp(100_000);
    const result = minMaxDownsampler(data, makeRequest(500, 0, 100_000));
    expect(result.length).toBeLessThan(data.length / 10);
    expect(result.length).toBeGreaterThan(0);
  });

  it('preserves the extremes of every pixel column', () => {
    const count = 10_000;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      x[i] = i;
      y[i] = 0;
    }
    // A single spike that a stride based reducer would drop
    y[5001] = 999;
    const data = seriesDataFromArrays(x, y);

    const result = minMaxDownsampler(data, makeRequest(100, 0, count));
    expect(Array.from(result.y.subarray(0, result.length))).toContain(999);
  });

  it('keeps the base of an area, and its extremes', () => {
    const count = 10_000;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    const base = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      x[i] = i;
      y[i] = 10;
      base[i] = i % 2;
    }
    // A dip in the base alone, which the top would not keep
    base[5001] = -999;
    const data = { ...seriesDataFromArrays(x, y), base };

    const result = minMaxDownsampler(data, makeRequest(100, 0, count));

    expect(result.length).toBeLessThan(count);
    expect(result.base).toBeDefined();
    expect(Array.from(result.base?.subarray(0, result.length) ?? [])).toContain(
      -999
    );
    for (let i = 0; i < result.length; i += 1) {
      expect(result.base?.[i]).toBe(base[result.x[i]]);
    }
  });

  it('keeps output sorted ascending by x', () => {
    const data = makeRamp(50_000);
    const result = minMaxDownsampler(data, makeRequest(300, 0, 50_000));
    for (let i = 1; i < result.length; i += 1) {
      expect(result.x[i]).toBeGreaterThanOrEqual(result.x[i - 1]);
    }
  });
});

describe('lttbDownsampler', () => {
  it('returns the input when it is under the threshold', () => {
    const data = makeRamp(50);
    expect(lttbDownsampler(data, makeRequest(100, 0, 50))).toBe(data);
  });

  it('reduces to the pixel budget and keeps the endpoints', () => {
    const data = makeRamp(10_000);
    const result = lttbDownsampler(data, makeRequest(200, 0, 10_000));
    expect(result.length).toBe(200);
    expect(result.x[0]).toBe(data.x[0]);
    expect(result.x[result.length - 1]).toBe(data.x[data.length - 1]);
  });
});

describe('ohlcDownsampler', () => {
  /** Bars at x = 0..count-1, each a rise of 1 from `i` to `i + 1`. */
  function makeBars(count: number) {
    const x = Array.from({ length: count }, (_, i) => i);
    return ohlcSeriesDataFromArrays(
      x,
      x,
      x.map(i => i + 2),
      x.map(i => i - 1),
      x.map(i => i + 1)
    );
  }

  it('returns the input when every bar already fits', () => {
    const data = makeBars(10);
    // 10 units over 1000 pixels is far more room than the bars need
    expect(ohlcDownsampler(data, makeRequest(1000, 0, 10))).toBe(data);
  });

  it('resamples bars into wider ones, keeping the extremes', () => {
    const data = makeBars(1024);
    // Bins of OHLC_BAR_PIXELS pixels at 1 unit per pixel
    const output = ohlcDownsampler(data, makeRequest(1024, 0, 1024));
    expect(isOhlcSeriesData(output)).toBe(true);
    if (!isOhlcSeriesData(output)) {
      return;
    }
    expect(output.length).toBe(1024 / OHLC_BAR_PIXELS);
    expect(output.x[1]).toBe(OHLC_BAR_PIXELS);
    expect(output.open[1]).toBe(OHLC_BAR_PIXELS);
    expect(output.high[1]).toBe(OHLC_BAR_PIXELS * 2 - 1 + 2);
    expect(output.low[1]).toBe(OHLC_BAR_PIXELS - 1);
    expect(output.y[1]).toBe(OHLC_BAR_PIXELS * 2);
  });

  it('anchors bins at zero, so panning does not regroup bars', () => {
    const data = makeBars(4096);
    const a = ohlcDownsampler(data, makeRequest(1000, 1000, 2000));
    const b = ohlcDownsampler(data, makeRequest(1000, 1003, 2003));
    const xs = (output: SeriesData) =>
      new Set(Array.from(output.x.subarray(0, output.length)));
    const shared = Array.from(xs(a)).filter(x => xs(b).has(x));
    expect(shared.length).toBeGreaterThan(a.length - 4);
  });

  it('ignores missing highs and lows within a bin', () => {
    const data = ohlcSeriesDataFromArrays(
      [0, 1, 2, 3],
      [1, 1, 1, 1],
      [Number.NaN, 5, 3, 2],
      [0, Number.NaN, -1, 0],
      [1, 2, 3, 4]
    );
    const output = ohlcDownsampler(data, makeRequest(1, 0, 1));
    expect(isOhlcSeriesData(output)).toBe(true);
    if (isOhlcSeriesData(output)) {
      expect(output.length).toBe(1);
      expect(output.high[0]).toBe(5);
      expect(output.low[0]).toBe(-1);
      expect(output.y[0]).toBe(4);
    }
  });

  it('returns series without bar columns unchanged', () => {
    const data = makeRamp(10_000);
    expect(ohlcDownsampler(data, makeRequest(10, 0, 10_000))).toBe(data);
  });
});

it('keeps bar columns when a point downsampler is used on bars', () => {
  const x = Array.from({ length: 5000 }, (_, i) => i);
  const data = ohlcSeriesDataFromArrays(x, x, x, x, x);
  const output = minMaxDownsampler(data, makeRequest(10, 0, 5000));
  expect(output.length).toBeLessThan(data.length);
  expect(isOhlcSeriesData(output)).toBe(true);
});

describe('with a scale', () => {
  // Most of the axis is a break, leaving 200 units on screen
  const scale = createRangeBreakScale({
    breaks: [{ start: 100, end: 900 }],
    anchor: 0,
  });
  const x = Array.from({ length: 1000 }, (_unused, i) => i);
  const data = seriesDataFromArrays(
    x,
    x.map(value => Math.sin(value))
  );
  const request = {
    seriesId: 'a',
    viewport: { xMin: 0, xMax: 1000, yMin: -1, yMax: 1 },
    pixelSize: { width: 10, height: 10 },
    style: {},
  };
  const columnsOf = (result: typeof data) =>
    new Set(
      Array.from(result.x.subarray(0, result.length)).map(value =>
        Math.min(9, Math.floor(scale.toPlot(value) / 20))
      )
    );

  it('bins min/max columns evenly on screen rather than in data units', () => {
    const plain = minMaxDownsampler(data, request);
    const scaled = minMaxDownsampler(data, { ...request, xScale: scale });
    // In data units, the 200 values on screen fall in just two columns
    expect(columnsOf(plain).size).toBeLessThan(10);
    expect(columnsOf(scaled).size).toBe(10);
    expect(scaled.length).toBeLessThanOrEqual(40);
  });

  it('bins bars by their positions on the scale', () => {
    const bars = ohlcSeriesDataFromArrays(
      x,
      x.map(() => 1),
      x.map(() => 2),
      x.map(() => 0),
      x.map(() => 1)
    );
    const scaled = ohlcDownsampler(bars, {
      ...request,
      pixelSize: { width: 80, height: 10 },
      xScale: scale,
    });
    // 200 units over 80 pixels at 8 pixels a bar is a bin of 16 units
    expect(scaled.length).toBe(Math.ceil(200 / 16));
  });
});
