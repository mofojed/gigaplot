from __future__ import annotations

from typing import Any, Literal, Mapping, Sequence, TypedDict, Union

from deephaven import ui
from deephaven.table import Table

from .scales import Scale, ScaleLike, _parse_scale
from .downsample import (
    Downsampler,
    Viewport,
    _ohlc_columns,
    area_bounds,
    bounds,
    downsample as downsample_table,
    ohlc_bounds,
)

__all__ = [
    "Camera",
    "Fill",
    "GradientStop",
    "LegendPosition",
    "LinearGradient",
    "PointScaling",
    "TooltipPart",
    "area",
    "candlestick",
    "line",
    "line3d",
    "linear_gradient",
    "ohlc",
    "scatter",
    "scatter3d",
]

_VIEWPORT_KEYS = ("x_min", "x_max", "x_bin", "y_min", "y_max", "y_bin")
_ORIGIN_KEYS = ("x_origin", "y_origin")

SeriesType = Literal[
    "line", "scatter", "area", "ohlc", "candlestick", "scatter3d", "line3d"
]

TooltipPart = Literal["box", "markers", "guides", "x_axis_label", "y_axis_labels"]
"""A part of what is drawn while hovering a plot."""

LegendPosition = Literal["overlay", "right"]
"""Where the legend is drawn: over the top of the plot, or beside it."""

_LEGEND_POSITIONS = ("overlay", "right")

# Must match TOOLTIP_PARTS in tooltipOptions.ts
_TOOLTIP_PARTS = ("box", "markers", "guides", "x_axis_label", "y_axis_labels")

GroupNorm = Literal["fraction", "percent"]
"""How stacked areas are normalized: to a fraction of 1, or a percent of 100."""

_GROUPNORMS = ("fraction", "percent")

_GRADIENT_DIRECTIONS = ("vertical", "horizontal")

_GRADIENT_UNITS = ("plot", "data")

_GRADIENT_STOP_KEYS = ("offset", "color", "opacity")


class GradientStop(TypedDict, total=False):
    """A color at one position along a gradient. Every key is optional."""

    offset: float
    """
    Where the color sits, in the gradient's units. Stops without one are
    spaced evenly from 0 to 1, which only makes sense in plot units.
    """
    color: str
    """A CSS color. Defaults to the series color."""
    opacity: float
    """Multiplies the color's alpha, from 0 to 1. Defaults to 1."""


class LinearGradient(TypedDict):
    """A fill that blends between colors along one axis. Make one with :func:`linear_gradient`."""

    type: Literal["linear"]
    stops: list[GradientStop]
    direction: Literal["vertical", "horizontal"]
    units: Literal["plot", "data"]


Fill = Union[str, LinearGradient]
"""How an area is filled: a CSS color, or a gradient."""


def linear_gradient(
    stops: Sequence[str | GradientStop],
    direction: Literal["vertical", "horizontal"] = "vertical",
    units: Literal["plot", "data"] = "plot",
) -> LinearGradient:
    """
    A fill for an area plot that blends between colors along one axis. Beyond
    the first and last stops, the fill keeps their colors.

    Colors are blended without premultiplying alpha, so fade a color out with
    ``{"opacity": 0}`` rather than ``"transparent"``, which is transparent
    black and greys the color on the way.

    Examples:
        The series color fading out towards the bottom of the plot::

            linear_gradient([{"opacity": 0.8}, {"opacity": 0}])

        Green above zero and red below, with a hard edge at zero::

            linear_gradient(
                [{"offset": 0, "color": "red"}, {"offset": 0, "color": "green"}],
                units="data",
            )

    Args:
        stops: The colors, in order. Each is a CSS color, or a
            :class:`GradientStop` to set its offset or opacity, or to use the
            series color by leaving out ``color``.
        direction: "vertical" varies the color with y, and "horizontal" with x.
        units: What stop offsets measure. "plot" spans the plot area, from 0 at
            the top, or left, to 1 at the bottom, or right, so the gradient
            stays put while panning. "data" places stops at values on the
            axis, so the gradient moves with the data, and every stop needs an
            offset.

    Returns:
        The gradient, to pass as an area's ``fill``.
    """
    if direction not in _GRADIENT_DIRECTIONS:
        raise ValueError(
            f"direction must be one of {list(_GRADIENT_DIRECTIONS)}, got {direction!r}"
        )
    if units not in _GRADIENT_UNITS:
        raise ValueError(f"units must be one of {list(_GRADIENT_UNITS)}, got {units!r}")
    if isinstance(stops, (str, Mapping)):
        raise ValueError(f"stops must be a sequence of stops, got {stops!r}")
    parsed: list[GradientStop] = []
    for stop in stops:
        if isinstance(stop, str):
            parsed.append({"color": stop})
        elif isinstance(stop, Mapping):
            unknown = [key for key in stop if key not in _GRADIENT_STOP_KEYS]
            if unknown:
                raise ValueError(
                    f"Unknown gradient stop keys {unknown}; expected some of {list(_GRADIENT_STOP_KEYS)}"
                )
            parsed_stop: GradientStop = {}
            if stop.get("offset") is not None:
                parsed_stop["offset"] = float(stop["offset"])
            if stop.get("color") is not None:
                parsed_stop["color"] = str(stop["color"])
            if stop.get("opacity") is not None:
                parsed_stop["opacity"] = min(1.0, max(0.0, float(stop["opacity"])))
            parsed.append(parsed_stop)
        else:
            raise ValueError(
                f"A gradient stop must be a color or a GradientStop, got {stop!r}"
            )
    if not parsed:
        raise ValueError("A gradient needs at least one stop")
    if units == "data" and any("offset" not in stop for stop in parsed):
        raise ValueError("Every stop of a gradient in data units needs an offset")
    return {"type": "linear", "stops": parsed, "direction": direction, "units": units}


