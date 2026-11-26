import type { SeriesData, SeriesDelta } from "gigaplot";
import { DoomRidgeSource, type DoomRidgeOptions } from "./DoomRidgeSource";
import { DOOM_HEIGHT, DOOM_WIDTH, type DoomFrame } from "./doomFrame";

const WHITE = 7;

const OPTIONS: DoomRidgeOptions = {
  // Two of Doom's rows per line
  lineCount: DOOM_HEIGHT / 2,
  amplitude: 1,
  style: "pulsar",
  occlude: false,
  lineWidth: 1,
};

/** A black frame, apart from white `pixels`, drawn without scaling. */
function createFrame(pixels: { column: number; row: number }[]): DoomFrame {
  const indexes = new Uint8Array(DOOM_WIDTH * DOOM_HEIGHT);
  const rgba = new Uint8Array(DOOM_WIDTH * DOOM_HEIGHT * 4);
  for (let i = 0; i < indexes.length; i += 1) {
    rgba[i * 4 + 3] = 255;
  }
  pixels.forEach(({ column, row }) => {
    const pixel = row * DOOM_WIDTH + column;
    indexes[pixel] = WHITE;
    rgba.set([255, 255, 255], pixel * 4);
  });
  return { indexes, rgba, rgbaWidth: DOOM_WIDTH };
}

function listen(source: DoomRidgeSource): SeriesDelta[][] {
  const deltas: SeriesDelta[][] = [];
  source.addEventListener("datachanged", (event) => deltas.push(event.deltas));
  return deltas;
}

function plot(options: DoomRidgeOptions, frame: DoomFrame): SeriesDelta[] {
  const source = new DoomRidgeSource(options);
  const deltas = listen(source);
  source.pushFrame(frame);
  return deltas[0];
}

function getData(deltas: SeriesDelta[], line: number): SeriesData {
  const delta = deltas[line];
  if (delta.type !== "update" && delta.type !== "replace") {
    throw new Error(`Expected new points, got ${delta.type}`);
  }
  return delta.data;
}

function getY(deltas: SeriesDelta[], line: number, column: number): number {
  return getData(deltas, line).y[column];
}

it("lifts each line from its baseline by the brightness of its band", () => {
  const deltas = plot(
    OPTIONS,
    createFrame([
      { column: 0, row: 0 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ]),
  );

  expect(deltas).toHaveLength(OPTIONS.lineCount);
  // The top line sits on the bottom of the top band, 2 rows down
  expect(getY(deltas, 0, 0)).toBeCloseTo(100);
  expect(getY(deltas, 0, 1)).toBeCloseTo(99);
  expect(getY(deltas, 0, 2)).toBeCloseTo(98);
  expect(getY(deltas, 1, 0)).toBeCloseTo(96);
});

it("hides a line wherever the lines in front rise above it", () => {
  const frame = createFrame([
    { column: 5, row: 2 },
    { column: 5, row: 3 },
  ]);
  const options = { ...OPTIONS, amplitude: 4 };

  // The second line, in front of the first, peaks 8 rows over its baseline
  expect(getY(plot(options, frame), 1, 5)).toBeCloseTo(104);
  expect(getY(plot(options, frame), 0, 5)).toBeCloseTo(98);
  expect(getY(plot({ ...options, occlude: true }, frame), 0, 5)).toBeCloseTo(
    104,
  );
  expect(getY(plot({ ...options, occlude: true }, frame), 0, 4)).toBeCloseTo(
    98,
  );
});

it("updates lines in place, but replaces them when they become areas", () => {
  const source = new DoomRidgeSource(OPTIONS);
  const deltas = listen(source);
  const frame = createFrame([{ column: 0, row: 0 }]);
  source.pushFrame(frame);
  source.pushFrame(frame);

  // An update would only fill the columns the plot holds, dropping the base
  source.setOptions({ style: "glow" });

  expect(deltas[1][0].type).toBe("update");
  expect(deltas[2][0].type).toBe("replace");
  // Filled from 4 lines below the line, where its glow fades out
  expect(getData(deltas[2], 0).base?.[0]).toBeCloseTo(90);
});
