import type { AxisTick, AxisValueFormatter } from '../model/PlotTypes';
import { RangeBreakScale, type RangeBreak } from './RangeBreakScale';

/** A trading session as local wall clock times, `HH:MM` or `HH:MM:SS`. */
export type BusinessSession = readonly [open: string, close: string];

/** The span between ticks on a business calendar axis. */
export type BusinessTickUnit =
  'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface BusinessCalendarOptions {
  /** IANA time zone the sessions are in. Defaults to `UTC`. */
  timeZone?: string;
  /**
   * Sessions of a normal business day, in order. A session that closes at or
   * before it opens runs past midnight into the next day. Defaults to
   * `09:30` to `16:00`.
   */
  sessions?: readonly BusinessSession[];
  /** Days of the week with sessions, 0 for Sunday to 6 for Saturday. Defaults to Monday to Friday. */
  businessDays?: readonly number[];
  /**
   * Dates, as `YYYY-MM-DD` in the calendar's time zone, with no sessions, or
   * mapped to their own sessions, such as a half day. An empty list closes
   * the day.
   */
  holidays?:
    readonly string[] | Readonly<Record<string, readonly BusinessSession[]>>;
  /**
   * Epoch milliseconds at axis value 0, for axes whose values are not epoch
   * milliseconds. Defaults to 0.
   */
  originMs?: number;
  /**
   * Milliseconds per axis unit, such as `1e-6` for nanoseconds. Defaults to 1,
   * for epoch milliseconds.
   */
  msPerUnit?: number;
  /**
   * Labels a tick at `epochMs`, which starts a period of `unit`. `isNewPeriod`
   * is true where the next larger period also starts, such as the first tick
   * of a day among hourly ticks, which usually labels it with the date.
   * Defaults to labels in the calendar's time zone.
   */
  formatTick?: (
    epochMs: number,
    unit: BusinessTickUnit,
    isNewPeriod: boolean
  ) => string;
  /** Formats a hovered value given as epoch milliseconds. */
  formatValue?: (epochMs: number, resolutionMs: number) => string;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** A local calendar date as days since 1970-01-01. */
type DayNumber = number;

