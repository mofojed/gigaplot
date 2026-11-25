# gigaplot agent guide

gigaplot is a GPU accelerated plotting library (WebGPU, with a Canvas 2D
fallback) and a `deephaven.ui` element plugin that plots Deephaven tables with
it. Read [README.md](README.md) for the overview and
[packages/gigaplot/docs/architecture.md](packages/gigaplot/docs/architecture.md)
before changing anything in the library.

## Layout

The repository root is an npm workspace. Run every command from the root
unless noted.

| Path                                                      | What it is                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/gigaplot`                                       | The library: model, `PlotView`, renderers, sources, React `Plot` |
| `packages/gigaplot/docs`                                  | Architecture, data source, downsampling, and theming contracts   |
| `packages/gigaplot-demo`                                  | Standalone Vite demo, no Deephaven server needed                 |
| `packages/plot-benchmark`                                 | gigaplot against other plotting libraries, on port 9030          |
| `deephaven-plugin-gigaplot/src/deephaven_plugin_gigaplot` | Python `gigaplot` component and server side downsampling         |
| `deephaven-plugin-gigaplot/src/js`                        | JS element plugin: `GigaplotView`, `TableDataSource`             |
| `tests`                                                   | Playwright e2e tests against the demo and benchmark              |
| `plans`                                                   | Plans for upcoming work, such as plotly-express parity           |
| `.github/skills`                                          | Agent skills for the library and the plugin                      |

The plugin bundles gigaplot **from source** (Vite alias and Jest
`moduleNameMapper`), so library changes do not need a separate build to reach
the plugin or the unit tests.

## Setup

On a fresh clone:

```bash
nvm use 24                                    # Node 24, as in deephaven-plugin-gigaplot/src/js/.nvmrc
npm install                                   # from the root only, never from a package
npx playwright install chromium               # browser for the e2e tests
```

Working on the Deephaven plugin also needs Python 3.12 and Java 17 or later.
Its venv setup is in the `gigaplot-deephaven-plugin` skill and the
[plugin README](deephaven-plugin-gigaplot/README.md).

## Skills

Load the matching skill from `.github/skills`:

- `gigaplot-authoring`: renderers, WGSL, series types, data sources,
  downsamplers, `PlotView`, and the demo app.
- `gigaplot-deephaven-plugin`: the Python component, `TableDataSource`,
  building and installing the plugin, and reproducing issues in a running
  Deephaven server.

## Plans

`plans/` holds design notes and feature gap lists for upcoming work. Check it
before starting a feature, and update the matching plan in the same change
when an item ships or the approach changes.

## Validating changes

```bash
npx jest                                      # all unit tests (library and plugin)
npx jest packages/gigaplot/src/view           # a subset by path
(cd packages/gigaplot && npx tsc --noEmit -p .)
(cd deephaven-plugin-gigaplot/src/js && npx tsc --noEmit -p .)
(cd packages/gigaplot-demo && npx tsc --noEmit -p .)
(cd packages/plot-benchmark && npx tsc --noEmit -p .)
npx playwright test                           # e2e; starts the demo on :9020 and benchmark on :9030 if needed
```

- `npm run types` fails because there is no root `tsconfig.json`. Type-check
  each package as above.
- Playwright reuses any server already listening on 9020 or 9030, which may
  be a demo from another checkout. To test this checkout while one is
  running, start the demo with `PORT=<port> npm start` and point the tests at
  it with `PLOT_DEMO_URL=http://localhost:<port>/gigaplot/` (and
  `PLOT_BENCHMARK_URL` for the benchmark).
- Run the narrowest Jest path first, then the full `npx jest` before
  committing.
- For a bug fix, add a test that fails without the fix. Confirm it by
  stashing the source change and re-running the test.

## Formatting

There is no Prettier config, and the packages use different styles. Format
only the files you touched, in their existing style:

- `packages/gigaplot/**` and `tests/gigaplot-demo.utils.ts` use single quotes:
  `npx prettier --single-quote --trailing-comma es5 --arrow-parens avoid --write <files>`
- `deephaven-plugin-gigaplot/src/js/**`, `packages/gigaplot-demo/**`,
  `packages/plot-benchmark/**`, the Playwright specs, and config files use
  the defaults:
  `npx prettier --write <files>`
- `packages/gigaplot-demo/src/App.scss` uses single quotes, which the
  defaults would rewrite. Edit it by hand.
- The plugin's Python has no formatter config. See the
  `gigaplot-deephaven-plugin` skill for which files are `black` clean.

Never run Prettier over a whole directory. Some files are already out of
style, and reformatting them buries the real change.

## Conventions

- Comments explain _why_, not _what_. Match the tone of the surrounding code.
- Nothing visual is hard coded. Colors, widths, fonts, and margins come from
  `PlotTheme` (see `docs/theming.md`).
- Keep the layering. Only `PlotView` talks to both sources and renderers.
- Other plotting libraries are dependencies of `packages/plot-benchmark` only.
  Never add them to the library or the demo.
- Keep demo and test data seeded. The e2e tests compare renders.
- When a change alters behavior described in `README.md`, the plugin README,
  or `packages/gigaplot/docs`, update those docs in the same change.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<optional scope>): <subject>`, such as
  "fix(view): draw plots whose bounds arrive while the renderer initializes".
  Use `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or
  `chore` for the type, and a package or area such as `gigaplot`, `plugin`,
  `demo`, `benchmark`, or `view` for the scope. Write the subject in the
  imperative mood, lowercase, with no trailing period. Mark breaking changes
  with `!` after the type or scope and a `BREAKING CHANGE:` footer. Use the
  body to explain why.

## Async lifecycle pitfalls

Most "blank plot" bugs are races, not drawing bugs.

- `PlotView.initialize()` awaits `getShape()`, renderer resolution, and
  renderer initialization. WebGPU setup is slow the first time and fast
  afterwards. Source events fired during those awaits must not be lost, so
  listeners are attached before the first `await`. Keep it that way.
- A source starts with a placeholder shape and no bounds. Until bounds arrive,
  the view sits on a unit viewport, and any data it requests is for that
  viewport.
- "Works after reopening the panel" usually means a cold-start race. Reproduce
  it in a unit test with a mock renderer whose `initialize` resolves only when
  the test says so, then fire source events while it is pending.
