"""
Server side downsampling for gigaplot.

Each function takes a table and returns a new, much smaller table with the same
x and value column names and types, so the result can be plotted exactly like
the source. Bins are anchored at zero, so a ticking source only changes the bins its
new rows fall into.

Ranges and bin sizes are in plot units: the column value for numeric columns, and
nanoseconds since the axis origin for ``Instant`` columns. The origin is an
integer number of epoch nanoseconds, so ``Instant`` values keep full nanosecond
precision near it, which a float of epoch nanoseconds or milliseconds cannot.

An axis with a :class:`~deephaven_plugin_gigaplot.scales.Scale` is binned by
position on the scale rather than by value, so bins are even on screen, such
as in business time on an axis without nights and weekends. Ranges stay in
plot units, and bin sizes are in positions.
"""

from __future__ import annotations

import math
from typing import Callable, Literal, Sequence, TypedDict

from deephaven import agg, merge
from deephaven.table import Table

from .scales import Scale

__all__ = [
    "Viewport",
    "Downsampler",
    "area_bounds",
    "bounds",
    "ohlc_bounds",
    "downsample",
    "downsample_line",
    "downsample_ohlc",
    "downsample_scatter",
]

_INSTANT_TYPE = "java.time.Instant"


class Viewport(TypedDict, total=False):
    """
    What the plot needs drawn, as sent by the client when it zooms, pans, or
    resizes. Line, OHLC, and candlestick plots only send the x keys.
    """

    x_min: float
    x_max: float
    x_bin: float
    """Width of one bin in plot units, at most one pixel wide."""
    y_min: float
    y_max: float
    y_bin: float
    x_origin: int
    """Epoch nanoseconds that x plot units count from, when x is an ``Instant``."""
    y_origin: int
    """Epoch nanoseconds that y plot units count from, when y is an ``Instant``."""
    x_scale: Scale
    """
    The x axis' scale, when it is not linear. Set by the plot, never by the
    client. ``x_bin`` is in positions on it.
    """
    y_scale: Scale
    """The y axis' scale, when it is not linear. ``y_bin`` is in positions on it."""


Downsampler = Callable[[Table, str, Sequence[str], Viewport], Table]
"""
A downsampling algorithm. Receives the source table, the x column, the value
columns, and the viewport, and returns a table with the same x and value
columns.

The value columns are the y columns of a line or scatter plot. For OHLC and
candlestick plots they are the open, high, low, and close columns of each
series in turn: ``[open0, high0, low0, close0, open1, ...]``.
"""


def _as_list(y: str | Sequence[str]) -> list[str]:
    return [y] if isinstance(y, str) else list(y)


def _is_instant(table: Table, column: str) -> bool:
    return table.definition[column].data_type.j_name == _INSTANT_TYPE


