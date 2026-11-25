import {
  appendSeriesData,
  copySeriesPoint,
  createSeriesData,
  createSeriesDataLike,
  ensureSeriesCapacity,
  trimSeriesData,
  type SeriesData,
  type SeriesDelta,
} from '../model/PlotTypes';

/** Applies a delta to the previous data for a series, returning the new data. */
export function applyDeltaToSeriesData(
  existing: SeriesData | undefined,
  delta: SeriesDelta
): SeriesData {
  switch (delta.type) {
    case 'replace':
      return delta.data;
    case 'clear':
      return existing != null
        ? createSeriesDataLike(existing)
        : createSeriesData();
    case 'append': {
      const target = existing ?? createSeriesDataLike(delta.data);
      return appendSeriesData(target, delta.data);
    }
    case 'update': {
      const target = existing ?? createSeriesDataLike(delta.data);
      const end = delta.offset + delta.data.length;
      ensureSeriesCapacity(target, end);
      for (let i = 0; i < delta.data.length; i += 1) {
        copySeriesPoint(delta.data, i, target, delta.offset + i);
      }
      target.length = Math.max(target.length, end);
      return target;
    }
    case 'trimStart':
      return existing != null
        ? trimSeriesData(existing, delta.count)
        : createSeriesData();
  }
}

export default applyDeltaToSeriesData;
