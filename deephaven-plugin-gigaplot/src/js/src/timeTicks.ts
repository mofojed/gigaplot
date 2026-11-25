import type { AxisTick, AxisTickGenerator, AxisValueFormatter } from "gigaplot";
import { getEpochSeconds, toEpochNanos } from "./instants";

/** The smallest calendar field a tick label must show. */
export type TimeField = "year" | "month" | "day" | "minute" | "second";

/** What a tick label must show to tell it apart from its neighbours. */
export interface TickResolution {
  field: TimeField;
  /** Digits of fractional seconds needed, when `field` is `second`. */
  fractionDigits: number;
}

/** Formats Instants for axis labels, in a time zone. */
export interface InstantFormatter {
  /**
   * Formats an Instant given in epoch nanoseconds, showing at least what
   * `resolution` needs.
   */
  format(epochNanos: string, resolution: TickResolution): string;
  /** Offset of the time zone from UTC at an instant, in seconds. */
  getOffsetSeconds(epochSeconds: number): number;
}

const NANOS_PER_SECOND = 1e9;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_MONTH = 2_629_746;
const SECONDS_PER_YEAR = 31_556_952;
/** 1970-01-05, the first Monday after the epoch, so weeks start on Monday. */
const FIRST_MONDAY_DAY = 4;
/** Guards against runaway loops if a step stops advancing at float limits. */
const MAX_TICKS = 1000;

type TimeStep =
  /** Divides a second, so aligns to the origin regardless of time zone. */
  | { unit: "nanos"; size: number; fractionDigits: number }
  /** Divides a day, aligned to local midnight. */
  | { unit: "seconds"; size: number }
  | { unit: "days"; size: number }
  | { unit: "months"; size: number }
  | { unit: "years"; size: number };

const STEPS: readonly TimeStep[] = [
  ...[1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8].flatMap((power, i) =>
    [1, 2, 5].map((multiple): TimeStep => ({
      unit: "nanos",
      size: multiple * power,
      fractionDigits: 9 - i,
    })),
  ),
  ...[
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600,
    43200,
  ].map((size): TimeStep => ({ unit: "seconds", size })),
  ...[1, 2, 7].map((size): TimeStep => ({ unit: "days", size })),
  ...[1, 2, 3, 6].map((size): TimeStep => ({ unit: "months", size })),
];

function getStepNanos(step: TimeStep): number {
  switch (step.unit) {
    case "nanos":
      return step.size;
    case "seconds":
      return step.size * NANOS_PER_SECOND;
    case "days":
      return step.size * SECONDS_PER_DAY * NANOS_PER_SECOND;
    case "months":
      return step.size * SECONDS_PER_MONTH * NANOS_PER_SECOND;
    case "years":
      return step.size * SECONDS_PER_YEAR * NANOS_PER_SECOND;
  }
}

/** Picks the smallest calendar friendly step at least `roughNanos` long. */
function getTimeStep(roughNanos: number): TimeStep {
  const step = STEPS.find((s) => getStepNanos(s) >= roughNanos);
  if (step != null) {
    return step;
  }
  const roughYears = roughNanos / (SECONDS_PER_YEAR * NANOS_PER_SECOND);
  const magnitude = 10 ** Math.floor(Math.log10(roughYears));
  const multiple = [1, 2, 5, 10].find((m) => m * magnitude >= roughYears) ?? 10;
  return { unit: "years", size: Math.max(1, multiple * magnitude) };
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Local seconds at the start of a month, counted in months since year 0. */
function getMonthStart(month: number): number {
  const date = new Date(0);
  // setUTCFullYear, unlike Date.UTC, does not map years 0 to 99 onto 1900
  date.setUTCFullYear(Math.floor(month / 12), mod(month, 12), 1);
  return date.getTime() / 1000;
}

/**
 * Inserts or widens the fractional seconds of a Deephaven date pattern so it
 * shows at least `digits` digits. Never shortens what the pattern shows.
 */
export function withFractionDigits(pattern: string, digits: number): string {
  if (digits <= 0) {
    return pattern;
  }
  let fractionStart = -1;
  let fractionLength = 0;
  let secondsEnd = -1;
  let isQuoted = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "'") {
      isQuoted = !isQuoted;
    } else if (!isQuoted && char === "S") {
      if (fractionStart < 0) {
        fractionStart = i;
      }
      if (fractionStart + fractionLength === i) {
        fractionLength += 1;
      }
    } else if (!isQuoted && char === "s") {
      secondsEnd = i + 1;
    }
  }
  const fraction = "S".repeat(Math.min(9, digits));
  if (fractionStart >= 0) {
    return fractionLength >= digits
      ? pattern
      : pattern.slice(0, fractionStart) +
          fraction +
          pattern.slice(fractionStart + fractionLength);
  }
  if (secondsEnd >= 0) {
    return `${pattern.slice(0, secondsEnd)}.${fraction}${pattern.slice(secondsEnd)}`;
  }
  return pattern;
}

