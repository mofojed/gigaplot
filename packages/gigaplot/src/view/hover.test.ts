import {
  ohlcSeriesDataFromArrays,
  seriesDataFromArrays,
  type PlotShape,
} from '../model/PlotTypes';
import { defaultPlotTheme } from '../theme/PlotTheme';
import { spreadLabels } from './HoverPainter';
import {
  DEFAULT_TOOLTIP_OPTIONS,
  findHover,
  hoverPointsEqual,
  resolveTooltipOptions,
  type HoverHitTestInput,
} from './hover';

const VIEWPORT = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
/** One pixel per data unit, with y flipped like the screen. */
const AREA = { width: 100, height: 100 };

function hitTest(
  shape: PlotShape,
  data: Record<string, [number[], number[]]>,
  cursor: { x: number; y: number }
): ReturnType<typeof findHover> {
  const input: HoverHitTestInput = {
    shape,
    viewport: VIEWPORT,
    area: AREA,
    cursor,
    theme: defaultPlotTheme,
    getSeriesData: id =>
      data[id] == null
        ? undefined
        : seriesDataFromArrays(data[id][0], data[id][1]),
  };
  return findHover(input);
}

describe('resolveTooltipOptions', () => {
  it('defaults to a box and markers', () => {
    expect(resolveTooltipOptions(undefined)).toEqual(DEFAULT_TOOLTIP_OPTIONS);
    expect(resolveTooltipOptions(true)).toEqual({
      box: true,
      markers: true,
      guides: false,
      xAxisLabel: false,
      yAxisLabels: false,
    });
  });

  it('turns everything off for false', () => {
    expect(Object.values(resolveTooltipOptions(false)).some(Boolean)).toBe(
      false
    );
  });

  it('changes only the parts an object sets', () => {
    expect(resolveTooltipOptions({ box: false, yAxisLabels: true })).toEqual({
      box: false,
      markers: true,
      guides: false,
      xAxisLabel: false,
      yAxisLabels: true,
    });
  });
});

