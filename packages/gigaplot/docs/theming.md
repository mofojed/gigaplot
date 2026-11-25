# Theming

Everything a plot draws comes from a `PlotTheme`: colors, fonts, line widths,
tick and legend metrics, and the margins around the data area. Nothing visual is
hard coded in the renderers or the axis painter.

## Defaults match Deephaven

With no configuration, a plot matches the charts from `@deephaven/components`.

1. `defaultPlotTheme` is the `@deephaven/components` dark theme with its CSS
   variables resolved, so a plot looks right even on a page without Deephaven
   styles.
2. If the Deephaven chart CSS variables are in scope for the plot container,
   they take precedence. These are the same variables `@deephaven/chart` reads,
   so the light theme and custom themes apply too.
3. The `theme` prop (or `PlotView` option) is applied last, as overrides.

| Theme property           | CSS variable                      |
| ------------------------ | --------------------------------- |
| `backgroundColor`        | `--dh-color-chart-bg`             |
| `plotBackgroundColor`    | `--dh-color-chart-plot-bg`        |
| `gridColor`              | `--dh-color-chart-grid`           |
| `axisColor`              | `--dh-color-chart-axis-line`      |
| `tickLabelColor`         | `--dh-color-chart-axis-line-zero` |
| `legendTextColor`        | `--dh-color-chart-legend-fg`      |
| `axisTitleColor`         | `--dh-color-chart-title`          |
| `colorway`               | `--dh-color-chart-colorway`       |
| `ohlcIncreasingColor`    | `--dh-color-chart-ohlc-increase`  |
| `ohlcDecreasingColor`    | `--dh-color-chart-ohlc-decrease`  |
| `tooltipBackgroundColor` | `--dh-color-tooltip-bg`           |
| `tooltipTextColor`       | `--dh-color-tooltip-fg`           |
| `tooltipBorderColor`     | `--dh-color-chart-axis-line`      |

Deephaven has no chart specific tooltip colors, so tooltips use the same ones
as every other Deephaven tooltip.

`--dh-color-chart-colorway` is a whitespace separated list of colors, as in
`@deephaven/components`. Any CSS color works, including `color-mix()`.

## Following theme switches

A plot re-reads its CSS theme whenever the page's styles change: a `<style>` or
stylesheet `<link>` is added, removed, or edited anywhere in the document, or a
`class`, `style`, `data-theme`, or `data-color-scheme` attribute changes on
`<html>` or `<body>`. That covers the `ThemeProvider` from
`@deephaven/components`, which swaps `<style>` elements when the theme changes.
All plots share one set of observers, and a plot whose resolved theme did not
change does nothing.

Changes the observers cannot see, such as a class toggled on some ancestor of
the plot, need a call to `PlotView.refreshTheme()`. Pass
`followCssTheme={false}` to stop following the page entirely.

## Overriding

`theme` takes a `PlotThemeOverrides`: any subset of `PlotTheme`, where `margin`
may also be partial.

```tsx
const COMPACT: PlotThemeOverrides = {
  fontSize: 9,
  margin: { left: 26, bottom: 14 },
};

<Plot source={source} theme={COMPACT} />;
```

Keep the object identity stable between renders. Each new object makes the plot
read the CSS variables again.

Leave colors out of overrides to keep following the page theme, and set them to
pin a color regardless of theme. A color set on a series through
`SeriesStyle.color` always beats the colorway.

Without React:

```ts
const view = new PlotView(container, source, { theme: COMPACT });
view.setTheme({ ...COMPACT, gridColor: "transparent" });
view.addEventListener("themechanged", ({ theme }) => console.log(theme));
```

## Theme properties

| Property              | Default                    | Used for                                       |
| --------------------- | -------------------------- | ---------------------------------------------- |
| `backgroundColor`     | `#2d2a2e`                  | The whole plot, including the margins          |
| `plotBackgroundColor` | `#322f33`                  | The data area                                  |
| `gridColor`           | `#403e41`                  | Gridlines                                      |
| `gridLineWidth`       | `1`                        | Gridlines                                      |
| `axisColor`           | `#5b5a5c`                  | Border around the data area                    |
| `axisLineWidth`       | `1`                        | Border around the data area                    |
| `tickLabelColor`      | `#c0bfbf`                  | Tick labels                                    |
| `tickLabelPadding`    | `6`                        | Gap between the data area and its tick labels  |
| `legendTextColor`     | `#f0f0ee`                  | Legend labels                                  |
| `legendSwatchSize`    | `8`                        | Legend color squares                           |
| `legendItemGap`       | `16`                       | Space between legend entries                   |
| `axisTitleColor`      | `#f0f0ee`                  | Axis titles                                    |
| `axisTitleFontSize`   | `12`                       | Axis titles                                    |
| `axisTitlePadding`    | `4`                        | Space on each side of an axis title            |
| `fontFamily`          | Fira Sans, then system UI  | Tick labels, legend, and axis titles           |
| `fontSize`            | `11`                       | Tick labels and legend                         |
| `colorway`            | Deephaven visual colors    | Series without an explicit color, by index     |
| `lineWidth`           | `1.5`                      | `line` and `area` series without an explicit `lineWidth` |
| `pointSize`           | `5`                        | `scatter` series without an explicit `pointSize` |
| `areaFillOpacity`     | `0.5`                      | `area` series without an explicit `fill`, which use their line color |
| `tooltipBackgroundColor` | `#403e41`               | Tooltip box and hovered x axis label           |
| `tooltipTextColor`    | `#f0f0ee`                  | Tooltip box and hovered x axis label text      |
| `tooltipBorderColor`  | `#5b5a5c`                  | Tooltip box and hovered x axis label border    |
| `tooltipPadding`      | `6`                        | Space inside the tooltip box and hover labels  |
| `tooltipOffset`       | `12`                       | Gap between the cursor and the tooltip box     |
| `hoverMarkerSize`     | `8`                        | Markers on hovered points                      |
| `hoverGuideWidth`     | `1`                        | Guide lines from hovered points to the axes    |
| `hoverGuideDash`      | `[3, 3]`                   | Dash pattern of the hover guide lines          |
| `hoverDistance`       | `6`                        | How far past a scatter point's edge, or a line's end, still hovers it |
| `margin`              | `16 / 16 / 32 / 56`        | Space around the data area (top/right/bottom/left) for tick labels |

Hovered y values labelled on the y axis are filled with their series' color,
with whichever of `backgroundColor` and `tooltipTextColor` contrasts more as
their text.

A plot whose shape has an `xAxisLabel` or `yAxisLabel` draws it as an axis
title. The y title adds its width to the left margin, and the bottom margin
grows if needed to fit the x title below the tick labels.

## Helpers

- `createPlotTheme(...overrides)` merges overrides onto `defaultPlotTheme`.
- `createPlotThemeFromElement(element, overrides?)` resolves a theme the same
  way a plot does.
- `readPlotThemeFromElement(element)` returns only what the CSS variables set.
- `observeThemeChanges(listener)` is the shared observer plots use; it returns
  an unsubscribe function.
