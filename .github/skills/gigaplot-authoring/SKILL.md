---
name: gigaplot-authoring
description: Work on the gigaplot package - add or modify renderers (WebGPU/WGSL, Canvas 2D), series types, data sources, or downsamplers, and test plots with the gigaplot-demo app. Use when adding a plot type, writing a WGSL shader, implementing a PlotDataSource, debugging a blank or corrupted plot render, or wiring plot e2e tests. Not for the legacy plotly.js based @deephaven/chart package.
---

# Authoring in gigaplot

`gigaplot` is a ground-up plotting library. WebGPU is the primary
renderer; Canvas 2D is the universal fallback. Read
`packages/gigaplot/docs/architecture.md` first — it explains the layering that the
rules below depend on.

Paths below are relative to the repository root, and commands run from there.
See `AGENTS.md` for setup, validation, and formatting.

## Ground rules

1. **Renderers never touch data sources, and sources never touch renderers.**
   `PlotView` is the only thing that talks to both. If you find yourself
   importing a source into a renderer, the design has gone wrong.
2. **Renderers own their copy of series data.** Sources are allowed to return
   their internal arrays (`minMaxDownsampler` returns its input unchanged when
   the data already fits). Applying a delta in place to that array corrupts the
   source and produces lines fanning out from the origin. Always
   `copySeriesData` in `setSeriesData`.
3. **Renderers draw data only.** Axes, gridlines, labels, and the legend belong
   to `AxisPainter`, and the data canvas is already sized and positioned to the
   plot area. Do not reimplement margins or chrome in a renderer.
4. **Never draw synchronously.** Call `invalidate()`; a single
   `requestAnimationFrame` coalesces the frame.
5. **The WebGPU device is shared by every plot on the page.** Get it from
   `getSharedWebGpu()`, never call `requestDevice` in a renderer, and never
   destroy it in `destroy()` — that would kill every other plot. Sharing is what
   lets a page hold dozens of plots, which is a main reason WebGPU is preferred
   over WebGL here.
6. **Nothing visual is hard coded.** Colors, line widths, fonts, and chrome
   metrics come from `PlotTheme`. A new visual property gets a theme field with
   a default matching `@deephaven/components`, and a `--dh-color-chart-*`
   mapping in `PLOT_THEME_CSS_VARIABLES` when Deephaven defines one. See
   `packages/gigaplot/docs/theming.md`.
7. **`PlotView` must not miss source events while it initializes.**
   `initialize()` awaits the shape and the renderer, and WebGPU setup can take
   long enough for a remote source to deliver its bounds. Listeners are added
   before the first `await`, and the renderer is set up from the latest
   `this.shape` rather than a snapshot. Anything new added to `initialize()`
   must keep both properties.

8. **Renderers, painters, and hover never see axis scales.** `PlotView` maps
   data and deltas to positions with `toPlotSeriesData` before the renderer
   gets them, and draws from a plot-space shape (`toPlotShape`) whose bounds,
   ticks, and formatters are wrapped. Requests, the public viewport, and hover
   events stay in data units. A downsampler must bin by
   `request.xScale.toPlot(x)` when it is set, or business time axes come out
   coarse. See `packages/gigaplot/docs/scales.md`.

9. **A series on another axis has a viewport of its own.** Shapes can add
   axes in `axes`, which series name in `xAxis` and `yAxis`. `PlotView` links
   each such axis to the primary viewport, and passes renderers, hover, and
   requests each series' own viewport. A renderer must draw a series against
   `seriesViewports.get(id) ?? viewport` from `setViewport`, never the plot's
   viewport alone, and anything that maps a series to screen must look its
   viewport up the same way. See "Axes" in `packages/gigaplot/docs/architecture.md`.

## Iterating

The demo app is the fastest loop and needs no Deephaven server:

```bash
npm start   # http://localhost:9020/gigaplot/
```

Add a case to `packages/gigaplot-demo/src/examples.ts` for whatever you are
building. Keep generators seeded — the e2e tests compare renders directly and
unseeded data makes them flaky.

## Adding a renderer

Implement `PlotRenderer` plus a `PlotRendererFactory`, then register it:

```ts
defaultRendererRegistry.register(mySvgRendererFactory);
```

- `capabilities.seriesTypes` gates selection. A renderer that cannot draw a
  series type in the plot is skipped rather than failing.
- `isSupported()` is async and cached. Returning false is the normal way to
  decline; throwing is also treated as unsupported.
- Set `capabilities.incrementalUpdates` honestly. It is documentation, not
  behaviour — `applyDeltas` may always redraw everything.

Add the renderer name to the demo's `RENDERER_PREFERENCES` so it can be forced
from the UI, which is how fallback gets tested.

## Adding a series type

1. Add it to the `PlotSeriesType` union in `model/PlotTypes.ts`.
2. Implement it in **both** renderers, or the plot silently falls back whenever
   that type is present.
3. Declare it in each renderer's `capabilities.seriesTypes`.
4. Consider whether existing downsamplers are still valid. `minMaxDownsampler`
   assumes points are sorted ascending by `x` and that dropping interior points
   is acceptable — true for lines, not for every type. Bars get their own,
   `ohlcDownsampler`, which `StaticDataSource` picks by series type.
5. If the type needs more than `x` and `y`, add optional columns to
   `SeriesData` as `open`, `high`, `low`, and `base` are, and keep them in step in
   every helper in `PlotTypes.ts` (`copySeriesPoint`, `ensureSeriesCapacity`,
   and the rest) so deltas and downsamplers do not drop them.
