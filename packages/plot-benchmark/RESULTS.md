# Benchmark results

Results from the comparison runner, recorded on 2026-11-08.

## Setup

- Headless Chromium 141 (from Playwright 1.56.1) on Linux, with a real GPU:
  AMD Radeon RX 5600 XT, using Vulkan through RADV. It was launched with
  `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --ignore-gpu-blocklist --enable-gpu`.
- Dev server (`npm run benchmark`), so gigaplot ran unminified from source.
- Viewport 1400 by 1000, device pixel ratio 1.
- 4 series. 10% of every series was replaced on each frame. 2px points and
  1px lines.
- Each run warmed up for 1 second and was measured for 3 seconds.

Treat these as a rough guide. Run the benchmark in desktop Chrome on your own
hardware for numbers you can compare.

Columns:

- **Init** is the time from mounting to the first frame drawn.
- **FPS** is page frames per second.
- **Updates/s** is the number of ticks the library finished each second.
- **Update** is the mean time inside the library's update call.
- **p95 frame** is the 95th percentile time between frames.

Libraries that draw on the next animation frame (gigaplot, Lightweight Charts,
ECharts, and deck.gl) leave the drawing out of **Update**. Compare libraries
by FPS and updates per second instead.

## Scatter

A rotating spiral galaxy. Every tick overwrites the oldest 10% of the points
in place.

| Library  | Renderer  | Points | Init (ms) |  FPS | Updates/s | Update (ms) | p95 frame (ms) |
| -------- | --------- | -----: | --------: | ---: | --------: | ----------: | -------------: |
| gigaplot | WebGPU    |   100K |        32 | 60.0 |      60.0 |         0.2 |           16.8 |
| gigaplot | WebGPU    |     1M |        33 | 60.0 |      60.0 |         1.3 |           16.7 |
| gigaplot | WebGPU    |    10M |       286 | 28.3 |      28.3 |         8.1 |           50.0 |
| gigaplot | Canvas 2D |   100K |        87 | 41.9 |      41.9 |         0.0 |           33.4 |
| gigaplot | Canvas 2D |     1M |       423 |  5.6 |       5.6 |         0.2 |            350 |
| gigaplot | Canvas 2D |    10M |      3620 |  0.4 |       0.4 |         9.3 |           3567 |
| Plotly   | WebGL     |   100K |       198 | 60.1 |      60.1 |        12.5 |           16.8 |
| Plotly   | WebGL     |     1M |       484 |  2.7 |       2.7 |         362 |            383 |
| Plotly   | WebGL     |    10M |      4805 |  0.2 |       0.2 |        4733 |           4800 |
| uPlot    | Canvas 2D |   100K |        76 | 36.5 |      36.5 |        25.0 |           33.4 |
| uPlot    | Canvas 2D |     1M |       646 |  2.7 |       2.7 |         258 |            517 |
| uPlot    | Canvas 2D |    10M |      6128 |  0.3 |       0.3 |        2569 |           3433 |
| ECharts  | Canvas 2D |   100K |       156 | 25.5 |      25.5 |        34.7 |           50.1 |
| ECharts  | Canvas 2D |     1M |       896 |  1.8 |       1.8 |         541 |            583 |
| ECharts  | Canvas 2D |    10M |     11581 |  0.2 |       0.2 |        6028 |           5983 |
| Chart.js | Canvas 2D |   100K |       151 | 12.7 |      12.7 |        76.0 |           83.4 |
| Chart.js | Canvas 2D |     1M |      1439 |  1.0 |       1.0 |        1000 |           1083 |
| Chart.js | Canvas 2D |    10M |         – |    – |         – |           – |              – |
| deck.gl  | WebGL2    |   100K |        98 | 60.0 |      60.0 |         0.1 |           16.7 |
| deck.gl  | WebGL2    |     1M |        86 | 60.0 |      60.0 |         0.4 |           16.7 |
| deck.gl  | WebGL2    |    10M |       235 | 14.8 |      14.8 |         2.2 |           66.8 |

Chart.js at 10M was skipped, because it managed under 1 update a second at
1M. Lightweight Charts has no scatter series.

## Line

