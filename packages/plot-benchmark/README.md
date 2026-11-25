# plot-benchmark

Measures how fast gigaplot draws large scatter and line plots next to other
plotting libraries, using the same data in each. It is a separate app so that
neither the `gigaplot` library nor its demo depend on any other plotting
library.

## Usage

From the `gigaplot/` workspace:

```bash
npm run benchmark
```

Then open <http://localhost:9030/>.

The best way to compare GPU renderers is a desktop Chrome with hardware
acceleration enabled. Headless or remote browsers often fall back to
SwiftShader, a CPU emulation of the GPU. That makes WebGPU and WebGL look far
slower than they really are.

### Live mode

Pick a plot type, library, point count, series count, and how much to tick.
The header shows the measurements for the last second. Point counts are split
evenly across the series. You can type any count, such as `750k` or `3.5M`.

Settings are kept in the query string, so you can link to a run. For example:
`?lib=plotly-webgl&kind=line&points=2000000&tick=0.01`.

### Compare

Check the libraries and sizes, then select **Run comparison**. Each library is
mounted at each size with the settings above. It ticks for a second to warm
up, then is measured for the chosen time. A library that fails, takes over 30
seconds to start, or manages under one update a second skips its larger sizes.
**Copy as Markdown** copies the results table.

See [RESULTS.md](RESULTS.md) for recorded results.

## Libraries

| Library                                                               | Renderer            | Notes                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| gigaplot                                                              | WebGPU              | Every point, never downsampled. Scatter ticks send `update` deltas over only the replaced points; lines send `trimStart` and `append`. |
| gigaplot                                                              | Canvas 2D           | gigaplot's fallback renderer, also not downsampled.                                                                                    |
| [Plotly](https://plotly.com/javascript/)                              | WebGL (`scattergl`) | A static plot, redrawn with `Plotly.react` and a new `datarevision`.                                                                   |
| [uPlot](https://github.com/leeoniya/uPlot)                            | Canvas 2D           | Lines merge points that share a pixel column as they draw. Scatter uses faceted mode with a circle path builder.                       |
| [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) | Canvas 2D           | Line only. Needs `{ time, value }` objects with strictly increasing times, and has no way to drop old points except `setData`.         |
| [ECharts](https://echarts.apache.org/)                                | Canvas 2D           | Large mode scatter and typed array data. Animation, sampling, and progressive rendering are off.                                       |
| [Chart.js](https://www.chartjs.org/)                                  | Canvas 2D           | Set up per its performance guide: no animation, parsing, or events, and normalized data.                                               |
| [deck.gl](https://deck.gl/)                                           | WebGL2              | A visualization framework, so no axes are drawn. Binary attributes are uploaded again in full every tick.                              |

Each library is set up for speed, using its own guidance for large data. It
uses fixed axis ranges, so no library spends time scanning the data to
autoscale, and hover and tooltips are off. Each library is in its own
lazily loaded chunk, so only the one under test is loaded.

Highcharts (with its Boost module) and SciChart are also popular for big data,
but they need commercial licenses, so they are not included.

## The data

Every library draws the same seeded data from
[`dataset.ts`](src/dataset.ts). On each animation frame, the benchmark ticks the
data and passes the change to the library.

- **Scatter** is the rotating spiral galaxy from the demo's scatter stress
  example, with one arm per series. A tick overwrites the oldest points in
  place, like a ring buffer, so the point count never changes.
- **Line** is a bounded random walk, with one band per series and an x array
  shared by every series. A tick drops the oldest points and appends the same
  number of new points, so the window scrolls.

The tick setting is the fraction of every series replaced per frame. **Off**
draws once and only measures the startup time.

## Measurements

| Column    | Meaning                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Init      | From mounting the library to the frame after it reports its first draw, not counting generating the data                          |
| Page FPS  | Animation frames per second. This drops when the main thread is busy, or when the GPU blocks presentation                         |
| Updates/s | Ticks the library accepted and finished per second. Plotly updates asynchronously and gets no new tick until the last one settles |
| Update    | Mean time spent synchronously in the library's update call                                                                        |
| p95 frame | 95th percentile time between frames, which shows stutter                                                                          |
| Heap      | JS heap in use, in Chromium only. GPU memory is not visible to the page                                                           |

The live header also shows **data**, the mean time spent generating each tick.
This cost is the same for every library, and it also comes out of the frame
budget.

Some libraries draw in their own animation frame callback rather than during
the update call, such as gigaplot, Lightweight Charts, ECharts, and deck.gl.
Their **Update** time leaves out the drawing, so compare libraries by **Page
FPS** and **Updates/s** rather than by **Update**. GPU work is asynchronous.
It only shows in the frame rate when the GPU falls far enough behind that the
browser holds back frames.

## Adding a library

1. Add the library to this package's `dependencies`.
2. Write an adapter in [`src/adapters`](src/adapters) that exports a
   `MountAdapter`. It mounts into the container it is given, and resolves once
   the first draw has been queued. On each `update`, it reads the dataset's
   arrays, which have already been changed.
3. Register it in [`src/libraries.ts`](src/libraries.ts) with a dynamic
   `import()`, so that the library loads only when it is selected.
4. Add it to `tests/plot-benchmark.spec.ts`.
