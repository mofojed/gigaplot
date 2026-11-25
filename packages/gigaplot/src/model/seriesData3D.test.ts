import { applyDeltaToSeriesData } from '../renderers/applyDeltaToSeriesData';
import { StaticDataSource } from '../sources/StaticDataSource';
import {
  appendSeriesData,
  copySeriesData,
  createSeriesDataLike,
  getSeriesBounds,
  is3DSeriesType,
  isBounds3D,
  seriesData3DFromArrays,
  seriesDataFromArrays,
  unionBounds,
} from './PlotTypes';

it('tells 3D series types apart', () => {
  expect(is3DSeriesType('scatter3d')).toBe(true);
  expect(is3DSeriesType('line3d')).toBe(true);
  expect(is3DSeriesType('scatter')).toBe(false);
});

it('keeps z in step through copies, appends, and updates', () => {
  const data = seriesData3DFromArrays([0, 1], [2, 3], [4, 5]);
  const copy = copySeriesData(data);
  expect(Array.from(copy.z ?? [])).toEqual([4, 5]);
  expect(createSeriesDataLike(data).z).toBeDefined();

  appendSeriesData(copy, seriesData3DFromArrays([2], [6], [7]));
  expect(Array.from(copy.z?.subarray(0, copy.length) ?? [])).toEqual([4, 5, 7]);

  const updated = applyDeltaToSeriesData(copy, {
    type: 'update',
    seriesId: 'a',
    offset: 1,
    data: seriesData3DFromArrays([9], [9], [9]),
  });
  expect(Array.from(updated.z?.subarray(0, updated.length) ?? [])).toEqual([
    4, 9, 7,
  ]);
  // The original was copied, not shared
  expect(Array.from(data.z ?? [])).toEqual([4, 5]);
});

it('measures the z range of 3D data, skipping points with a missing value', () => {
  const bounds = getSeriesBounds(
    seriesData3DFromArrays([0, 1, 2], [0, 1, 2], [5, Number.NaN, -3])
  );
  expect(bounds).toEqual({
    xMin: 0,
    xMax: 2,
    yMin: 0,
    yMax: 2,
    zMin: -3,
    zMax: 5,
  });
  expect(isBounds3D(bounds)).toBe(true);
  expect(isBounds3D(getSeriesBounds(seriesDataFromArrays([0], [0])))).toBe(
    false
  );
});

it('unions z ranges, and leaves 2D bounds without one', () => {
  const flat = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  expect(unionBounds(flat, flat)).toEqual(flat);
  expect(unionBounds(flat, { ...flat, xMax: 3, zMin: -1, zMax: 2 })).toEqual({
    xMin: 0,
    xMax: 3,
    yMin: 0,
    yMax: 1,
    zMin: -1,
    zMax: 2,
  });
});

it('hands 3D series over whole, since there is nothing to downsample to', async () => {
  const count = 10_000;
  const values = Array.from({ length: count }, (_unused, i) => i);
  const data = seriesData3DFromArrays(values, values, values);
  const source = new StaticDataSource([
    { id: 'a', name: 'A', type: 'scatter3d', data },
  ]);
  const shape = await source.getShape();
  expect(shape.bounds?.zMax).toBe(count - 1);

  const result = await source.requestSeriesData({
    seriesId: 'a',
    viewport: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    pixelSize: { width: 10, height: 10 },
    style: {},
  });
  expect(result.complete).toBe(true);
  expect(result.data.length).toBe(count);
});