const DATE_FIELDS = new Set(["y", "M", "d"]);
const HOUR_FIELDS = new Set(["H", "h", "k", "K"]);

/**
 * Adapts a Deephaven date pattern so labels show what the tick step needs.
 * Adds a date to time only patterns for steps of a day or more, a time to date
 * only patterns for shorter steps, and seconds or fractions of a second as
 * needed. Keeps the rest of the pattern as the user chose it.
 */
export function getTickPattern(
  pattern: string,
  { field, fractionDigits }: TickResolution,
): string {
  const fields = new Set<string>();
  let dateEnd = 0;
  let minuteEnd = 0;
  let isQuoted = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "'") {
      isQuoted = !isQuoted;
    } else if (!isQuoted) {
      fields.add(char);
      if (DATE_FIELDS.has(char)) {
        dateEnd = i + 1;
      } else if (char === "m") {
        minuteEnd = i + 1;
      }
    }
  }

  let result = pattern;
  const hasDate = [...DATE_FIELDS].some((f) => fields.has(f));
  const hasHour = [...HOUR_FIELDS].some((f) => fields.has(f));
  if (field === "year" || field === "month" || field === "day") {
    if (!hasDate) {
      result = `yyyy-MM-dd ${result}`;
    }
  } else if (!hasHour) {
    const time = field === "second" ? "HH:mm:ss" : "HH:mm";
    result =
      dateEnd > 0
        ? `${result.slice(0, dateEnd)} ${time}${result.slice(dateEnd)}`
        : `${time} ${result}`;
  } else if (field === "second" && !fields.has("s") && minuteEnd > 0) {
    result = `${result.slice(0, minuteEnd)}:ss${result.slice(minuteEnd)}`;
  }
  return field === "second"
    ? withFractionDigits(result, fractionDigits)
    : result;
}

function getTickResolution(step: TimeStep): TickResolution {
  switch (step.unit) {
    case "nanos":
      return { field: "second", fractionDigits: step.fractionDigits };
    case "seconds":
      return { field: step.size < 60 ? "second" : "minute", fractionDigits: 0 };
    case "days":
      return { field: "day", fractionDigits: 0 };
    case "months":
      return { field: "month", fractionDigits: 0 };
    case "years":
      return { field: "year", fractionDigits: 0 };
  }
}

/**
 * Creates ticks for an axis of Instants, plotted as nanoseconds since
 * `originSeconds`. Ticks land on round times in the formatter's time zone,
 * such as whole minutes, local midnight, or the first of a month.
 */
