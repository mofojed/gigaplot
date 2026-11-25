import {
  limitFillStops,
  resolveAreaFill,
  rgbaToCss,
  sampleFillStops,
} from './areaFill';

const VIEWPORT = { xMin: 0, xMax: 10, yMin: -5, yMax: 15 };

describe('resolveAreaFill', () => {
  it('defaults to the series color at the default opacity', () => {
    const fill = resolveAreaFill(undefined, '#ff0000', 0.5, VIEWPORT);

    expect(fill.stops).toEqual([{ offset: 0, color: [1, 0, 0, 0.5] }]);
  });

  it('uses a color as is', () => {
    const fill = resolveAreaFill('#00ff00', '#ff0000', 0.5, VIEWPORT);

    expect(fill.stops).toEqual([{ offset: 0, color: [0, 1, 0, 1] }]);
  });

  it('runs a vertical plot gradient from the top of the plot to the bottom', () => {
    const fill = resolveAreaFill(
      { type: 'linear', stops: [{ opacity: 1 }, { opacity: 0 }] },
      '#ff0000',
      0.5,
      VIEWPORT
    );

    expect(fill.axis).toBe('y');
    expect(fill.start).toBe(15);
    expect(fill.end).toBe(-5);
    expect(fill.stops).toEqual([
      { offset: 0, color: [1, 0, 0, 1] },
      { offset: 1, color: [1, 0, 0, 0] },
    ]);
  });

  it('runs a horizontal plot gradient from left to right', () => {
    const fill = resolveAreaFill(
      {
        type: 'linear',
        direction: 'horizontal',
        stops: [
          { offset: 0.5, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      },
      '#ff0000',
      0.5,
      VIEWPORT
    );

    expect(fill.axis).toBe('x');
    // Rescaled so the first stop is at 0
    expect(fill.start).toBe(5);
    expect(fill.end).toBe(10);
    expect(fill.stops.map(stop => stop.offset)).toEqual([0, 1]);
  });

  it('places data stops at values, in order', () => {
    const fill = resolveAreaFill(
      {
        type: 'linear',
        units: 'data',
        stops: [
          { offset: 100, color: '#ffffff' },
          { offset: 0, color: '#000000' },
          { offset: 50, color: '#ff0000' },
        ],
      },
      '#ff0000',
      0.5,
      VIEWPORT
    );

    expect(fill.start).toBe(0);
    expect(fill.end).toBe(100);
    expect(fill.stops.map(stop => stop.offset)).toEqual([0, 0.5, 1]);
    expect(fill.stops[0].color).toEqual([0, 0, 0, 1]);
  });

  it('keeps a hard edge where every stop is at one value', () => {
    const fill = resolveAreaFill(
      {
        type: 'linear',
        units: 'data',
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 0, color: '#00ff00' },
        ],
      },
      '#ff0000',
      0.5,
      VIEWPORT
    );

    expect(fill.end).toBeGreaterThan(fill.start);
    expect(sampleFillStops(fill.stops, -1)).toEqual([1, 0, 0, 1]);
    expect(sampleFillStops(fill.stops, 2)).toEqual([0, 1, 0, 1]);
  });
});

describe('sampleFillStops', () => {
  const stops = [
    { offset: 0, color: [0, 0, 0, 1] as [number, number, number, number] },
    { offset: 1, color: [1, 1, 1, 0] as [number, number, number, number] },
  ];

  it('blends between stops without premultiplying', () => {
    expect(sampleFillStops(stops, 0.5)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('keeps the end colors beyond the stops', () => {
    expect(sampleFillStops(stops, -1)).toEqual([0, 0, 0, 1]);
    expect(sampleFillStops(stops, 2)).toEqual([1, 1, 1, 0]);
  });
});

it('resamples gradients with more stops than the shader holds', () => {
  const stops = Array.from({ length: 20 }, (_unused, i) => ({
    offset: i / 19,
    color: [i / 19, 0, 0, 1] as [number, number, number, number],
  }));

  const limited = limitFillStops(stops, 4);

  expect(limited.map(stop => stop.offset)).toEqual([0, 1 / 3, 2 / 3, 1]);
  expect(limited[3].color).toEqual([1, 0, 0, 1]);
});

it('formats colors for a canvas', () => {
  expect(rgbaToCss([1, 0.5, 0, 0.25])).toBe('rgba(255, 128, 0, 0.25)');
});