A random walk per series. Every tick drops the oldest 10% of the points and
appends as many, so the window scrolls.

| Library            | Renderer  | Points | Init (ms) |  FPS | Updates/s | Update (ms) | p95 frame (ms) |
| ------------------ | --------- | -----: | --------: | ---: | --------: | ----------: | -------------: |
| gigaplot           | WebGPU    |   100K |        33 | 60.0 |      60.0 |         0.4 |           16.8 |
| gigaplot           | WebGPU    |     1M |        54 | 60.0 |      60.0 |         4.1 |           16.8 |
| gigaplot           | WebGPU    |    10M |       303 | 24.3 |      24.3 |        35.2 |            200 |
| gigaplot           | Canvas 2D |   100K |        34 | 60.0 |      60.0 |         0.3 |           16.7 |
| gigaplot           | Canvas 2D |     1M |        86 | 34.7 |      34.7 |         1.5 |           50.0 |
| gigaplot           | Canvas 2D |    10M |       578 |  3.8 |       3.8 |        12.6 |            600 |
| Plotly             | WebGL     |   100K |       187 | 36.6 |      36.6 |        25.4 |           33.4 |
| Plotly             | WebGL     |     1M |       553 |  2.6 |       2.6 |         386 |            400 |
| Plotly             | WebGL     |    10M |      4490 |  0.2 |       0.2 |        4523 |           4550 |
| uPlot              | Canvas 2D |   100K |        34 | 60.0 |      60.0 |         3.5 |           16.8 |
| uPlot              | Canvas 2D |     1M |        47 | 60.0 |      60.0 |         8.4 |           16.8 |
| uPlot              | Canvas 2D |    10M |       157 | 13.7 |      13.7 |        67.8 |           83.4 |
| Lightweight Charts | Canvas 2D |   100K |       180 | 10.4 |      10.4 |        82.6 |            133 |
| Lightweight Charts | Canvas 2D |     1M |      1317 |  0.8 |       0.8 |        1134 |           1450 |
| Lightweight Charts | Canvas 2D |    10M |         – |    – |         – |           – |              – |
| ECharts            | Canvas 2D |   100K |       118 | 50.6 |      50.6 |        19.3 |           33.4 |
| ECharts            | Canvas 2D |     1M |       454 |  4.8 |       4.8 |         206 |            233 |
| ECharts            | Canvas 2D |    10M |      3817 |  0.4 |       0.4 |        2230 |           2433 |
| Chart.js           | Canvas 2D |   100K |        80 | 60.0 |      60.0 |         8.8 |           16.7 |
| Chart.js           | Canvas 2D |     1M |       468 | 10.0 |      10.0 |        98.6 |            167 |
| Chart.js           | Canvas 2D |    10M |      4967 |  0.9 |       0.9 |        1100 |           1383 |
| deck.gl            | WebGL2    |   100K |       113 | 60.0 |      60.0 |         0.4 |           16.8 |
| deck.gl            | WebGL2    |     1M |       163 | 60.0 |      60.0 |         3.5 |           16.7 |
| deck.gl            | WebGL2    |    10M |       291 |  7.4 |       7.4 |        31.4 |            150 |

Lightweight Charts at 10M was skipped, because it managed under 1 update a
second at 1M.

## Takeaways

- On scatter plots, gigaplot on WebGPU holds 60 FPS at 1M points and 28 FPS
  at 10M. That is 20 to 140 times Plotly on WebGL, and about twice deck.gl
  at 10M. Plotly and the Canvas libraries all fall under 3 FPS at 1M.
- On scrolling lines, gigaplot on WebGPU is the fastest at 10M points, at
  24 FPS against 13.7 for uPlot and 7.4 for deck.gl. Its slowest 5% of frames
  are still around 200 ms at 10M. Those frames come from growing the copy of
  the data that it keeps in memory every so often.
- uPlot is the strongest of the Canvas libraries on lines, because it merges
  points that land in the same pixel column as it draws. It is not as strong
  on scatter, which it has no built-in series for.
- Plotly's WebGL traces cost hundreds of milliseconds of main thread time per
  update from 1M points up, so they cannot keep up with ticking data.