describe('findHover', () => {
  it('reports a stacked area by its own value, drawn at its total', () => {
    const shape: PlotShape = {
      series: [{ id: 'top', name: 'Top', type: 'area', stacked: true }],
    };
    const hover = findHover({
      shape,
      viewport: VIEWPORT,
      area: AREA,
      cursor: { x: 50, y: 50 },
      theme: defaultPlotTheme,
      getSeriesData: () => ({
        ...seriesDataFromArrays([50], [70]),
        base: Float64Array.from([30]),
      }),
    });

    expect(hover?.points[0].y).toBe(70);
    expect(hover?.points[0].value).toBe(40);
  });

  it('reports an area that is not stacked by its y', () => {
    const shape: PlotShape = {
      series: [{ id: 'band', name: 'Band', type: 'area' }],
    };
    const hover = findHover({
      shape,
      viewport: VIEWPORT,
      area: AREA,
      cursor: { x: 50, y: 50 },
      theme: defaultPlotTheme,
      getSeriesData: () => ({
        ...seriesDataFromArrays([50], [70]),
        base: Float64Array.from([30]),
      }),
    });

    expect(hover?.points[0].value).toBeUndefined();
  });

  it('snaps bars along x and reports their open, high, and low', () => {
    const shape: PlotShape = {
      series: [{ id: 'bars', name: 'Bars', type: 'candlestick' }],
    };
    const hover = findHover({
      shape,
      viewport: VIEWPORT,
      area: AREA,
      // Nowhere near either bar vertically
      cursor: { x: 58, y: 1 },
      theme: defaultPlotTheme,
      getSeriesData: () =>
        ohlcSeriesDataFromArrays(
          [20, 60],
          [10, 50],
          [30, 55],
          [5, 30],
          [25, 40]
        ),
    });
    expect(hover?.points).toEqual([
      {
        seriesId: 'bars',
        seriesIndex: 0,
        name: 'Bars',
        type: 'candlestick',
        color: defaultPlotTheme.ohlcDecreasingColor,
        x: 60,
        y: 40,
        open: 50,
        high: 55,
        low: 30,
      },
    ]);
  });

  const lines: PlotShape = {
    series: [
      { id: 'a', name: 'A', type: 'line' },
      { id: 'b', name: 'B', type: 'line', style: { color: '#123456' } },
    ],
  };
  const lineData: Record<string, [number[], number[]]> = {
    a: [
      [0, 20, 40, 60],
      [10, 20, 30, 40],
    ],
    b: [
      [0, 20, 40, 60],
      [90, 80, 70, 60],
    ],
  };

  it('snaps every line to the point nearest the cursor along x', () => {
    // Far from either line vertically, which does not matter for lines
    const hover = hitTest(lines, lineData, { x: 37, y: 50 });
    expect(hover?.points).toEqual([
      {
        seriesId: 'a',
        seriesIndex: 0,
        name: 'A',
        type: 'line',
        color: defaultPlotTheme.colorway[0],
        x: 40,
        y: 30,
      },
      {
        seriesId: 'b',
        seriesIndex: 1,
        name: 'B',
        type: 'line',
        color: '#123456',
        x: 40,
        y: 70,
      },
    ]);
    expect(hover?.x).toBe(37);
    expect(hover?.y).toBe(50);
  });

  it('picks the value nearest the cursor among points sharing an x', () => {
    // Downsamplers keep a min and a max per pixel column at the same x
    const shape: PlotShape = { series: [{ id: 'a', name: 'A', type: 'line' }] };
    const data: Record<string, [number[], number[]]> = {
      a: [
        [10, 10, 20, 20],
        [5, 95, 5, 95],
      ],
    };
    expect(hitTest(shape, data, { x: 11, y: 10 })?.points[0].y).toBe(95);
    expect(hitTest(shape, data, { x: 11, y: 90 })?.points[0].y).toBe(5);
  });

  it('leaves out lines that do not reach the cursor', () => {
    const data: Record<string, [number[], number[]]> = {
      ...lineData,
      b: [
        [0, 20],
        [90, 80],
      ],
    };
    const hover = hitTest(lines, data, { x: 55, y: 50 });
    expect(hover?.points.map(point => point.seriesId)).toEqual(['a']);
  });

  it('only reports a scatter point when the cursor is over it', () => {
    const shape: PlotShape = {
      series: [
        { id: 's', name: 'S', type: 'scatter', style: { pointSize: 4 } },
      ],
    };
    const data: Record<string, [number[], number[]]> = {
      s: [
        [50, 80],
        [50, 20],
      ],
    };
    // Screen y is flipped, so the point at y = 50 is 50 pixels down
    expect(hitTest(shape, data, { x: 53, y: 52 })?.points[0]).toMatchObject({
      x: 50,
      y: 50,
    });
    // Radius is half the point size plus the hover distance
    const reach = 2 + defaultPlotTheme.hoverDistance;
    expect(hitTest(shape, data, { x: 50 + reach + 1, y: 50 })).toBeUndefined();
    expect(hitTest(shape, data, { x: 65, y: 50 })).toBeUndefined();
  });

  it('reports lines and any scatter point under the cursor together', () => {
    const shape: PlotShape = {
      series: [
        { id: 'a', name: 'A', type: 'line' },
        { id: 's', name: 'S', type: 'scatter' },
      ],
    };
    const data: Record<string, [number[], number[]]> = {
      a: lineData.a,
      s: [[22], [50]],
    };
    expect(
      hitTest(shape, data, { x: 21, y: 50 })?.points.map(p => p.seriesId)
    ).toEqual(['a', 's']);
    expect(
      hitTest(shape, data, { x: 21, y: 10 })?.points.map(p => p.seriesId)
    ).toEqual(['a']);
  });

  it('skips points that are not finite', () => {
    const shape: PlotShape = {
      series: [{ id: 's', name: 'S', type: 'scatter' }],
    };
    const data: Record<string, [number[], number[]]> = {
      s: [
        [Number.NaN, 50],
        [50, Number.NaN],
      ],
    };
    expect(hitTest(shape, data, { x: 50, y: 50 })).toBeUndefined();
  });

  it('reports nothing outside the plot area', () => {
    expect(hitTest(lines, lineData, { x: -1, y: 50 })).toBeUndefined();
    expect(hitTest(lines, lineData, { x: 50, y: 101 })).toBeUndefined();
  });
});

describe('hoverPointsEqual', () => {
  it('compares the points, not the cursor', () => {
    const point = {
      seriesId: 'a',
      seriesIndex: 0,
      name: 'A',
      type: 'line' as const,
      color: '#fff',
      x: 1,
      y: 2,
    };
    expect(
      hoverPointsEqual(
        { x: 1, y: 1, points: [point] },
        { x: 5, y: 5, points: [{ ...point }] }
      )
    ).toBe(true);
    expect(
      hoverPointsEqual(
        { x: 1, y: 1, points: [point] },
        { x: 1, y: 1, points: [{ ...point, y: 3 }] }
      )
    ).toBe(false);
    expect(hoverPointsEqual(undefined, undefined)).toBe(true);
    expect(hoverPointsEqual({ x: 1, y: 1, points: [point] }, undefined)).toBe(
      false
    );
  });
});

describe('spreadLabels', () => {
  it('leaves labels that do not overlap level with their values', () => {
    expect(spreadLabels([50, 10, 90], 10, 0, 100)).toEqual([50, 10, 90]);
  });

  it('pushes overlapping labels apart, keeping their order', () => {
    expect(spreadLabels([52, 50], 10, 0, 100)).toEqual([60, 50]);
  });

  it('keeps labels within bounds by pushing back from the edge', () => {
    expect(spreadLabels([99, 98, 97], 10, 5, 95)).toEqual([95, 85, 75]);
  });
});
