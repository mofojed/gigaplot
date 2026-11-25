import type { SeriesDelta } from "gigaplot";
import { RIPPLE_BOUNDS, RippleSource, rippleHeight } from "./RippleSource";

async function getSeries(source: RippleSource, seriesId: string) {
  const { data } = await source.requestSeriesData({
    seriesId,
    viewport: RIPPLE_BOUNDS,
    pixelSize: { width: 100, height: 100 },
    style: {},
  });
  return data;
}

it("describes fixed bounds and a wireframe of 3D lines", async () => {
  const shape = await new RippleSource({ gridSize: 4 }).getShape();
  expect(shape.bounds).toEqual(RIPPLE_BOUNDS);
  expect(shape.series.map((series) => [series.id, series.type])).toEqual([
    ["rows", "line3d"],
    ["columns", "line3d"],
  ]);
});

it("separates each grid line with a gap", async () => {
  const source = new RippleSource({ gridSize: 3 });
  const rows = await getSeries(source, "rows");
  const columns = await getSeries(source, "columns");
  expect(rows.length).toBe(12);
  expect(source.getPointCount()).toBe(24);
  [3, 7, 11].forEach((gap) => {
    expect(rows.x[gap]).toBeNaN();
    expect(columns.z?.[gap]).toBeNaN();
  });
  // Rows run along x, columns along y
  expect(Array.from(rows.x.subarray(0, 3))).toEqual([-1, 0, 1]);
  expect(Array.from(rows.y.subarray(0, 3))).toEqual([-1, -1, -1]);
  expect(Array.from(columns.x.subarray(0, 3))).toEqual([-1, -1, -1]);
  expect(Array.from(columns.y.subarray(0, 3))).toEqual([-1, 0, 1]);
});

it("moves the water on each tick, as one update per series", async () => {
  const source = new RippleSource({ gridSize: 5, speed: 0.5 });
  const before = Array.from((await getSeries(source, "rows")).z ?? []);
  const deltas: SeriesDelta[] = [];
  source.addEventListener("datachanged", (event) =>
    deltas.push(...event.deltas),
  );
  source.tick();

  expect(deltas.map((delta) => [delta.type, delta.seriesId])).toEqual([
    ["update", "rows"],
    ["update", "columns"],
  ]);
  const rows = await getSeries(source, "rows");
  const after = Array.from(rows.z ?? []);
  expect(after).not.toEqual(before);
  expect(after[1]).toBeCloseTo(rippleHeight(rows.x[1], rows.y[1], 0.5));
  after
    .filter((z) => !Number.isNaN(z))
    .forEach((z) => {
      expect(z).toBeGreaterThanOrEqual(RIPPLE_BOUNDS.zMin);
      expect(z).toBeLessThanOrEqual(RIPPLE_BOUNDS.zMax);
    });
});