class Camera(TypedDict, total=False):
    """
    Where a 3D plot is viewed from. The camera orbits the center of the plot's
    box, which is scaled to a cube with z up. Every key is optional.
    """

    azimuth: float
    """
    Degrees around the z axis, counterclockwise from +x looking down. -90
    looks along +y, with x to the right. Defaults to -60.
    """
    elevation: float
    """Degrees above the x-y plane, from -90 to 90. Defaults to 25."""
    distance: float
    """
    Distance from the center of the box in half box widths, so below 1 is
    inside it. Defaults to the distance that fits the box in view.
    """
    fov: float
    """Vertical field of view in degrees. Defaults to 35."""


_CAMERA_KEYS = ("azimuth", "elevation", "distance", "fov")

PointScaling = Literal["fixed", "perspective"]
"""
How 3D points are sized: "fixed" draws each at its size, and "perspective"
scales them with distance, so nearer points look bigger.
"""

_POINT_SCALINGS = ("fixed", "perspective")


def _parse_fill(fill: Any) -> Fill | None:
    if fill is None or isinstance(fill, str):
        return fill
    if isinstance(fill, Mapping) and fill.get("type") == "linear":
        # Validated again, since a gradient can be written by hand
        return linear_gradient(
            fill.get("stops", []),
            fill.get("direction", "vertical"),
            fill.get("units", "plot"),
        )
    raise ValueError(f"fill must be a color or a linear_gradient, got {fill!r}")


def _parse_fills(
    fill: Fill | Sequence[Fill | None] | None, count: int
) -> tuple[Fill | None, ...] | None:
    """One fill for every series, or a fill per series, or None for the defaults."""
    if fill is None:
        return None
    if isinstance(fill, (str, Mapping)):
        return (_parse_fill(fill),) * count
    if not isinstance(fill, Sequence):
        raise ValueError(
            f"fill must be a color, a linear_gradient, or a sequence of them, got {fill!r}"
        )
    fills = tuple(_parse_fill(each) for each in fill)
    if len(fills) != count:
        raise ValueError(
            f"fill has {len(fills)} entries for {count} y columns; pass one fill, or one per column"
        )
    return fills


def _stack_areas(table: Table, y: Sequence[str], groupnorm: GroupNorm | None) -> Table:
    """
    Replaces each y column with the running total of the columns up to it,
    so each area can be drawn on the one before it. Done on the server, before
    downsampling, so a bin keeps the same rows of every total and neighbouring
    areas meet exactly. Missing values count as zero, as in plotly.
    """
    values = [
        f"(isNull({column}) || Double.isNaN((double) {column}) ? 0.0 : (double) {column})"
        for column in y
    ]
    totals = [" + ".join(values[: i + 1]) for i in range(len(y))]
    if groupnorm is not None:
        scale = "100.0" if groupnorm == "percent" else "1.0"
        totals = [f"({total}) * {scale} / ({totals[-1]})" for total in totals]
    temporary = [f"__GigaplotStack{i}" for i in range(len(y))]
    return (
        table.update_view(
            [f"{name} = {total}" for name, total in zip(temporary, totals)]
        )
        .update_view([f"{column} = {name}" for column, name in zip(y, temporary)])
        .drop_columns(temporary)
    )


def _parse_tooltip(tooltip: bool | Sequence[TooltipPart]) -> bool | list[str]:
    """Rejects unknown parts here, where the mistake was made, rather than in the browser."""
    if isinstance(tooltip, bool):
        return tooltip
    if isinstance(tooltip, str):
        raise ValueError(
            f"tooltip must be a bool or a sequence of parts, got {tooltip!r}"
        )
    parts = list(tooltip)
    unknown = [part for part in parts if part not in _TOOLTIP_PARTS]
    if unknown:
        raise ValueError(
            f"Unknown tooltip parts {unknown}; expected some of {list(_TOOLTIP_PARTS)}"
        )
    return parts


def _parse_scales(x_scale: ScaleLike, y_scale: ScaleLike) -> dict[str, Scale]:
    """The scales that are not linear, by viewport key. Calendars only fit x."""
    scales: dict[str, Scale] = {}
    parsed_x = _parse_scale(x_scale, "x")
    if parsed_x is not None:
        scales["x_scale"] = parsed_x
    parsed_y = _parse_scale(y_scale, "y")
    if parsed_y is not None:
        if parsed_y.supports_instants:
            raise ValueError("Calendar and break scales only fit the x axis")
        scales["y_scale"] = parsed_y
    return scales


