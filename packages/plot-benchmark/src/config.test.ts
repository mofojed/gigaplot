import {
  DEFAULT_CONFIG,
  formatCount,
  parseCount,
  readConfig,
  writeConfig,
} from "./config";

describe("parseCount", () => {
  it.each([
    ["2500", 2500],
    ["250k", 250_000],
    ["2.5M", 2_500_000],
    ["1,000,000", 1_000_000],
    [" 7 m ", 7_000_000],
  ])("parses %s", (text, expected) => {
    expect(parseCount(text)).toBe(expected);
  });

  it.each(["", "abc", "0", "5g", "-3"])("rejects %s", (text) => {
    expect(parseCount(text)).toBeUndefined();
  });
});

describe("formatCount", () => {
  it("abbreviates round counts", () => {
    expect(formatCount(1_000)).toBe("1K");
    expect(formatCount(250_000)).toBe("250K");
    expect(formatCount(2_500_000)).toBe("2.5M");
    expect(formatCount(1234)).toBe((1234).toLocaleString());
  });
});

describe("readConfig", () => {
  it("round trips through the query string", () => {
    const config = {
      kind: "line" as const,
      pointCount: 750_000,
      seriesCount: 8,
      tickFraction: 0.01,
      pointSize: 3,
      lineWidth: 2,
    };
    expect(readConfig(writeConfig(config, "uplot"))).toEqual(config);
  });

  it("falls back to defaults for missing or bad values", () => {
    expect(readConfig("")).toEqual(DEFAULT_CONFIG);
    expect(readConfig("?points=lots&tick=-1&series=0")).toEqual({
      ...DEFAULT_CONFIG,
      seriesCount: 1,
    });
    expect(readConfig("?points=2M").pointCount).toBe(2_000_000);
  });
});
