import {
  seriesDataFromArrays,
  type PlotShape,
  type SeriesDelta,
} from '../model/PlotTypes';
import { LayeredDataSource } from './LayeredDataSource';
import {
  StaticDataSource,
  type StaticDataSourceOptions,
} from './StaticDataSource';

class TestDataSource extends StaticDataSource {
  push(deltas: SeriesDelta[]): void {
    this.fireDataChanged(deltas);
  }

  pushShape(shape: Partial<PlotShape>): void {
    this.fireShapeChanged({ ...this.buildShape(), ...shape });
  }
}

function makeSource(
  id: string,
  y: number[],
  options: StaticDataSourceOptions = {}
): TestDataSource {
  return new TestDataSource(
    [
      {
        id,
        name: id.toUpperCase(),
        type: 'line',
        data: seriesDataFromArrays(
          y.map((_value, i) => i),
          y
        ),
      },
    ],
    options
  );
}

it('prefixes series with their layer and puts them on their axes', async () => {
  const price = makeSource('p', [100, 110], {
    xAxisLabel: 'Time',
    yAxisLabel: 'Price',
  });
  const volume = makeSource('v', [0, 50, 1000], { yAxisLabel: 'Volume' });
  const source = new LayeredDataSource([
    { source: price },
    { source: volume, yAxis: 'volume' },
  ]);

  const shape = await source.getShape();

  expect(shape.series.map(({ id, yAxis }) => ({ id, yAxis }))).toEqual([
    { id: '0:p', yAxis: undefined },
    { id: '1:v', yAxis: 'volume' },
  ]);
  expect(shape.xAxisLabel).toBe('Time');
  expect(shape.yAxisLabel).toBe('Price');
  // Both layers share x, but only the price is on the primary y
  expect(shape.bounds).toEqual({ xMin: 0, xMax: 2, yMin: 100, yMax: 110 });
  expect(shape.axes).toEqual([
    expect.objectContaining({
      id: 'volume',
      dimension: 'y',
      label: 'Volume',
      range: { min: 0, max: 1000 },
    }),
  ]);
});

it('stands an axis in for a primary axis that no layer uses', async () => {
  const source = new LayeredDataSource([
    { source: makeSource('v', [0, 10], { yAxisLabel: 'Volume' }), yAxis: 'y2' },
  ]);

  const shape = await source.getShape();

  expect(shape.axes).toBeUndefined();
  expect(shape.series[0].yAxis).toBeUndefined();
  expect(shape.yAxisSide).toBe('right');
  expect(shape.yAxisLabel).toBe('Volume');
  expect(shape.bounds).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 10 });
});

it('titles and places axes from its options', async () => {
  const source = new LayeredDataSource(
    [
      { source: makeSource('a', [1], { yAxisLabel: 'A' }) },
      { source: makeSource('b', [2], { yAxisLabel: 'B' }), yAxis: 'b' },
    ],
    {
      title: 'Both',
      axes: { y: { label: '' }, b: { side: 'left', label: 'Bees' } },
    }
  );

  const shape = await source.getShape();

  expect(shape.title).toBe('Both');
  expect(shape.yAxisLabel).toBeUndefined();
  expect(shape.axes?.[0]).toMatchObject({ side: 'left', label: 'Bees' });
});

it('forwards requests to their layer and tags its deltas', async () => {
  const price = makeSource('p', [1, 2]);
  const volume = makeSource('v', [3, 4]);
  const source = new LayeredDataSource([
    { source: price },
    { source: volume, yAxis: 'volume' },
  ]);
  const request = jest.spyOn(volume, 'requestSeriesData');
  const onData = jest.fn();
  source.addEventListener('datachanged', onData);

  const result = await source.requestSeriesData({
    seriesId: '1:v',
    viewport: { xMin: 0, xMax: 1, yMin: 0, yMax: 4 },
    pixelSize: { width: 100, height: 100 },
    style: {},
  });
  volume.push([{ type: 'clear', seriesId: 'v' }]);

  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({ seriesId: 'v' })
  );
  expect(Array.from(result.data.y)).toEqual([3, 4]);
  expect(onData).toHaveBeenCalledWith({
    deltas: [{ type: 'clear', seriesId: '1:v' }],
  });
});

it('keeps a shape that changes while its first shape loads', async () => {
  const price = makeSource('p', [1, 2], { xAxisLabel: 'Before' });
  const source = new LayeredDataSource([{ source: price }]);

  const loading = source.getShape();
  price.pushShape({ xAxisLabel: 'After' });

  expect((await loading).xAxisLabel).toBe('After');
});

it('rejects an axis named as both an x and a y axis', () => {
  expect(
    () =>
      new LayeredDataSource([
        { source: makeSource('a', [1]), xAxis: 'other' },
        { source: makeSource('b', [1]), yAxis: 'other' },
      ])
  ).toThrow('cannot be both');
});

it('closes every layer and stops listening to them', () => {
  const price = makeSource('p', [1, 2]);
  const close = jest.spyOn(price, 'close');
  const source = new LayeredDataSource([{ source: price }]);
  const onData = jest.fn();
  source.addEventListener('datachanged', onData);

  source.close();
  price.push([{ type: 'clear', seriesId: 'p' }]);

  expect(close).toHaveBeenCalled();
  expect(onData).not.toHaveBeenCalled();
});
