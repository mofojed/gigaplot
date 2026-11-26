/**
 * Screen size that fills the width of the screen above the status bar. The
 * default, 9, shrinks the view inside a border, and 11 hides the status bar.
 */
export const FULL_SCREEN_BLOCKS = 10;

const POINTER_SIZE = 4;

function findString(bytes: Uint8Array, value: string): number | undefined {
  const encoded = Array.from(`${value}\0`, (c) => c.charCodeAt(0));
  for (let offset = 1; offset + encoded.length <= bytes.length; offset += 1) {
    // Starts a string, rather than ending a longer one
    if (bytes[offset - 1] === 0) {
      let i = 0;
      while (i < encoded.length && bytes[offset + i] === encoded[i]) {
        i += 1;
      }
      if (i === encoded.length) {
        return offset;
      }
    }
  }
  return undefined;
}

/**
 * Changes one of the defaults Doom loads its settings from, as a config file
 * would. The port has no config file, and exports none of the settings, so
 * this finds the setting's entry in Doom's `defaults` table in the port's
 * memory: a pointer to its name, a pointer to the setting, then its default.
 * Call it before the game starts, which is when the defaults are loaded.
 * @param bytes The port's memory
 * @param name Name of the setting, as in Doom's config file
 * @param value Value for the setting to start with
 * @returns Whether the setting was found
 */
export function setDoomDefault(
  bytes: Uint8Array,
  name: string,
  value: number,
): boolean {
  const nameAddress = findString(bytes, name);
  if (nameAddress == null) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (
    let entry = 0;
    entry + POINTER_SIZE * 3 <= bytes.length;
    entry += POINTER_SIZE
  ) {
    if (view.getUint32(entry, true) === nameAddress) {
      const location = view.getUint32(entry + POINTER_SIZE, true);
      if (location > 0 && location < bytes.length) {
        view.setInt32(entry + POINTER_SIZE * 2, value, true);
        return true;
      }
    }
  }
  return false;
}

export default setDoomDefault;
