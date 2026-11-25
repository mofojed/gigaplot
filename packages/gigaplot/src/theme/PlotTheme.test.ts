import {
  createPlotTheme,
  createPlotThemeFromElement,
  defaultPlotTheme,
  getSeriesColor,
  PLOT_THEME_CSS_VARIABLES,
  plotThemesEqual,
  readPlotThemeFromElement,
  splitColorList,
} from './PlotTheme';

describe('createPlotTheme', () => {
  it('returns a copy of the default theme', () => {
    const theme = createPlotTheme();
    expect(theme).toEqual(defaultPlotTheme);
    expect(theme).not.toBe(defaultPlotTheme);
    expect(theme.margin).not.toBe(defaultPlotTheme.margin);
    expect(theme.colorway).not.toBe(defaultPlotTheme.colorway);
  });

  it('applies overrides left to right and merges margin sides', () => {
    const theme = createPlotTheme(
      { gridColor: 'red', fontSize: 9, margin: { left: 10 } },
      { gridColor: 'blue', margin: { top: 2 } }
    );
    expect(theme.gridColor).toBe('blue');
    expect(theme.fontSize).toBe(9);
    expect(theme.margin).toEqual({
      ...defaultPlotTheme.margin,
      left: 10,
      top: 2,
    });
  });

  it('ignores undefined values and an empty colorway', () => {
    const theme = createPlotTheme({
      gridColor: undefined,
      colorway: [],
      margin: { left: undefined },
    });
    expect(theme).toEqual(defaultPlotTheme);
  });
});

describe('splitColorList', () => {
  it('splits on whitespace and commas outside of functions', () => {
    expect(
      splitColorList(' #111  rgb(1, 2, 3),hsl(10 20% 30%)\n\tred ')
    ).toEqual(['#111', 'rgb(1, 2, 3)', 'hsl(10 20% 30%)', 'red']);
  });

  it('keeps nested functions together', () => {
    expect(
      splitColorList('color-mix(in srgb, rgb(0 0 0) 50%, white) #fff')
    ).toEqual(['color-mix(in srgb, rgb(0 0 0) 50%, white)', '#fff']);
  });

  it('returns nothing for an empty value', () => {
    expect(splitColorList('   ')).toEqual([]);
  });
});

describe('reading the theme from CSS', () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it('reads nothing when no variables are set', () => {
    expect(readPlotThemeFromElement(element)).toEqual({});
    expect(createPlotThemeFromElement(element)).toEqual(defaultPlotTheme);
  });

  it('reads every Deephaven chart variable', () => {
    const { style } = element;
    style.setProperty(PLOT_THEME_CSS_VARIABLES.backgroundColor, '#010101');
    style.setProperty(PLOT_THEME_CSS_VARIABLES.plotBackgroundColor, '#020202');
    style.setProperty(PLOT_THEME_CSS_VARIABLES.gridColor, '#030303');
    style.setProperty(PLOT_THEME_CSS_VARIABLES.axisColor, '#040404');
    style.setProperty(PLOT_THEME_CSS_VARIABLES.tickLabelColor, '#050505');
    style.setProperty(PLOT_THEME_CSS_VARIABLES.legendTextColor, '#060606');
    style.setProperty(PLOT_THEME_CSS_VARIABLES.colorway, ' #aaa #bbb ');
    style.setProperty(
      PLOT_THEME_CSS_VARIABLES.tooltipBackgroundColor,
      '#070707'
    );
    style.setProperty(PLOT_THEME_CSS_VARIABLES.tooltipTextColor, '#080808');

    expect(readPlotThemeFromElement(element)).toEqual({
      backgroundColor: '#010101',
      plotBackgroundColor: '#020202',
      gridColor: '#030303',
      axisColor: '#040404',
      tickLabelColor: '#050505',
      legendTextColor: '#060606',
      colorway: ['#aaa', '#bbb'],
      tooltipBackgroundColor: '#070707',
      tooltipTextColor: '#080808',
      // Hover labels are outlined like the plot area
      tooltipBorderColor: '#040404',
    });
  });

  it('uses the same variables as @deephaven/chart and Deephaven tooltips', () => {
    expect(PLOT_THEME_CSS_VARIABLES).toEqual({
      backgroundColor: '--dh-color-chart-bg',
      plotBackgroundColor: '--dh-color-chart-plot-bg',
      gridColor: '--dh-color-chart-grid',
      axisColor: '--dh-color-chart-axis-line',
      tickLabelColor: '--dh-color-chart-axis-line-zero',
      legendTextColor: '--dh-color-chart-legend-fg',
      axisTitleColor: '--dh-color-chart-title',
      colorway: '--dh-color-chart-colorway',
      ohlcIncreasingColor: '--dh-color-chart-ohlc-increase',
      ohlcDecreasingColor: '--dh-color-chart-ohlc-decrease',
      tooltipBackgroundColor: '--dh-color-tooltip-bg',
      tooltipTextColor: '--dh-color-tooltip-fg',
      tooltipBorderColor: '--dh-color-chart-axis-line',
    });
  });

  it('lets overrides win over CSS', () => {
    element.style.setProperty('--dh-color-chart-grid', '#030303');
    element.style.setProperty('--dh-color-chart-bg', '#010101');
    const theme = createPlotThemeFromElement(element, { gridColor: 'red' });
    expect(theme.gridColor).toBe('red');
    expect(theme.backgroundColor).toBe('#010101');
  });
});

describe('plotThemesEqual', () => {
  it('compares by value', () => {
    expect(plotThemesEqual(createPlotTheme(), createPlotTheme())).toBe(true);
    expect(
      plotThemesEqual(createPlotTheme(), createPlotTheme({ margin: { top: 1 } }))
    ).toBe(false);
    expect(
      plotThemesEqual(createPlotTheme(), createPlotTheme({ colorway: ['red'] }))
    ).toBe(false);
    expect(
      plotThemesEqual(createPlotTheme(), createPlotTheme({ fontSize: 30 }))
    ).toBe(false);
  });
});

describe('getSeriesColor', () => {
  it('prefers the series color, then cycles the colorway', () => {
    const theme = createPlotTheme({ colorway: ['a', 'b'] });
    expect(getSeriesColor(theme, 0, 'red')).toBe('red');
    expect(getSeriesColor(theme, 0)).toBe('a');
    expect(getSeriesColor(theme, 3)).toBe('b');
  });

  it('falls back to the default colorway when a theme has none', () => {
    const theme = { ...createPlotTheme(), colorway: [] };
    expect(getSeriesColor(theme, 0)).toBe(defaultPlotTheme.colorway[0]);
  });
});
