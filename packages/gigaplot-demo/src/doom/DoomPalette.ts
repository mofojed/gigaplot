import { DOOM_WIDTH, type DoomFrame } from "./doomFrame";
import { PALETTE_SIZE, UNSEEN, getLuminance, packRgb } from "./doomColors";

/**
 * Doom's palette, learned from the frames as they appear.
 *
 * Doom keeps a palette index for every pixel and only turns them into colors
 * when it draws, so the color of each index is read off the RGBA frame at a
 * pixel using it. Doom swaps palettes to tint the screen, such as red on
 * taking damage, so colors are read again on every frame.
 */
export class DoomPalette {
  /** The color of each palette index, or {@link UNSEEN}. */
  readonly colors = new Int32Array(PALETTE_SIZE).fill(UNSEEN);

  /** Brightness of each palette index, from 0 to 1, or 0 if unseen. */
  readonly luminance = new Float32Array(PALETTE_SIZE);

  /** Goes up whenever a color changes, so users can tell they are stale. */
  version = 0;

  private samples = new Int32Array(PALETTE_SIZE);

  private listeners = new Set<(colors: Int32Array) => void>();

  /** Reads the colors in a frame, telling listeners if any changed. */
  learn({ indexes, rgba, rgbaWidth }: DoomFrame): boolean {
    const { samples, colors } = this;
    samples.fill(-1);
    for (let i = 0; i < indexes.length; i += 1) {
      if (samples[indexes[i]] < 0) {
        samples[indexes[i]] = i;
      }
    }
    const scale = rgbaWidth / DOOM_WIDTH;
    let isChanged = false;
    for (let index = 0; index < PALETTE_SIZE; index += 1) {
      const pixel = samples[index];
      if (pixel >= 0) {
        const column = pixel % DOOM_WIDTH;
        const row = (pixel - column) / DOOM_WIDTH;
        const offset = (row * scale * rgbaWidth + column * scale) * 4;
        const rgb = packRgb(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
        if (colors[index] !== rgb) {
          colors[index] = rgb;
          this.luminance[index] = getLuminance(rgb);
          isChanged = true;
        }
      }
    }
    if (isChanged) {
      this.version += 1;
      const copy = colors.slice();
      this.listeners.forEach((listener) => listener(copy));
    }
    return isChanged;
  }

  /** Calls `listener` with a copy of the colors whenever any change. */
  onChanged(listener: (colors: Int32Array) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export default DoomPalette;
