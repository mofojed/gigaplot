import {
  BusinessCalendar,
  createBusinessCalendarScale,
  getTimeZoneOffset,
  parseSessionTime,
  wallClockToEpoch,
} from './businessCalendar';
import {
  createExponentialScale,
  createLogScale,
  createPowerScale,
} from './continuousScales';
import {
  fromPlotBounds,
  isOnScale,
  linearScale,
  toPlotTicks,
} from './PlotScale';
import { createRangeBreakScale, mergeRangeBreaks } from './RangeBreakScale';

const NEW_YORK = 'America/New_York';

/** Epoch milliseconds of a New York wall clock time. */
function ny(date: string, time: string): number {
  const day = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return wallClockToEpoch(day, parseSessionTime(time), NEW_YORK);
}

describe('range breaks', () => {
  it('merges overlapping and touching breaks', () => {
    expect(
      mergeRangeBreaks([
        { start: 5, end: 7 },
        { start: 1, end: 2 },
        { start: 2, end: 3 },
        { start: 6, end: 9 },
        { start: 4, end: 4 },
      ])
    ).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 9 },
    ]);
  });

  it('closes each break up, and maps positions back', () => {
    const scale = createRangeBreakScale({
      breaks: [
        { start: 10, end: 20 },
        { start: 30, end: 35 },
      ],
      anchor: 0,
    });
    expect(scale.toPlot(5)).toBe(5);
    expect(scale.toPlot(10)).toBe(10);
    expect(scale.toPlot(15)).toBe(10);
    expect(scale.toPlot(20)).toBe(10);
    expect(scale.toPlot(25)).toBe(15);
    expect(scale.toPlot(40)).toBe(25);
    expect(scale.toPlot(-5)).toBe(-5);

    expect(scale.fromPlot(5)).toBe(5);
    // A break comes back as its end
    expect(scale.fromPlot(10)).toBe(20);
    expect(scale.fromPlot(15)).toBe(25);
    expect(scale.fromPlot(25)).toBe(40);
    expect(scale.isInBreak(15)).toBe(true);
    expect(scale.isInBreak(20)).toBe(false);
  });

  it('keeps positions stable as it looks up more breaks either side', () => {
    const provider = jest.fn((start: number, end: number) => {
      // A break of 5 at the start of every 10
      const breaks = [];
      for (let t = Math.floor(start / 10) * 10; t <= end; t += 10) {
        breaks.push({ start: t, end: t + 5 });
      }
      return breaks;
    });
    const scale = createRangeBreakScale({ breaks: provider });
    const first = scale.toPlot(1007);
    expect(first).toBe(0);
    expect(scale.toPlot(1017) - first).toBe(5);
    // Far away in both directions, which loads more breaks
    expect(scale.toPlot(2007) - first).toBe(500);
    expect(scale.toPlot(7) - first).toBe(-500);
    expect(scale.toPlot(1017) - first).toBe(5);
    expect(scale.fromPlot(scale.toPlot(1507))).toBe(1507);
    expect(scale.fromPlot(-1000)).toBe(-993);
    expect(provider.mock.calls.length).toBeLessThan(30);
  });

  it('leaves ticks in a break off the axis', () => {
    const scale = createRangeBreakScale({
      breaks: [{ start: 2.5, end: 7.5 }],
      anchor: 0,
    });
    const ticks = toPlotTicks(scale, undefined)(0, scale.toPlot(10), 10);
    expect(ticks.map(tick => tick.label)).toEqual([
      '0',
      '1.0',
      '2.0',
      '8.0',
      '9.0',
      '10.0',
    ]);
    expect(ticks.map(tick => tick.value)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('business calendar', () => {
  it('converts New York wall clock times across daylight saving', () => {
    expect(ny('2026-01-05', '09:30')).toBe(Date.parse('2026-01-05T14:30:00Z'));
    expect(ny('2026-07-06', '09:30')).toBe(Date.parse('2026-07-06T13:30:00Z'));
    expect(
      getTimeZoneOffset(Date.parse('2026-07-06T13:30:00Z'), NEW_YORK)
    ).toBe(-4 * 3_600_000);
  });

  it('puts the next open right beside each close, over nights and weekends', () => {
    const scale = createBusinessCalendarScale({ timeZone: NEW_YORK });
    const mondayOpen = scale.toPlot(ny('2026-01-05', '09:30'));
    const mondayClose = scale.toPlot(ny('2026-01-05', '16:00'));
    const tuesdayOpen = scale.toPlot(ny('2026-01-06', '09:30'));
    const fridayClose = scale.toPlot(ny('2026-01-09', '16:00'));
    const nextMondayOpen = scale.toPlot(ny('2026-01-12', '09:30'));
    const sessionLength = 6.5 * 3_600_000;

    expect(mondayClose - mondayOpen).toBe(sessionLength);
    expect(tuesdayOpen).toBe(mondayClose);
    expect(nextMondayOpen).toBe(fridayClose);
    expect(nextMondayOpen - mondayOpen).toBe(5 * sessionLength);
    // Overnight and on a Saturday sit at the next open
    expect(scale.toPlot(ny('2026-01-05', '20:00'))).toBe(tuesdayOpen);
    expect(scale.toPlot(ny('2026-01-10', '12:00'))).toBe(nextMondayOpen);
    expect(scale.fromPlot(nextMondayOpen)).toBe(ny('2026-01-12', '09:30'));
    expect(isOnScale(scale, ny('2026-01-10', '12:00'))).toBe(false);
  });

  it('skips holidays and keeps half days short', () => {
    const scale = createBusinessCalendarScale({
      timeZone: NEW_YORK,
      holidays: { '2026-11-26': [], '2026-11-27': [['09:30', '13:00']] },
    });
    const wednesdayClose = scale.toPlot(ny('2026-11-25', '16:00'));
    expect(scale.toPlot(ny('2026-11-27', '09:30'))).toBe(wednesdayClose);
    expect(scale.toPlot(ny('2026-11-30', '09:30')) - wednesdayClose).toBe(
      3.5 * 3_600_000
    );
  });

  it('supports sessions that run past midnight and several a day', () => {
    const calendar = new BusinessCalendar({
      timeZone: 'UTC',
      sessions: [
        ['09:00', '11:30'],
        ['12:30', '15:00'],
      ],
      businessDays: [0, 1, 2, 3, 4, 5, 6],
    });
    const day = Date.parse('2026-03-02T00:00:00Z') / 86_400_000;
    expect(calendar.getSessions(day)).toEqual([
      {
        open: Date.parse('2026-03-02T09:00:00Z'),
        close: Date.parse('2026-03-02T11:30:00Z'),
      },
      {
        open: Date.parse('2026-03-02T12:30:00Z'),
        close: Date.parse('2026-03-02T15:00:00Z'),
      },
    ]);
    const overnight = new BusinessCalendar({ sessions: [['18:00', '17:00']] });
    expect(overnight.getSessions(day)).toEqual([
      {
        open: Date.parse('2026-03-02T18:00:00Z'),
        close: Date.parse('2026-03-03T17:00:00Z'),
      },
    ]);
  });

  it('places axis values in other units, such as nanoseconds from an origin', () => {
    const originMs = ny('2026-01-05', '00:00');
    const scale = createBusinessCalendarScale({
      timeZone: NEW_YORK,
      originMs,
      msPerUnit: 1e-6,
    });
    const toValue = (epochMs: number) => (epochMs - originMs) * 1e6;
    expect(
      scale.toPlot(toValue(ny('2026-01-06', '09:30'))) -
        scale.toPlot(toValue(ny('2026-01-05', '09:30')))
    ).toBe(6.5 * 3_600_000 * 1e6);
  });

  it('ticks on clock times when zoomed in, labelling each new day', () => {
    const scale = createBusinessCalendarScale({ timeZone: NEW_YORK });
    const ticks = toPlotTicks(scale, undefined);
    const start = scale.toPlot(ny('2026-01-05', '14:00'));
    const end = scale.toPlot(ny('2026-01-06', '11:00'));
    const labels = ticks(start, end, 6).map(tick => tick.label);
    // The first tick on screen is labelled with its date, like each new day
    expect(labels).toEqual(['Jan 5', '15:00', 'Jan 6', '10:00', '11:00']);
  });

  it('ticks on days, weeks, and months as it zooms out', () => {
    const scale = createBusinessCalendarScale({ timeZone: NEW_YORK });
    const ticks = toPlotTicks(scale, undefined);
    const labels = (from: string, to: string, count: number) =>
      ticks(
        scale.toPlot(ny(from, '09:30')),
        scale.toPlot(ny(to, '16:00')),
        count
      ).map(tick => tick.label);

    // Friday's close sits at Monday's open, so the last tick is Monday's
    expect(labels('2026-01-05', '2026-01-09', 6)).toEqual([
      'Jan 5',
      '6',
      '7',
      '8',
      '9',
      '12',
    ]);
    expect(labels('2026-01-05', '2026-02-27', 8)).toEqual([
      'Jan 5',
      '12',
      '19',
      '26',
      'Feb 2',
      '9',
      '16',
      '23',
      'Mar 2',
    ]);
    expect(labels('2026-01-02', '2026-12-31', 8)).toEqual([
      'Jan 2026',
      'Mar',
      'May',
      'Jul',
      'Sep',
      'Nov',
      'Jan 2027',
    ]);
  });
});

describe('continuous scales', () => {
  it('places powers of the base evenly on a log scale', () => {
    const scale = createLogScale(10);
    expect(scale.toPlot(1000)).toBeCloseTo(3);
    expect(scale.fromPlot(2)).toBeCloseTo(100);
    expect(scale.toPlot(0)).toBeNaN();
    expect(scale.toPlot(-1)).toBeNaN();
    const ticks = toPlotTicks(scale, undefined)(0, 6, 8);
    expect(ticks.map(tick => tick.label)).toEqual([
      '1',
      '10',
      '100',
      '1000',
      '10000',
      '100000',
      '1e+6',
    ]);
    expect(
      toPlotTicks(scale, undefined)(0, 1, 9).map(tick => tick.label)
    ).toEqual(['1', '2', '5', '10']);
  });

  it('spreads out large values on exponential and power scales', () => {
    const exp = createExponentialScale(10);
    expect(exp.toPlot(2)).toBeCloseTo(100);
    expect(exp.fromPlot(1000)).toBeCloseTo(3);
    const pow = createPowerScale(2);
    expect(pow.toPlot(-3)).toBe(-9);
    expect(pow.fromPlot(16)).toBeCloseTo(4);
    // Ticks thin out where the scale bunches values up
    const ticks = toPlotTicks(exp, undefined)(exp.toPlot(0), exp.toPlot(3), 5);
    const positions = ticks.map(tick => tick.value);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i] - positions[i - 1]).toBeGreaterThan(1000 / 10);
    }
    expect(Number(ticks[ticks.length - 1].label)).toBe(3);
  });

  it('rejects scales that cannot be inverted', () => {
    expect(() => createLogScale(1)).toThrow();
    expect(() => createExponentialScale(-2)).toThrow();
    expect(() => createPowerScale(0)).toThrow();
  });
});

it('labels an exponential axis whose view reaches below position zero', () => {
  const scale = createExponentialScale(10);
  const ticks = toPlotTicks(scale, undefined)(-500, 10_500, 5);
  expect(ticks.length).toBeGreaterThan(2);
  expect(Number(ticks[ticks.length - 1].label)).toBe(4);
});

it('keeps data bounds finite where a view reaches past a scale', () => {
  const bounds = fromPlotBounds(
    { xMin: 0, xMax: 1, yMin: -500, yMax: 10_500 },
    { x: linearScale, y: createExponentialScale(10) }
  );
  expect(Number.isFinite(bounds.yMin)).toBe(true);
  expect(bounds.yMax).toBeCloseTo(Math.log10(10_500));
});
