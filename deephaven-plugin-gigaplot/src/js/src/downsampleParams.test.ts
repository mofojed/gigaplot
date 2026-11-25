import {
  OHLC_BAR_PIXELS,
  createLogScale,
  createRangeBreakScale,
} from "gigaplot";
import {
  downsampleParamsEqual,
  getDownsampleParams,
  getParamsXResolution,
  snapRange,
} from "./downsampleParams";

const pixelSize = { width: 1000, height: 500 };

describe("snapRange", () => {
  it("covers the range with at least half a span of margin", () => {
    const [low, high] = snapRange(100, 200);
    expect(low).toBeLessThanOrEqual(50);
    expect(high).toBeGreaterThanOrEqual(250);
    expect(high - low).toBeLessThanOrEqual(400);
  });

  it("does not change for small pans", () => {
    expect(snapRange(100, 200)).toEqual(snapRange(101, 201));
  });
});

describe("getDownsampleParams", () => {
  it.each(["line", "area"] as const)(
    "bins %s plots a pixel wide, ignoring y",
    (type) => {
      const params = getDownsampleParams(
        { viewport: { xMin: 0, xMax: 1000, yMin: -1, yMax: 1 }, pixelSize },
        type,
      );
      expect(params).toEqual({
        x_min: expect.any(Number),
        x_max: expect.any(Number),
        x_bin: 1,
      });
      expect(getParamsXResolution(params!, type)).toBe(1);
    },
  );

  it.each(["ohlc", "candlestick"] as const)(
    "bins %s bars several pixels wide, ignoring y",
    (type) => {
      const params = getDownsampleParams(
        { viewport: { xMin: 0, xMax: 1000, yMin: -1, yMax: 1 }, pixelSize },
        type,
      );
      expect(params).toEqual({
        x_min: expect.any(Number),
        x_max: expect.any(Number),
        x_bin: OHLC_BAR_PIXELS,
      });
      expect(getParamsXResolution(params!, type)).toBe(1);
    },
  );

  it("uses power of two bins no wider than a pixel for lines", () => {
    const params = getDownsampleParams(
      { viewport: { xMin: 0, xMax: 3000, yMin: -1, yMax: 1 }, pixelSize },
      "line",
    );
    expect(params).toEqual({
      x_min: expect.any(Number),
      x_max: expect.any(Number),
      x_bin: 2,
    });
  });

  it("ignores the y viewport for lines", () => {
    const a = getDownsampleParams(
      { viewport: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, pixelSize },
      "line",
    );
    const b = getDownsampleParams(
      { viewport: { xMin: 0, xMax: 1, yMin: 5, yMax: 50 }, pixelSize },
      "line",
    );
    expect(downsampleParamsEqual(a!, b!)).toBe(true);
  });

  it("only changes bins once zoom crosses a power of two", () => {
    const request = (span: number) =>
      getDownsampleParams(
        { viewport: { xMin: 0, xMax: span, yMin: 0, yMax: 1 }, pixelSize },
        "line",
      )!.x_bin;
    expect(request(1100)).toBe(request(1900));
    expect(request(2100)).toBe(2 * request(1900));
  });

  it("includes y cells for scatter", () => {
    const params = getDownsampleParams(
      { viewport: { xMin: 0, xMax: 1000, yMin: 0, yMax: 500 }, pixelSize },
      "scatter",
    );
    expect(params?.x_bin).toBe(2);
    expect(params?.y_bin).toBe(2);
    expect(params?.y_min).toBeLessThanOrEqual(-250);
    expect(params?.y_max).toBeGreaterThanOrEqual(750);
  });

  it("returns null for an empty viewport or plot", () => {
    expect(
      getDownsampleParams(
        { viewport: { xMin: 1, xMax: 1, yMin: 0, yMax: 1 }, pixelSize },
        "line",
      ),
    ).toBeNull();
    expect(
      getDownsampleParams(
        {
          viewport: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
          pixelSize: { width: 0, height: 0 },
        },
        "line",
      ),
    ).toBeNull();
  });
});

describe("downsampleParamsEqual", () => {
  it("compares origins", () => {
    const params = { x_min: 0, x_max: 1, x_bin: 1 };
    expect(
      downsampleParamsEqual(
        { ...params, x_origin: 1_704_067_200_000_000_000 },
        { ...params, x_origin: 1_704_067_200_000_000_000 },
      ),
    ).toBe(true);
    expect(downsampleParamsEqual(params, { ...params, x_origin: 0 })).toBe(
      false,
    );
    expect(downsampleParamsEqual(params, { ...params, y_origin: 0 })).toBe(
      false,
    );
  });
});

describe("getDownsampleParams with scales", () => {
  // Most of the axis is a break, leaving 200 units on screen
  const xScale = createRangeBreakScale({
    breaks: [{ start: 100, end: 900 }],
    anchor: 0,
  });

  it("sizes bins in positions on the scale, so they are even on screen", () => {
    const params = getDownsampleParams(
      {
        viewport: { xMin: 0, xMax: 1000, yMin: -1, yMax: 1 },
        pixelSize: { width: 100, height: 100 },
        xScale,
      },
      "line",
    );
    // 200 positions across 100 pixels
    expect(params?.x_bin).toBe(2);
    // The range to load stays in plot units, wide enough to cover the view
    expect(params?.x_min).toBeLessThanOrEqual(0);
    expect(params?.x_max).toBeGreaterThanOrEqual(1000);
  });

  it("sizes scatter cells in positions on a log y scale", () => {
    const params = getDownsampleParams(
      {
        viewport: { xMin: 0, xMax: 1, yMin: 1, yMax: 1000 },
        pixelSize: { width: 100, height: 300 },
        yScale: createLogScale(10),
      },
      "scatter",
    );
    // 3 decades across 300 pixels, at 3 pixels a cell
    expect(params?.y_bin).toBeCloseTo(2 ** Math.floor(Math.log2(0.03)));
    expect(params?.y_min).toBeGreaterThan(0);
    expect(params?.y_max).toBeGreaterThanOrEqual(1000);
  });
});
