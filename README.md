# gigaplot

A GPU accelerated plotting library, and a [Deephaven](https://deephaven.io)
plugin that uses it to plot live, ticking tables with tens of millions of
rows.

gigaplot draws with WebGPU, and falls back to Canvas 2D where WebGPU is not
available. Sources and renderers can be swapped, and the library does not depend
on Deephaven. It supports scatter, line, area, OHLC, and candlestick plots in
2D, and scatter and line plots in 3D. 2D axes can use log, exponential, power,
or business calendar scales.

This repository is an npm workspace containing:

- [packages/gigaplot](packages/gigaplot): the `gigaplot` plotting library
- [packages/gigaplot-demo](packages/gigaplot-demo): a standalone demo app,
  no Deephaven server required
- [packages/plot-benchmark](packages/plot-benchmark): raw rendering
  performance of gigaplot against Plotly, uPlot, Lightweight Charts, ECharts,
  Chart.js, and deck.gl
- [deephaven-plugin-gigaplot](deephaven-plugin-gigaplot): a `deephaven.ui`
  element plugin that plots tables with gigaplot, downsampling them on the
  server
- [plans](plans): plans for upcoming work

## Prerequisites

- Node.js 24 and npm. With [nvm](https://github.com/nvm-sh/nvm), run
  `nvm install 24`.
- A browser with WebGPU, such as a recent Chrome or Edge, for the GPU
  renderer. Other browsers use the Canvas 2D renderer.
- For the Deephaven plugin only: Python 3.12 and Java 17 or later.

## Getting started

```bash
git clone https://github.com/mofojed/gigaplot.git
cd gigaplot
npm install
npx playwright install chromium   # once, for the e2e tests

npm start          # runs the demo at http://localhost:9020/gigaplot/
npm run benchmark  # runs the benchmark at http://localhost:9030/
npm test           # unit tests
npm run e2e        # Playwright tests against the demo and benchmark
npm run build      # builds every package
```

Run npm commands from the repository root, not from a package.

See the [plugin README](deephaven-plugin-gigaplot/README.md) to build the
Deephaven plugin, install it, and run it in a server.

## Documentation

- [Library README](packages/gigaplot/README.md): usage, data sources,
  scales, and theming
- [Architecture](packages/gigaplot/docs/architecture.md),
  [data sources](packages/gigaplot/docs/data-sources.md),
  [downsampling](packages/gigaplot/docs/downsampling.md),
  [scales](packages/gigaplot/docs/scales.md), and
  [theming](packages/gigaplot/docs/theming.md)
- [Plugin README](deephaven-plugin-gigaplot/README.md): Python API, examples,
  and the downsampling protocol
- [Plotly Express parity plan](plans/plotly-express-parity.md): features of
  `deephaven.plot.express` that the plugin does not have yet

## Contributing

[AGENTS.md](AGENTS.md) describes the layout, validation, formatting, and
conventions, and applies to people as much as to coding agents. Agent skills
for the library and the plugin are in [.github/skills](.github/skills).

## License

[Apache License 2.0](LICENSE)
