/** Doom's own resolution. Every frame is drawn at this size, then scaled up. */
export const DOOM_WIDTH = 320;
export const DOOM_HEIGHT = 200;

export interface DoomFrame {
  /** Palette index of every pixel, row major, `DOOM_WIDTH` by `DOOM_HEIGHT`. */
  indexes: Uint8Array;
  /** The frame as RGBA, row major, `rgbaWidth` pixels wide. */
  rgba: Uint8Array;
  /** Width of `rgba` in pixels, a whole multiple of `DOOM_WIDTH`. */
  rgbaWidth: number;
}
