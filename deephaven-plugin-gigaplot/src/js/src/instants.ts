/**
 * Exact conversion of Deephaven `Instant` values to plot units.
 *
 * Instants are epoch nanoseconds, which a float64 can only hold to the nearest
 * 256 ns. Plotting them as nanoseconds since a nearby origin instead keeps
 * every nanosecond within about 104 days of it, and loses only a few
 * nanoseconds beyond that.
 */

export const INSTANT_TYPE = "java.time.Instant";

const NANOS_PER_SECOND = 1_000_000_000;

const BIG_NANOS_PER_SECOND = 1_000_000_000n;

/**
 * Origins are whole multiples of this many seconds. That keeps the origin in
 * epoch nanoseconds exact as a float64 for every Instant Deephaven supports,
 * so it reaches the server unchanged through JSON.
 */
const ORIGIN_GRANULARITY_SECONDS = 1024;

/**
 * Epoch nanoseconds of an Instant from the JS API as a decimal string, or null.
 * Accepts a `DateWrapper` or `LongWrapper`, a nanosecond string or number, or
 * a JS `Date`.
 */
export function getEpochNanos(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)).toString() : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis)
      ? null
      : (BigInt(millis) * 1_000_000n).toString();
  }
  // LongWrapper.valueOf returns the exact long as a string
  const nanos = (value as { valueOf(): unknown }).valueOf();
  return typeof nanos === "string" ? nanos : null;
}

/** Floor division of epoch nanoseconds into whole epoch seconds. */
export function getEpochSeconds(epochNanos: string): number {
  const nanos = BigInt(epochNanos);
  let seconds = nanos / BIG_NANOS_PER_SECOND;
  if (nanos < 0n && seconds * BIG_NANOS_PER_SECOND !== nanos) {
    seconds -= 1n;
  }
  return Number(seconds);
}

/** Picks an origin, in whole epoch seconds, at or just before an Instant. */
export function getOriginSeconds(epochNanos: string): number {
  return (
    Math.floor(getEpochSeconds(epochNanos) / ORIGIN_GRANULARITY_SECONDS) *
    ORIGIN_GRANULARITY_SECONDS
  );
}

/** The origin in epoch nanoseconds, as sent to the server. Always exact. */
export function getOriginNanos(originSeconds: number): number {
  return originSeconds * NANOS_PER_SECOND;
}

/** Nanoseconds from `originSeconds` to an Instant, in plot units. */
export function nanosSinceOrigin(
  epochNanos: string,
  originSeconds: number,
): number {
  // Splitting the string avoids a BigInt per value for the common case
  if (epochNanos.length > 9 && epochNanos.charCodeAt(0) !== 45 /* - */) {
    const seconds = Number(epochNanos.slice(0, -9));
    const fraction = Number(epochNanos.slice(-9));
    return (seconds - originSeconds) * NANOS_PER_SECOND + fraction;
  }
  return Number(
    BigInt(epochNanos) - BigInt(originSeconds) * BIG_NANOS_PER_SECOND,
  );
}

/** The Instant at `value` nanoseconds from `originSeconds`, in epoch nanoseconds. */
export function toEpochNanos(value: number, originSeconds: number): string {
  return (
    BigInt(originSeconds) * BIG_NANOS_PER_SECOND +
    BigInt(Math.round(value))
  ).toString();
}

/**
 * Converts the Instants of one axis to plot units. The origin is taken from the
 * first Instant seen and never changes, since viewports are relative to it.
 */
export class InstantAxis {
  originSeconds: number | undefined;

  toPlotValue(value: unknown): number {
    const epochNanos = getEpochNanos(value);
    if (epochNanos == null) {
      return Number.NaN;
    }
    if (this.originSeconds == null) {
      this.originSeconds = getOriginSeconds(epochNanos);
    }
    return nanosSinceOrigin(epochNanos, this.originSeconds);
  }
}
