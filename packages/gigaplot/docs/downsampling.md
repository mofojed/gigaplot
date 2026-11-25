# Downsampling

A plot can only show as much detail as it has pixels. Sending a million points
into a 900 pixel wide plot costs bandwidth, memory, and GPU time to draw
something indistinguishable from a few thousand points.

Downsampling in this package is a property of the **data source**, not the
renderer. The renderer asks for what it needs to draw and the source decides how
to satisfy that. In memory that means running a reducer; against a server it
means pushing the work down as a query.

## The request

```ts
interface SeriesDataRequest {
  seriesId: string;
  viewport: Bounds; // the region of data space being drawn
  pixelSize: PixelSize; // the size of the plot area
  style: SeriesStyle; // affects how much detail is actually visible
  signal?: AbortSignal; // aborted when a newer viewport supersedes this one
  xScale?: PlotScale; // the x axis' scale, when it is not linear
  yScale?: PlotScale; // the y axis' scale, when it is not linear
}
```

`viewport` and `pixelSize` together define the smallest distinguishable
difference: one pixel column is `(xMax - xMin) / pixelSize.width` in data space.
Anything finer than that cannot be seen.

`style` matters because a 10 pixel wide line hides more detail than a 1 pixel
one, and a scatter series cannot drop points the way a line can without changing
what the plot means.

A new request is made whenever the viewport or the plot size changes, so zooming
in naturally resolves more detail.

## Scales

On an axis with a [scale](scales.md), pixels are even in positions,
`xScale.toPlot(x)`, rather than in data units. Bin by position: on an axis
without nights and weekends, a column of `(xMax - xMin) / pixelSize.width` in
data units would span hours of closed market, and leave the sessions coarse.
The viewport stays in data units, for filtering.

```ts
const toX = request.xScale?.toPlot ?? (x => x);
const min = toX(request.viewport.xMin);
const max = toX(request.viewport.xMax);
const column = Math.floor(((toX(x) - min) / (max - min)) * pixelSize.width);
```

The bundled downsamplers all do this, and drop points with no position. A
source that reports `xResolution` reports it in positions too.

## Zoom transitions

Until the new request resolves, the plot keeps drawing the data it already has
at the new viewport. Zoomed in, that data is coarser than the screen: each of
its pixel columns now spans several, so its min/max zigzag is stretched out and
then snaps to the real shape when the detailed data lands.

To hide that, `PlotView` remembers the resolution each series was downsampled
to. While the viewport is zoomed in past it, the renderer draws the series on
that coarser pixel grid and scales it up without smoothing, as if zooming into
a picture of the last frame. Lines stay where they were and grow thicker and
blockier instead of jumping. The x grid starts at the data's `xCoverage.min`,
and the y grid is frozen from the last frame drawn at full resolution.

When more detailed data arrives, the renderer keeps the old data and fades it
out underneath the new data over a moment. Series the source returned
`complete` are exact at any zoom and never pixelate. The plot only reports
`ready` once the old data has faded.

Pass `smoothZoom: false` to `PlotView` or `<Plot>` to always draw sharp.
Renderers opt in by implementing `setSeriesResolution`, `retainSeriesData`, and
`setRetainedSeriesOpacity`.

Zoomed out, the data on hand only spans part of the new viewport, leaving empty
edges where the series hasn't loaded yet. `PlotView` hatches those x ranges
until data covering them arrives, then fades the hatching out. It waits briefly
before showing it, so quick loads never flash. The hatching uses the theme's
`backgroundColor` and `gridColor`, and is limited to the series' bounds, so space
beyond the end of the data is never marked as loading. `smoothZoom: false`
turns this off as well.

A source that answers a request at once with data it already holds, while a
more detailed result loads, should set `xResolution` on the result to the x
units per pixel that data was made for, and `xCoverage` to the x range it spans.
Otherwise the plot assumes the data matches the request, with nothing to
pixelate or hatch. The Deephaven plugin reports its loaded table's bin width
and range this way.

## Bundled downsamplers

A `Downsampler` reduces a fully materialized series for one request:

```ts
type Downsampler = (
  input: SeriesData,
  request: SeriesDataRequest
) => SeriesData;
```

### `minMaxDownsampler` (default for lines, areas, and scatter)

Keeps the first, last, minimum, and maximum point of every pixel column, plus
one point outside each edge so lines still enter and exit the plot. An area
with a `base` also keeps the points where its base is lowest and highest.

This is lossless _for the requested resolution_: the rasterized result is pixel
identical to drawing every point, because the extremes that define each column's
vertical extent are all preserved. It is the right default, and it is what a
server side downsample should aim to reproduce.

Output size scales with pixel width rather than input size, at up to four points
per column, or six for an area with a base.

### `lttbDownsampler`

Largest Triangle Three Buckets. Produces a fixed point budget and preserves the
perceived shape of a line, but it can clip narrow spikes. Use it only when a
hard point budget matters more than exactness.

The demo app has both applied to the same million points so the difference is
visible.

### `ohlcDownsampler` (default for `ohlc` and `candlestick`)

Resamples bars into longer periods once there are more than fit: each bin keeps
its first open, highest high, lowest low, and last close, at the x of its first
bar. Bins are a power of two wide, anchored at zero, and chosen so bars end up
between half of `OHLC_BAR_PIXELS` and `OHLC_BAR_PIXELS` pixels apart, which
leaves room to see each bar's open and close. Panning never moves a bar, and
zooming only regroups them at each doubling. Like `minMaxDownsampler` it
requires input sorted by `x`, and it returns the input when nothing is merged.

`StaticDataSource` uses it for bar series unless a `downsampler` is given.

### `identityDownsampler`

Returns the input untouched. Useful for small series and tests.

## Writing your own

Anything that satisfies the `Downsampler` signature works:

```ts
const everyTenth: Downsampler = (input, request) => {
  /* ... */
};

new StaticDataSource(series, { downsampler: everyTenth });
```

For a source that does not hold its data in memory, skip `Downsampler` entirely
and implement the reduction inside `requestSeriesData`. That is the intended
path for a server backed source: turn the viewport and pixel width into a query,
cache the result if it helps, and return it. The Deephaven
[plugin](../../../deephaven-plugin-gigaplot) does this, reproducing
`minMaxDownsampler` as a table aggregation on the server.

Whatever the strategy, report `complete: false` from `requestSeriesData` when
points were dropped. See [data-sources.md](data-sources.md#serving-data).