6. Hover: decide whether it snaps along x (`isSnappingSeriesType`) or needs a
   hit, and what the tooltip box lists for it.

3D series types (`scatter3d`, `line3d`) are drawn by `Plot3DView` with the 3D
renderers in `defaultRenderer3DRegistry`, not by `PlotView`. A new one goes in
`is3DSeriesType`, both `WebGpu3DRenderer` and `Canvas3DRenderer`, and
`findHover3D`. The 2D renderers must not declare it, and vice versa, so a plot
of the wrong kind fails with a clear "cannot draw" error.

## Writing WGSL

Shaders live in `renderers/webgpu/shaders.ts`. Every pipeline shares one
uniform struct of 96 bytes:

| Offset | Field             | Type        |
| ------ | ----------------- | ----------- |
| 0      | `viewport`        | `vec4<f32>` |
| 16     | `color`           | `vec4<f32>` |
| 32     | `resolution`      | `vec2<f32>` |
| 40     | `size`            | `f32`       |
| 44     | `snap`            | `f32`       |
| 48     | `grid`            | `vec4<f32>` |
| 64     | `decreasingColor` | `vec4<f32>` |
| 80     | `bar`             | `vec4<f32>` |

Line and scatter read `array<vec2<f32>>` points; the OHLC pipeline, used for
both `ohlc` and `candlestick`, reads five `f32` per bar (x, open, high, low,
close); the area pipelines read three per point (x, y, base), and the line
shader is shared with areas through a `point(i)` accessor. A series' buffer
stride follows its data, or for areas its type, so a buffer is reallocated
when a series switches layout.

The area fill pipeline has its own bind group layout, adding a fill uniform of
gradient stops at binding 2. Its bind group is dropped whenever the storage
buffer is replaced. Fills are drawn in a pass before every other series, so
stacked areas never cover the line below.

A fragment that must agree with its neighbours on which quad owns a pixel,
like the area fill, has to derive its sample from `@builtin(position)`.
Interpolated varyings round differently per quad, which leaves pixels at a
shared edge filled twice or not at all, seen as thin vertical streaks.

Changing it means changing `UNIFORM_FLOAT_COUNT` and `writeUniforms` together.

3D shaders live in `renderers/webgpu/shaders3d.ts` with their own 112 byte
struct (a data to clip `mat4x4`, color, resolution, size, reference depth, and
fade), and points stored as `vec4` with `w` 0 for a gap, since WGSL does not
reliably keep NaN checks. Each 3D shader is drawn twice: `depthMain` writes the
depth of pixels at least half opaque with color masked off, then
`fragmentMain` draws color depth tested without writing. Writing depth from
antialiased edges leaves dark rings around points and dotted lines.

- Positions are **relative to a per series origin**, and the viewport passed in
  the uniform is shifted by the same origin. Absolute `f32` is not precise
  enough for epoch millisecond timestamps.
- Fragment shaders output **premultiplied** alpha (`color.rgb * alpha, alpha`)
  because the canvas is configured with `alphaMode: 'premultiplied'`.
- Clear to transparent. The axes canvas sits underneath and must show through.

### Debugging a blank WebGPU plot

Validation errors are asynchronous. `WebGpuRenderer` already logs them through
an `uncapturederror` listener, so check the console first.

If there are no errors, bisect rather than guess:

1. Return a constant color from the fragment shader. Geometry appears → the
   vertex stage is fine and the problem is in the fragment stage.
2. Output a uniform or interpolated value into a color channel and read the
   pixels back. This is how you tell "the uniform is wrong" from "the maths is
   wrong".

To run WebGPU in a headless browser, launch Chromium with
`--enable-unsafe-webgpu --use-angle=swiftshader --enable-gpu`. Stock headless
has no adapter.

## Writing a data source

Extend `AbstractPlotDataSource`. The critical field is `complete` on the
`requestSeriesData` result: `true` means "nothing was dropped", which is what
allows deltas to be applied incrementally. Reporting `true` for reduced data
misaligns append offsets and corrupts the plot. When unsure, return `false`.

See `packages/gigaplot/docs/data-sources.md` for the full contract.

## Testing

- **Unit** (`npx jest`)
  — jsdom has no WebGPU, so cover the WebGPU renderer's logic through the
  registry and delta helpers rather than by instantiating it. Use a mock
  `PlotRenderer` for `PlotView` tests, and stub
  `HTMLElement.prototype.getBoundingClientRect` since jsdom reports zero size.
  To test a race during startup, give the mock renderer an `initialize` that
  resolves only when the test calls it, and fire source events in between.
  Data requests are coalesced on a `setTimeout(0)`, so await one before
  asserting on them.
- **E2E** (`tests/gigaplot-demo.spec.ts`) — wait on
  `[data-dh-plot-status=ready]` rather than a timeout, then poll for pixels;
  ready means the data loaded, and the paint lands a frame later. Assert that
  something was drawn with `expectDrawn` from `tests/gigaplot-demo.utils.ts`, which
  measures a Playwright element screenshot. Do **not** read a WebGPU canvas with
  `toDataURL`, `drawImage`, or `createImageBitmap`: Chromium returns a blank
  image once several WebGPU canvases are live.
- **WebGPU e2e** (`tests/gigaplot-demo-webgpu.spec.ts`) — runs only in the
  `chromium-webgpu` project, which forces WebGPU on over SwiftShader so the
  tests fail rather than skip. Put anything renderer specific there.
