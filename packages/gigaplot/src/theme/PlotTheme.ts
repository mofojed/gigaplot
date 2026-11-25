import { isOhlcSeriesType, type PlotSeriesType } from '../model/PlotTypes';

/** Space reserved outside the data area, in pixels. */
export interface PlotMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Everything that controls how a plot looks. Every renderer and the axis
 * painter read from this, so nothing visual is hard coded elsewhere.
 *
 * The defaults match the `@deephaven/components` dark theme. In a page that
 * defines the Deephaven chart CSS variables the plot follows those instead; see
 * {@link PLOT_THEME_CSS_VARIABLES}.
 */
export interface PlotTheme {
  /** Background of the whole plot, including the axis margins. */
  backgroundColor: string;
  /** Background of the data area only. */
  plotBackgroundColor: string;
  gridColor: string;
  gridLineWidth: number;
  /** Border drawn around the data area. */
  axisColor: string;
  axisLineWidth: number;
  tickLabelColor: string;
  /** Gap in pixels between the data area and the y axis tick labels. */
  tickLabelPadding: number;
  legendTextColor: string;
  /** Edge length in pixels of the colored square beside each legend entry. */
  legendSwatchSize: number;
  /** Horizontal space in pixels between legend entries. */
  legendItemGap: number;
  axisTitleColor: string;
  /** Font size in pixels for axis titles. */
  axisTitleFontSize: number;
  /** Space in pixels on each side of an axis title, across the axis. */
  axisTitlePadding: number;
  fontFamily: string;
  /** Font size in pixels for tick labels and the legend. */
  fontSize: number;
  /** Series colors, assigned by index when a series has no explicit color. */
  colorway: string[];
  /** Default line width in pixels for `line` and `area` series. */
  lineWidth: number;
  /** Default point diameter in pixels for `scatter` series. */
  pointSize: number;
  /**
   * Opacity of an `area` series' fill when it has no `fill` of its own, which
   * is then its line color.
   */
  areaFillOpacity: number;
  /** Color of `ohlc` and `candlestick` bars that close at or above their open. */
  ohlcIncreasingColor: string;
  /** Color of `ohlc` and `candlestick` bars that close below their open. */
  ohlcDecreasingColor: string;
  /**
   * Width of an `ohlc` bar's ticks, or a `candlestick` body, as a fraction of
   * the smallest x spacing between bars.
   */
  ohlcBarWidth: number;
  /** Background of the tooltip box and the axis label for the hovered x. */
  tooltipBackgroundColor: string;
  tooltipTextColor: string;
  /** Border of the tooltip box and the axis label for the hovered x. */
  tooltipBorderColor: string;
  /** Space in pixels between the edge of a tooltip or hover label and its text. */
  tooltipPadding: number;
  /** Gap in pixels between the cursor and the tooltip box. */
  tooltipOffset: number;
  /** Diameter in pixels of the marker drawn on each hovered point. */
  hoverMarkerSize: number;
  /** Width in pixels of the guide lines from hovered points to the axes. */
  hoverGuideWidth: number;
  /** Dash pattern of the hover guide lines, as for `setLineDash`. */
  hoverGuideDash: number[];
  /**
   * How far in pixels the cursor may be from a scatter point, beyond its
   * edge, to hover it. Lines snap to the cursor's x within this distance of
   * their ends.
   */
  hoverDistance: number;
  /**
   * Space reserved outside the data area for tick labels. Axis titles get
   * extra space on top of this as needed.
   */
  margin: PlotMargin;
}

/** A partial theme. `margin` may also be partial; its sides merge individually. */
export type PlotThemeOverrides = Partial<Omit<PlotTheme, 'margin'>> & {
  margin?: Partial<PlotMargin>;
};

/** The `@deephaven/components` dark theme with its CSS variables resolved. */
export const defaultPlotTheme: Readonly<PlotTheme> = Object.freeze({
  backgroundColor: '#2d2a2e',
  plotBackgroundColor: '#322f33',
  gridColor: '#403e41',
  gridLineWidth: 1,
  axisColor: '#5b5a5c',
  axisLineWidth: 1,
  tickLabelColor: '#c0bfbf',
  tickLabelPadding: 6,
  legendTextColor: '#f0f0ee',
  legendSwatchSize: 8,
  legendItemGap: 16,
  axisTitleColor: '#f0f0ee',
  axisTitleFontSize: 12,
  axisTitlePadding: 4,
  fontFamily:
    "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
  fontSize: 11,
  colorway: Object.freeze([
    '#74d6e1',
    '#9bd96c',
    '#fad459',
    '#cac1fe',
    '#fa8648',
    '#f85e85',
    '#c2d153',
    '#c592e5',
    '#5edeb8',
    '#ee83ba',
    '#f0f0ee',
  ]) as string[],
  lineWidth: 1.5,
  pointSize: 5,
  areaFillOpacity: 0.5,
  ohlcIncreasingColor: '#9bd96c',
  ohlcDecreasingColor: '#f85e85',
  ohlcBarWidth: 0.6,
  tooltipBackgroundColor: '#403e41',
  tooltipTextColor: '#f0f0ee',
  tooltipBorderColor: '#5b5a5c',
  tooltipPadding: 6,
  tooltipOffset: 12,
  hoverMarkerSize: 8,
  hoverGuideWidth: 1,
  hoverGuideDash: Object.freeze([3, 3]) as number[],
  hoverDistance: 6,
  margin: Object.freeze({ top: 16, right: 16, bottom: 32, left: 56 }),
});

