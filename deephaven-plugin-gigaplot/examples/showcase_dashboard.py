"""
A deephaven.ui dashboard showing off gigaplot: live ticking markets, tens of
millions of rows, every 2D plot type, axis scales, and 3D.

Run it in the console of a Deephaven server with the plugin installed. The
large tables need several GB of heap, such as `--jvm-args=-Xmx8g`.
"""

from deephaven import agg, empty_table, new_table, time_table
from deephaven import ui
from deephaven.calendar import calendar
from deephaven.column import double_col
from deephaven.updateby import cum_sum, rolling_avg_tick, rolling_std_tick
import deephaven_plugin_gigaplot as gp

SYMBOLS = ["NOVA", "APEX", "FLUX", "ZEN"]
START_PRICES = {s: 100 + 40 * i for i, s in enumerate(SYMBOLS)}
POSITIVE = "#9bd96c"
NEGATIVE = "#f85e85"

# ---------------------------------------------------------------------------
# Live data: four correlated random walks ticking 20 times a second
# ---------------------------------------------------------------------------

market = (
    time_table("PT0.05s")
    .update(
        ["Market = randomGaussian(0.0, 0.06)"]
        + [
            f"{s}_Chg = Market * {0.6 + 0.3 * i} + randomGaussian(0.0, {0.02 + 0.01 * i})"
            for i, s in enumerate(SYMBOLS)
        ]
        + [
            "N = epochMillis(Timestamp) / 50.0",
            "Lit = 400 + 250 * Math.sin(N / 300.0) + randomGaussian(0.0, 30.0)",
            "Dark = 250 + 150 * Math.cos(N / 450.0) + randomGaussian(0.0, 25.0)",
            "Auction = 120 + 100 * Math.abs(Math.sin(N / 120.0)) + randomGaussian(0.0, 15.0)",
            "Retail = 180 + 60 * Math.sin(N / 90.0 + 1) + randomGaussian(0.0, 20.0)",
        ]
    )
    .update_by(cum_sum([f"{s}_Walk = {s}_Chg" for s in SYMBOLS]))
    .update([f"{s} = {START_PRICES[s]} * Math.exp({s}_Walk / 25.0)" for s in SYMBOLS])
    .update_by(
        [rolling_avg_tick(f"{s}_Fast = {s}", rev_ticks=40) for s in SYMBOLS]
        + [rolling_avg_tick(f"{s}_Slow = {s}", rev_ticks=200) for s in SYMBOLS]
        + [rolling_std_tick(f"{s}_Vol = {s}", rev_ticks=100) for s in SYMBOLS]
    )
    .update(
        # The deviation of a single row is NaN, which would make the bands' bounds NaN too
        [f"{s}_Vol = isNaN({s}_Vol) ? NULL_DOUBLE : {s}_Vol" for s in SYMBOLS]
        + [f"{s}_Upper = {s}_Slow + 2 * {s}_Vol" for s in SYMBOLS]
        + [f"{s}_Lower = {s}_Slow - 2 * {s}_Vol" for s in SYMBOLS]
        + [f"{s}_Ret = {s}_Chg * 100.0" for s in SYMBOLS]
        + [f"{s}_PnL = ({s} - {START_PRICES[s]}) * 1000.0" for s in SYMBOLS]
    )
)
last_prices = market.view(SYMBOLS).last_by()
tick_count = market.count_by("Ticks")


def live_bars(symbol: str, seconds: int):
    """Resamples the ticking prices of a symbol into bars."""
    return market.update_view(f"Bar = lowerBin(Timestamp, {seconds} * SECOND)").agg_by(
        [
            agg.first(f"Open = {symbol}"),
            agg.max_(f"High = {symbol}"),
            agg.min_(f"Low = {symbol}"),
            agg.last(f"Close = {symbol}"),
        ],
        by="Bar",
    )


# ---------------------------------------------------------------------------
# Big static data
# ---------------------------------------------------------------------------

# 50 million rows: a slow wave with fast ripples and noise
waves = empty_table(50_000_000).update(
    [
        "X = ii",
        "Signal = Math.sin(ii / 1.0e6) + Math.sin(ii / 997.0) * 0.1 + randomGaussian(0.0, 0.02)",
        "Envelope = Math.cos(ii / 3.0e6)",
    ]
)

