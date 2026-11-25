"""
Axis scales for gigaplot plots: logarithmic, exponential, and power axes, and
axes with ranges removed, such as a business calendar's nights, weekends, and
holidays.

Each scale is described to the client, which draws in positions along the
scale, and gives the server a formula for a value's position, so tables are
downsampled into bins that are even on screen.
"""

from __future__ import annotations

import math
import os
import re
import tempfile
from datetime import date, datetime
from typing import Any, Mapping, Sequence, Union
from xml.sax.saxutils import escape

import jpy

__all__ = [
    "BreaksScale",
    "CalendarScale",
    "ExponentialScale",
    "LogScale",
    "PowerScale",
    "Scale",
    "ScaleLike",
    "breaks_scale",
    "calendar_scale",
    "exp_scale",
    "log_scale",
    "pow_scale",
]

CALENDAR_VARIABLE = "gigaplot_calendar"
"""
The name a calendar's Java object must have in the scope of a formula that
places values on it. See :meth:`Scale.position`.
"""

_TIME_PATTERN = re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$")

_DAY_NAMES = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)


def _float_literal(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError(f"Expected a finite number, got {value}")
    return repr(float(value))


class Scale:
    """
    How the values on an axis map to positions along it. Create one with
    :func:`log_scale`, :func:`exp_scale`, :func:`pow_scale`,
    :func:`breaks_scale`, or :func:`calendar_scale`.
    """

    supports_instants = False
    """True if the scale can place ``Instant`` columns."""

    calendar: Any = None
    """The Java business calendar the position formula reads, if any."""

    def spec(self) -> dict[str, Any]:
        """The scale as plain data, for the client."""
        raise NotImplementedError

    def position(self, value: str, column: str, is_instant: bool, origin: int) -> str:
        """
        A formula for the position of a value on the scale.

        Args:
            value: A formula for the value as a double: the column for a
                numeric column, or nanoseconds since ``origin`` for an
                ``Instant`` column.
            column: The column itself.
            is_instant: True if the column holds ``Instant`` values.
            origin: For an ``Instant`` column, the epoch nanoseconds the value
                counts from.

        Returns:
            A formula for a double, NaN where the value has no position. A
            calendar's formula reads its Java calendar from a variable named
            :data:`CALENDAR_VARIABLE`, which must be in scope.
        """
        raise NotImplementedError


class LogScale(Scale):
    """Each power of the base is the same distance apart. See :func:`log_scale`."""

    def __init__(self, base: float = 10):
        if not base > 0 or base == 1:
            raise ValueError(
                f"A log scale needs a positive base other than 1, got {base}"
            )
        self.base = float(base)

    def spec(self) -> dict[str, Any]:
        return {"type": "log", "base": self.base}

    def position(self, value: str, column: str, is_instant: bool, origin: int) -> str:
        return f"({value} > 0 ? Math.log({value}) / {_float_literal(math.log(self.base))} : Double.NaN)"


class ExponentialScale(Scale):
    """A value sits at the base to its power. See :func:`exp_scale`."""

    def __init__(self, base: float = math.e):
        if not base > 0 or base == 1:
            raise ValueError(
                f"An exponential scale needs a positive base other than 1, got {base}"
            )
        self.base = float(base)

    def spec(self) -> dict[str, Any]:
        return {"type": "exp", "base": self.base}

    def position(self, value: str, column: str, is_instant: bool, origin: int) -> str:
        return f"Math.pow({_float_literal(self.base)}, {value})"


class PowerScale(Scale):
    """A value sits at itself to the exponent. See :func:`pow_scale`."""

    def __init__(self, exponent: float):
        if not math.isfinite(exponent) or exponent <= 0:
            raise ValueError(f"A power scale needs a positive exponent, got {exponent}")
        self.exponent = float(exponent)

    def spec(self) -> dict[str, Any]:
        return {"type": "pow", "exponent": self.exponent}

    def position(self, value: str, column: str, is_instant: bool, origin: int) -> str:
        return f"(Math.signum({value}) * Math.pow(Math.abs({value}), {_float_literal(self.exponent)}))"


TimeLike = Union[str, datetime, date, int, float, Any]
"""
A point in time: an ISO 8601 string, a ``datetime``, a Java ``Instant``, or
a number of epoch nanoseconds.
"""


def _epoch_nanos(value: TimeLike) -> int:
    """Epoch nanoseconds of a point in time, as an exact int."""
    if isinstance(value, bool):
        raise ValueError(f"Expected a time, got {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError(f"A datetime needs a time zone, got {value!r}")
        return int(value.timestamp()) * 1_000_000_000 + value.microsecond * 1000
    if isinstance(value, str):
        parse = jpy.get_type("io.deephaven.time.DateTimeUtils").parseInstant
        return int(
            jpy.get_type("io.deephaven.time.DateTimeUtils").epochNanos(parse(value))
        )
    if hasattr(value, "getEpochSecond"):
        return int(value.getEpochSecond()) * 1_000_000_000 + int(value.getNano())
    raise ValueError(f"Expected a time, got {value!r}")


class BreaksScale(Scale):
    """Removes ranges of values from an axis. See :func:`breaks_scale`."""

    supports_instants = True

    def __init__(self, breaks: Sequence[tuple[Any, Any]], is_time: bool):
        self.breaks = list(breaks)
        self.is_time = is_time

    def spec(self) -> dict[str, Any]:
        if self.is_time:
            # Milliseconds lose the nanoseconds, but a break is never that fine
            return {
                "type": "breaks",
                "isTime": True,
                "breaks": [{"start": s / 1e6, "end": e / 1e6} for s, e in self.breaks],
            }
        return {
            "type": "breaks",
            "breaks": [{"start": float(s), "end": float(e)} for s, e in self.breaks],
        }

    def position(self, value: str, column: str, is_instant: bool, origin: int) -> str:
        if is_instant != self.is_time:
            kind = "times" if self.is_time else "numbers"
            raise ValueError(f"These breaks are {kind}, which do not fit this column")
        removed = []
        for start, end in self.breaks:
            low = float(start - origin) if is_instant else float(start)
            length = float(end - start)
            removed.append(
                f"Math.min(Math.max({value} - {_float_literal(low)}, 0.0), {_float_literal(length)})"
            )
        if not removed:
            return value
        return f"({value} - ({' + '.join(removed)}))"


class CalendarScale(Scale):
    """Removes the time between business sessions. See :func:`calendar_scale`."""

    supports_instants = True

    def __init__(self, calendar: Any, spec: dict[str, Any]):
        self.calendar = calendar
        self._spec = spec

    def spec(self) -> dict[str, Any]:
        return dict(self._spec)

    def position(self, value: str, column: str, is_instant: bool, origin: int) -> str:
        if is_instant:
            # Business time between the origin and the value, either way round
            start = f"epochNanosToInstant({origin}L)"
            return (
                f"(epochNanos({column}) >= {origin}L"
                f" ? (double) {CALENDAR_VARIABLE}.diffBusinessNanos({start}, {column})"
                f" : -(double) {CALENDAR_VARIABLE}.diffBusinessNanos({column}, {start}))"
            )
        # Numeric columns are epoch milliseconds, and positions business milliseconds
        return (
            f"({value} >= 0"
            f" ? {CALENDAR_VARIABLE}.diffBusinessNanos(epochMillisToInstant(0L), epochMillisToInstant((long) {value})) / 1.0e6"
            f" : -{CALENDAR_VARIABLE}.diffBusinessNanos(epochMillisToInstant((long) {value}), epochMillisToInstant(0L)) / 1.0e6)"
        )


ScaleLike = Union[Scale, str, None]
"""A scale, ``"linear"`` or None for none, or ``"log"`` for a base 10 log scale."""


def _parse_scale(scale: ScaleLike, axis: str) -> Scale | None:
    if scale is None or scale == "linear":
        return None
    if scale == "log":
        return LogScale()
    if isinstance(scale, Scale):
        return scale
    raise ValueError(f"{axis}_scale must be a scale, 'linear', or 'log', got {scale!r}")


def log_scale(base: float = 10) -> LogScale:
    """
    A logarithmic axis: each power of ``base`` is the same distance apart, so
    exponential growth is a straight line. Values at or below zero have no
    place on it, and are left out.

    Args:
        base: The base of the logarithm.

    Returns:
        The scale, to pass as ``x_scale`` or ``y_scale``.
    """
    return LogScale(base)


def exp_scale(base: float = math.e) -> ExponentialScale:
    """
    An exponential axis, the inverse of a log one: a value ``v`` sits at
    ``base ** v``, so data that is itself a logarithm, such as decibels or pH,
    is drawn in proportion to what it measures.

    Args:
        base: The base raised to each value.

    Returns:
        The scale, to pass as ``x_scale`` or ``y_scale``.
    """
    return ExponentialScale(base)


def pow_scale(exponent: float) -> PowerScale:
    """
    A power axis: a value ``v`` sits at ``v ** exponent``, keeping its sign.
    An exponent above 1 spreads out large values, and below 1, such as 0.5 for
    a square root, small ones.

    Args:
        exponent: The power each value is raised to.

    Returns:
        The scale, to pass as ``x_scale`` or ``y_scale``.
    """
    return PowerScale(exponent)


def breaks_scale(breaks: Sequence[tuple[Any, Any]]) -> BreaksScale:
    """
    An axis with ranges removed, so the values either side of each sit next
    to each other.

    Args:
        breaks: The ``(start, end)`` ranges to remove, as numbers for a
            numeric column, or times for an ``Instant`` column: ISO 8601
            strings, ``datetime`` objects with a time zone, Java ``Instant``
            objects, or epoch nanoseconds.

    Returns:
        The scale, to pass as ``x_scale``.
    """
    if isinstance(breaks, (str, Mapping)):
        raise ValueError(
            f"breaks must be a sequence of (start, end) pairs, got {breaks!r}"
        )
    pairs = list(breaks)
    is_time = any(
        not isinstance(value, (int, float)) or isinstance(value, bool)
        for pair in pairs
        for value in pair
    )
    parsed = []
    for pair in pairs:
        if len(pair) != 2:
            raise ValueError(f"Each break is a (start, end) pair, got {pair!r}")
        start, end = (
            (_epoch_nanos(v) for v in pair) if is_time else (float(v) for v in pair)
        )
        if not end > start:
            raise ValueError(f"A break must end after it starts, got {pair!r}")
        parsed.append((start, end))
    return BreaksScale(sorted(parsed), is_time)


def _check_time(value: str) -> str:
    if not isinstance(value, str) or not _TIME_PATTERN.match(value):
        raise ValueError(f"Expected a time as HH:MM, got {value!r}")
    return value


def _parse_sessions(sessions: Sequence[Sequence[str]]) -> list[list[str]]:
    if isinstance(sessions, str):
        raise ValueError(
            f"sessions must be a sequence of (open, close) pairs, got {sessions!r}"
        )
    parsed = []
    for session in sessions:
        if len(session) != 2:
            raise ValueError(f"Each session is an (open, close) pair, got {session!r}")
        open_time, close_time = (_check_time(t) for t in session)
        if not _seconds(close_time) > _seconds(open_time):
            raise ValueError(f"A session must close after it opens, got {session!r}")
        parsed.append([open_time, close_time])
    return parsed


def _seconds(time: str) -> int:
    parts = [int(p) for p in time.split(":")]
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] if len(parts) > 2 else 0)


