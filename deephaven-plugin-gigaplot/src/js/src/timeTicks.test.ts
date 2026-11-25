import { getEpochSeconds, toEpochNanos } from "./instants";
import {
  createTimeFormatter,
  createTimeTicks,
  getTickPattern,
  utcInstantFormatter,
  withFractionDigits,
  type InstantFormatter,
} from "./timeTicks";

const SECOND = 1e9;
const HOUR = 3600 * SECOND;
const DAY = 24 * HOUR;

const utcSeconds = (...args: Parameters<typeof Date.UTC>) =>
  Date.UTC(...args) / 1000;

/** A formatter for an IANA zone, using Intl for offsets like the JS API does. */
function zoneFormatter(timeZone: string): InstantFormatter {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const getOffsetSeconds = (epochSeconds: number) => {
    const parts = Object.fromEntries(
      format
        .formatToParts(new Date(epochSeconds * 1000))
        .map((part) => [part.type, Number(part.value)]),
    );
    return (
      utcSeconds(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) - epochSeconds
    );
  };
  return {
    getOffsetSeconds,
    format: (epochNanos, resolution) =>
      utcInstantFormatter.format(
        (
          BigInt(epochNanos) +
          BigInt(getOffsetSeconds(getEpochSeconds(epochNanos))) * 1_000_000_000n
        ).toString(),
        resolution,
      ),
  };
}

describe("withFractionDigits", () => {
  const pattern = "yyyy-MM-dd HH:mm:ss.SSS";

  it("keeps patterns that already show enough", () => {
    expect(withFractionDigits(pattern, 0)).toBe(pattern);
    expect(withFractionDigits(pattern, 3)).toBe(pattern);
    expect(withFractionDigits("yyyy-MM-dd HH:mm:ss.SSSSSSSSS", 6)).toBe(
      "yyyy-MM-dd HH:mm:ss.SSSSSSSSS",
    );
  });

  it("widens fractional seconds", () => {
    expect(withFractionDigits(pattern, 6)).toBe("yyyy-MM-dd HH:mm:ss.SSSSSS");
    expect(withFractionDigits("HH:mm:ss.SSS z", 9)).toBe(
      "HH:mm:ss.SSSSSSSSS z",
    );
  });

  it("adds fractional seconds after the seconds", () => {
    expect(withFractionDigits("yyyy-MM-dd'T'HH:mm:ss z", 3)).toBe(
      "yyyy-MM-dd'T'HH:mm:ss.SSS z",
    );
  });

  it("ignores quoted text and patterns without seconds", () => {
    expect(withFractionDigits("yyyy-MM-dd 'ss'", 3)).toBe("yyyy-MM-dd 'ss'");
  });
});

describe("getTickPattern", () => {
  const second = { field: "second", fractionDigits: 0 } as const;

  it("keeps full patterns", () => {
    const pattern = "yyyy-MM-dd HH:mm:ss.SSS z";
    expect(getTickPattern(pattern, { field: "day", fractionDigits: 0 })).toBe(
      pattern,
    );
    expect(getTickPattern(pattern, second)).toBe(pattern);
  });

  it("adds a date to time only patterns for long steps", () => {
    expect(
      getTickPattern("HH:mm:ss", { field: "month", fractionDigits: 0 }),
    ).toBe("yyyy-MM-dd HH:mm:ss");
  });

  it("adds a time to date only patterns for short steps", () => {
    expect(
      getTickPattern("yyyy-MM-dd z", { field: "minute", fractionDigits: 0 }),
    ).toBe("yyyy-MM-dd HH:mm z");
    expect(
      getTickPattern("MM-dd-yyyy", { field: "second", fractionDigits: 3 }),
    ).toBe("MM-dd-yyyy HH:mm:ss.SSS");
  });

  it("adds seconds to patterns that stop at minutes", () => {
    expect(getTickPattern("yyyy-MM-dd HH:mm", second)).toBe(
      "yyyy-MM-dd HH:mm:ss",
    );
  });
});