# 20 million seconds of a random walk
history = (
    empty_table(20_000_000)
    .update(
        [
            "Timestamp = '2024-01-01T00:00:00Z' + ii * SECOND",
            "Change = randomGaussian(0.0, 0.05)",
        ]
    )
    .update_by(cum_sum("Walk = Change"))
    .update("Price = 500.0 + Walk")
)

# A week of one second ticks, resampled into minute bars
minute_bars = (
    empty_table(7 * 24 * 60 * 60)
    .update(
        [
            "Timestamp = '2024-01-01T00:00:00Z' + ii * SECOND",
            "Change = randomGaussian(0.0, 0.02)",
        ]
    )
    .update_by(cum_sum("Walk = Change"))
    .update("Price = 100.0 + Walk")
    .update_view("Minute = lowerBin(Timestamp, MINUTE)")
    .agg_by(
        [
            agg.first("Open = Price"),
            agg.max_("High = Price"),
            agg.min_("Low = Price"),
            agg.last("Close = Price"),
        ],
        by="Minute",
    )
)

# 6 million stars in a three armed spiral galaxy, one series per arm
galaxy = empty_table(6_000_000).update(
    [
        "Arm = (int) (ii % 3)",
        "R = 0.3 + Math.pow(random(), 0.7) * 10.0",
        "Theta = R * 0.7 + Arm * 2.0 * Math.PI / 3.0 + randomGaussian(0.0, 0.1 + 0.3 / (R + 1.0))",
        "X = R * Math.cos(Theta) + randomGaussian(0.0, 0.12)",
        "Y = R * Math.sin(Theta) + randomGaussian(0.0, 0.12)",
        "Arm1 = Arm == 0 ? Y : NULL_DOUBLE",
        "Arm2 = Arm == 1 ? Y : NULL_DOUBLE",
        "Arm3 = Arm == 2 ? Y : NULL_DOUBLE",
    ]
)

# A week of web traffic, one row per minute
traffic = empty_table(7 * 1440).update(
    [
        "Timestamp = '2024-01-01T00:00:00Z' + ii * MINUTE",
        "Web = 50 + 30 * Math.sin(ii / 1440.0 * 2 * Math.PI) + randomGaussian(0.0, 5.0)",
        "Mobile = 80 + 40 * Math.sin(ii / 1440.0 * 2 * Math.PI + 1) + randomGaussian(0.0, 5.0)",
        "Api = 20 + randomGaussian(0.0, 2.0)",
    ]
)

# Compound growth over 50 years, straight lines on a log axis
growth = empty_table(600).update(
    [
        "Year = ii / 12.0",
        "Cash = 1000 * Math.pow(1.0015, ii)",
        "Bonds = 1000 * Math.pow(1.0035, ii)",
        "Stocks = 1000 * Math.pow(1.007, ii) * (1 + 0.15 * Math.sin(ii / 30.0))",
    ]
)

# Minute bars ticking in only during NYSE sessions, with a gap at each open
nyse = calendar("USNYSE_EXAMPLE")
sessions = (
    time_table("PT0.01s")
    .update(
        [
            "Bar = ii",
            "Timestamp = nyse.plusBusinessDays('2026-01-05T09:30:00 ET', (int) (Bar / 390)) + (Bar % 390) * MINUTE",
            "Change = randomGaussian(0.0, 0.05) + (Bar % 390 == 0 ? randomGaussian(0.0, 0.8) : 0.0)",
        ]
    )
    .update_by(cum_sum("Walk = Change"))
    .update("Price = 100.0 + Walk")
)

# ---------------------------------------------------------------------------
# 3D data
# ---------------------------------------------------------------------------


def lorenz(steps: int = 30_000, dt: float = 0.005):
    """Integrates the Lorenz attractor."""
    x, y, z = 0.1, 0.0, 0.0
    xs, ys, zs = [], [], []
    for _ in range(steps):
        dx = 10.0 * (y - x)
        dy = x * (28.0 - z) - y
        dz = x * y - 8.0 / 3.0 * z
        x, y, z = x + dx * dt, y + dy * dt, z + dz * dt
        xs.append(x)
        ys.append(y)
        zs.append(z)
    return new_table(
        [double_col("X", xs), double_col("Y", ys), double_col("Attractor", zs)]
    )


attractor = lorenz()

