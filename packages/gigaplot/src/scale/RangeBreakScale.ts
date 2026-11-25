import type { AxisTickGenerator, AxisValueFormatter } from '../model/PlotTypes';
import type { PlotScale } from './PlotScale';

/** A range of data values removed from an axis, from `start` up to `end`. */
export interface RangeBreak {
  start: number;
  end: number;
}

/**
 * Returns every break overlapping `[start, end]`, whole, in any order. Lets a
 * scale remove an endless pattern, like every night and weekend, by asking
 * only for the stretch of the axis it needs.
 */
export type RangeBreakProvider = (start: number, end: number) => RangeBreak[];

export interface RangeBreakScaleOptions {
  /** The ranges to remove: a list, or a provider for repeating ones. */
  breaks: readonly RangeBreak[] | RangeBreakProvider;
  /**
   * Ticks for a data range. Defaults to the shape's ticks, or numbers, with
   * any that fall in a break left out.
   */
  ticks?: AxisTickGenerator;
  /** Formats a data value, when the shape has none for the axis. */
  format?: AxisValueFormatter;
  /**
   * The value at position 0. Defaults to the first value placed, which keeps
   * positions near the data. Only differences between positions matter.
   */
  anchor?: number;
  /** The kind of scale, reported as its `type`. Defaults to `breaks`. */
  type?: string;
}

