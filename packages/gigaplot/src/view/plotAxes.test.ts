import type { PlotShape } from '../model/PlotTypes';
import { defaultPlotTheme } from '../theme/PlotTheme';
import { getShapeAxes, normalizeShapeAxes, placeAxes } from './plotAxes';

const theme = defaultPlotTheme;

it('stacks axes sharing an edge outward, in order', () => {
  const shape: PlotShape = {
    series: [],
    axes: [
      { id: 'a', dimension: 'y' },
      { id: 'b', dimension: 'y', label: 'B' },
      { id: 'top', dimension: 'x' },
    ],
  };
  const { axes, margins } = placeAxes(
    getShapeAxes(shape),
    theme,
    new Map([
      ['a', 40],
      ['b', 24],
    ])
  );

  const titleSize = theme.axisTitleFontSize + theme.axisTitlePadding * 2;
  expect(
    axes.map(({ id, side, offset, size }) => [id, side, offset, size])
  ).toEqual([
    ['x', 'bottom', 0, theme.margin.bottom],
    ['y', 'left', 0, theme.margin.left],
    ['a', 'right', 0, 40],
    ['b', 'right', 40, 24 + titleSize],
    ['top', 'top', 0, theme.margin.bottom],
  ]);
  expect(margins).toEqual({
    top: theme.margin.bottom,
    right: 64 + titleSize,
    bottom: theme.margin.bottom,
    left: theme.margin.left,
  });
});

it('puts series naming an axis that is missing on the primary axes', () => {
  const shape = normalizeShapeAxes({
    series: [
      { id: 'a', name: 'A', type: 'line', yAxis: 'missing' },
      { id: 'b', name: 'B', type: 'line', yAxis: 'top' },
      { id: 'c', name: 'C', type: 'line', yAxis: 'right' },
    ],
    axes: [
      { id: 'top', dimension: 'x' },
      { id: 'right', dimension: 'y' },
      { id: 'y', dimension: 'y' },
    ],
  });

  expect(shape.series.map(series => series.yAxis)).toEqual([
    undefined,
    undefined,
    'right',
  ]);
  expect(shape.axes?.map(axis => axis.id)).toEqual(['top', 'right']);
});