/** Parses `HH:MM` or `HH:MM:SS` into milliseconds after midnight. */
export function parseSessionTime(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (match == null) {
    throw new Error(`Expected a time as HH:MM, got ${time}`);
  }
  const [hours, minutes, seconds] = [match[1], match[2], match[3] ?? '0'].map(
    Number
  );
  if (hours > 24 || minutes > 59 || seconds > 59) {
    throw new Error(`Expected a time as HH:MM, got ${time}`);
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function parseDate(date: string): DayNumber {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match == null) {
    throw new Error(`Expected a date as YYYY-MM-DD, got ${date}`);
  }
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    MS_PER_DAY
  );
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function getPartFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (formatter == null) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall clock time in `timeZone` at `epochMs`, as if it were UTC. */
function toWallClock(epochMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  getPartFormatter(timeZone)
    .formatToParts(new Date(epochMs))
    .forEach(({ type, value }) => {
      parts[type] = Number(value);
    });
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

/** Milliseconds `timeZone` is ahead of UTC at `epochMs`. */
export function getTimeZoneOffset(epochMs: number, timeZone: string): number {
  const wholeSeconds = Math.floor(epochMs / 1000) * 1000;
  return toWallClock(wholeSeconds, timeZone) - wholeSeconds;
}

/**
 * The epoch milliseconds of a wall clock time in `timeZone`, given as
 * milliseconds after midnight of a local date. Times skipped by a daylight
 * saving change land just after it.
 */
export function wallClockToEpoch(
  day: DayNumber,
  msOfDay: number,
  timeZone: string
): number {
  const wall = day * MS_PER_DAY + msOfDay;
  const guess = wall - getTimeZoneOffset(wall, timeZone);
  const offset = getTimeZoneOffset(guess, timeZone);
  return wall - offset;
}

/** The local date in `timeZone` at `epochMs`. */
function getLocalDay(epochMs: number, timeZone: string): DayNumber {
  return Math.floor(toWallClock(epochMs, timeZone) / MS_PER_DAY);
}

/** 0 for Sunday to 6 for Saturday. */
function getWeekday(day: DayNumber): number {
  // 1970-01-01 was a Thursday
  return (((day + 4) % 7) + 7) % 7;
}

interface Session {
  open: number;
  close: number;
}

/** How far to look past a range for the sessions either side of its breaks. */
const MAX_CLOSED_DAYS = 366;

/**
 * The trading schedule behind {@link createBusinessCalendarScale}: which
 * epoch milliseconds are in a session, worked out day by day and cached.
 */
export class BusinessCalendar {
  readonly timeZone: string;

  private sessions: { open: number; close: number }[];

  private businessDays: Set<number>;

  private holidays: Map<DayNumber, { open: number; close: number }[]>;

  private cache = new Map<DayNumber, Session[]>();

  /** Business milliseconds in a normal day. */
  readonly dayLength: number;

  constructor({
    timeZone = 'UTC',
    sessions = [['09:30', '16:00']],
    businessDays = [1, 2, 3, 4, 5],
    holidays = [],
  }: BusinessCalendarOptions = {}) {
    // Throws early for an unknown zone, rather than on the first draw
    getPartFormatter(timeZone);
    this.timeZone = timeZone;
    const parseSessions = (list: readonly BusinessSession[]) =>
      list.map(([open, close]) => {
        const openMs = parseSessionTime(open);
        let closeMs = parseSessionTime(close);
        if (closeMs <= openMs) {
          closeMs += MS_PER_DAY;
        }
        return { open: openMs, close: closeMs };
      });
    this.sessions = parseSessions(sessions);
    this.businessDays = new Set(businessDays);
    this.holidays = new Map(
      Array.isArray(holidays)
        ? (holidays as readonly string[]).map(date => [parseDate(date), []])
        : Object.entries(
            holidays as Readonly<Record<string, readonly BusinessSession[]>>
          ).map(([date, list]) => [parseDate(date), parseSessions(list)])
    );
    this.dayLength = this.sessions.reduce(
      (total, session) => total + session.close - session.open,
      0
    );
  }

  /** Sessions opening on a local date, in epoch milliseconds. */
  getSessions(day: DayNumber): Session[] {
    let sessions = this.cache.get(day);
    if (sessions == null) {
      const times =
        this.holidays.get(day) ??
        (this.businessDays.has(getWeekday(day)) ? this.sessions : []);
      sessions = times.map(({ open, close }) => ({
        open: wallClockToEpoch(day, open, this.timeZone),
        close: wallClockToEpoch(day, close, this.timeZone),
      }));
      this.cache.set(day, sessions);
    }
    return sessions;
  }

  getLocalDay(epochMs: number): DayNumber {
    return getLocalDay(epochMs, this.timeZone);
  }

  /**
   * Sessions from the last one opening before `start` to the first opening
   * after `end`, so the gaps between them cover the whole range.
   */
  getSessionsAround(start: number, end: number): Session[] {
    let first = this.getLocalDay(start) - 1;
    let last = this.getLocalDay(end) + 1;
    for (
      let i = 0;
      i < MAX_CLOSED_DAYS &&
      !this.getSessions(first).some(session => session.open < start);
      i += 1
    ) {
      first -= 1;
    }
    for (
      let i = 0;
      i < MAX_CLOSED_DAYS &&
      !this.getSessions(last).some(session => session.open > end);
      i += 1
    ) {
      last += 1;
    }
    const sessions: Session[] = [];
    for (let day = first; day <= last; day += 1) {
      sessions.push(...this.getSessions(day));
    }
    return sessions.sort((a, b) => a.open - b.open);
  }

  /** The closed time between sessions, in epoch milliseconds, around a range. */
  getBreaks(start: number, end: number): RangeBreak[] {
    const sessions = this.getSessionsAround(start, end);
    const breaks: RangeBreak[] = [];
    for (let i = 1; i < sessions.length; i += 1) {
      const close = sessions[i - 1].close;
      if (sessions[i].open > close) {
        breaks.push({ start: close, end: sessions[i].open });
      }
    }
    return breaks;
  }
}

const labelFormatters = new Map<string, Intl.DateTimeFormat>();

function formatInZone(
  epochMs: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = labelFormatters.get(key);
  if (formatter == null) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    labelFormatters.set(key, formatter);
  }
  return formatter.format(new Date(epochMs));
}

/** Default tick labels: times within a day, then dates, months, and years. */
function defaultFormatTick(timeZone: string) {
  return (
    epochMs: number,
    unit: BusinessTickUnit,
    isNewPeriod: boolean
  ): string => {
    switch (unit) {
      case 'minute':
      case 'hour':
        return isNewPeriod
          ? formatInZone(epochMs, timeZone, { month: 'short', day: 'numeric' })
          : formatInZone(epochMs, timeZone, {
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            });
      case 'day':
      case 'week':
        return isNewPeriod
          ? formatInZone(epochMs, timeZone, { month: 'short', day: 'numeric' })
          : formatInZone(epochMs, timeZone, { day: 'numeric' });
      case 'month':
        return isNewPeriod
          ? formatInZone(epochMs, timeZone, { month: 'short', year: 'numeric' })
          : formatInZone(epochMs, timeZone, { month: 'short' });
      default:
        return formatInZone(epochMs, timeZone, { year: 'numeric' });
    }
  };
}

function defaultFormatValue(timeZone: string) {
  return (epochMs: number, resolutionMs: number): string =>
    formatInZone(epochMs, timeZone, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(resolutionMs < MS_PER_MINUTE ? { second: '2-digit' } : {}),
    });
}

