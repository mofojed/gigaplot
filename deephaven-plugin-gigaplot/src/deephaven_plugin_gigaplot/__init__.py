"""
A Deephaven element plugin for plotting tables with gigaplot
"""

from .gigaplot import (
    Camera,
    Fill,
    GradientStop,
    LegendPosition,
    LinearGradient,
    PointScaling,
    TooltipPart,
    area,
    candlestick,
    line,
    line3d,
    linear_gradient,
    ohlc,
    scatter,
    scatter3d,
)
from .scales import (
    BreaksScale,
    CalendarScale,
    ExponentialScale,
    LogScale,
    PowerScale,
    Scale,
    ScaleLike,
    breaks_scale,
    calendar_scale,
    exp_scale,
    log_scale,
    pow_scale,
)
from .downsample import (
    Downsampler,
    Viewport,
    area_bounds,
    bounds,
    downsample,
    downsample_line,
    downsample_ohlc,
    downsample_scatter,
    ohlc_bounds,
)
