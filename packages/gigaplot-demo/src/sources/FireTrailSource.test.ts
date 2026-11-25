import type { SeriesDelta } from "gigaplot";
import {
  FIRE_TRAIL_BOUNDS,
  FIRE_TRAIL_CYCLE_TICKS,
  FIRE_TRAIL_DRIVE_TICKS,
  FIRE_TRAIL_SERIES,
  FireTrailSource,
  type FireTrailSeriesId,
} from "./FireTrailSource";

async function getData(source: FireTrailSource, seriesId: FireTrailSeriesId) {
  const { data } = await source.requestSeriesData({
    seriesId,
    viewport: FIRE_TRAIL_BOUNDS,
    pixelSize: { width: 100, height: 100 },
    style: {},
  });
  return data;
}

function countVisible(data: { x: ArrayLike<number>; length: number }): number {
  let count = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (Number.isFinite(data.x[i])) {
      count += 1;
    }
  }
  return count;
}

/** Ticks until the run is at `phase`. */
function tickTo(source: FireTrailSource, phase: number): void {
  while (source.getPhase() !== phase) {
    source.tick();
  }
}

it("describes every series in fixed bounds", async () => {
  const shape = await new FireTrailSource().getShape();
  expect(shape.bounds).toEqual(FIRE_TRAIL_BOUNDS);
  expect(shape.series.map((series) => series.id)).toEqual([
    ...FIRE_TRAIL_SERIES,
  ]);
});

it("starts mid run, with the car on the road and its trails alight", async () => {
  const source = new FireTrailSource({ seed: 2 });
  expect(source.getPhase()).toBeLessThan(FIRE_TRAIL_DRIVE_TICKS);
  expect(countVisible(await getData(source, "car"))).toBeGreaterThan(0);
  expect(countVisible(await getData(source, "flames"))).toBeGreaterThan(0);
});

it("sends an update for every moving series on each tick", () => {
  const source = new FireTrailSource();
  const deltas: SeriesDelta[] = [];
  source.addEventListener("datachanged", (event) =>
    deltas.push(...event.deltas),
  );
  source.tick();

  expect(deltas.map((delta) => delta.seriesId)).toEqual(
    FIRE_TRAIL_SERIES.filter((id) => id !== "road" && id !== "stars"),
  );
  deltas.forEach((delta) =>
    expect(delta).toMatchObject({ type: "update", offset: 0 }),
  );
});

it("only lights fire in the tracks behind the car", async () => {
  const source = new FireTrailSource({ seed: 3 });
  const carY = FireTrailSource.getCarY(source.getPhase());
  const flames = await getData(source, "flames");
  for (let i = 0; i < flames.length; i += 1) {
    if (Number.isFinite(flames.y[i])) {
      expect(flames.y[i]).toBeLessThan(carY);
    }
  }
});

it("vanishes the car at 88 and lets the trails burn out", async () => {
  const source = new FireTrailSource({ seed: 4 });
  tickTo(source, FIRE_TRAIL_DRIVE_TICKS + 1);
  expect(countVisible(await getData(source, "car"))).toBe(0);
  expect(countVisible(await getData(source, "sparks"))).toBeGreaterThan(0);
  expect(countVisible(await getData(source, "flames"))).toBeGreaterThan(0);

  tickTo(source, FIRE_TRAIL_CYCLE_TICKS - 1);
  expect(countVisible(await getData(source, "flames"))).toBe(0);
  expect(countVisible(await getData(source, "sparks"))).toBe(0);
});

it("is the same on every run for a seed", async () => {
  const first = await getData(new FireTrailSource({ seed: 5 }), "embers");
  const second = await getData(new FireTrailSource({ seed: 5 }), "embers");
  expect(Array.from(first.z ?? [])).toEqual(Array.from(second.z ?? []));
});
