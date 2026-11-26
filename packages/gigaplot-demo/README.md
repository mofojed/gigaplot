# gigaplot-demo

A standalone app for developing and testing `gigaplot`. It runs entirely
on generated data, so **no Deephaven server is required**.

## Usage

```bash
npm start
```

Then open <http://localhost:9020/gigaplot/>.

Pick an example from the sidebar and a renderer from the dropdown. The header
shows which renderer actually resolved, which is how you confirm a fallback
happened. Scroll to zoom, drag to pan, and double click to reset. On 3D
examples, drag to rotate instead.

## Examples

| Example            | What it covers                                          |
| ------------------ | ------------------------------------------------------- |
| Scatter            | Three 2,000 point clusters                              |
| Line               | Three 5,000 point noisy sine waves                      |
| Mixed              | A line series with a scatter series overlaid            |
| Downsample (1M)    | One million points reduced with the min/max downsampler |
| Downsample (LTTB)  | The same points with LTTB, which clips spikes           |
| Streaming          | Four random walks appended as incremental deltas        |
| Many plots (64)    | 64 plots of 50,000 points each, 3.2M points on one page |
| Plot cube          | Six different streaming plots on a rotating 3D cube     |
| Scatter stress     | Up to 10M streaming scatter points, never downsampled   |
| Scatter 3D         | Three 2,000 point clusters in 3D, with hover            |
| Line 3D            | Two Lorenz attractor traces and a helix in 3D           |
| Streaming 3D       | Lorenz attractor traces growing as incremental appends  |
| Star field         | 9,000 ticking 3D points flying past the camera          |
| Market hours       | Ticking prices on clock time and on a business calendar |
| Log scale          | Compound growth on linear and log axes                  |
| Exponential, power | Exponential and power scales straightening their data   |
| Great Scott!       | Back to the Future: fire trails, flux capacitor, 88 mph |
| Doom               | Playable Doom as 256 scatter series, replaced per frame |

Every example apart from Doom is seeded, so the output is identical on every
run. That is what lets the e2e tests compare renders directly.

## Plot cube

Six plots stream on the faces of a CSS 3D cube: an oscilloscope, orbiting
scatter clusters, random walks, Lissajous figures, an ECG style heartbeat, and a
line with noisy samples overlaid. Drag to fling it around, or focus it and use
the arrow keys. **Explode** pulls the faces apart, and **Auto rotate** keeps it
spinning while idle. Plot interaction is off on the faces so that dragging always
rotates the cube.

It doubles as a check that plots size themselves from their layout box rather
than their on screen projection, so a face that loads edge on is not squashed.

## Scatter stress

A rotating spiral galaxy that measures raw renderer throughput. It is never
downsampled: the renderer holds and draws every point on every frame. Pick the
**Points** (10K to 10M), how many are **Replaced per frame**, and the **Point
size**. Points live in a fixed size ring buffer and the oldest are overwritten
once per animation frame as incremental `update` deltas, so WebGPU only uploads
the points that changed. The header reports the frame rate the plot actually
achieves.

Use WebGPU for the large counts. Canvas draws every point as a path on the main
thread and drops to a few frames a second around a million points.

## Doom

Doom, playable, in a scatter plot. Every frame Doom draws is split by palette
color into 256 scatter series, with a point for each pixel of that color, and
every series on screen is replaced on every frame: 64,000 points at Doom's 35
frames a second by default. Click the plot to give it the keyboard, then use
the arrows to move, Ctrl to fire, Space to open doors, Enter to select, Alt and
the arrows to strafe, and Escape for the menu.

The colors are learned from the frames as they appear, and follow Doom's
palette when it flashes red on taking damage. Everything else is a plot
setting changed while the game runs:

- **Points** splits each Doom pixel into 4, 9, or 16 points, up to a million
  points a frame, or samples every other pixel.
- **Point size** fits the points to the zoom by default. Pick a fixed size and
  zoom in to see the frame is made of dots.
- **Colors** recolors the series: the plot theme's colorway, night vision,
  thermal, or a rainbow.
- **Axis scale** puts power scales on both axes, which magnify or pinch the
  middle of the screen.
- The **palette grid** has a swatch per series. Click one to hide its color,
  shift click to show it alone, or hide whole groups such as the browns.

The game is the shareware episode compiled to wasm, from
[deephaven-doom](https://github.com/mofojed/deephaven-doom), which loads only
when the example is opened. Besides the RGBA frame it draws, the port exports
`I_ReadScreen`, which copies out the palette indexed screen Doom renders, so
pixels are split by palette index rather than by matching colors.

## Comparing renderers

**Many plots** is the example to reach for. WebGL caps a document at roughly
8-16 live contexts and drops the oldest beyond that, so a grid like this is not
something it can render; every WebGPU plot here shares a single device. The
header reports how long all 64 plots took to load their data and submit a first
frame.

**Start stream** ticks all 64 plots at once, appending to every one of them four
times a second. Plots follow their data until you zoom or pan, so they stay in
frame as they grow.

Tick **Draw every point** to skip downsampling and push all 3.2M points through
the renderer. In that mode every series is complete, so ticks apply as
incremental deltas and the viewport can follow without refetching anything. It
is a deliberate stress test: on a software rasterizer such as SwiftShader it
will crawl.

A WebGPU frame is submitted rather than completed by the time it is counted, so
read the reported time as the CPU cost of getting 64 plots on screen rather than
as a GPU benchmark.

## Tests

E2E tests live in [tests/gigaplot-demo.spec.ts](../../tests/gigaplot-demo.spec.ts) and
expect this app to be running on port 9020:

```bash
npm start
npx playwright test tests/gigaplot-demo.spec.ts
```

Those tests are renderer agnostic and run against the canvas renderer, because
stock headless browsers have no WebGPU adapter. WebGPU has its own suite in
[tests/gigaplot-demo-webgpu.spec.ts](../../tests/gigaplot-demo-webgpu.spec.ts), which
only runs in the `chromium-webgpu` Playwright project. That project launches
Chromium with WebGPU forced on over SwiftShader, so the tests fail rather than
skip if WebGPU stops working:

```bash
npx playwright test --project=chromium-webgpu
```

## WebGPU says it is unavailable

If the renderer dropdown shows **WebGPU only (unavailable here)**, the browser
returned no GPU adapter. That is a browser or driver limitation, not a plot
problem, and the plot falls back to canvas. Common causes:

- Firefox ships WebGPU on Windows only; elsewhere it needs
  `dom.webgpu.enabled` in `about:config`.
- Chrome on Linux often blocklists the GPU. `chrome://gpu` says why, and
  `--enable-unsafe-webgpu --use-angle=swiftshader` forces a software adapter.
- Embedded browsers such as the VS Code Simple Browser generally have no
  adapter at all.

Check it directly with `await navigator.gpu.requestAdapter()` in the console; a
`null` result means no adapter is available.
