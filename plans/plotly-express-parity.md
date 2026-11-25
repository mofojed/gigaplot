# Plotly Express parity for deephaven-plugin-gigaplot

Features of Deephaven Plotly Express (`dx`, `deephaven.plot.express`) that the
gigaplot plugin does not have yet, for the plot types both support. Use it to
pick and plan work, and update it as features ship.

Compared against the [dx docs](https://deephaven.io/core/plotly/docs/) and the
plot signatures in `plugins/plotly-express/src/deephaven/plot/express/plots`
in [deephaven-plugins](https://github.com/deephaven/deephaven-plugins), as of
November 2026.

| gigaplot plugin | dx               |
| --------------- | ---------------- |
| `line`          | `dx.line`        |
| `scatter`       | `dx.scatter`     |
| `area`          | `dx.area`        |
| `ohlc`          | `dx.ohlc`        |
| `candlestick`   | `dx.candlestick` |
| `scatter3d`     | `dx.scatter_3d`  |
| `line3d`        | `dx.line_3d`     |

Other dx plot types (bar, histogram, box, pie, maps, and so on) are out of
scope here.

**Status** is **Missing** when there is no equivalent, and **Partial** when
something close exists.

**Work in** says where a change is needed:

- **Python**: only `deephaven_plugin_gigaplot` (`gigaplot.py`, `downsample.py`).
- **Plugin**: the Python and `src/js` (`GigaplotView`, `TableDataSource`), but
  the library already supports it, for example through `SeriesStyle` or
  `PlotView`.
- **Library**: `packages/gigaplot` needs new support first, then the plugin
  exposes it.

## 1. Missing for every plot type

| dx feature                                                                                                                                                                                                      | Status                                                                                                                   | Work in |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| `by`, `by_vars`: split a long table into series by a column, which also picks each group's color, symbol, size, dash, width, and pattern                                                                        | Missing. Each series must be its own `y` column in a wide table.                                                         | Python  |
| `filter_by`, `required_filter_by`, and `PartitionedTable` input                                                                                                                                                 | Missing. Only a plain `Table` is accepted.                                                                               | Python  |
| `labels`: rename columns in axis titles, the legend, and hover                                                                                                                                                  | Partial. `x_title` and `y_title` exist, but the legend always shows column names.                                        | Plugin  |
| `hover_name`, `text`: more columns in hover, and labels on points                                                                                                                                               | Missing. The tooltip shows only plotted values.                                                                          | Library |
| `template`                                                                                                                                                                                                      | Missing. The theme comes only from Deephaven's CSS variables.                                                            | Plugin  |
| `range_x`, `range_y`: fixed axis ranges                                                                                                                                                                         | Missing for 2D. 3D has `x_range`, `y_range`, and `z_range`. `PlotView.setViewport` exists.                               | Plugin  |
| `xaxis_sequence`, `yaxis_sequence`, and lists of `xaxis_titles` and `yaxis_titles`: more than one axis                                                                                                          | Missing. There is one x axis and one y axis.                                                                             | Library |
| `log_x`, `log_y`                                                                                                                                                                                                | Done, as `x_scale` and `y_scale`, which also have calendar, breaks, exp, and pow scales.                                 | —       |
| `calendar`                                                                                                                                                                                                      | Done, as `x_scale=calendar_scale(...)`.                                                                                  | —       |
| `color_discrete_sequence`, `color_discrete_map`                                                                                                                                                                 | Missing for 2D. `SeriesStyle.color` exists, and 3D exposes `color`.                                                      | Plugin  |
| Events: `on_click`, `on_press`, `on_double_click`, `on_double_press`, `on_selected`, `on_deselect`, `on_relayout`, `on_legend_click`, `on_legend_double_click`, `on_click_annotation`, `on_web_gl_context_lost` | Missing. The library has `onHover` and `onViewportChanged`, but nothing reaches Python except the downsampling viewport. | Library |
| Clicking a legend entry to hide or isolate a series                                                                                                                                                             | Missing. The legend is display only.                                                                                     | Library |
| Box or lasso selection, box zoom, and a modebar with download and autoscale                                                                                                                                     | Missing. There is wheel zoom, drag pan, and double click to reset.                                                       | Library |
| `dx.layer`: overlay figures, such as a line with scatter markers                                                                                                                                                | Missing. The plugin draws one series type per plot, though the library already mixes types in one plot.                  | Plugin  |
| `dx.make_subplots`: grids with shared axes and subplot titles                                                                                                                                                   | Partial. Plots can be arranged with `deephaven.ui` layouts, but axes and zoom are not shared.                            | Library |
| Static image export                                                                                                                                                                                             | Missing.                                                                                                                 | Library |
| `unsafe_update_figure`                                                                                                                                                                                          | Missing. See [section 3](#3-features-dx-gets-through-unsafe_update_figure).                                              | —       |

`render_mode` does not apply, since gigaplot chooses WebGPU or Canvas itself.

## 2. Missing per plot type

### line

| dx feature                                                         | Work in |
| ------------------------------------------------------------------ | ------- |
| Error bars: `error_x`, `error_x_minus`, `error_y`, `error_y_minus` | Library |
| `markers`: points drawn on the line                                | Library |
| `symbol`, `symbol_sequence`, `symbol_map`                          | Library |
| `size`, `size_sequence`, `size_map`                                | Library |
| `line_dash`, `line_dash_sequence`, `line_dash_map`                 | Library |
| `width`, `width_sequence`, `width_map` (`SeriesStyle.lineWidth`)   | Plugin  |
| `line_shape`: `spline`, and steps `hv`, `vh`, `hvh`, `vhv`         | Library |

### scatter

| dx feature                                                                                                                                            | Work in |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Error bars on x and y                                                                                                                                 | Library |
| A fixed marker size (`SeriesStyle.pointSize`; 3D exposes `size`)                                                                                      | Plugin  |
| `size` from a column, for bubble plots, with `size_sequence` and `size_map`                                                                           | Library |
| `color` from a column, by category or on a continuous scale with `color_continuous_scale`, `range_color`, `color_continuous_midpoint`, and a colorbar | Library |
| `symbol`, `symbol_sequence`, `symbol_map`: marker shapes                                                                                              | Library |
| `opacity`                                                                                                                                             | Library |
| `marginal_x`, `marginal_y`: histogram, box, violin, or rug plots along the axes                                                                       | Library |

### area

Stacking, the default as in dx, and `groupnorm` are done. gigaplot also has
`stacked=False` and gradient `fill`s.

| dx feature                                                     | Work in |
| -------------------------------------------------------------- | ------- |
| `pattern_shape`, `pattern_shape_sequence`, `pattern_shape_map` | Library |
| `markers`, `symbol`, `size`, and their sequences and maps      | Library |
| `line_shape`                                                   | Library |
| A line color per series. Only the fill color can be set.       | Plugin  |

### ohlc and candlestick

| dx feature                                                                                                                                                              | Work in |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `increasing_color_sequence`, `decreasing_color_sequence`. Colors come only from the theme's `ohlcIncreasingColor` and `ohlcDecreasingColor`, one pair for every series. | Library |
| More than one axis, and lists of axis titles, as in section 1                                                                                                           | Library |

dx bars take no `by`, so that gap does not apply here.

### scatter3d

`color` and `size` per series and `x_range`, `y_range`, and `z_range` are done.
gigaplot also has `camera`, `point_scaling`, `depth_fade`, and `show_axes`.

| dx feature                                                         | Work in |
| ------------------------------------------------------------------ | ------- |
| `by`, `by_vars`, `filter_by`, `required_filter_by`                 | Python  |
| Error bars on x, y, and z, including `error_z` and `error_z_minus` | Library |
| `color` and `size` from a column, with a color scale               | Library |
| `symbol`, `symbol_sequence`, `symbol_map`, and `opacity`           | Library |
| `log_x`, `log_y`, `log_z`. 3D has no scales.                       | Library |
| `text`, `hover_name`, `labels`                                     | Library |
| Events                                                             | Library |

### line3d

`color` and `width` per series, the ranges, `camera`, and `depth_fade` are
done. Everything missing from scatter3d is missing here too, along with:

| dx feature                                         | Work in |
| -------------------------------------------------- | ------- |
| `markers`                                          | Library |
| `line_dash`, `line_dash_sequence`, `line_dash_map` | Library |
| `width_sequence`, `width_map`                      | Plugin  |
| `size`, `size_sequence`, `size_map`                | Library |

## 3. Features dx gets through `unsafe_update_figure`

dx has no parameters for these. Its docs reach them through
`unsafe_update_figure`, which edits the Plotly figure directly (see the dx
pages on `unsafe_update_figure`, titles and legends, and events). gigaplot has
no such escape hatch, and will not have Plotly's, so each needs its own API.

| What dx does with it                                                                                                                                 | Status                                                                           | Work in |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| Change any figure, trace, or layout setting: tick formats, gridlines, fonts, margins, hover templates                                                | Missing. The theme covers some of these, for every plot at once.                 | Library |
| Place the legend anywhere, with `legend=dict(x, y, xanchor, yanchor)`                                                                                | Partial. `legend_position` is `"overlay"` or `"right"`.                          | Library |
| A horizontal legend below the plot: `orientation="h"` and a negative `y`                                                                             | Missing. The overlay legend is horizontal, but across the top.                   | Library |
| Hide the legend: `showlegend=False`                                                                                                                  | Missing.                                                                         | Library |
| Reference lines and shapes: `add_vline`, `add_hline`, `add_shape`                                                                                    | Missing.                                                                         | Library |
| Fill between two lines: `fill="tonexty"`, for bands                                                                                                  | Partial. Areas stack or fill to zero, but cannot fill between two chosen series. | Library |
| Annotations: `add_annotation`, clickable with `captureevents=True` and `on_click_annotation`                                                         | Missing.                                                                         | Library |
| Clicks anywhere: `clickanywhere=True`, so `on_click` reports the data coordinates of empty space                                                     | Missing, along with every other event.                                           | Library |
| Marker outlines: `update_traces(marker_line_width=..., marker_line_color=...)`. The dx example is a bar plot, but it applies to scatter markers too. | Missing.                                                                         | Library |

## 4. What gigaplot has that dx does not

These should be kept while closing the gaps above:

- Server side downsampling for every 2D type, with custom `Downsampler`s.
- Scales beyond log: `calendar_scale`, `breaks_scale`, `exp_scale`, and
  `pow_scale`.
- A choice of tooltip parts, such as guides and axis labels.
- Gradient area fills, and areas that are not stacked.
- A 3D camera, perspective point scaling, and depth fade.

## Suggested order

1. **Expose what the library already has.** 2D colors, line widths, and point
   sizes per series; legend names from `labels`; fixed `range_x` and
   `range_y`; and mixed series types in one plot, as a `layer`.
2. **`by` and `filter_by`.** Most dx examples plot long tables split by a
   column, so this is the biggest change for people moving from dx. It is
   Python only, but has to stay compatible with downsampling: each group is
   downsampled as its own series.
3. **Events and an interactive legend.** `on_click`, `on_relayout`, and legend
   clicks to hide series, which also unlocks linking plots to other
   `deephaven.ui` components.
4. **Line and marker styling.** `markers`, `line_dash`, `line_shape`,
   `opacity`, symbols, and OHLC colors per series.
5. **Encodings from columns.** Color and size from a column, with continuous
   color scales and a colorbar.
6. **Replacements for `unsafe_update_figure`.** Reference lines,
   annotations, fill between series, and legend placement and hiding.
7. **The rest.** Error bars, more than one axis, subplots with shared axes,
   marginals, image export, and log axes in 3D.