# One row holding the time, so every point moves on each tick
clock = time_table("PT0.05s").last_by().view("T = epochMillis(Timestamp) / 1000.0")

star_field = (
    empty_table(4000)
    .update(
        [
            "X = Math.random() * 2 - 1",
            "Y = Math.random() * 2 - 1",
            "Z0 = Math.random() * 2",
        ]
    )
    .join(clock)
    .update_view("Stars = (Z0 + T * 0.4) % 2.0 - 1.0")
)

GRID = 70
ripple = (
    empty_table(GRID * GRID)
    .update(
        [
            f"X = (ii % {GRID}) / {GRID / 2.0} - 1.0",
            f"Y = ((long) (ii / {GRID})) / {GRID / 2.0} - 1.0",
            "R = Math.sqrt(X * X + Y * Y)",
        ]
    )
    .join(clock)
    .update_view("Surface = Math.sin(R * 14.0 - T * 4.0) * Math.exp(-R * 1.8) * 0.6")
)

clusters = empty_table(6000).update(
    [
        "X = randomGaussian(ii % 3 * 4.0, 1.0)",
        "Y = randomGaussian(ii % 3 == 1 ? 3.0 : 0.0, 1.0)",
        "Z = randomGaussian(ii % 3 == 2 ? 4.0 : 0.0, 1.0)",
        "Alpha = ii % 3 == 0 ? Z : NULL_DOUBLE",
        "Beta = ii % 3 == 1 ? Z : NULL_DOUBLE",
        "Gamma = ii % 3 == 2 ? Z : NULL_DOUBLE",
    ]
)

# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------


def tile(*children):
    return ui.view(
        ui.flex(*children, direction="column", gap="size-50"),
        background_color="gray-100",
        border_radius="large",
        border_width="thin",
        border_color="gray-300",
        padding_x="size-200",
        padding_y="size-150",
        min_width="size-2000",
    )


def ticker_tile(symbol: str, price: float | None):
    if price is None:
        return tile(
            ui.text(symbol, color="gray-700"), ui.heading("…", level=2, margin=0)
        )
    change = (price / START_PRICES[symbol] - 1.0) * 100.0
    up = change >= 0
    return tile(
        ui.flex(
            ui.text(symbol, color="gray-700"),
            ui.badge(
                f"{'▲' if up else '▼'} {abs(change):.2f}%",
                variant="positive" if up else "negative",
            ),
            justify_content="space-between",
            align_items="center",
            gap="size-200",
        ),
        ui.heading(f"{price:,.2f}", level=2, margin=0),
    )


@ui.component
def header():
    last = ui.use_row_data(last_prices) or {}
    ticks = ui.use_cell_data(tick_count) or 0

    return ui.flex(
        ui.flex(
            ui.flex(
                ui.heading("gigaplot", level=1, margin=0),
                ui.badge("● LIVE", variant="positive"),
                align_items="center",
                gap="size-150",
            ),
            ui.text(
                "WebGPU plotting for Deephaven: ticking tables, server side downsampling of tens of millions of "
                "rows, OHLC and candles, stacked and gradient areas, market hours, log scales, and 3D.",
                color="gray-700",
            ),
            ui.flex(
                ui.badge(f"{ticks:,} live ticks", variant="info"),
                ui.badge("50M row line", variant="purple"),
                ui.badge("20M seconds", variant="indigo"),
                ui.badge("6M point scatter", variant="fuchsia"),
                ui.badge("3D", variant="seafoam"),
                gap="size-100",
                wrap=True,
            ),
            direction="column",
            gap="size-100",
            flex_grow=1,
            min_width="size-4600",
        ),
        *[ticker_tile(s, last.get(s)) for s in SYMBOLS],
        align_items="center",
        gap="size-200",
        wrap=True,
        width="100%",
    )


CHART_TYPES = ["Candles", "OHLC", "Line", "Bands"]
BAR_SECONDS = [1, 2, 5, 15]


