import {
  createBusinessCalendarScale,
  type BusinessSession,
} from './businessCalendar';
import {
  createExponentialScale,
  createLogScale,
  createPowerScale,
} from './continuousScales';
import { linearScale, type PlotScale } from './PlotScale';
import { createRangeBreakScale } from './RangeBreakScale';

/**
 * A scale described as plain data, such as one sent from a server. Build it
 * with {@link createPlotScale}.
 */
export type PlotScaleSpec =
  | { type: 'linear' }
  | { type: 'log'; base?: number }
  | { type: 'exp'; base?: number }
  | { type: 'pow'; exponent: number }
  | {
      type: 'breaks';
      breaks: readonly { start: number; end: number }[];
      /**
       * True if the breaks are epoch milliseconds, placed on the axis by its
       * units, rather than axis values.
       */
      isTime?: boolean;
    }
  | {
      type: 'calendar';
      timeZone?: string;
      sessions?: readonly BusinessSession[];
      businessDays?: readonly number[];
      holidays?:
        | readonly string[]
        | Readonly<Record<string, readonly BusinessSession[]>>;
    };

/** How axis values relate to time, for scales that work in time. */
export interface PlotScaleUnits {
  /** Epoch milliseconds at axis value 0. Defaults to 0. */
  originMs?: number;
  /** Milliseconds per axis unit. Defaults to 1, for epoch milliseconds. */
  msPerUnit?: number;
}

/** Builds the scale a {@link PlotScaleSpec} describes. */
export function createPlotScale(
  spec: PlotScaleSpec,
  { originMs = 0, msPerUnit = 1 }: PlotScaleUnits = {}
): PlotScale {
  switch (spec.type) {
    case 'linear':
      return linearScale;
    case 'log':
      return createLogScale(spec.base);
    case 'exp':
      return createExponentialScale(spec.base);
    case 'pow':
      return createPowerScale(spec.exponent);
    case 'breaks': {
      const toValue = (value: number): number =>
        spec.isTime === true ? (value - originMs) / msPerUnit : value;
      return createRangeBreakScale({
        breaks: spec.breaks.map(({ start, end }) => ({
          start: toValue(start),
          end: toValue(end),
        })),
      });
    }
    case 'calendar':
      return createBusinessCalendarScale({
        timeZone: spec.timeZone,
        sessions: spec.sessions,
        businessDays: spec.businessDays,
        holidays: spec.holidays,
        originMs,
        msPerUnit,
      });
    default:
      throw new Error(`Unknown scale type ${(spec as { type: unknown }).type}`);
  }
}