export function createTimeTicks(
  originSeconds: number,
  formatter: InstantFormatter,
): AxisTickGenerator {
  const toLocal = (seconds: number): number =>
    seconds + formatter.getOffsetSeconds(Math.floor(seconds));
  const fromLocal = (local: number): number => {
    const guess = local - formatter.getOffsetSeconds(Math.floor(local));
    return local - formatter.getOffsetSeconds(Math.floor(guess));
  };
  const toValue = (seconds: number): number =>
    (seconds - originSeconds) * NANOS_PER_SECOND;

  function getValues(min: number, max: number, step: TimeStep): number[] {
    const values: number[] = [];
    if (step.unit === "nanos") {
      // The origin is a whole second, so multiples of the step are round times
      for (
        let k = Math.ceil(min / step.size);
        k * step.size <= max && values.length < MAX_TICKS;
        k += 1
      ) {
        values.push(k * step.size);
      }
      return values;
    }

    const localMin = toLocal(originSeconds + min / NANOS_PER_SECOND);
    let nextLocal: () => number;
    if (step.unit === "seconds") {
      let local = Math.ceil(localMin / step.size) * step.size;
      nextLocal = () => {
        const result = local;
        local += step.size;
        return result;
      };
    } else if (step.unit === "days") {
      let day = Math.ceil(localMin / SECONDS_PER_DAY);
      day +=
        step.size === 7 ? mod(FIRST_MONDAY_DAY - day, 7) : mod(-day, step.size);
      nextLocal = () => {
        const result = day * SECONDS_PER_DAY;
        day += step.size;
        return result;
      };
    } else {
      const minDate = new Date(Math.floor(localMin) * 1000);
      const monthsPerStep = step.unit === "months" ? step.size : step.size * 12;
      let month =
        step.unit === "months"
          ? minDate.getUTCFullYear() * 12 + minDate.getUTCMonth()
          : minDate.getUTCFullYear() * 12;
      if (getMonthStart(month) < localMin) {
        month += step.unit === "months" ? 1 : 12;
      }
      month += mod(-month, monthsPerStep);
      nextLocal = () => {
        const result = getMonthStart(month);
        month += monthsPerStep;
        return result;
      };
    }

    while (values.length < MAX_TICKS) {
      const value = toValue(fromLocal(nextLocal()));
      if (value > max) {
        break;
      }
      // A skipped local time across a DST change can land on a neighbour
      if (value >= min && value !== values[values.length - 1]) {
        values.push(value);
      }
    }
    return values;
  }

  // The painter may ask several times a frame while fitting labels
  let cacheMin = Number.NaN;
  let cacheMax = Number.NaN;
  const cache = new Map<number, AxisTick[]>();

  return (min, max, targetCount) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return [];
    }
    if (min !== cacheMin || max !== cacheMax) {
      cache.clear();
      cacheMin = min;
      cacheMax = max;
    }
    const cached = cache.get(targetCount);
    if (cached != null) {
      return cached;
    }
    const step = getTimeStep((max - min) / Math.max(1, targetCount));
    const resolution = getTickResolution(step);
    const ticks = getValues(min, max, step).map((value) => ({
      value,
      label: formatter.format(toEpochNanos(value, originSeconds), resolution),
    }));
    cache.set(targetCount, ticks);
    return ticks;
  };
}

/**
 * Formats single Instants on an axis plotted as nanoseconds since
 * `originSeconds`, such as hovered values. Always shows the time to the
 * second, and as many fractional digits as a pixel resolves, since a tooltip
 * pins down one moment rather than labelling a range.
 */
export function createTimeFormatter(
  originSeconds: number,
  formatter: InstantFormatter,
): AxisValueFormatter {
  return (value, resolution) => {
    const fractionDigits =
      resolution > 0 && Number.isFinite(resolution)
        ? Math.min(9, Math.max(0, Math.ceil(9 - Math.log10(resolution))))
        : 9;
    return formatter.format(toEpochNanos(value, originSeconds), {
      field: "second",
      fractionDigits,
    });
  };
}

/**
 * Formats Instants as `yyyy-MM-dd HH:mm:ss.SSS` in UTC. Used until the user's
 * settings are known.
 */
export const utcInstantFormatter: InstantFormatter = {
  format(epochNanos, { fractionDigits }) {
    const seconds = getEpochSeconds(epochNanos);
    const fraction = BigInt(epochNanos) - BigInt(seconds) * 1_000_000_000n;
    const date = new Date(seconds * 1000).toISOString();
    const digits = Math.min(9, Math.max(3, fractionDigits));
    return `${date.slice(0, 10)} ${date.slice(11, 19)}.${fraction
      .toString()
      .padStart(9, "0")
      .slice(0, digits)}`;
  },
  getOffsetSeconds: () => 0,
};