/**
 * The CSS custom properties read for each theme property. These are the same
 * variables `@deephaven/chart` reads, so a gigaplot matches the other charts in
 * a Deephaven theme, including custom themes.
 *
 * `colorway` is a whitespace separated list of colors.
 */
export const PLOT_THEME_CSS_VARIABLES = Object.freeze({
  backgroundColor: '--dh-color-chart-bg',
  plotBackgroundColor: '--dh-color-chart-plot-bg',
  gridColor: '--dh-color-chart-grid',
  axisColor: '--dh-color-chart-axis-line',
  // @deephaven/chart colors tick labels with the zero line color
  tickLabelColor: '--dh-color-chart-axis-line-zero',
  legendTextColor: '--dh-color-chart-legend-fg',
  // @deephaven/chart colors axis titles with the title color
  axisTitleColor: '--dh-color-chart-title',
  colorway: '--dh-color-chart-colorway',
  ohlcIncreasingColor: '--dh-color-chart-ohlc-increase',
  ohlcDecreasingColor: '--dh-color-chart-ohlc-decrease',
  // Deephaven has no chart specific tooltip colors, so match its other tooltips
  tooltipBackgroundColor: '--dh-color-tooltip-bg',
  tooltipTextColor: '--dh-color-tooltip-fg',
  // Outlined like the plot area, so hover labels sit in with the axes
  tooltipBorderColor: '--dh-color-chart-axis-line',
} as const);

/**
 * Splits a list of CSS colors separated by whitespace or commas, keeping
 * functional notations like `rgb(1, 2, 3)` intact.
 */
export function splitColorList(value: string): string[] {
  const colors: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current !== '') {
        colors.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current !== '') {
    colors.push(current);
  }
  return colors;
}

/**
 * Merges overrides onto a base theme, left to right. Unset values are ignored,
 * as is an empty colorway, since series need at least one color to cycle.
 */
export function createPlotTheme(
  ...overrides: (PlotThemeOverrides | null | undefined)[]
): PlotTheme {
  const theme: PlotTheme = {
    ...defaultPlotTheme,
    colorway: [...defaultPlotTheme.colorway],
    margin: { ...defaultPlotTheme.margin },
  };
  for (let i = 0; i < overrides.length; i += 1) {
    const override = overrides[i];
    if (override != null) {
      const { margin, colorway, ...rest } = override;
      const keys = Object.keys(rest) as (keyof typeof rest)[];
      for (let k = 0; k < keys.length; k += 1) {
        const value = rest[keys[k]];
        if (value !== undefined) {
          (theme as unknown as Record<string, unknown>)[keys[k]] = value;
        }
      }
      if (colorway != null && colorway.length > 0) {
        theme.colorway = [...colorway];
      }
      if (margin != null) {
        const sides = Object.keys(margin) as (keyof PlotMargin)[];
        for (let s = 0; s < sides.length; s += 1) {
          const side = margin[sides[s]];
          if (side !== undefined) {
            theme.margin[sides[s]] = side;
          }
        }
      }
    }
  }
  return theme;
}

/**
 * Reads the theme properties set through {@link PLOT_THEME_CSS_VARIABLES} that
 * are in scope for `element`. Variables that are unset are left out.
 */
export function readPlotThemeFromElement(element: Element): PlotThemeOverrides {
  const computed = getComputedStyle(element);
  const overrides: Record<string, unknown> = {};
  const entries = Object.entries(PLOT_THEME_CSS_VARIABLES);
  for (let i = 0; i < entries.length; i += 1) {
    const [key, variable] = entries[i];
    const value = computed.getPropertyValue(variable).trim();
    if (value !== '') {
      overrides[key] = key === 'colorway' ? splitColorList(value) : value;
    }
  }
  return overrides as PlotThemeOverrides;
}

/**
 * Builds a theme from the Deephaven CSS variables in scope for `element`, then
 * applies `overrides`. Anything not set by either uses {@link defaultPlotTheme}.
 */
export function createPlotThemeFromElement(
  element: Element,
  overrides?: PlotThemeOverrides | null
): PlotTheme {
  return createPlotTheme(readPlotThemeFromElement(element), overrides);
}

/** True if both themes would draw identically. */
export function plotThemesEqual(a: PlotTheme, b: PlotTheme): boolean {
  if (a === b) {
    return true;
  }
  const keys = Object.keys(a) as (keyof PlotTheme)[];
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every(key => {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      return (
        left.length === right.length &&
        left.every((value, i) => value === right[i])
      );
    }
    if (key === 'margin') {
      return (
        a.margin.top === b.margin.top &&
        a.margin.right === b.margin.right &&
        a.margin.bottom === b.margin.bottom &&
        a.margin.left === b.margin.left
      );
    }
    return left === right;
  });
}

/** Returns the color to draw a series with, falling back to the theme colorway. */
export function getSeriesColor(
  theme: PlotTheme,
  index: number,
  color?: string
): string {
  if (color != null && color !== '') {
    return color;
  }
  const colorway =
    theme.colorway.length > 0 ? theme.colorway : defaultPlotTheme.colorway;
  return colorway[index % colorway.length];
}

/**
 * The color a series is listed with in the legend and tooltips. Bar series
 * draw in two colors, so they are listed with their increasing color.
 */
export function getSeriesSwatchColor(
  theme: PlotTheme,
  index: number,
  series: { type: PlotSeriesType; style?: { color?: string } }
): string {
  if (isOhlcSeriesType(series.type)) {
    return theme.ohlcIncreasingColor;
  }
  return getSeriesColor(theme, index, series.style?.color);
}
