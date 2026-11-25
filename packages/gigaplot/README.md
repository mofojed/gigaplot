# gigaplot

A plotting library built from the ground up around swappable GPU renderers and
data sources that are not tied to Deephaven.

WebGPU is the primary renderer. A Canvas 2D renderer ships as the fallback for
platforms where WebGPU is unavailable. Scatter, line, area, OHLC, and
candlestick series are supported in 2D, and scatter and line series in 3D. 2D
axes can be logarithmic, exponential, or a power, or skip ranges such as the
nights and weekends of a business calendar.

## Install

gigaplot is not published to npm yet. Until it is, build it from a clone of
[the repository](https://github.com/mofojed/gigaplot) and install the packed
tarball:

```bash
npm install                    # from the repository root
npm run build -w gigaplot
npm pack -w gigaplot           # writes gigaplot-<version>.tgz
npm install --save /path/to/gigaplot-<version>.tgz   # from your app
```

Once it is published, `npm install --save gigaplot` will do.

## Usage

```tsx
import { Plot, StaticDataSource, seriesDataFromArrays } from "gigaplot";

const source = new StaticDataSource([
  {
    id: "sine",
    name: "Sine",
    type: "line",
    data: seriesDataFromArrays([0, 1, 2, 3], [0, 1, 0, -1]),
  },
]);

function MyPlot() {
  return <Plot source={source} rendererPreference={["webgpu", "canvas"]} />;
}
```

The renderer preference is a fallback chain. The first renderer that is both
registered and supported on the current platform, and that can draw every series
type in the plot, is used. Omit `rendererPreference` to use the registration
order of the registry, which defaults to WebGPU then Canvas.

### 3D plots

`Plot3D` draws `scatter3d` and `line3d` series, whose data carries a `z`
column, in a box the camera orbits. Drag to rotate, scroll to zoom, and double
click to reset. It reads the same `PlotDataSource` as `Plot`, but 3D series are
never downsampled.

```tsx
import { Plot3D, StaticDataSource, seriesData3DFromArrays } from "gigaplot";

const source = new StaticDataSource([
  {
    id: "spiral",
    name: "Spiral",
    type: "line3d",
    data: seriesData3DFromArrays([1, 0, -1, 0], [0, 1, 0, -1], [0, 1, 2, 3]),
  },
]);

<Plot3D
  source={source}
  camera={{ azimuth: -60, elevation: 25 }}
  pointScaling="perspective"
  depthFade={0.5}
/>;
```

`pointScaling="perspective"` draws nearer points bigger, `depthFade` fades
farther data, and `showAxes={false}` hides the box, which together make a star
field. `Plot3DView` is the framework free equivalent of `PlotView`.

### Scales

Give an axis a scale to make it logarithmic, exponential, or a power, or to
remove ranges from it, such as the nights, weekends, and holidays between
market sessions, so a line of prices runs straight from each close into the
next open:

```tsx
import {
  Plot,
  createBusinessCalendarScale,
  createLogScale,
  linearScale,
} from "gigaplot";

const nyse = createBusinessCalendarScale({
  timeZone: "America/New_York",
  sessions: [["09:30", "16:00"]],
  holidays: ["2026-01-19"],
});

<Plot source={source} xScale={nyse} yScale={createLogScale(10)} />;
```

A source can give its axes scales in its shape, and a plot replaces them with
the `xScale` and `yScale` props, such as `linearScale` to show clock time. See
[docs/scales.md](docs/scales.md).

### Theming

Plots match the `@deephaven/components` theme by default, reading the same
`--dh-color-chart-*` CSS variables as other Deephaven charts and following theme
switches. Pass a partial `theme` to override any color, font, or size:

```tsx
<Plot source={source} theme={{ fontSize: 9, margin: { left: 30 } }} />
```

See [docs/theming.md](docs/theming.md).

### Without React

`Plot` is a thin wrapper over `PlotView`, which has no framework dependency:

```ts
import { PlotView } from "gigaplot";

const view = new PlotView(containerElement, source);
await view.initialize();
// ...
view.destroy();
```

### Custom data sources

Implement `PlotDataSource` to plot anything. Only the shape is required up
front; point data is pulled per viewport so a source can push filtering and
downsampling to wherever the data lives.

```ts
import { AbstractPlotDataSource } from "gigaplot";

class MyDataSource extends AbstractPlotDataSource {
  async getShape() {
    return { series: [{ id: "a", name: "A", type: "line" as const }] };
  }

  async requestSeriesData({ viewport, pixelSize }) {
    const data = await fetchPoints(viewport, pixelSize.width);
    return { data, complete: false };
  }
}
```

See [docs/data-sources.md](docs/data-sources.md) for the full contract,
including how to emit incremental updates.

## Documentation

- [Architecture](docs/architecture.md) — how the model, view, and renderers fit
  together
- [Data sources](docs/data-sources.md) — implementing a source and emitting
  deltas
- [Downsampling](docs/downsampling.md) — the request contract and the bundled
  downsamplers
- [Scales](docs/scales.md) — log, exponential, and power axes, and axes with
  ranges removed, such as a market's nights and weekends
- [Theming](docs/theming.md) — matching the Deephaven theme by default, and
  overriding any part of it

## Demo app

`gigaplot-demo` is a standalone app for iterating on plots without a
Deephaven server:

```bash
npm start
```
