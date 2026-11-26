import { patchDemoVersions } from "./doomDemos";

interface Lump {
  name: string;
  data: number[];
}

/**
 * Memory holding a WAD of `lumps` at `wadOffset`, after a stray "IWAD", as
 * the port's strings have, that is not followed by a directory.
 */
function createMemory(lumps: Lump[], wadOffset = 64): Uint8Array {
  const dataSize = lumps.reduce((size, { data }) => size + data.length, 0);
  const directory = 12 + dataSize;
  const bytes = new Uint8Array(wadOffset + directory + lumps.length * 16);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x57, 0x41, 0x44, 0xff, 0xff, 0xff, 0x7f], 8);
  bytes.set([0x49, 0x57, 0x41, 0x44], wadOffset);
  view.setInt32(wadOffset + 4, lumps.length, true);
  view.setInt32(wadOffset + 8, directory, true);
  let position = 12;
  lumps.forEach(({ name, data }, i) => {
    bytes.set(data, wadOffset + position);
    const entry = wadOffset + directory + i * 16;
    view.setInt32(entry, position, true);
    view.setInt32(entry + 4, data.length, true);
    bytes.set(
      Array.from(name, (c) => c.charCodeAt(0)),
      entry + 8,
    );
    position += data.length;
  });
  return bytes;
}

it("restamps Doom 1.9 demos for the 1.10 engine", () => {
  const bytes = createMemory([
    { name: "PLAYPAL", data: [109, 1, 2] },
    { name: "DEMO1", data: [109, 2, 1, 1] },
    { name: "DEMO2", data: [109, 2, 3, 1] },
    { name: "DEMOSEQ", data: [109] },
  ]);
  const original = bytes.slice();

  expect(patchDemoVersions(bytes)).toBe(2);

  const changed = bytes.reduce<number[]>(
    (offsets, byte, i) => (byte !== original[i] ? [...offsets, i] : offsets),
    [],
  );
  expect(changed).toEqual([64 + 12 + 3, 64 + 12 + 7]);
  expect(changed.map((i) => bytes[i])).toEqual([110, 110]);
});

it("leaves demos of other versions alone", () => {
  const bytes = createMemory([{ name: "DEMO1", data: [110, 2, 1, 1] }]);
  const original = bytes.slice();

  expect(patchDemoVersions(bytes)).toBe(0);
  expect(bytes).toEqual(original);
});

it("does nothing without a WAD", () => {
  expect(patchDemoVersions(new Uint8Array(64))).toBe(0);
});
