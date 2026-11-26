import type { PlotShape, SeriesDelta } from "gigaplot";
import {
  DoomPaletteSource,
  getPaletteSeriesId,
  type DoomPlotOptions,
} from "./DoomPaletteSource";
import { DOOM_HEIGHT, DOOM_WIDTH, type DoomFrame } from "./doomFrame";

const RGBA_SCALE = 2;
const RGBA_WIDTH = DOOM_WIDTH * RGBA_SCALE;

const OPTIONS: DoomPlotOptions = {
  pointsPerPixel: 1,
  pointSize: 2,
  colorMode: "doom",
  hidden: new Set(),
};

/**
 * A frame of palette index 0 apart from `pixels`, drawn at twice the size in
 * RGBA as the port does, with each index's color from `colors`.
 */
function createFrame(
  pixels: { column: number; row: number; index: number }[],
  colors: Record<number, [number, number, number]>,
): DoomFrame {
  const indexes = new Uint8Array(DOOM_WIDTH * DOOM_HEIGHT);
  pixels.forEach(({ column, row, index }) => {
    indexes[row * DOOM_WIDTH + column] = index;
  });
  const rgba = new Uint8Array(RGBA_WIDTH * DOOM_HEIGHT * RGBA_SCALE * 4);
  for (let y = 0; y < DOOM_HEIGHT * RGBA_SCALE; y += 1) {
    for (let x = 0; x < RGBA_WIDTH; x += 1) {
      const index =
        indexes[
          Math.floor(y / RGBA_SCALE) * DOOM_WIDTH + Math.floor(x / RGBA_SCALE)
        ];
      const [red, green, blue] = colors[index] ?? [0, 0, 0];
      rgba.set([red, green, blue, 255], (y * RGBA_WIDTH + x) * 4);
    }
  }
  return { indexes, rgba, rgbaWidth: RGBA_WIDTH };
}

function listen(source: DoomPaletteSource): {
  deltas: SeriesDelta[][];
  shapes: PlotShape[];
} {
  const deltas: SeriesDelta[][] = [];
  const shapes: PlotShape[] = [];
  source.addEventListener("datachanged", (event) => deltas.push(event.deltas));
  source.addEventListener("shapechanged", (event) => shapes.push(event.shape));
  return { deltas, shapes };
}

function getPoints(
  deltas: SeriesDelta[],
  index: number,
): [number, number][] | undefined {
  const delta = deltas.find(
    (candidate) => candidate.seriesId === getPaletteSeriesId(index),
  );
  if (delta == null || delta.type !== "replace") {
    return undefined;
  }
  return Array.from({ length: delta.data.length }, (_unused, i) => [
    delta.data.x[i],
    delta.data.y[i],
  ]);
}

it("plots each pixel in the series of its palette index, centred with y up", () => {
  const source = new DoomPaletteSource(OPTIONS);
  const { deltas } = listen(source);

  source.pushFrame(
    createFrame(
      [
        { column: 0, row: 0, index: 7 },
        { column: 319, row: 199, index: 9 },
      ],
      {},
    ),
  );

  expect(deltas).toHaveLength(1);
  expect(getPoints(deltas[0], 7)).toEqual([[-159.5, 99.5]]);
  expect(getPoints(deltas[0], 9)).toEqual([[159.5, -99.5]]);
  expect(getPoints(deltas[0], 0)).toHaveLength(DOOM_WIDTH * DOOM_HEIGHT - 2);
  // Palette entries absent from the frame are left alone
  expect(getPoints(deltas[0], 8)).toBeUndefined();
  expect(source.getPointCount()).toBe(DOOM_WIDTH * DOOM_HEIGHT);
});

it("splits each pixel into more points, or samples fewer", () => {
  const source = new DoomPaletteSource({ ...OPTIONS, pointsPerPixel: 4 });
  const { deltas } = listen(source);
  source.pushFrame(createFrame([{ column: 0, row: 0, index: 7 }], {}));

  expect(getPoints(deltas[0], 7)).toEqual([
    [-159.75, 99.75],
    [-159.25, 99.75],
    [-159.75, 99.25],
    [-159.25, 99.25],
  ]);

  source.setOptions({ pointsPerPixel: 0.25 });

  // Every other pixel each way, at the centre of its 2 by 2 block
  expect(getPoints(deltas[1], 7)).toEqual([[-159, 99]]);
  expect(source.getPointCount()).toBe((DOOM_WIDTH * DOOM_HEIGHT) / 4);
});

it("empties hidden colors, and stops updating them once empty", () => {
  const source = new DoomPaletteSource(OPTIONS);
  const { deltas } = listen(source);
  const frame = createFrame([{ column: 4, row: 4, index: 7 }], {});
  source.pushFrame(frame);

  source.setOptions({ hidden: new Set([7]) });
  expect(getPoints(deltas[1], 7)).toEqual([]);

  source.pushFrame(frame);
  expect(getPoints(deltas[2], 7)).toBeUndefined();
  expect(source.getPointCount()).toBe(DOOM_WIDTH * DOOM_HEIGHT - 1);
});

it("colors each series from the frame, following palette changes", () => {
  const source = new DoomPaletteSource(OPTIONS);
  const { shapes } = listen(source);
  const palettes: Int32Array[] = [];
  source.onPaletteChanged((palette) => palettes.push(palette));
  const pixels = [{ column: 10, row: 20, index: 7 }];

  source.pushFrame(createFrame(pixels, { 7: [255, 0, 0] }));
  source.pushFrame(createFrame(pixels, { 7: [255, 0, 0] }));
  // Doom tints the whole palette red on taking damage
  source.pushFrame(createFrame(pixels, { 7: [255, 128, 0] }));

  expect(shapes).toHaveLength(2);
  expect(shapes[0].series[7].style?.color).toBe("#ff0000");
  expect(shapes[1].series[7].style?.color).toBe("#ff8000");
  expect(palettes[1][7]).toBe(0xff8000);
  // Index 8 never appeared, so its color is unknown
  expect(palettes[1][8]).toBe(-1);
});
