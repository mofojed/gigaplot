import { setDoomDefault } from "./doomDefaults";

const NAME_ADDRESS = 17;
const ENTRY_ADDRESS = 32;
const LOCATION_ADDRESS = 64;

function encode(value: string): number[] {
  return Array.from(`${value}\0`, (c) => c.charCodeAt(0));
}

/**
 * Memory with "screenblocks" at `NAME_ADDRESS`, after a longer name that ends
 * in it, and a `defaults` entry for it at `ENTRY_ADDRESS`.
 */
function createMemory(): Uint8Array {
  const bytes = new Uint8Array(80);
  const view = new DataView(bytes.buffer);
  bytes.set(encode("xscreenblocks"), 1);
  bytes.set(encode("screenblocks"), NAME_ADDRESS);
  view.setUint32(ENTRY_ADDRESS, NAME_ADDRESS, true);
  view.setUint32(ENTRY_ADDRESS + 4, LOCATION_ADDRESS, true);
  view.setInt32(ENTRY_ADDRESS + 8, 9, true);
  return bytes;
}

it("changes the default value of a setting", () => {
  const bytes = createMemory();
  const original = bytes.slice();

  expect(setDoomDefault(bytes, "screenblocks", 10)).toBe(true);

  const view = new DataView(bytes.buffer);
  expect(view.getInt32(ENTRY_ADDRESS + 8, true)).toBe(10);
  view.setInt32(ENTRY_ADDRESS + 8, 9, true);
  expect(bytes).toEqual(original);
});

it("does nothing for a setting it cannot find", () => {
  const bytes = createMemory();
  const original = bytes.slice();

  expect(setDoomDefault(bytes, "detaillevel", 1)).toBe(false);
  expect(bytes).toEqual(original);
});