@ui.component
def live_markets():
    symbol, set_symbol = ui.use_state(SYMBOLS[0])
    chart, set_chart = ui.use_state("Candles")
    seconds, set_seconds = ui.use_state(2)

    bars = ui.use_memo(lambda: live_bars(symbol, seconds), [symbol, seconds])

    if chart == "Line":
        plot = gp.line(
            market,
            x="Timestamp",
            y=[symbol, f"{symbol}_Fast", f"{symbol}_Slow"],
            title=f"{symbol} with moving averages",
            y_title="Price",
            legend_position="right",
            tooltip=["markers", "guides", "x_axis_label", "y_axis_labels"],
        )
    elif chart == "Bands":
        plot = gp.line(
            market,
            x="Timestamp",
            y=[f"{symbol}_Upper", symbol, f"{symbol}_Slow", f"{symbol}_Lower"],
            title=f"{symbol} Bollinger bands",
            y_title="Price",
            legend_position="right",
        )
    else:
        bar_plot = gp.ohlc if chart == "OHLC" else gp.candlestick
        plot = bar_plot(
            bars,
            x="Bar",
            open="Open",
            high="High",
            low="Low",
            close="Close",
            title=f"{symbol} {seconds}s {chart.lower()}",
        )

    return ui.flex(
        ui.flex(
            ui.picker(
                *SYMBOLS,
                label="Symbol",
                label_position="side",
                selected_key=symbol,
                on_change=set_symbol,
            ),
            ui.action_group(
                *[ui.item(c, key=c) for c in CHART_TYPES],
                selection_mode="single",
                disallow_empty_selection=True,
                selected_keys=[chart],
                on_change=lambda keys: set_chart(next(iter(keys))) if keys else None,
                density="compact",
            ),
            ui.picker(
                *[ui.item(f"{s}s", key=str(s)) for s in BAR_SECONDS],
                label="Bar",
                label_position="side",
                selected_key=str(seconds),
                on_change=lambda key: set_seconds(int(key)),
                is_disabled=chart not in ("Candles", "OHLC"),
            ),
            gap="size-200",
            align_items="center",
            wrap=True,
            flex_grow=0,
        ),
        ui.view(plot, flex_grow=1, flex_basis=0, min_height=0, width="100%"),
        direction="column",
        gap="size-100",
        height="100%",
        width="100%",
    )


def plot_panel(plot, title: str):
    return ui.panel(plot, title=title, padding="size-50", align_items="stretch")


def tabs(*panels):
    """A stack that opens on its first panel, rather than its last."""
    return ui.stack(*panels, active_item_index=0)


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

all_symbols_plot = gp.line(
    market,
    x="Timestamp",
    y=SYMBOLS,
    title="All symbols, log scale",
    y_scale="log",
    legend_position="right",
)

# How far the P&L has gone above and below zero, rounded up to a power of root two,
# so the gradient below only changes, and recreates the plot, now and then
pnl_extent = market.agg_by(
    [agg.min_("Low = NOVA_PnL"), agg.max_("High = NOVA_PnL")]
).view(
    [
        f"{name} = 500.0 * Math.pow(2.0, Math.ceil(2.0 * Math.log(Math.max({value}, 500.0) / 500.0) / Math.log(2.0)) / 2.0)"
        for name, value in [("Below", "-Low"), ("Above", "High")]
    ]
)


@ui.component
def pnl_plot():
    extent = ui.use_row_data(pnl_extent) or {}
    below = extent.get("Below") or 500.0
    above = extent.get("Above") or 500.0
    # Green above zero and red below, strongest at the extremes and clear at zero
    fill = gp.linear_gradient(
        [
            {"offset": -below, "color": NEGATIVE, "opacity": 0.9},
            {"offset": 0, "color": NEGATIVE, "opacity": 0},
            {"offset": 0, "color": POSITIVE, "opacity": 0},
            {"offset": above, "color": POSITIVE, "opacity": 0.9},
        ],
        units="data",
    )
    return gp.area(
        market,
        x="Timestamp",
        y="NOVA_PnL",
        stacked=False,
        title="NOVA P&L",
        y_title="USD",
        fill=fill,
    )


returns_plot = gp.scatter(
    market,
    x="NOVA_Ret",
    y=["APEX_Ret", "FLUX_Ret", "ZEN_Ret"],
    title="Tick returns vs NOVA",
    x_title="NOVA %",
    y_title="%",
)

flow_plot = gp.area(
    market,
    x="Timestamp",
    y=["Lit", "Dark", "Auction", "Retail"],
    title="Live volume by venue",
    fill=gp.linear_gradient([{"opacity": 0.85}, {"opacity": 0}]),
)

