---
name: gigaplot-deephaven-plugin
description: Work on deephaven-plugin-gigaplot, the deephaven.ui element plugin that plots Deephaven tables with gigaplot. Use when changing the Python plots (line, scatter, area, ohlc, candlestick, scatter3d, line3d), scales.py, or downsample.py, GigaplotView or TableDataSource, building or installing the plugin wheel, running a Deephaven server with the plugin, or debugging a gigaplot panel that is blank, stale, or never finishes downsampling. For library internals (renderers, PlotView, WGSL), use gigaplot-authoring.
---

# Working on the Deephaven gigaplot plugin

Paths are relative to `deephaven-plugin-gigaplot`, from the repository root. The plugin
[README](../../../deephaven-plugin-gigaplot/README.md) documents usage,
the downsampling protocol, and custom downsamplers. Read it first.

## How a plot gets its data

```
Python _plot (ui.component)               JS GigaplotView -> TableDataSource -> PlotView
  bounds(table)        ──bounds──────────▶  setBoundsTable   ─ shapechanged (bounds) ─▶ home viewport
                       ◀─on_viewport_change─ requestSeriesData -> getDownsampleParams
  set_viewport -> downsample(table, viewport)
                       ──table, viewport─▶  setTable(table, params) ─ datachanged ─▶ redraw
```

1. Python renders with `viewport = None`, so `table` is absent and only
   `bounds` (a one row table of the full extent) is sent.
2. `TableDataSource` subscribes to the bounds table and fires `shapechanged`
   with real bounds. Until then, `hasBounds` is false and `requestSeriesData`
   sends nothing to the server.
3. `PlotView` asks for data for its viewport. The source turns it into
   `DownsampleParams` (`src/js/src/downsampleParams.ts`), throttled to one
   request per 100 ms, and calls `on_viewport_change`.
4. Python sanitizes the params (`_parse_viewport` in `gigaplot.py`), stores
   them in state, and re-renders with a downsampled table and the `viewport` it
   was made for.
5. The source subscribes to the new table and keeps drawing the old one until
   the new one delivers its first update, then swaps. `isDownsampling` drives
   the "Downsampling…" indicator until the drawn table matches the latest
   request.

Ordering is not guaranteed. The bounds can arrive before, during, or after
`PlotView.initialize()`, and the WebGPU renderer takes much longer to start on
a cold page. Any fix in this area must hold for every order.

## Invariants

- The element name `deephaven_plugin_gigaplot.gigaplot` in `gigaplot.py` must
  match the `mapping` key in `GigaplotPlugin.ts`.
- `TableDataSource` owns every table passed to `setTable` and
  `setBoundsTable` and must close it, including when the source is already
  closed. `useFetchedTable` in `GigaplotView.tsx` closes fetches that resolve
  after they were superseded.
- `requestSeriesData` in downsampled mode always returns `complete: false`, so
  the plot keeps asking as tables change. Never return `true` for a
  downsampled table.
- Python never puts client values into formulas unchecked. `_parse_viewport`
  keeps only known keys, as floats, and Instant origins as exact ints.
- Instant columns are plotted as nanoseconds since a per axis origin. The
  server subtracts the origin as a `long` before converting to `double`. Keep
  that order, or values lose nanosecond precision.
- `line`, `scatter`, `area`, `ohlc`, and `candlestick` in `gigaplot.py` all render
  the `_plot` component. Bar plots send `open`, `high`, `low`, and `close`
  column lists instead of `y`, and a downsampler receives their columns
  flattened as `[open0, high0, low0, close0, open1, ...]`. Bounds for bars come
  from `ohlc_bounds`, as the lowest low and highest high per series, in the
  same `YMin{i}`/`YMax{i}` layout `TableDataSource` reads for lines.
- `scatter3d` and `line3d` render no component: `_plot_3d` returns the
  element directly with the whole table, no `bounds`, and no
  `on_viewport_change`, since 3D data is never downsampled. They send `z`
  column lists paired with `y`, and `GigaplotView` renders `Plot3D` for their
  types. `TableDataSource` reads z as plain numbers, not Instants.