def _parse_origin(key: str, value: Any) -> int:
    """Origins are epoch nanoseconds, kept as exact ints since a float would round them."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"Viewport {key} must be an integer, got {value!r}")
    if isinstance(value, float) and not value.is_integer():
        raise ValueError(f"Viewport {key} must be an integer, got {value!r}")
    return int(value)


def _parse_viewport(params: dict[str, Any]) -> Viewport:
    """Keeps only known keys from the client, as numbers, so nothing else reaches a formula."""
    viewport: dict[str, float | int] = {}
    for key in _VIEWPORT_KEYS:
        value = params.get(key)
        if value is not None:
            viewport[key] = float(value)
    for key in _ORIGIN_KEYS:
        value = params.get(key)
        if value is not None:
            viewport[key] = _parse_origin(key, value)
    if "x_bin" not in viewport:
        raise ValueError("Viewport is missing x_bin")
    return viewport  # type: ignore[return-value]


def _as_list(columns: str | Sequence[str]) -> list[str]:
    return [columns] if isinstance(columns, str) else list(columns)


_OHLC_ROLES = ("Open", "High", "Low", "Close")


def _unique_ohlc(
    table: Table, x: str, ohlc: tuple[tuple[str, ...], ...]
) -> tuple[Table, tuple[tuple[str, ...], ...]]:
    """
    Gives every role of every bar series a column of its own. Plotting raw
    prices as candles uses one column for all four roles, but a downsampled
    table needs four columns to hold a bin's open, high, low, and close.
    Repeats are aliased with formula columns, so nothing is copied. Closes go
    first so they keep their names, which name the series.
    """
    roles = [list(columns) for columns in ohlc]
    seen = {x}
    aliases = []
    for role in (3, 0, 1, 2):
        for i, column in enumerate(roles[role]):
            if column in seen:
                alias = f"__Gigaplot{_OHLC_ROLES[role]}{i}"
                aliases.append(f"{alias} = {column}")
                roles[role][i] = alias
            else:
                seen.add(column)
    unique = tuple(tuple(columns) for columns in roles)
    return (table.update_view(aliases) if aliases else table), unique


@ui.component
def _plot(
    table: Table,
    x: str,
    type: SeriesType,
    y: tuple[str, ...] | None,
    ohlc: tuple[tuple[str, ...], ...] | None,
    title: str | None,
    x_title: str | None,
    y_title: str | None,
    downsample: bool | Downsampler,
    tooltip: bool | Sequence[TooltipPart],
    legend_position: LegendPosition,
    stacked: bool = False,
    groupnorm: GroupNorm | None = None,
    fill: tuple[Fill | None, ...] | None = None,
    x_scale: ScaleLike = None,
    y_scale: ScaleLike = None,
) -> ui.BaseElement:
    """
    The element every plot renders. Exactly one of ``y``, for line, scatter,
    and area plots, and ``ohlc``, the open, high, low, and close columns of
    OHLC and candlestick plots, is set. ``stacked``, ``groupnorm``, and
    ``fill`` are only used by area plots.
    """
    tooltip_parts = _parse_tooltip(tooltip)
    scales = _parse_scales(x_scale, y_scale)
    if legend_position not in _LEGEND_POSITIONS:
        raise ValueError(
            f"legend_position must be one of {list(_LEGEND_POSITIONS)}, got {legend_position!r}"
        )
    # Called on every render, like every hook, even though only bars need it
    table, ohlc = ui.use_memo(
        lambda: (table, ohlc) if ohlc is None else _unique_ohlc(table, x, ohlc),
        [table, x, ohlc],
    )
    table = ui.use_memo(
        lambda: _stack_areas(table, y, groupnorm) if stacked and y else table,
        [table, y, stacked, groupnorm],
    )
    # What a downsampler is given: the y columns, or each bar's four columns in turn
    value_columns = (
        list(y)
        if ohlc is None
        else [column for series in zip(*ohlc) for column in series]
    )
    columns_key = (y, ohlc)
    downsampler: Downsampler | None = None
    if callable(downsample):
        downsampler = downsample
    elif downsample:
        downsampler = lambda t, x_col, cols, viewport: downsample_table(
            t, x_col, cols, viewport, type
        )
    is_downsampled = downsampler is not None

    viewport, set_viewport = ui.use_state(None)

    # The client asks for a viewport once it knows the bounds and its size
    def make_bounds() -> Table | None:
        if not is_downsampled:
            return None
        if type == "area":
            return area_bounds(table, x, value_columns)
        if ohlc is None:
            return bounds(table, x, value_columns)
        _opens, highs, lows, _closes = ohlc
        return ohlc_bounds(table, x, lows, highs)

    plot_bounds = ui.use_memo(make_bounds, [table, x, columns_key, is_downsampled])

    plot_table = ui.use_memo(
        lambda: (
            table
            if downsampler is None
            else (
                None
                if viewport is None
                else downsampler(table, x, value_columns, {**viewport, **scales})
            )
        ),
        # The default downsampler is recreated each render, so depend on what it uses
        [table, x, columns_key, type, downsample, viewport, x_scale, y_scale],
    )

    on_viewport_change = ui.use_callback(
        lambda params: set_viewport(_parse_viewport(params)), [set_viewport]
    )

    opens, highs, lows, closes = ohlc if ohlc is not None else (None,) * 4
    # The name must match the key in the mapping in GigaplotPlugin.ts
    return ui.BaseElement(
        "deephaven_plugin_gigaplot.gigaplot",
        table=plot_table,
        # Lets the client tell when the table matches the viewport it last asked for
        viewport=viewport if is_downsampled else None,
        bounds=plot_bounds,
        on_viewport_change=on_viewport_change if is_downsampled else None,
        x=x,
        y=list(y) if y is not None else None,
        open=list(opens) if opens is not None else None,
        high=list(highs) if highs is not None else None,
        low=list(lows) if lows is not None else None,
        close=list(closes) if closes is not None else None,
        type=type,
        stacked=stacked,
        fill=list(fill) if fill is not None else None,
        title=title,
        # The client defaults these to the column names when they are None
        x_title=x_title,
        y_title=y_title,
        tooltip=tooltip_parts,
        legend_position=legend_position,
        x_scale=scales["x_scale"].spec() if "x_scale" in scales else None,
        y_scale=scales["y_scale"].spec() if "y_scale" in scales else None,
    )


def line(
    table: Table,
    x: str,
    y: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    downsample: bool | Downsampler = True,
    tooltip: bool | Sequence[TooltipPart] = True,
    legend_position: LegendPosition = "overlay",
    x_scale: ScaleLike = None,
    y_scale: ScaleLike = None,
) -> ui.BaseElement:
    """
    Plot columns of a table as lines. The table should be sorted by x. Hovering
    snaps to the x under the cursor, showing every line's value there.

    Args:
        table: The table to plot. Ticking tables update the plot live.
        x: The column to use for x values.
        y: The column, or columns, to plot against x. Each one is a line.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. Defaults to the y column name when
            there is one; several y columns have no default, since the legend
            names them. Pass an empty string to hide it.
        downsample: Reduce the table on the server to what the plot can show
            at its current size, zoom, and pan, and replace the reduced table as
            those change. Pass a Downsampler to use your own algorithm, or False
            to send the whole table to the client.
        tooltip: What to draw while hovering the plot. True draws a tooltip box
            and markers on the hovered points, and False draws nothing. To
            choose, pass the parts to draw: "box" for the tooltip box,
            "markers", "guides" for dashed lines from the points to the axes,
            "x_axis_label" to label the hovered x on the x axis, and
            "y_axis_labels" to label each hovered value on the y axis in its
            series' color.
        legend_position: Where to draw the legend. "overlay" lists the series
            across the top of the plot, over the data; "right" lists them in a
            column beside the plot, which narrows to make room.
        x_scale: How x values map to positions along the axis: a scale from
            :func:`calendar_scale` to remove the nights, weekends, and holidays
            between business sessions, or :func:`breaks_scale`,
            :func:`log_scale`, :func:`exp_scale`, or :func:`pow_scale`, or
            "log". Defaults to linear. The table is downsampled into bins even
            along the scale.
        y_scale: How y values map to positions: :func:`log_scale`,
            :func:`exp_scale`, :func:`pow_scale`, or "log". Defaults to linear.

    Returns:
        The plot element.
    """
    return _plot(
        table,
        x,
        "line",
        tuple(_as_list(y)),
        None,
        title,
        x_title,
        y_title,
        downsample,
        tooltip,
        legend_position,
        x_scale=x_scale,
        y_scale=y_scale,
    )


def scatter(
    table: Table,
    x: str,
    y: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    downsample: bool | Downsampler = True,
    tooltip: bool | Sequence[TooltipPart] = True,
    legend_position: LegendPosition = "overlay",
    x_scale: ScaleLike = None,
    y_scale: ScaleLike = None,
) -> ui.BaseElement:
    """
    Plot columns of a table as points. Hovering needs the cursor over a point.

    Args:
        table: The table to plot. Ticking tables update the plot live.
        x: The column to use for x values.
        y: The column, or columns, to plot against x. Each one is a series.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. Defaults to the y column name when
            there is one; several y columns have no default, since the legend
            names them. Pass an empty string to hide it.
        downsample: Reduce the table on the server to what the plot can show
            at its current size, zoom, and pan, and replace the reduced table as
            those change. Pass a Downsampler to use your own algorithm, or False
            to send the whole table to the client.
        tooltip: What to draw while hovering the plot. True draws a tooltip box
            and markers on the hovered points, and False draws nothing. To
            choose, pass the parts to draw: "box" for the tooltip box,
            "markers", "guides" for dashed lines from the points to the axes,
            "x_axis_label" to label the hovered x on the x axis, and
            "y_axis_labels" to label each hovered value on the y axis in its
            series' color.
        legend_position: Where to draw the legend. "overlay" lists the series
            across the top of the plot, over the data; "right" lists them in a
            column beside the plot, which narrows to make room.
        x_scale: How x values map to positions along the axis: a scale from
            :func:`calendar_scale` to remove the nights, weekends, and holidays
            between business sessions, or :func:`breaks_scale`,
            :func:`log_scale`, :func:`exp_scale`, or :func:`pow_scale`, or
            "log". Defaults to linear. The table is downsampled into bins even
            along the scale.
        y_scale: How y values map to positions: :func:`log_scale`,
            :func:`exp_scale`, :func:`pow_scale`, or "log". Defaults to linear.

    Returns:
        The plot element.
    """
    return _plot(
        table,
        x,
        "scatter",
        tuple(_as_list(y)),
        None,
        title,
        x_title,
        y_title,
        downsample,
        tooltip,
        legend_position,
        x_scale=x_scale,
        y_scale=y_scale,
    )


def area(
    table: Table,
    x: str,
    y: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    downsample: bool | Downsampler = True,
    tooltip: bool | Sequence[TooltipPart] = True,
    legend_position: LegendPosition = "overlay",
    x_scale: ScaleLike = None,
    y_scale: ScaleLike = None,
    stacked: bool = True,
    groupnorm: GroupNorm | None = None,
    fill: Fill | Sequence[Fill | None] | None = None,
) -> ui.BaseElement:
    """
    Plot columns of a table as filled areas. Like ``deephaven.plot.express``,
    several y columns are stacked, each on top of the one before it, so the top
    shows their total. Areas are filled down to zero, which is always in view.
    The table should be sorted by x. Hovering snaps to the x under the cursor,
    showing each column's own value there.

    Args:
        table: The table to plot. Ticking tables update the plot live.
        x: The column to use for x values.
        y: The column, or columns, to plot against x. Each one is an area.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. Defaults to the y column name when
            there is one; several y columns have no default, since the legend
            names them. Pass an empty string to hide it.
        downsample: Reduce the table on the server to what the plot can show
            at its current size, zoom, and pan, and replace the reduced table as
            those change. Stacked columns are summed first, so a Downsampler of
            your own receives the running totals. Pass False to send the whole
            table to the client.
        tooltip: What to draw while hovering the plot. True draws a tooltip box
            and markers on the hovered points, and False draws nothing. To
            choose, pass the parts to draw: "box" for the tooltip box,
            "markers", "guides" for dashed lines from the points to the axes,
            "x_axis_label" to label the hovered x on the x axis, and
            "y_axis_labels" to label each hovered value on the y axis in its
            series' color.
        legend_position: Where to draw the legend. "overlay" lists the series
            across the top of the plot, over the data; "right" lists them in a
            column beside the plot, which narrows to make room.
        x_scale: How x values map to positions along the axis: a scale from
            :func:`calendar_scale` to remove the nights, weekends, and holidays
            between business sessions, or :func:`breaks_scale`,
            :func:`log_scale`, :func:`exp_scale`, or :func:`pow_scale`, or
            "log". Defaults to linear. The table is downsampled into bins even
            along the scale.
        y_scale: How y values map to positions: :func:`log_scale`,
            :func:`exp_scale`, :func:`pow_scale`, or "log". Defaults to linear.
        stacked: Stack the areas, each on top of the one before it. Missing
            values count as zero. False fills every area down to zero, overlapping
            each other.
        groupnorm: Normalize stacked areas at each x by their total: "fraction"
            to fill from 0 to 1, or "percent" from 0 to 100. Needs ``stacked``.
        fill: How to fill the areas: a CSS color, or a gradient from
            :func:`linear_gradient`, for every area, or a sequence with one per
            y column, where None keeps the default. By default an area is its
            line color, half transparent.

    Returns:
        The plot element.
    """
    ys = tuple(_as_list(y))
    if groupnorm is not None and groupnorm not in _GROUPNORMS:
        raise ValueError(
            f"groupnorm must be one of {list(_GROUPNORMS)} or None, got {groupnorm!r}"
        )
    if groupnorm is not None and not stacked:
        raise ValueError("groupnorm normalizes stacked areas, so it needs stacked=True")
    if stacked and len(set(ys)) != len(ys):
        raise ValueError("Each stacked y column must be different")
    return _plot(
        table,
        x,
        "area",
        ys,
        None,
        title,
        x_title,
        y_title,
        downsample,
        tooltip,
        legend_position,
        x_scale=x_scale,
        y_scale=y_scale,
        stacked=stacked,
        groupnorm=groupnorm,
        fill=_parse_fills(fill, len(ys)),
    )


def _bars(
    type: SeriesType,
    table: Table,
    x: str,
    open: str | Sequence[str],
    high: str | Sequence[str],
    low: str | Sequence[str],
    close: str | Sequence[str],
    title: str | None,
    x_title: str | None,
    y_title: str | None,
    downsample: bool | Downsampler,
    tooltip: bool | Sequence[TooltipPart],
    legend_position: LegendPosition,
    x_scale: ScaleLike,
    y_scale: ScaleLike,
) -> ui.BaseElement:
    ohlc = tuple(tuple(columns) for columns in _ohlc_columns(open, high, low, close))
    return _plot(
        table,
        x,
        type,
        None,
        ohlc,
        title,
        x_title,
        y_title,
        downsample,
        tooltip,
        legend_position,
        x_scale=x_scale,
        y_scale=y_scale,
    )


def ohlc(
    table: Table,
    x: str,
    open: str | Sequence[str],
    high: str | Sequence[str],
    low: str | Sequence[str],
    close: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    downsample: bool | Downsampler = True,
    tooltip: bool | Sequence[TooltipPart] = True,
    legend_position: LegendPosition = "overlay",
    x_scale: ScaleLike = None,
    y_scale: ScaleLike = None,
) -> ui.BaseElement:
    """
    Plot open, high, low, and close values as OHLC bars: a line from low to
    high, with a tick to the left at the open and to the right at the close.
    Bars that close below their open are drawn in the decreasing color. When
    there are more bars than fit, neighbouring bars are combined into longer
    periods, and zooming in shows the originals. Hovering snaps to the bar
    under the cursor and lists its values.

    Args:
        table: The table to plot, sorted by x. Ticking tables update the plot
            live.
        x: The column to use for x values, such as the start of each period.
        open: The column of opening values, or one per series.
        high: The column of high values, or one per series.
        low: The column of low values, or one per series.
        close: The column of closing values, or one per series. A series is
            named after its close column.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. None by default. Pass a string to show
            one.
        downsample: Reduce the table on the server to what the plot can show
            at its current size, zoom, and pan, and replace the reduced table as
            those change. Pass a Downsampler to use your own algorithm, or False
            to send the whole table to the client.
        tooltip: What to draw while hovering the plot. True draws a tooltip box
            and markers on the hovered points, and False draws nothing. To
            choose, pass the parts to draw: "box" for the tooltip box,
            "markers", "guides" for dashed lines from the points to the axes,
            "x_axis_label" to label the hovered x on the x axis, and
            "y_axis_labels" to label each hovered value on the y axis in its
            series' color.
        legend_position: Where to draw the legend. "overlay" lists the series
            across the top of the plot, over the data; "right" lists them in a
            column beside the plot, which narrows to make room.
        x_scale: How x values map to positions along the axis: a scale from
            :func:`calendar_scale` to remove the nights, weekends, and holidays
            between business sessions, or :func:`breaks_scale`,
            :func:`log_scale`, :func:`exp_scale`, or :func:`pow_scale`, or
            "log". Defaults to linear. The table is downsampled into bins even
            along the scale.
        y_scale: How y values map to positions: :func:`log_scale`,
            :func:`exp_scale`, :func:`pow_scale`, or "log". Defaults to linear.

    Returns:
        The plot element.
    """
    return _bars(
        "ohlc",
        table,
        x,
        open,
        high,
        low,
        close,
        title,
        x_title,
        y_title,
        downsample,
        tooltip,
        legend_position,
        x_scale,
        y_scale,
    )


def candlestick(
    table: Table,
    x: str,
    open: str | Sequence[str],
    high: str | Sequence[str],
    low: str | Sequence[str],
    close: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    downsample: bool | Downsampler = True,
    tooltip: bool | Sequence[TooltipPart] = True,
    legend_position: LegendPosition = "overlay",
    x_scale: ScaleLike = None,
    y_scale: ScaleLike = None,
) -> ui.BaseElement:
    """
    Plot open, high, low, and close values as candlesticks: a line from low to
    high, with a body from the open to the close. Bars that close below their
    open are drawn in the decreasing color. When there are more bars than fit,
    neighbouring bars are combined into longer periods, and zooming in shows
    the originals. Hovering snaps to the bar under the cursor and lists its
    values.

    Args:
        table: The table to plot, sorted by x. Ticking tables update the plot
            live.
        x: The column to use for x values, such as the start of each period.
        open: The column of opening values, or one per series.
        high: The column of high values, or one per series.
        low: The column of low values, or one per series.
        close: The column of closing values, or one per series. A series is
            named after its close column.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. None by default. Pass a string to show
            one.
        downsample: Reduce the table on the server to what the plot can show
            at its current size, zoom, and pan, and replace the reduced table as
            those change. Pass a Downsampler to use your own algorithm, or False
            to send the whole table to the client.
        tooltip: What to draw while hovering the plot. True draws a tooltip box
            and markers on the hovered points, and False draws nothing. To
            choose, pass the parts to draw: "box" for the tooltip box,
            "markers", "guides" for dashed lines from the points to the axes,
            "x_axis_label" to label the hovered x on the x axis, and
            "y_axis_labels" to label each hovered value on the y axis in its
            series' color.
        legend_position: Where to draw the legend. "overlay" lists the series
            across the top of the plot, over the data; "right" lists them in a
            column beside the plot, which narrows to make room.
        x_scale: How x values map to positions along the axis: a scale from
            :func:`calendar_scale` to remove the nights, weekends, and holidays
            between business sessions, or :func:`breaks_scale`,
            :func:`log_scale`, :func:`exp_scale`, or :func:`pow_scale`, or
            "log". Defaults to linear. The table is downsampled into bins even
            along the scale.
        y_scale: How y values map to positions: :func:`log_scale`,
            :func:`exp_scale`, :func:`pow_scale`, or "log". Defaults to linear.

    Returns:
        The plot element.
    """
    return _bars(
        "candlestick",
        table,
        x,
        open,
        high,
        low,
        close,
        title,
        x_title,
        y_title,
        downsample,
        tooltip,
        legend_position,
        x_scale,
        y_scale,
    )


def _parse_camera(camera: Camera | None) -> dict[str, float] | None:
    if camera is None:
        return None
    if not isinstance(camera, Mapping):
        raise ValueError(f"camera must be a dict of camera settings, got {camera!r}")
    unknown = [key for key in camera if key not in _CAMERA_KEYS]
    if unknown:
        raise ValueError(
            f"Unknown camera keys {unknown}; expected some of {list(_CAMERA_KEYS)}"
        )
    parsed = {
        key: float(camera[key]) for key in _CAMERA_KEYS if camera.get(key) is not None
    }
    if "distance" in parsed and parsed["distance"] <= 0:
        raise ValueError(f"camera distance must be positive, got {parsed['distance']}")
    if "fov" in parsed and not 0 < parsed["fov"] < 180:
        raise ValueError(
            f"camera fov must be between 0 and 180 degrees, got {parsed['fov']}"
        )
    return parsed


def _parse_range(key: str, value: Sequence[float] | None) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, (str, Mapping)) or len(value) != 2:
        raise ValueError(f"{key} must be a (min, max) pair, got {value!r}")
    low, high = float(value[0]), float(value[1])
    if not low < high:
        raise ValueError(f"{key} must have its min below its max, got {value!r}")
    return [low, high]


def _pair_columns(
    y: str | Sequence[str], z: str | Sequence[str]
) -> tuple[list[str], list[str]]:
    """Pairs y and z columns into series, repeating a single column to match the other."""
    ys, zs = _as_list(y), _as_list(z)
    if len(ys) == 1 and len(zs) > 1:
        ys = ys * len(zs)
    elif len(zs) == 1 and len(ys) > 1:
        zs = zs * len(ys)
    if len(ys) != len(zs):
        raise ValueError(
            f"y and z name {len(ys)} and {len(zs)} columns; pass one of each per series, or a single column to share"
        )
    if not ys:
        raise ValueError("A 3D plot needs at least one y and z column")
    return ys, zs


def _plot_3d(
    table: Table,
    type: SeriesType,
    x: str,
    y: str | Sequence[str],
    z: str | Sequence[str],
    title: str | None,
    x_title: str | None,
    y_title: str | None,
    z_title: str | None,
    color: str | Sequence[str] | None,
    size: float | None,
    tooltip: bool,
    legend_position: LegendPosition,
    camera: Camera | None,
    show_axes: bool,
    point_scaling: PointScaling,
    depth_fade: float,
    x_range: Sequence[float] | None,
    y_range: Sequence[float] | None,
    z_range: Sequence[float] | None,
) -> ui.BaseElement:
    if not isinstance(tooltip, bool):
        raise ValueError(f"tooltip must be a bool for a 3D plot, got {tooltip!r}")
    if legend_position not in _LEGEND_POSITIONS:
        raise ValueError(
            f"legend_position must be one of {list(_LEGEND_POSITIONS)}, got {legend_position!r}"
        )
    if point_scaling not in _POINT_SCALINGS:
        raise ValueError(
            f"point_scaling must be one of {list(_POINT_SCALINGS)}, got {point_scaling!r}"
        )
    ys, zs = _pair_columns(y, z)
    colors = None if color is None else _as_list(color)
    if colors is not None and len(colors) not in (1, len(ys)):
        raise ValueError(
            f"color has {len(colors)} entries for {len(ys)} series; pass one color, or one per series"
        )
    if size is not None and float(size) < 0:
        raise ValueError(f"size must not be negative, got {size!r}")
    # The name must match the key in the mapping in GigaplotPlugin.ts
    return ui.BaseElement(
        "deephaven_plugin_gigaplot.gigaplot",
        # 3D data is not downsampled, so the whole table is sent
        table=table,
        x=x,
        y=ys,
        z=zs,
        type=type,
        title=title,
        x_title=x_title,
        y_title=y_title,
        z_title=z_title,
        color=None if colors is None else colors * (len(ys) if len(colors) == 1 else 1),
        size=None if size is None else float(size),
        tooltip=tooltip,
        legend_position=legend_position,
        camera=_parse_camera(camera),
        show_axes=bool(show_axes),
        point_scaling=point_scaling,
        depth_fade=min(1.0, max(0.0, float(depth_fade))),
        x_range=_parse_range("x_range", x_range),
        y_range=_parse_range("y_range", y_range),
        z_range=_parse_range("z_range", z_range),
    )


def scatter3d(
    table: Table,
    x: str,
    y: str | Sequence[str],
    z: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    z_title: str | None = None,
    color: str | Sequence[str] | None = None,
    size: float | None = None,
    tooltip: bool = True,
    legend_position: LegendPosition = "overlay",
    camera: Camera | None = None,
    show_axes: bool = True,
    point_scaling: PointScaling = "fixed",
    depth_fade: float = 0.0,
    x_range: Sequence[float] | None = None,
    y_range: Sequence[float] | None = None,
    z_range: Sequence[float] | None = None,
) -> ui.BaseElement:
    """
    Plot columns of a table as points in 3D. Drag to rotate, scroll to zoom,
    and double click to reset the camera. Hovering a point lists its values.

    Args:
        table: The table to plot. Ticking tables update the plot live. 3D data
            is not downsampled, so the whole table is sent to the client;
            filter or ``tail`` large tables first.
        x: The column to use for x values.
        y: The column, or columns, to use for y values.
        z: The column, or columns, to use for z values. Series ``i`` is made
            of ``x``, ``y[i]``, and ``z[i]``; a single y or z column is shared
            by every series. A series is named after its z column, or its y
            column when several series share one z column.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. Defaults to the y column name when
            there is one.
        z_title: Title for the z axis. Defaults to the z column name when
            there is one.
        color: A CSS color for every series, or one per series. Defaults to
            the theme's colorway.
        tooltip: Mark the point under the cursor and list its x, y, and z.
        legend_position: Where to draw the legend: "overlay" across the top of
            the plot, or "right" beside it.
        camera: Where the camera starts, and returns to on double click. See
            :class:`Camera`. Drag to rotate and scroll to zoom.
        show_axes: Draw the box, its gridlines, and its labels.
        x_range: A fixed (min, max) for the x axis. Defaults to the data's
            extent, which follows a ticking table.
        y_range: A fixed (min, max) for the y axis.
        z_range: A fixed (min, max) for the z axis.
        size: Point diameter in pixels. Defaults to the theme's point size.
        point_scaling: "fixed" draws every point at ``size``. "perspective"
            draws points at ``size`` at the center of the box and scales them
            with distance, so nearer points look bigger.
        depth_fade: How much the farthest points fade, from 0, not at all, to
            1, fully transparent.

    Returns:
        The plot element.
    """
    return _plot_3d(
        table,
        "scatter3d",
        x,
        y,
        z,
        title,
        x_title,
        y_title,
        z_title,
        color,
        size,
        tooltip,
        legend_position,
        camera,
        show_axes,
        point_scaling,
        depth_fade,
        x_range,
        y_range,
        z_range,
    )


def line3d(
    table: Table,
    x: str,
    y: str | Sequence[str],
    z: str | Sequence[str],
    title: str | None = None,
    x_title: str | None = None,
    y_title: str | None = None,
    z_title: str | None = None,
    color: str | Sequence[str] | None = None,
    width: float | None = None,
    tooltip: bool = True,
    legend_position: LegendPosition = "overlay",
    camera: Camera | None = None,
    show_axes: bool = True,
    depth_fade: float = 0.0,
    x_range: Sequence[float] | None = None,
    y_range: Sequence[float] | None = None,
    z_range: Sequence[float] | None = None,
) -> ui.BaseElement:
    """
    Plot columns of a table as lines in 3D, joining each series' points in
    table order. Drag to rotate, scroll to zoom, and double click to reset the
    camera. Hovering a vertex lists its values.

    Args:
        table: The table to plot. Ticking tables update the plot live. 3D data
            is not downsampled, so the whole table is sent to the client;
            filter or ``tail`` large tables first.
        x: The column to use for x values.
        y: The column, or columns, to use for y values.
        z: The column, or columns, to use for z values. Series ``i`` is made
            of ``x``, ``y[i]``, and ``z[i]``; a single y or z column is shared
            by every series. A series is named after its z column, or its y
            column when several series share one z column.
        title: Optional title for the plot.
        x_title: Title for the x axis. Defaults to the x column name. Pass an
            empty string to hide it.
        y_title: Title for the y axis. Defaults to the y column name when
            there is one.
        z_title: Title for the z axis. Defaults to the z column name when
            there is one.
        color: A CSS color for every series, or one per series. Defaults to
            the theme's colorway.
        tooltip: Mark the point under the cursor and list its x, y, and z.
        legend_position: Where to draw the legend: "overlay" across the top of
            the plot, or "right" beside it.
        camera: Where the camera starts, and returns to on double click. See
            :class:`Camera`. Drag to rotate and scroll to zoom.
        show_axes: Draw the box, its gridlines, and its labels.
        x_range: A fixed (min, max) for the x axis. Defaults to the data's
            extent, which follows a ticking table.
        y_range: A fixed (min, max) for the y axis.
        z_range: A fixed (min, max) for the z axis.
        width: Line width in pixels. Defaults to the theme's line width.
        depth_fade: How much the farthest parts of the lines fade, from 0, not
            at all, to 1, fully transparent.

    Returns:
        The plot element.
    """
    return _plot_3d(
        table,
        "line3d",
        x,
        y,
        z,
        title,
        x_title,
        y_title,
        z_title,
        color,
        width,
        tooltip,
        legend_position,
        camera,
        show_axes,
        "fixed",
        depth_fade,
        x_range,
        y_range,
        z_range,
    )