flow_share_plot = gp.area(
    market,
    x="Timestamp",
    y=["Lit", "Dark", "Auction", "Retail"],
    groupnorm="percent",
    title="Venue share",
    y_title="%",
)

waves_plot = gp.line(
    waves, x="X", y=["Signal", "Envelope"], title="50 million rows, zoom in for detail"
)

history_plot = gp.area(
    history,
    x="Timestamp",
    y="Price",
    stacked=False,
    title="20 million seconds, zoom down to the second",
    fill=gp.linear_gradient([{"opacity": 0.6}, {"opacity": 0}]),
)

galaxy_plot = gp.scatter(
    galaxy,
    x="X",
    y=["Arm1", "Arm2", "Arm3"],
    title="6 million stars",
    x_title="",
    y_title="",
)

minute_plot = gp.candlestick(
    minute_bars,
    x="Minute",
    open="Open",
    high="High",
    low="Low",
    close="Close",
    title="A week of minute bars",
)

business_plot = gp.line(
    sessions,
    x="Timestamp",
    y="Price",
    title="NYSE business hours only",
    x_scale=gp.calendar_scale(nyse),
)
clock_plot = gp.line(
    sessions, x="Timestamp", y="Price", title="The same prices in clock time"
)

growth_plot = gp.line(
    growth,
    x="Year",
    y=["Cash", "Bonds", "Stocks"],
    title="Growth of $1,000 on a log axis",
    y_scale="log",
)

traffic_plot = gp.area(
    traffic, x="Timestamp", y=["Web", "Mobile", "Api"], title="Requests, stacked"
)

star_plot = gp.scatter3d(
    star_field,
    x="X",
    y="Y",
    z="Stars",
    color="white",
    size=2,
    camera={"azimuth": -90, "elevation": 90, "distance": 1, "fov": 60},
    show_axes=False,
    point_scaling="perspective",
    depth_fade=1,
    x_range=(-1, 1),
    y_range=(-1, 1),
    z_range=(-1, 1),
)

ripple_plot = gp.scatter3d(
    ripple,
    x="X",
    y="Y",
    z="Surface",
    z_title="Z",
    color="#4cc9f0",
    size=2.5,
    title="Ripple",
    point_scaling="perspective",
    depth_fade=0.5,
    x_range=(-1, 1),
    y_range=(-1, 1),
    z_range=(-0.8, 0.8),
)

lorenz_plot = gp.line3d(
    attractor,
    x="X",
    y="Y",
    z="Attractor",
    z_title="Z",
    color="#f72585",
    width=1.5,
    title="Lorenz",
    depth_fade=0.6,
)

clusters_plot = gp.scatter3d(
    clusters,
    x="X",
    y="Y",
    z=["Alpha", "Beta", "Gamma"],
    z_title="Z",
    size=3,
    title="Clusters",
    point_scaling="perspective",
)

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

showcase = ui.dashboard(
    ui.column(
        ui.row(
            ui.panel(header(), title="gigaplot showcase", padding="size-200"), height=16
        ),
        ui.row(
            ui.column(
                tabs(
                    plot_panel(live_markets(), "Live markets"),
                    plot_panel(all_symbols_plot, "All symbols"),
                ),
                ui.row(
                    tabs(
                        plot_panel(pnl_plot(), "P&L"),
                        plot_panel(returns_plot, "Returns"),
                    ),
                    tabs(
                        plot_panel(flow_plot, "Venues"),
                        plot_panel(flow_share_plot, "Venue share"),
                    ),
                ),
                width=46,
            ),
            ui.column(
                tabs(
                    plot_panel(waves_plot, "50M rows"),
                    plot_panel(history_plot, "20M seconds"),
                    plot_panel(galaxy_plot, "Galaxy"),
                    plot_panel(minute_plot, "Minute bars"),
                ),
                tabs(
                    plot_panel(business_plot, "Market hours"),
                    plot_panel(clock_plot, "Clock time"),
                    plot_panel(growth_plot, "Log scale"),
                    plot_panel(traffic_plot, "Stacked area"),
                ),
                width=30,
            ),
            ui.column(
                tabs(
                    plot_panel(star_plot, "Star field"),
                    plot_panel(clusters_plot, "Clusters"),
                ),
                tabs(
                    plot_panel(ripple_plot, "Ripple"), plot_panel(lorenz_plot, "Lorenz")
                ),
                width=24,
            ),
        ),
    )
)