def _time_text(local_time: Any) -> str:
    """A Java LocalTime as HH:MM or HH:MM:SS, dropping fractions of a second."""
    text = str(local_time.toString())
    return text.split(".")[0]


def _spec_from_calendar(calendar: Any) -> dict[str, Any]:
    """Describes a Deephaven business calendar for the client."""
    zone = calendar.timeZone()
    # Ranges are generic, so jpy sees Comparable until they are cast
    instant = jpy.get_type("java.time.Instant")

    def local_time(value: Any) -> str:
        return _time_text(jpy.cast(value, instant).atZone(zone).toLocalTime())

    sessions = [
        [_time_text(r.start()), _time_text(r.end())]
        for r in calendar.standardBusinessDay().businessTimeRanges().toArray()
    ]
    weekend = {int(day.getValue()) % 7 for day in calendar.weekendDays().toArray()}
    holidays: dict[str, list[list[str]]] = {}
    entries = calendar.holidays().entrySet().iterator()
    while entries.hasNext():
        entry = entries.next()
        holidays[str(entry.getKey().toString())] = [
            [local_time(r.start()), local_time(r.end())]
            for r in entry.getValue().businessTimeRanges().toArray()
        ]
    return {
        "type": "calendar",
        "timeZone": str(zone.getId()),
        "sessions": sessions,
        "businessDays": [day for day in range(7) if day not in weekend],
        "holidays": holidays,
    }