/** Sorts breaks and merges those that overlap or touch, dropping empty ones. */
export function mergeRangeBreaks(breaks: readonly RangeBreak[]): RangeBreak[] {
  const sorted = breaks
    .filter(
      ({ start, end }) =>
        end > start && Number.isFinite(start) && Number.isFinite(end)
    )
    .sort((a, b) => a.start - b.start);
  const merged: RangeBreak[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    if (last != null && sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

/** Most times a lookup extends the known breaks before giving up. */
const MAX_EXTENSIONS = 64;

/**
 * A scale that removes ranges from an axis, so the values either side of a
 * break sit next to each other. Positions are data units with every break
 * before them taken out, so the axis stays linear between breaks.
 *
 * Breaks are looked up lazily, by doubling the stretch of the axis known each
 * time a value falls outside it, and indexed by start with a running total of
 * their lengths, so placing a value is a binary search.
 */
export class RangeBreakScale implements PlotScale {
  readonly type: string;

  /**
   * The ticks given, if any. Without them, the axis uses the shape's ticks,
   * or numbers, leaving out any that fall in a break.
   */
  ticks: AxisTickGenerator | undefined;

  readonly format?: AxisValueFormatter;

  private provider: RangeBreakProvider;

  private anchor: number | undefined;

  /** The range of values whose breaks are all known. */
  private low = 0;

  private high = 0;

  private starts: number[] = [];

  private ends: number[] = [];

  /** Total length of the breaks before each one. */
  private totals: number[] = [];

  /** `anchor - removed(anchor)`, so the anchor sits at position 0. */
  private offset = 0;

  constructor({ breaks, ticks, format, anchor, type }: RangeBreakScaleOptions) {
    this.type = type ?? 'breaks';
    if (typeof breaks === 'function') {
      this.provider = breaks;
    } else {
      const list = mergeRangeBreaks(breaks);
      this.provider = (start, end) =>
        list.filter(item => item.end >= start && item.start <= end);
    }
    this.format = format;
    this.ticks = ticks;
    if (anchor != null && Number.isFinite(anchor)) {
      this.setAnchor(anchor);
    }
    this.toPlot = this.toPlot.bind(this);
    this.fromPlot = this.fromPlot.bind(this);
  }

  private setAnchor(anchor: number): void {
    this.anchor = anchor;
    this.low = anchor;
    this.high = anchor;
    this.load(anchor, anchor);
  }

  /** Adds the breaks overlapping `[start, end]` and rebuilds the index. */
  private load(start: number, end: number): void {
    const known = this.starts.map((breakStart, i) => ({
      start: breakStart,
      end: this.ends[i],
    }));
    const merged = mergeRangeBreaks([...known, ...this.provider(start, end)]);
    this.starts = merged.map(item => item.start);
    this.ends = merged.map(item => item.end);
    this.totals = [];
    let total = 0;
    for (let i = 0; i < merged.length; i += 1) {
      this.totals.push(total);
      total += merged[i].end - merged[i].start;
    }
    const anchor = this.anchor ?? 0;
    this.offset = anchor - this.removedBefore(anchor);
  }

  /** Makes sure every break up to `value` is known. */
  private extendTo(value: number): void {
    if (this.anchor == null) {
      this.setAnchor(value);
      return;
    }
    const span = this.high - this.low;
    if (value < this.low) {
      const low = Math.min(value, this.low - span);
      this.load(low, this.low);
      this.low = low;
    } else if (value > this.high) {
      const high = Math.max(value, this.high + span);
      this.load(this.high, high);
      this.high = high;
    }
  }

  /** Index of the last break starting at or before `value`, or -1. */
  private findBreak(value: number): number {
    const { starts } = this;
    let low = 0;
    let high = starts.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1; // eslint-disable-line no-bitwise
      if (starts[mid] <= value) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  /** Total length of the known breaks before `value`, counting any it is in. */
  private removedBefore(value: number): number {
    const i = this.findBreak(value);
    if (i < 0) {
      return 0;
    }
    return this.totals[i] + Math.min(value, this.ends[i]) - this.starts[i];
  }

  /** True if `value` is inside a break, at or after its start and before its end. */
  isInBreak(value: number): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }
    this.extendTo(value);
    const i = this.findBreak(value);
    return i >= 0 && value < this.ends[i];
  }

  /** The known breaks overlapping `[start, end]`, merged and in order. */
  getBreaks(start: number, end: number): RangeBreak[] {
    this.extendTo(start);
    this.extendTo(end);
    const breaks: RangeBreak[] = [];
    for (
      let i = Math.max(0, this.findBreak(start));
      i < this.starts.length;
      i += 1
    ) {
      if (this.starts[i] > end) {
        break;
      }
      if (this.ends[i] >= start) {
        breaks.push({ start: this.starts[i], end: this.ends[i] });
      }
    }
    return breaks;
  }

  toPlot(value: number): number {
    if (!Number.isFinite(value)) {
      return Number.NaN;
    }
    this.extendTo(value);
    const i = this.findBreak(value);
    // Everything inside a break sits where it ends
    const placed = i >= 0 && value < this.ends[i] ? this.ends[i] : value;
    return placed - this.removedBefore(placed) - this.offset;
  }

  fromPlot(position: number): number {
    if (!Number.isFinite(position)) {
      return Number.NaN;
    }
    if (this.anchor == null) {
      // Nothing has been placed yet, so place the anchor at this position
      this.setAnchor(position);
    }
    // Loading breaks before the anchor moves the offset, so it is read each time
    for (let attempt = 0; attempt < MAX_EXTENSIONS; attempt += 1) {
      const value = this.findValue(position + this.offset);
      if (value >= this.low && value <= this.high) {
        return value;
      }
      this.extendTo(value);
    }
    return this.findValue(position + this.offset);
  }

  /** The value whose position plus the offset is `target`, from the known breaks. */
  private findValue(target: number): number {
    const { starts, totals } = this;
    // The last break whose start sits at or before the target
    let low = 0;
    let high = starts.length - 1;
    let i = -1;
    while (low <= high) {
      const mid = (low + high) >> 1; // eslint-disable-line no-bitwise
      if (starts[mid] - totals[mid] <= target) {
        i = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (i < 0) {
      return target;
    }
    return target + totals[i] + this.ends[i] - starts[i];
  }
}

/** A scale removing `breaks`, a list or a provider. See {@link RangeBreakScale}. */
export function createRangeBreakScale(
  options: RangeBreakScaleOptions
): RangeBreakScale {
  return new RangeBreakScale(options);
}