/** Steps between ticks within a session, in minutes. */
const INTRADAY_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360];

/**
 * The business calendar axis of {@link createBusinessCalendarScale}, which
 * removes the time between sessions.
 */
export class BusinessCalendarScale extends RangeBreakScale {
  readonly calendar: BusinessCalendar;

  constructor(options: BusinessCalendarOptions = {}) {
    const calendar = new BusinessCalendar(options);
    const originMs = options.originMs ?? 0;
    const msPerUnit = options.msPerUnit ?? 1;
    const toMs = (value: number): number => originMs + value * msPerUnit;
    const fromMs = (epochMs: number): number =>
      (epochMs - originMs) / msPerUnit;
    const formatTick =
      options.formatTick ?? defaultFormatTick(calendar.timeZone);
    const formatValue =
      options.formatValue ?? defaultFormatValue(calendar.timeZone);
    const format: AxisValueFormatter = (value, resolution) =>
      formatValue(toMs(value), resolution * msPerUnit);
    super({
      type: 'calendar',
      breaks: (start, end) =>
        calendar.getBreaks(toMs(start), toMs(end)).map(item => ({
          start: fromMs(item.start),
          end: fromMs(item.end),
        })),
      format,
    });
    this.calendar = calendar;
    this.ticks = (min, max, targetCount) =>
      this.getTicks(
        toMs(min),
        toMs(max),
        targetCount,
        msPerUnit,
        fromMs,
        formatTick
      );
  }

