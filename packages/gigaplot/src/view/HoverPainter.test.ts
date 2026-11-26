import type { PlotShape } from '../model/PlotTypes';
import { defaultPlotTheme } from '../theme/PlotTheme';
import { HoverPainter, type HoverPaintInput } from './HoverPainter';
import { resolveTooltipOptions, type PlotHover } from './hover';

const SHAPE: PlotShape = {
  series: [
    { id: 'a', name: 'Alpha', type: 'line' },
    { id: 'b', name: 'Beta', type: 'line' },
  ],
  xAxisLabel: 'Time',
};

const HOVER: PlotHover = {
  x: 40,
  y: 50,
  points: [
    {
      seriesId: 'a',
      seriesIndex: 0,
      name: 'Alpha',
      type: 'line',
      color: '#74d6e1',
      x: 40,
      y: 30,
    },
    {
      seriesId: 'b',
      seriesIndex: 1,
      name: 'Beta',
      type: 'line',
      color: '#9bd96c',
      x: 40,
      y: 70,
    },
  ],
};

function paint(overrides: Partial<HoverPaintInput>): string[] {
  const canvas = document.createElement('canvas');
  const painter = new HoverPainter(canvas);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const fillText = jest.spyOn(context, 'fillText');
  painter.paint({
    width: 300,
    height: 200,
    area: { left: 50, top: 10, width: 200, height: 160 },
    viewport: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
    shape: SHAPE,
    theme: defaultPlotTheme,
    hover: HOVER,
    options: resolveTooltipOptions(true),
    ...overrides,
  });
  return fillText.mock.calls.map(([text]) => text);
}

it('lists the shared x once and every series value in the box', () => {
  expect(paint({})).toEqual(['Time: 40.0', 'Alpha', '30.0', 'Beta', '70.0']);
});

it('treats lines within a pixel of each other as sharing an x', () => {
  // Two data units per pixel, so these are under a pixel apart
  const hover: PlotHover = {
    ...HOVER,
    points: [HOVER.points[0], { ...HOVER.points[1], x: 40.4 }],
  };
  expect(paint({ hover })).toEqual([
    'Time: 40.0',
    'Alpha',
    '30.0',
    'Beta',
    '70.0',
  ]);
  expect(
    paint({
      hover,
      options: resolveTooltipOptions({ box: false, xAxisLabel: true }),
    })
  ).toEqual(['40.0']);
});

it('heads the box with the x of a line rather than a scatter point', () => {
  const hover: PlotHover = {
    ...HOVER,
    points: [{ ...HOVER.points[0], type: 'scatter', x: 30 }, HOVER.points[1]],
  };
  expect(paint({ hover })).toEqual([
    'Time: 40.0',
    'Alpha',
    '(30.0, 30.0)',
    'Beta',
    '70.0',
  ]);
});

it('shows both values for a point off the shared x', () => {
  const hover: PlotHover = {
    ...HOVER,
    points: [HOVER.points[0], { ...HOVER.points[1], x: 42 }],
  };
  expect(paint({ hover })).toContain('(42.0, 70.0)');
});

it('labels the axes when asked, using the shape formatters', () => {
  const texts = paint({
    shape: {
      ...SHAPE,
      xAxisFormatter: value => `x=${value}`,
      yAxisFormatter: value => `y=${value}`,
    },
    options: resolveTooltipOptions({
      box: false,
      xAxisLabel: true,
      yAxisLabels: true,
    }),
  });
  // Both points share an x, so it is labelled once
  expect(texts).toEqual(['x=40', 'y=30', 'y=70']);
});

it('draws nothing without a hover', () => {
  expect(paint({ hover: undefined })).toEqual([]);
});

it('draws nothing when every part is off', () => {
  expect(paint({ options: resolveTooltipOptions(false) })).toEqual([]);
});

it('labels each distinct x, keeping labels that would overlap apart', () => {
  const canvas = document.createElement('canvas');
  const painter = new HoverPainter(canvas);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const fillText = jest.spyOn(context, 'fillText');
  painter.paint({
    width: 300,
    height: 200,
    area: { left: 50, top: 10, width: 200, height: 160 },
    viewport: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
    shape: SHAPE,
    theme: defaultPlotTheme,
    hover: {
      ...HOVER,
      points: [HOVER.points[0], { ...HOVER.points[1], x: 41 }],
    },
    options: resolveTooltipOptions({ box: false, xAxisLabel: true }),
  });
  const [first, second] = fillText.mock.calls;
  expect([first[0], second[0]]).toEqual(['40.0', '41.0']);
  // jest-canvas-mock measures text as one pixel per character
  const labelWidth = 4 + defaultPlotTheme.tooltipPadding * 2;
  expect(second[1] - first[1]).toBeGreaterThanOrEqual(labelWidth);
});

it('labels a value on the axis its series is drawn against', () => {
  const canvas = document.createElement('canvas');
  const painter = new HoverPainter(canvas);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const fillText = jest.spyOn(context, 'fillText');
  painter.paint({
    width: 300,
    height: 200,
    area: { left: 50, top: 10, width: 200, height: 160 },
    viewport: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
    seriesViewports: new Map([
      ['b', { xMin: 0, xMax: 100, yMin: 0, yMax: 1000 }],
    ]),
    shape: { ...SHAPE, axes: [{ id: 'right', dimension: 'y' }] },
    theme: defaultPlotTheme,
    hover: {
      ...HOVER,
      points: [HOVER.points[0], { ...HOVER.points[1], y: 700, yAxis: 'right' }],
    },
    options: resolveTooltipOptions({ box: false, yAxisLabels: true }),
  });

  const labels = fillText.mock.calls.map(([text, x]) => ({ text, x }));
  expect(labels).toEqual([
    { text: '30.0', x: expect.any(Number) },
    { text: '700', x: expect.any(Number) },
  ]);
  // Primary values sit left of the plot area, and the other axis' right of it
  expect(labels[0].x).toBeLessThan(50);
  expect(labels[1].x).toBeGreaterThan(250);
});
