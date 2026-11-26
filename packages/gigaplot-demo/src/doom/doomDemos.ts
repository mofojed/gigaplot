/** Version byte of demos recorded by Doom 1.9, as in the shareware WAD. */
const DEMO_VERSION_1_9 = 109;

/** Version the port, built from the linuxdoom 1.10 source, insists on. */
const DEMO_VERSION_1_10 = 110;

const WAD_HEADER_SIZE = 12;

const LUMP_ENTRY_SIZE = 16;

function readName(bytes: Uint8Array, offset: number, length: number): string {
  let name = "";
  for (let i = 0; i < length && bytes[offset + i] !== 0; i += 1) {
    name += String.fromCharCode(bytes[offset + i]);
  }
  return name;
}

/**
 * Finds the WAD the port embeds in its memory: the "IWAD" magic followed by a
 * lump directory that fits inside the memory.
 */
function findWad(bytes: Uint8Array, view: DataView): number | undefined {
  for (let offset = 0; offset + WAD_HEADER_SIZE <= bytes.length; offset += 1) {
    // "IWAD"
    if (
      bytes[offset] === 0x49 &&
      bytes[offset + 1] === 0x57 &&
      bytes[offset + 2] === 0x41 &&
      bytes[offset + 3] === 0x44
    ) {
      const lumpCount = view.getInt32(offset + 4, true);
      const directory = view.getInt32(offset + 8, true);
      if (
        lumpCount > 0 &&
        directory >= WAD_HEADER_SIZE &&
        offset + directory + lumpCount * LUMP_ENTRY_SIZE <= bytes.length
      ) {
        return offset;
      }
    }
  }
  return undefined;
}

/**
 * Lets the title screen play its demos. The shareware WAD's demos were
 * recorded by Doom 1.9, and the port, built from the linuxdoom 1.10 source,
 * rejects them as "from a different game version" though the game logic is the
 * same, so the attract loop showed only its title and help pages. Restamping
 * the demos in the WAD embedded in the port's memory, before the game starts,
 * plays them as 1.9 did.
 * @param bytes The port's memory
 * @returns How many demos were restamped
 */
export function patchDemoVersions(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wad = findWad(bytes, view);
  if (wad == null) {
    return 0;
  }
  const lumpCount = view.getInt32(wad + 4, true);
  const directory = wad + view.getInt32(wad + 8, true);
  let patched = 0;
  for (let lump = 0; lump < lumpCount; lump += 1) {
    const entry = directory + lump * LUMP_ENTRY_SIZE;
    if (/^DEMO\d$/.test(readName(bytes, entry + 8, 8))) {
      const start = wad + view.getInt32(entry, true);
      if (start < bytes.length && bytes[start] === DEMO_VERSION_1_9) {
        bytes[start] = DEMO_VERSION_1_10;
        patched += 1;
      }
    }
  }
  return patched;
}

export default patchDemoVersions;
