# Data sources

A `PlotDataSource` is the only thing a plot needs. It has no Deephaven specific
concepts, so anything that can describe series and produce points can back a
plot.

## The contract

```ts
interface PlotDataSource {
  getShape: () => Promise<PlotShape>;
  requestSeriesData: (request: SeriesDataRequest) => Promise<SeriesDataResult>;
  addEventListener: ...;
  removeEventListener: ...;
  close?: () => void;
}
```

### Shape first

`getShape` is the only thing required up front. It returns the series list and,
if cheaply available, the overall bounds:

```ts
{
  series: [{ id: 'a', name: 'Ask', type: 'line' }],
  bounds: { xMin: 0, xMax: 1000, yMin: -5, yMax: 5 },
}
```

No point data is needed here. The bounds are used to pick the initial viewport;
omit them and the plot starts on a unit viewport until data arrives.

The shape can also label the axes in the source's own units with
`xAxisTicks` and `yAxisTicks`. Each is an `AxisTickGenerator` that takes the
visible range and a target count and returns `{ value, label }` ticks. Without
one, an axis shows evenly spaced numbers from `linearTicks`. The plot asks for
fewer x ticks when their labels would overlap.

The shape can also give each axis a [scale](scales.md), `xScale` and
`yScale`, such as a business calendar that removes nights and weekends, or a
log scale. Its ticks take precedence over `xAxisTicks` and `yAxisTicks`. Data
stays in data units; the plot maps it to positions.

Hovered values in tooltips are formatted by `xAxisFormatter` and
`yAxisFormatter`. Each is an `AxisValueFormatter` that takes a value and the
data units one screen pixel spans, so it can show as much precision as the plot
resolves. Without one, values are numbers from `formatValue`. A source with
custom ticks usually wants a matching formatter, such as dates for timestamps.

This split matters for large or remote data. A source can describe a billion row
table instantly, then serve only what the current viewport can actually resolve.

### Serving data

`requestSeriesData` receives the viewport, the plot area size in pixels, and the
series style, and returns the points to draw. See
[downsampling.md](downsampling.md) for how to use those parameters.

`complete` tells the plot whether the result contains every point the source
holds for that series:

| `complete` | Meaning                | Effect                                 |
| ---------- | ---------------------- | -------------------------------------- |
| `true`     | Nothing was dropped    | Deltas are applied incrementally       |
| `false`    | The result was reduced | Deltas trigger a fresh request instead |

Getting this wrong is the one way to corrupt a plot: reporting `complete: true`
for reduced data makes append offsets point at the wrong place. When in doubt,
report `false`.

For `line` series the result must be sorted ascending by `x`.

`scatter3d` and `line3d` series also carry a `z` column, and their bounds
`zMin` and `zMax`. A 3D plot has no pixel columns to reduce points into, so it
asks once with the shape's bounds as the viewport and expects every point, with
`complete: true`, then relies on deltas. `line3d` points are joined in the
order given. Give the shape bounds with a z range to fix the box; without one,
the box fits the data.

Requests carry an `AbortSignal` that fires when a newer viewport supersedes
them. Honour it for anything expensive.

### Notifying of changes

Extend `AbstractPlotDataSource` to get the event plumbing:

```ts
class MyDataSource extends AbstractPlotDataSource {
  onServerUpdate(points: SeriesData) {
    this.fireDataChanged([{ type: 'append', seriesId: 'a', data: points }]);
  }

  onSeriesAdded() {
    this.fireShapeChanged(this.buildShape());
  }
}
```

Deltas are expressed against the source's own data, and describe a change the
source has **already applied**:

| Delta       | Meaning                             |
| ----------- | ----------------------------------- |
| `append`    | Points added to the end             |
| `update`    | Points changed starting at `offset` |
| `trimStart` | The first `count` points removed    |
| `replace`   | All data replaced                   |
| `clear`     | All data dropped                    |

Prefer `append`, `update`, and `trimStart` over `replace`. They are what lets
the WebGPU renderer write just the changed bytes into an existing GPU buffer
instead of re-uploading a series.

A rolling window, such as the last N points of a ticking table, is `trimStart`
for the points that left plus `append` for the ones that arrived. Do not
`replace` the whole window on every tick: that uploads every point again.
`trimSeriesData` drops the front of a `SeriesData` without copying, for a
source that keeps its own window.

Do not mutate a `SeriesData` after handing it to a delta; renderers copy what
they need, but the plot may still be reading it.

`ohlc` and `candlestick` series carry `open`, `high`, and `low` arrays parallel
to `x` and `y`, with `y` holding the close. Build them with
`createOhlcSeriesData` or `ohlcSeriesDataFromArrays`, and send the same columns
in every delta for the series.

`area` series are filled from `y` down to an optional `base` array, or to zero
without one. To stack areas, a source sends each one's running total as `y` and
the total below it as `base`, and sets `stacked` on its descriptor, so hover
reports the series' own value. `stackSeriesData` does this for series that
share x values point for point, optionally normalized to a fraction or percent.
Stack before downsampling, or with every series kept to the same points, so
each area's base is exactly the top of the one below.

## Bundled sources

- **`StaticDataSource`** — arrays already in memory, downsampled per request.
- **`StreamingDataSource`** — a seeded random walk that appends over time and
  emits `append` deltas. With `maxPoints`, it keeps a rolling window and also
  emits `trimStart` deltas. `tick()` drives it manually so tests do not need
  timers.

Both are seeded, which is what keeps the demo app and its e2e tests
deterministic.

## Adapting Deephaven

The [plugin](../../../deephaven-plugin-gigaplot) adapts Deephaven tables in
`TableDataSource`. With server side downsampling, which is the default:

- `getShape` takes its bounds from a one row table of the full extent,
- `requestSeriesData` turns the viewport and pixel size into downsample
  params, asks the server for a table reduced to them, and returns whatever is
  loaded with `complete: false`,
- when the new table's first update arrives it replaces the old one with
  `replace` deltas, which makes the plot ask again and draw the new data.

Params are snapped to powers of two, so small pans and zooms reuse the table
already loaded instead of querying again.

`Instant` columns are epoch nanoseconds, which a float64 can only hold to the
nearest 256 ns. `TableDataSource` plots them as nanoseconds since an origin, a
whole second near the first value it sees, so every nanosecond is kept. The
origin is sent with the downsample params as `x_origin` or `y_origin`, and the
server subtracts it as a `long` before binning. The axis is labelled with
`createTimeTicks`, which places ticks on round times in the user's time zone and
formats them with their workspace date format.