def _calendar_xml(
    time_zone: str,
    sessions: list[list[str]],
    business_days: list[int],
    holidays: Mapping[str, list[list[str]]],
) -> str:
    def business_time(ranges: list[list[str]]) -> str:
        return "".join(
            f"<businessTime><open>{escape(o)}</open><close>{escape(c)}</close></businessTime>"
            for o, c in ranges
        )

    weekend = "".join(
        f"<weekend>{_DAY_NAMES[day]}</weekend>"
        for day in range(7)
        if day not in business_days
    )
    holiday_xml = "".join(
        f"<holiday><date>{escape(day)}</date>{business_time(ranges)}</holiday>"
        for day, ranges in sorted(holidays.items())
    )
    return (
        "<calendar>"
        "<name>GIGAPLOT</name>"
        f"<timeZone>{escape(time_zone)}</timeZone>"
        "<description>A gigaplot axis calendar</description>"
        "<firstValidDate>1900-01-01</firstValidDate>"
        "<lastValidDate>2199-12-31</lastValidDate>"
        f"<default>{business_time(sessions)}{weekend}</default>"
        f"{holiday_xml}"
        "</calendar>"
    )


def calendar_scale(
    calendar: str | Any | None = None,
    time_zone: str = "America/New_York",
    sessions: Sequence[Sequence[str]] = (("09:30", "16:00"),),
    business_days: Sequence[int] = (1, 2, 3, 4, 5),
    holidays: Sequence[str] | Mapping[str, Sequence[Sequence[str]]] = (),
) -> CalendarScale:
    """
    A time axis without the time between business sessions: nights,
    weekends, and holidays. The close of one session sits right beside the
    open of the next, so a line of market data runs on without gaps, and
    ticks fall on times within sessions or on the opens of days, weeks, and
    months. Values outside sessions sit at the next open.

    Use a Deephaven business calendar, or describe one. Numeric columns are
    read as epoch milliseconds.

    Examples:
        The New York Stock Exchange example calendar::

            calendar_scale("USNYSE_EXAMPLE")

        A market with a lunch break, closed on New Year's Day::

            calendar_scale(
                time_zone="Asia/Tokyo",
                sessions=[("09:00", "11:30"), ("12:30", "15:00")],
                holidays=["2026-01-01"],
            )

    Args:
        calendar: The name of a Deephaven business calendar, such as
            ``"USNYSE_EXAMPLE"``, or a business calendar from
            ``deephaven.calendar``. Its time zone, sessions, weekend, and
            holidays are used, and the other arguments are ignored.
        time_zone: The IANA time zone of the sessions.
        sessions: The ``(open, close)`` local times of each session in a
            normal business day, as ``HH:MM`` or ``HH:MM:SS``, in order.
        business_days: The days with sessions, 0 for Sunday to 6 for Saturday.
        holidays: Dates as ``YYYY-MM-DD`` with no sessions, or a mapping of
            dates to their own sessions, such as a half day. An empty list
            closes the day.

    Returns:
        The scale, to pass as ``x_scale``.
    """
    if calendar is not None:
        if isinstance(calendar, str):
            from deephaven.calendar import calendar as get_calendar

            calendar = get_calendar(calendar)
        return CalendarScale(calendar, _spec_from_calendar(calendar))

    parsed_sessions = _parse_sessions(sessions)
    days = sorted({int(day) for day in business_days})
    if any(day < 0 or day > 6 for day in days):
        raise ValueError(
            f"business_days must be from 0 to 6, got {list(business_days)}"
        )
    if isinstance(holidays, Mapping):
        parsed_holidays = {
            str(day): _parse_sessions(ranges) for day, ranges in holidays.items()
        }
    elif isinstance(holidays, str):
        raise ValueError(f"holidays must be a sequence of dates, got {holidays!r}")
    else:
        parsed_holidays = {str(day): [] for day in holidays}
    for day in parsed_holidays:
        date.fromisoformat(day)
    zone_id = jpy.get_type("java.time.ZoneId")
    zone_id.of(time_zone)

    xml = _calendar_xml(time_zone, parsed_sessions, days, parsed_holidays)
    handle, path = tempfile.mkstemp(suffix=".calendar")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            file.write(xml)
        parser = jpy.get_type("io.deephaven.time.calendar.BusinessCalendarXMLParser")
        java_calendar = parser.loadBusinessCalendar(path)
    finally:
        os.remove(path)
    return CalendarScale(
        java_calendar,
        {
            "type": "calendar",
            "timeZone": time_zone,
            "sessions": parsed_sessions,
            "businessDays": days,
            "holidays": parsed_holidays,
        },
    )