  /**
   * Ticks like a market chart: at round clock times within sessions when
   * zoomed in, then at the open of every day, week, month, or year. Spacing
   * is picked by business time, so a weekend takes no room.
   */
  private getTicks(
    minMs: number,
    maxMs: number,
    targetCount: number,
    msPerUnit: number,
    fromMs: (epochMs: number) => number,
    formatTick: NonNullable<BusinessCalendarOptions['formatTick']>
  ): AxisTick[] {
    const { calendar } = this;
    if (!(maxMs > minMs) || !Number.isFinite(maxMs - minMs)) {
      return [];
    }
    const span =
      (this.toPlot(fromMs(maxMs)) - this.toPlot(fromMs(minMs))) * msPerUnit;
    const perTick = span / Math.max(1, targetCount);
    const dayLength = calendar.dayLength > 0 ? calendar.dayLength : MS_PER_DAY;
    const sessions = calendar
      .getSessionsAround(minMs, maxMs)
      .filter(session => session.close >= minMs && session.open <= maxMs);
    const ticks: AxisTick[] = [];
    // The period of the last tick shown, so the first of each new one, and
    // the first on screen, is labelled with it, such as with its date
    let lastPeriod: number | undefined;
    const add = (epochMs: number, unit: BusinessTickUnit, period: number) => {
      if (epochMs >= minMs && epochMs <= maxMs) {
        ticks.push({
          value: fromMs(epochMs),
          label: formatTick(epochMs, unit, period !== lastPeriod),
        });
        lastPeriod = period;
      }
    };
    const date = (day: number) => new Date(day * MS_PER_DAY);
    const monthOf = (day: number) =>
      date(day).getUTCFullYear() * 12 + date(day).getUTCMonth();

    const step = INTRADAY_STEPS.find(
      minutes => minutes * MS_PER_MINUTE >= perTick
    );
    // Clock ticks only help when at least two fit in a session
    if (step != null && step * MS_PER_MINUTE * 2 <= dayLength) {
      const stepMs = step * MS_PER_MINUTE;
      const unit = step >= 60 ? 'hour' : 'minute';
      sessions.forEach(({ open, close }) => {
        const day = calendar.getLocalDay(open);
        add(open, unit, day);
        // Round clock times, skipping any too close to the open to fit
        const offset = getTimeZoneOffset(open, calendar.timeZone);
        let time = Math.ceil((open + offset) / stepMs) * stepMs - offset;
        if (time - open < stepMs / 2) {
          time += stepMs;
        }
        for (; time < close; time += stepMs) {
          add(time, unit, day);
        }
      });
      return ticks;
    }

    // One tick per business day, week, month, or year: the day's first open
    const days: { day: number; open: number }[] = [];
    sessions.forEach(({ open }) => {
      const day = calendar.getLocalDay(open);
      if (days[days.length - 1]?.day !== day) {
        days.push({ day, open });
      }
    });
    const daysPerWeek = 5;
    const perDay = perTick / dayLength;
    if (perDay <= 2) {
      const every = perDay <= 1 ? 1 : 2;
      days.forEach(({ day, open }) => {
        if (day % every === 0) {
          add(open, 'day', monthOf(day));
        }
      });
      return ticks;
    }
    if (perDay <= daysPerWeek * 2) {
      let lastWeek: number | undefined;
      days.forEach(({ day, open }) => {
        // Weeks start on Monday
        const week = Math.floor((day + 3) / 7);
        if (week !== lastWeek) {
          if (perDay <= daysPerWeek || week % 2 === 0) {
            add(open, 'week', monthOf(day));
          }
          lastWeek = week;
        }
      });
      return ticks;
    }
    const perMonth = perDay / 21;
    const monthStep = [1, 2, 3, 6, 12].find(months => months >= perMonth);
    const years = Math.ceil(perMonth / 12);
    let lastMonth: number | undefined;
    days.forEach(({ day, open }) => {
      const month = monthOf(day);
      if (month !== lastMonth) {
        lastMonth = month;
        const year = Math.floor(month / 12);
        if (monthStep != null && month % monthStep === 0) {
          add(open, monthStep === 12 ? 'year' : 'month', year);
        } else if (
          monthStep == null &&
          month % 12 === 0 &&
          year % years === 0
        ) {
          add(open, 'year', year);
        }
      }
    });
    return ticks;
  }
}

/**
 * A time axis that skips the time between trading sessions: nights,
 * weekends, and holidays. The close of one session sits right beside the
 * open of the next, so a line of market data runs on without gaps.
 *
 * Values are epoch milliseconds unless `originMs` and `msPerUnit` say
 * otherwise. Ticks fall on round times within sessions, or on the first open
 * of each day, week, month, or year, labelled in the calendar's time zone, or
 * by `formatTick`.
 */
export function createBusinessCalendarScale(
  options: BusinessCalendarOptions = {}
): BusinessCalendarScale {
  return new BusinessCalendarScale(options);
}
