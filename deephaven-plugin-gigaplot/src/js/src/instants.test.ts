import {
  InstantAxis,
  getEpochNanos,
  getEpochSeconds,
  getOriginNanos,
  getOriginSeconds,
  nanosSinceOrigin,
  toEpochNanos,
} from "./instants";

/** Mimics a DateWrapper, whose valueOf is the exact long as a string. */
const wrap = (nanos: string) => ({ valueOf: () => nanos });

// 2024-01-01T00:00:00Z
const NEW_YEAR = 1_704_067_200;

describe("getEpochNanos", () => {
  it("reads wrappers exactly", () => {
    expect(getEpochNanos(wrap("1704067200000000001"))).toBe(
      "1704067200000000001",
    );
  });

  it("reads dates and nulls", () => {
    expect(getEpochNanos(new Date(1500))).toBe("1500000000");
    expect(getEpochNanos(null)).toBeNull();
    expect(getEpochNanos(undefined)).toBeNull();
  });
});

describe("getEpochSeconds", () => {
  it("floors toward negative infinity", () => {
    expect(getEpochSeconds("1999999999")).toBe(1);
    expect(getEpochSeconds("-1")).toBe(-1);
    expect(getEpochSeconds("-1000000000")).toBe(-1);
  });
});

describe("origins", () => {
  it("are whole seconds at or before the value", () => {
    const origin = getOriginSeconds("1704067200123456789");
    expect(origin).toBeLessThanOrEqual(NEW_YEAR);
    expect(NEW_YEAR - origin).toBeLessThan(1024);
  });

  it("serialize exactly as epoch nanoseconds", () => {
    for (const nanos of [
      "1704067200123456789",
      "-1704067200123456789",
      "9223372036854775807",
      "-9223372036854775807",
    ]) {
      const origin = getOriginSeconds(nanos);
      expect(JSON.stringify(getOriginNanos(origin))).toBe(
        (BigInt(origin) * 1_000_000_000n).toString(),
      );
    }
  });
});

describe("nanosSinceOrigin", () => {
  it("keeps every nanosecond", () => {
    expect(nanosSinceOrigin("1704067200000000001", NEW_YEAR)).toBe(1);
    expect(nanosSinceOrigin("1704067199999999999", NEW_YEAR)).toBe(-1);
    expect(nanosSinceOrigin("1704153600000000007", NEW_YEAR)).toBe(
      86_400_000_000_007,
    );
  });

  it("handles instants before the epoch", () => {
    expect(nanosSinceOrigin("-999999999", -1)).toBe(1);
    expect(nanosSinceOrigin("5", 0)).toBe(5);
  });

  it("round trips through toEpochNanos", () => {
    const nanos = "1704067200123456789";
    expect(toEpochNanos(nanosSinceOrigin(nanos, NEW_YEAR), NEW_YEAR)).toBe(
      nanos,
    );
  });
});

describe("InstantAxis", () => {
  it("fixes the origin at the first value", () => {
    const axis = new InstantAxis();
    expect(axis.toPlotValue(null)).toBeNaN();
    expect(axis.originSeconds).toBeUndefined();
    const first = axis.toPlotValue(wrap("1704067200000000001"));
    const origin = axis.originSeconds;
    expect(origin).toBeDefined();
    expect(axis.toPlotValue(wrap("1704067200000000002")) - first).toBe(1);
    axis.toPlotValue(wrap("1000"));
    expect(axis.originSeconds).toBe(origin);
  });
});
