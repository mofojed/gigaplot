# Scales

A scale maps the values on an axis to positions along it. A plot draws, pans,
zooms, and downsamples in positions, which are linear on screen, so a scale is
what makes an axis logarithmic, or removes ranges from it, such as the nights,
weekends, and holidays between market sessions.

```ts
interface PlotScale {
  readonly type: string;
  toPlot: (value: number) => number; // data value to position
  fromPlot: (position: number) => number; // position to data value
  ticks?: AxisTickGenerator; // ticks for a data range, in data units
  format?: AxisValueFormatter; // formats a data value
}
```

`toPlot` must never decrease as the value increases, so sorted data stays
sorted. It returns NaN where the scale has no position, such as at zero on a log
axis, and those points are left out of lines as gaps.

## Where scales come from

The source gives each axis its scale in the shape, as `xScale` and `yScale`, so
the model decides how its axes read, including their ticks and labels. A plot
can replace either one with its own, through `PlotViewOptions.xScale` or the
`xScale` prop of `Plot`, such as to show the same data in clock time and in
business time side by side. An axis with neither is linear.

```tsx
import {
  Plot,
  StaticDataSource,
  createBusinessCalendarScale,
  createLogScale,
  linearScale,
} from "gigaplot";

const nyse = createBusinessCalendarScale({
  timeZone: "America/New_York",
  sessions: [["09:30", "16:00"]],
  holidays: ["2026-01-19"],
});

const source = new StaticDataSource(series, {
  xScale: nyse,
  yScale: createLogScale(10),
});

<Plot source={source} />; // business time on x, log y
<Plot source={source} xScale={linearScale} />; // the same data in clock time
```

Keep a scale's identity stable. A new scale moves every point, so the plot loads
its data again.

## Bundled scales

| Scale                           | Position of a value `v`                             |
| ------------------------------- | --------------------------------------------------- |
| `linearScale`                   | `v`                                                 |
| `createLogScale(base)`          | `log(v) / log(base)`, none at or below zero         |
| `createExponentialScale(base)`  | `base ** v`, the inverse of a log scale             |
| `createPowerScale(exponent)`    | `sign(v) * abs(v) ** exponent`                      |
| `createRangeBreakScale(...)`    | `v` less the length of every break before it        |
| `createBusinessCalendarScale()` | business time: a range break scale without sessions |

Each has ticks to suit it: powers of the base on a log axis, values thinned
where an exponential or power axis bunches them up, and numbers outside breaks.

### Range breaks

`createRangeBreakScale({ breaks })` removes ranges from an axis, so the values
either side of each break sit next to each other, and the axis stays linear
between them. A value inside a break sits where the break ends.

`breaks` is a list, or a provider that returns the breaks overlapping a range:

```ts
// Every night from 18:00 to 06:00, endlessly, in epoch milliseconds
const nights = createRangeBreakScale({
  breaks: (start, end) => {
    const breaks = [];
    const day = 86_400_000;
    for (let t = Math.floor(start / day) * day - day; t <= end; t += day) {
      breaks.push({ start: t + 18 * 3_600_000, end: t + day + 6 * 3_600_000 });
    }
    return breaks;
  },
});
```

The scale asks the provider for more of the axis only as values outside what it
knows are placed, doubling the stretch each time, and indexes the breaks with a
running total of their lengths, so placing a value is a binary search.
Positions count from the first value placed, so they stay small and precise
next to large values such as epoch timestamps.

### Business calendars

`createBusinessCalendarScale` removes the time between sessions:

| Option                  | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `timeZone`              | IANA time zone of the sessions. Defaults to `UTC`                        |
| `sessions`              | `[open, close]` local times of a normal day, several for a lunch break   |
| `businessDays`          | Days with sessions, 0 for Sunday. Defaults to Monday to Friday           |
| `holidays`              | Dates with no sessions, or a map of dates to their own sessions          |
| `originMs`, `msPerUnit` | How axis values relate to epoch milliseconds, such as `1e-6` for nanos   |
| `formatTick`            | Labels a tick, given its epoch milliseconds, unit, and whether it is new |
| `formatValue`           | Formats a hovered value                                                  |

Sessions are worked out day by day in the time zone, so they follow daylight
saving. A session that closes at or before it opens runs past midnight.
Ticks fall on round clock times within sessions when zoomed in, then on the
first open of each day, week, month, or year as the view widens, with spacing
picked by business time so a weekend takes no room. The first tick of each day
or month, and the first on screen, carries the date.

A calendar that is always open, with a session from `00:00` to `24:00` every
day, removes nothing, which gives a clock time axis the same time labels.

### Plain data

`createPlotScale(spec, units)` builds a scale from a `PlotScaleSpec`, plain data
such as `{ type: 'log', base: 10 }` or `{ type: 'calendar', timeZone, sessions
}`, for scales sent from a server. `units` says how axis values relate to
epoch milliseconds, for calendars and breaks given in time.

## How a plot uses them

`PlotView` keeps the source's shape and data in data units, and everything that
draws in positions:

- Data and deltas from the source are mapped with `toPlot` before the renderer
  gets them, so renderers, hit testing, and the pixel grid never see a scale.
- The shape everything draws from has its bounds mapped, gradient stops in data
  units placed on the axis, and tick generators and formatters wrapped, so they
  are asked about data values and place ticks by position. The scale's ticks
  take precedence over the shape's; the shape's formatter over the scale's.
  Ticks inside a break, or with no position, are left out.
- Requests carry the viewport in data units, with the scales when they are not
  linear, so a source bins by position. See
  [downsampling.md](downsampling.md#scales).
- The viewport, `viewportchanged`, and `hover` are reported in data units.

When a shape's bounds have no position, such as a log axis whose data reaches
zero, home is fitted to the data loaded instead.

2D plots only; 3D plots ignore scales.
