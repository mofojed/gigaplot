import type { SeriesDelta } from "gigaplot";
import { STAR_FIELD_BOUNDS, StarFieldSource } from "./StarFieldSource";

function makeSource(): StarFieldSource {
  return new StarFieldSource(
    [
      { id: "a", name: "A", count: 50 },
      { id: "b", name: "B", count: 25 },
    ],
    { speed: 0.5, seed: 3 },
  );
}

async function getStars(source: StarFieldSource, seriesId: string) {
  const { data } = await source.requestSeriesData({
    seriesId,
    viewport: STAR_FIELD_BOUNDS,
    pixelSize: { width: 100, height: 100 },
    style: {},
  });
  return data;
}

it("describes fixed bounds and 3D scatter series", async () => {
  const shape = await makeSource().getShape();
  expect(shape.bounds).toEqual(STAR_FIELD_BOUNDS);
  expect(shape.series.map((series) => series.type)).toEqual([
    "scatter3d",
    "scatter3d",
  ]);
});

it("moves every star towards +z on each tick, as one update per layer", async () => {
  const source = makeSource();
  const before = Array.from((await getStars(source, "a")).z ?? []);
  const deltas: SeriesDelta[] = [];
  source.addEventListener("datachanged", (event) =>
    deltas.push(...event.deltas),
  );
  source.tick();

  expect(deltas.map((delta) => [delta.type, delta.seriesId])).toEqual([
    ["update", "a"],
    ["update", "b"],
  ]);
  const after = (await getStars(source, "a")).z ?? [];
  before.forEach((z, i) => {
    const moved = z + 0.5;
    // Stars past the top wrap around to the bottom
    const expected = moved > STAR_FIELD_BOUNDS.zMax ? moved - 2 : moved;
    expect(after[i]).toBeCloseTo(expected);
    expect(after[i]).toBeGreaterThanOrEqual(STAR_FIELD_BOUNDS.zMin);
    expect(after[i]).toBeLessThanOrEqual(STAR_FIELD_BOUNDS.zMax);
  });
});

it("is the same on every run for a seed", async () => {
  const first = await getStars(makeSource(), "b");
  const second = await getStars(makeSource(), "b");
  expect(Array.from(first.x)).toEqual(Array.from(second.x));
  expect(Array.from(first.z ?? [])).toEqual(Array.from(second.z ?? []));
});