def _float_literal(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError(f"Expected a finite number, got {value}")
    return repr(float(value))


def _long_literal(value: int) -> str:
    return f"{int(value)}L"


def _plot_value(table: Table, column: str, origin: int) -> str:
    """Formula for a column's value in plot units."""
    if _is_instant(table, column):
        # Subtract as longs first, so the double only holds the small difference
        return f"((double) (epochNanos({column}) - {_long_literal(origin)}))"
    return column


def _position(table: Table, column: str, origin: int, scale: Scale | None) -> str:
    """Formula for a column's position on its axis' scale, in plot units without one."""
    value = _plot_value(table, column, origin)
    if scale is None:
        return value
    is_instant = _is_instant(table, column)
    if is_instant and not scale.supports_instants:
        raise ValueError(f"A {type(scale).__name__} cannot place the Instant column {column}")
    return scale.position(value, column, is_instant, origin)


def _bin_rows(
    table: Table,
    column: str,
    origin: int,
    bin_size: float,
    scale: Scale | None,
    name: str = "__Bin",
) -> Table:
    """Adds the bin of each row, dropping rows with no position on the scale."""
    bin_literal = _float_literal(bin_size)
    if scale is None:
        return table.update_view(
            f"{name} = (long) Math.floor({_plot_value(table, column, origin)} / {bin_literal})"
        )
    # A calendar's formula reads it from this name, in the scope of the call
    gigaplot_calendar = scale.calendar  # noqa: F841
    return (
        table.update_view(f"__Pos = {_position(table, column, origin, scale)}")
        .where("Double.isFinite(__Pos)")
        .update_view(f"{name} = (long) Math.floor(__Pos / {bin_literal})")
    )


def _range_filter(
    table: Table,
    column: str,
    value_range: tuple[float, float] | None,
    origin: int,
) -> Table:
    """Keeps rows where the column is within the range, or not null if there is no range."""
    if value_range is None:
        return table.where(f"!isNull({column})")
    low, high = value_range
    if _is_instant(table, column):
        low_nanos = origin + math.floor(low)
        high_nanos = origin + math.ceil(high)
        return table.where(
            [
                f"!isNull({column})",
                f"epochNanos({column}) >= {_long_literal(low_nanos)}",
                f"epochNanos({column}) <= {_long_literal(high_nanos)}",
            ]
        )
    return table.where(
        f"!isNull({column}) && {column} >= {_float_literal(low)} && {column} <= {_float_literal(high)}"
    )


def _check_bin(name: str, value: float) -> None:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive number, got {value}")


def downsample_line(
    table: Table,
    x: str,
    y: str | Sequence[str],
    x_bin: float,
    x_range: tuple[float, float] | None = None,
    x_origin: int = 0,
    x_scale: Scale | None = None,
) -> Table:
    """
    Reduces line series to at most four points per bin: the first, minimum,
    maximum, and last value. With bins no wider than a pixel, this draws the
    same line as every point would.

    The source should be sorted by x, since first and last follow row order.

    Args:
        table: The table to downsample.
        x: The x column. Numeric or Instant.
        y: The y column, or columns.
        x_bin: Width of each bin, in plot units.
        x_range: Only rows with x in this range are kept. All rows when None.
        x_origin: For an Instant x column, the epoch nanoseconds that x_bin and
            x_range count from. Ignored for numeric columns.
        x_scale: The x axis' scale. Bins are even in its positions, and x_bin
            is in them.

    Returns:
        A table with the x and y columns, sorted by x.
    """
    ys = _as_list(y)
    _check_bin("x_bin", x_bin)

    binned = _bin_rows(_range_filter(table, x, x_range, x_origin), x, x_origin, x_bin, x_scale)
    bins = binned.agg_by(
        [
            agg.count_("__Count"),
            agg.first([f"__FirstX = {x}"] + [f"__First{i} = {c}" for i, c in enumerate(ys)]),
            agg.last([f"__LastX = {x}"] + [f"__Last{i} = {c}" for i, c in enumerate(ys)]),
            agg.min_([f"__Min{i} = {c}" for i, c in enumerate(ys)]),
            agg.max_([f"__Max{i} = {c}" for i, c in enumerate(ys)]),
        ],
        by="__Bin",
    )

    def points(order: int, x_column: str, prefix: str) -> Table:
        return bins.view(
            ["__Bin", "__Count", f"__Order = {order}", f"{x} = {x_column}"]
            + [f"{c} = {prefix}{i}" for i, c in enumerate(ys)]
        )

    # A bin of one or two points is already exact, so skip the redundant rows
    return (
        merge(
            [
                points(0, "__FirstX", "__First"),
                points(1, "__FirstX", "__Min").where("__Count > 2"),
                points(2, "__LastX", "__Max").where("__Count > 2"),
                points(3, "__LastX", "__Last").where("__Count > 1"),
            ]
        )
        .sort(["__Bin", "__Order"])
        .view([x] + ys)
    )


def downsample_scatter(
    table: Table,
    x: str,
    y: str | Sequence[str],
    x_bin: float,
    y_bin: float,
    x_range: tuple[float, float] | None = None,
    y_range: tuple[float, float] | None = None,
    x_origin: int = 0,
    y_origin: int = 0,
    x_scale: Scale | None = None,
    y_scale: Scale | None = None,
) -> Table:
    """
    Reduces scatter series by keeping one point in each grid cell. With cells
    no larger than a point, the plot looks the same as with every point.

    Args:
        table: The table to downsample.
        x: The x column. Numeric or Instant.
        y: The y column, or columns.
        x_bin: Width of each cell, in plot units.
        y_bin: Height of each cell, in plot units.
        x_range: Only rows with x in this range are kept. All rows when None.
        y_range: Points outside this range are off screen, so they collapse
            into one cell above and one below it for each x cell.
        x_origin: For an Instant x column, the epoch nanoseconds that x_bin and
            x_range count from. Ignored for numeric columns.
        y_origin: For Instant y columns, the epoch nanoseconds that y_bin and
            y_range count from. Ignored for numeric columns.
        x_scale: The x axis' scale. Cells are even in its positions, and x_bin
            is in them.
        y_scale: The y axis' scale. Cells are even in its positions, and y_bin
            is in them, while y_range stays in plot units. It cannot be a
            calendar.

    Returns:
        A table with the x and y columns.
    """
    ys = _as_list(y)
    _check_bin("x_bin", x_bin)
    _check_bin("y_bin", y_bin)
    if y_scale is not None and y_scale.calendar is not None:
        raise ValueError("A calendar scale only fits the x axis")

    y_bin_literal = _float_literal(y_bin)

    def y_cell(column: str) -> str:
        value = _plot_value(table, column, y_origin)
        position = _position(table, column, y_origin, y_scale)
        # Points with no position on the scale are drawn nowhere, so share a cell
        cell = (
            f"(long) Math.floor({position} / {y_bin_literal})"
            if y_scale is None
            else f"Double.isFinite({position}) ? (long) Math.floor({position} / {y_bin_literal}) : NULL_LONG"
        )
        if y_range is None:
            return f"isNull({column}) ? NULL_LONG : {cell}"
        low, high = (_float_literal(v) for v in y_range)
        return (
            f"isNull({column}) ? NULL_LONG"
            f" : {value} < {low} ? Long.MIN_VALUE + 1"
            f" : {value} > {high} ? Long.MAX_VALUE"
            f" : {cell}"
        )

    keys = ["__BinX"] + [f"__BinY{i}" for i in range(len(ys))]
    binned = _bin_rows(
        _range_filter(table, x, x_range, x_origin),
        x,
        x_origin,
        x_bin,
        x_scale,
        name="__BinX",
    )
    return (
        binned.update_view([f"__BinY{i} = {y_cell(c)}" for i, c in enumerate(ys)])
        .first_by(keys)
        .view([x] + ys)
    )


def downsample_ohlc(
    table: Table,
    x: str,
    open: str | Sequence[str],
    high: str | Sequence[str],
    low: str | Sequence[str],
    close: str | Sequence[str],
    x_bin: float,
    x_range: tuple[float, float] | None = None,
    x_origin: int = 0,
    x_scale: Scale | None = None,
) -> Table:
    """
    Resamples OHLC bars into one bar per bin, the way prices are resampled to
    a longer period: the first open, the highest high, the lowest low, and the
    last close, at the x of the first bar in the bin. Bins with one bar are
    returned unchanged.

    The source should be sorted by x, since first and last follow row order.
    Each column is output once, so a column used for several roles, or by
    several series, keeps only its first role's values. Alias it to a column
    per role first, such as with ``update_view``, to keep them all.

    Args:
        table: The table to downsample.
        x: The x column. Numeric or Instant.
        open: The open column, or one per series.
        high: The high column, or one per series.
        low: The low column, or one per series.
        close: The close column, or one per series.
        x_bin: Width of each bin, in plot units.
        x_range: Only rows with x in this range are kept. All rows when None.
        x_origin: For an Instant x column, the epoch nanoseconds that x_bin and
            x_range count from. Ignored for numeric columns.
        x_scale: The x axis' scale. Bins are even in its positions, so on an
            axis without nights and weekends a bar covers business time, and
            x_bin is in them.

    Returns:
        A table with the x, open, high, low, and close columns, sorted by x.
    """
    opens, highs, lows, closes = _ohlc_columns(open, high, low, close)
    _check_bin("x_bin", x_bin)

    binned = _bin_rows(_range_filter(table, x, x_range, x_origin), x, x_origin, x_bin, x_scale)
    bins = binned.agg_by(
        [
            agg.first([f"{x}"] + [f"__Open{i} = {c}" for i, c in enumerate(opens)]),
            agg.max_([f"__High{i} = {c}" for i, c in enumerate(highs)]),
            agg.min_([f"__Low{i} = {c}" for i, c in enumerate(lows)]),
            agg.last([f"__Close{i} = {c}" for i, c in enumerate(closes)]),
        ],
        by="__Bin",
    )
    # A column can serve several series or roles, so keep the first of each name
    outputs: dict[str, str] = {}
    for prefix, columns in (
        ("__Open", opens),
        ("__High", highs),
        ("__Low", lows),
        ("__Close", closes),
    ):
        for i, column in enumerate(columns):
            outputs.setdefault(column, f"{column} = {prefix}{i}")
    return bins.sort("__Bin").view([x] + list(outputs.values()))


def _ohlc_columns(
    open: str | Sequence[str],
    high: str | Sequence[str],
    low: str | Sequence[str],
    close: str | Sequence[str],
) -> tuple[list[str], list[str], list[str], list[str]]:
    """The columns of each role as lists, checked to describe the same number of series."""
    columns = (_as_list(open), _as_list(high), _as_list(low), _as_list(close))
    if len({len(c) for c in columns}) != 1:
        raise ValueError(
            "open, high, low, and close must name the same number of columns, got "
            + ", ".join(str(len(c)) for c in columns)
        )
    return columns


def _split_ohlc(columns: Sequence[str]) -> tuple[list[str], list[str], list[str], list[str]]:
    """Splits ``[open0, high0, low0, close0, open1, ...]`` into a list per role."""
    if len(columns) % 4 != 0:
        raise ValueError(
            f"Expected open, high, low, and close columns for each series, got {list(columns)}"
        )
    return (
        list(columns[0::4]),
        list(columns[1::4]),
        list(columns[2::4]),
        list(columns[3::4]),
    )


def downsample(
    table: Table,
    x: str,
    y: str | Sequence[str],
    viewport: Viewport,
    type: Literal["line", "scatter", "area", "ohlc", "candlestick"] = "line",
    x_scale: Scale | None = None,
    y_scale: Scale | None = None,
) -> Table:
    """
    Downsamples a table for the viewport a plot is drawing. This is the default
    :data:`Downsampler` used by every plot.

    Args:
        table: The table to downsample.
        x: The x column.
        y: The value columns. For OHLC and candlestick plots, the open, high,
            low, and close columns of each series in turn.
        viewport: The region and resolution to downsample for.
        type: The series type, which decides the algorithm. Areas are
            downsampled like lines.
        x_scale: The x axis' scale, if it has one. Bins are even in its
            positions. Defaults to the viewport's ``x_scale``.
        y_scale: The y axis' scale, if it has one. Only scatter plots bin y.
            Defaults to the viewport's ``y_scale``.

    Returns:
        A table with the x and value columns.
    """
    x_range = (
        (viewport["x_min"], viewport["x_max"])
        if "x_min" in viewport and "x_max" in viewport
        else None
    )
    x_origin = viewport.get("x_origin", 0)
    x_scale = x_scale if x_scale is not None else viewport.get("x_scale")
    y_scale = y_scale if y_scale is not None else viewport.get("y_scale")
    if type in ("ohlc", "candlestick"):
        return downsample_ohlc(
            table,
            x,
            *_split_ohlc(_as_list(y)),
            viewport["x_bin"],
            x_range,
            x_origin,
            x_scale,
        )
    if type == "scatter":
        y_range = (
            (viewport["y_min"], viewport["y_max"])
            if "y_min" in viewport and "y_max" in viewport
            else None
        )
        return downsample_scatter(
            table,
            x,
            y,
            viewport["x_bin"],
            viewport["y_bin"],
            x_range,
            y_range,
            x_origin,
            viewport.get("y_origin", 0),
            x_scale,
            y_scale,
        )
    return downsample_line(table, x, y, viewport["x_bin"], x_range, x_origin, x_scale)


def bounds(table: Table, x: str, y: str | Sequence[str]) -> Table:
    """
    A one row table with the extent of each column, for picking the initial
    viewport. Columns are ``XMin``, ``XMax``, and ``YMin{i}`` and ``YMax{i}``
    for each y column in order.

    Args:
        table: The table to measure.
        x: The x column.
        y: The y column, or columns.

    Returns:
        A one row table that ticks with the source.
    """
    ys = _as_list(y)
    return _bounds(table, x, ys, ys)


def area_bounds(table: Table, x: str, y: str | Sequence[str]) -> Table:
    """
    Like :func:`bounds`, for area plots, which are filled down to zero, so
    ``YMin{i}`` is at most zero and ``YMax{i}`` at least zero. Stacked areas
    are measured by their running totals.

    Args:
        table: The table to measure.
        x: The x column.
        y: The y column, or columns.

    Returns:
        A one row table that ticks with the source.
    """
    ys = _as_list(y)
    return bounds(table, x, ys).update_view(
        [
            formula
            for i in range(len(ys))
            for formula in (
                f"YMin{i} = isNull(YMin{i}) ? YMin{i} : Math.min(YMin{i}, 0)",
                f"YMax{i} = isNull(YMax{i}) ? YMax{i} : Math.max(YMax{i}, 0)",
            )
        ]
    )


def ohlc_bounds(
    table: Table,
    x: str,
    low: str | Sequence[str],
    high: str | Sequence[str],
) -> Table:
    """
    Like :func:`bounds`, for OHLC and candlestick plots, whose bars reach from
    their low to their high. ``YMin{i}`` is the lowest low and ``YMax{i}`` the
    highest high of series ``i``.

    Args:
        table: The table to measure.
        x: The x column.
        low: The low column, or one per series.
        high: The high column, or one per series.

    Returns:
        A one row table that ticks with the source.
    """
    lows, highs = _as_list(low), _as_list(high)
    if len(lows) != len(highs):
        raise ValueError("low and high must name the same number of columns")
    return _bounds(table, x, lows, highs)


def _bounds(table: Table, x: str, mins: list[str], maxes: list[str]) -> Table:
    return table.agg_by(
        [
            agg.min_([f"XMin = {x}"] + [f"YMin{i} = {c}" for i, c in enumerate(mins)]),
            agg.max_([f"XMax = {x}"] + [f"YMax{i} = {c}" for i, c in enumerate(maxes)]),
        ]
    )
