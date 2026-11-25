import type { SeriesData, SeriesDelta } from "gigaplot";
import { createDeLoreanRun } from "./deLoreanRun";
import {
  FIRE_TRAIL_DRIVE_TICKS,
  FIRE_TRAIL_RUN,
  FireTrailSource,
} from "./FireTrailSource";
import { SpeedometerSource } from "./SpeedometerSource";

async function getData(
  source: SpeedometerSource,
  seriesId: string,
): Promise<SeriesData> {
  const { data } = await source.requestSeriesData({
    seriesId,
    viewport: { xMin: 0, xMax: 10, yMin: 0, yMax: 110 },
    pixelSize: { width: 100, height: 100 },
    style: {},
  });
  return data;
}

function tickTo(car: FireTrailSource, phase: number): void {
  while (car.getPhase() !== phase) {
    car.tick();
  }
}

it("makes a run that climbs from a standing start to exactly 88", () => {
  const run = createDeLoreanRun(120);
  expect(run.speed).toHaveLength(121);
  expect(run.speed[0]).toBe(0);
  expect(run.speed[120]).toBe(88);
  expect(run.distance[0]).toBe(0);
  expect(run.distance[120]).toBe(1);
  // The car only ever moves forwards
  for (let tick = 1; tick <= 120; tick += 1) {
    expect(run.distance[tick]).toBeGreaterThanOrEqual(run.distance[tick - 1]);
  }
});

it("reads the car's speed up to the tick it is on", async () => {
  const car = new FireTrailSource();
  const speedometer = new SpeedometerSource(car);
  const phase = car.getPhase();
  const speed = await getData(speedometer, "speed");

  expect(speed.length).toBe(phase + 1);
  expect(speed.y[phase]).toBe(FIRE_TRAIL_RUN.speed[phase]);
  expect((await getData(speedometer, "gone")).length).toBe(0);
});

it("follows the car to 88, when it is gone, and starts over with it", async () => {
  const car = new FireTrailSource();
  const speedometer = new SpeedometerSource(car);
  const deltas: SeriesDelta[] = [];
  speedometer.addEventListener("datachanged", (event) =>
    deltas.push(...event.deltas),
  );

  tickTo(car, FIRE_TRAIL_DRIVE_TICKS);
  expect(deltas.every((delta) => delta.type === "replace")).toBe(true);
  const speed = await getData(speedometer, "speed");
  expect(speed.y[speed.length - 1]).toBe(88);
  expect((await getData(speedometer, "gone")).length).toBe(1);
  expect((await getData(speedometer, "lightning")).length).toBeGreaterThan(0);

  tickTo(car, 0);
  expect((await getData(speedometer, "speed")).length).toBe(1);
  expect((await getData(speedometer, "gone")).length).toBe(0);
  expect((await getData(speedometer, "lightning")).length).toBe(0);
});

it("stops following the car once closed", () => {
  const car = new FireTrailSource();
  const speedometer = new SpeedometerSource(car);
  const listener = jest.fn();
  speedometer.addEventListener("datachanged", listener);
  speedometer.close();
  car.tick();
  expect(listener).not.toHaveBeenCalled();
});