- `x_scale` and `y_scale` take a `Scale` from `scales.py`. Its `spec()` goes
  to the client, which builds it with `createPlotScale`; an `Instant` x axis
  waits for its origin, since values count nanoseconds from it. The server
  bins by `Scale.position`, so `x_bin` and `y_bin` are in positions while
  ranges stay in plot units. A calendar's formula reads its Java calendar from
  a local named `gigaplot_calendar` in the function that calls `update_view`,
  because Deephaven builds the query scope from the caller's frame. Custom
  calendars are built by writing calendar XML and parsing it, since
  `BusinessCalendar`'s parts have package-private constructors.
- Stacked areas are summed on the server (`_stack_areas`), before
  downsampling, replacing each `y` column with its running total. Every total
  then keeps the same rows per bin, so each area's base, which
  `TableDataSource` takes from the previous series' column, is exactly the top
  of the one below. Area bounds come from `area_bounds`, which includes zero.
- `GigaplotView` memoizes the source on `x`, the column lists (by JSON), `type`, `stacked`,
  `fill`, `color` and `size`, and the 3D ranges (each by JSON), `title`, `xTitle`, `yTitle`, `zTitle`, and whether downsampling is on. Changing any of these recreates the source
  and the `PlotView`, so do not add inputs that change every render.
- Bounds use Deephaven's `agg.min_` and `agg.max_`, which return NaN if any
  value in the column is NaN, and the client then drops that series' extent.
  Tables and examples should use `NULL_DOUBLE`, not NaN, for missing values.

## Validating

Unit tests cover the JS side and run under the workspace Jest config, from the
repository root:

```bash
npx jest deephaven-plugin-gigaplot
(cd deephaven-plugin-gigaplot/src/js && npx tsc --noEmit -p .)
```

The JS uses Prettier defaults (double quotes): `npx prettier --write <files>`.
The Python has no formatter config. `gigaplot.py` is clean under `black`
(`uvx black <file>`), but `downsample.py` and `register.py` are not, so do not
run `black` over them; it would bury the real change.
There are no Python unit tests, so check Python changes in a running server.

## Building and running in Deephaven

Needs Python 3.12 and Java 17 or later, which `deephaven-server` runs on. One
time setup, from the repository root:

```bash
npm install
cd deephaven-plugin-gigaplot
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade -r requirements.txt
pip install deephaven-server watchdog click
```

Then build and install from `deephaven-plugin-gigaplot` with the venv
active:

```bash
python plugin_builder.py --install --js           # first install
python plugin_builder.py --reinstall --js         # after JS or Python changes
python plugin_builder.py --reinstall              # Python only
python plugin_builder.py --reinstall --js --watch --server --server-arg --jvm-args=-Xmx8g
```

- `--server` runs `deephaven server --no-browser`. The IDE is at
  `http://localhost:10000/ide/` unless `--port` is passed. Check the server log
  for the login URL and pre-shared key.
- The large table examples in the README need several GB of heap, such as
  `-Xmx8g`.
- A JS change only reaches the browser after `--js` rebuilds the bundle,
  `--reinstall` reinstalls the wheel, the server restarts, and the page is
  reloaded. A stale bundle is the most common reason a fix "does nothing".
- Run long-lived servers in the background, and stop them when done.
  `deephaven server` exits ("Aborted!") as soon as stdin closes, so pipe one
  in: `tail -f /dev/null | deephaven server --no-browser --port 10031 ...`.
  Port 10000 is often taken by another checkout's server; pass `--port`.
- For quick checks without a login, add
  `--jvm-args "-DAuthHandlers=io.deephaven.auth.AnonymousAuthenticationHandler"`.

## Reproducing issues in the browser

Use the browser tools (Playwright or Chrome DevTools MCP) against the IDE:

1. Run the snippet in the console. The README's 20 million row `prices`
   example is a good stress case for the downsampled path.
2. Inspect the plot container:
   - `data-dh-plot-renderer` shows which renderer was resolved.
   - `data-dh-plot-status` is `loading` while requests are outstanding and
     `ready` once data is drawn.
3. Check the browser console. Logs come from the
   `deephaven-plugin-gigaplot.*` and gigaplot `Log` modules.
4. For first-open-only bugs, test a cold load: hard reload, then open the
   panel. Closing and reopening a panel reuses a warm WebGPU device and hides
   startup races.

Once the cause is known, write a unit test that reproduces the event order
before fixing it. For example, hold a mock renderer's `initialize` open while
the source fires events.