describe("createTimeTicks", () => {
  const origin = utcSeconds(2024, 0, 1);
  const utcTicks = createTimeTicks(origin, utcInstantFormatter);

  it("labels nanosecond ticks with every digit", () => {
    const ticks = utcTicks(0, 10, 5);
    expect(ticks.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks[1].label).toBe("2024-01-01 00:00:00.000000002");
  });

  it("uses round clock times", () => {
    const ticks = utcTicks(0, HOUR, 6);
    expect(ticks.map((t) => t.value / SECOND)).toEqual([
      0, 600, 1200, 1800, 2400, 3000, 3600,
    ]);
    expect(ticks[1].label).toBe("2024-01-01 00:10:00.000");
  });

  it("aligns days to local midnight", () => {
    const ticks = createTimeTicks(origin, zoneFormatter("Asia/Kolkata"))(
      0,
      3 * DAY,
      3,
    );
    // Midnight in UTC+5:30 is 18:30 UTC the day before
    expect(ticks.map((t) => t.value / HOUR)).toEqual([18.5, 42.5, 66.5]);
    expect(ticks[0].label).toBe("2024-01-02 00:00:00.000");
  });

  it("keeps local midnight across a DST change", () => {
    const start = utcSeconds(2024, 2, 9);
    const ticks = createTimeTicks(start, zoneFormatter("America/New_York"))(
      0,
      4 * DAY,
      4,
    );
    expect(ticks.map((t) => t.label)).toEqual([
      "2024-03-09 00:00:00.000",
      "2024-03-10 00:00:00.000",
      "2024-03-11 00:00:00.000",
      "2024-03-12 00:00:00.000",
    ]);
    // The day with the change is 23 hours long
    expect((ticks[2].value - ticks[1].value) / HOUR).toBe(23);
  });

  it("starts weeks on Monday", () => {
    const ticks = utcTicks(0, 60 * DAY, 9);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      const date = new Date(Number(toEpochNanos(tick.value, origin)) / 1e6);
      expect(date.getUTCDay()).toBe(1);
      expect(date.getUTCHours()).toBe(0);
    }
  });

  it("uses calendar months and years", () => {
    expect(utcTicks(1, 365 * DAY, 4).map((t) => t.label)).toEqual([
      "2024-04-01 00:00:00.000",
      "2024-07-01 00:00:00.000",
      "2024-10-01 00:00:00.000",
    ]);
    expect(
      utcTicks(0, 45 * 366 * DAY, 5).map((t) => t.label.slice(0, 4)),
    ).toEqual(["2030", "2040", "2050", "2060"]);
  });

  it("returns nothing for an empty range", () => {
    expect(utcTicks(5, 5, 5)).toEqual([]);
    expect(utcTicks(Number.NaN, 5, 5)).toEqual([]);
  });
});

describe("createTimeFormatter", () => {
  const origin = utcSeconds(2024, 0, 1);
  const format = jest.fn(
    (epochNanos: string, { field, fractionDigits }) =>
      `${epochNanos} ${field} ${fractionDigits}`,
  );
  const formatter = createTimeFormatter(origin, {
    format,
    getOffsetSeconds: () => 0,
  });

  it("formats the Instant at a plot value", () => {
    expect(formatter(1.5 * SECOND, 1)).toBe(
      `${BigInt(origin) * 1_000_000_000n + 1_500_000_000n} second 9`,
    );
  });

  it("shows as many fractional digits as a pixel resolves", () => {
    expect(formatter(0, 1e6)).toMatch(/ second 3$/);
    expect(formatter(0, 2.5e6)).toMatch(/ second 3$/);
    expect(formatter(0, SECOND)).toMatch(/ second 0$/);
    expect(formatter(0, HOUR)).toMatch(/ second 0$/);
  });
});
