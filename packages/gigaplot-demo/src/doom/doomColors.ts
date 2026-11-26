/** Doom draws every frame from a palette of this many colors. */
export const PALETTE_SIZE = 256;

/** Marks a palette entry that has not appeared on screen yet. */
export const UNSEEN = -1;

/** How the palette series are colored. */
export type DoomColorMode =
  "doom" | "colorway" | "night-vision" | "thermal" | "vice-city" | "rainbow";

export const DOOM_COLOR_MODES: { id: DoomColorMode; label: string }[] = [
  { id: "doom", label: "Doom palette" },
  { id: "colorway", label: "Plot colorway" },
  { id: "night-vision", label: "Night vision" },
  { id: "thermal", label: "Thermal" },
  { id: "vice-city", label: "Vice City" },
  { id: "rainbow", label: "Rainbow" },
];

/** Broad hues the palette can be hidden or shown by. */
export type DoomColorGroup =
  "reds" | "browns" | "yellows" | "greens" | "blues" | "greys";

export const DOOM_COLOR_GROUPS: { id: DoomColorGroup; label: string }[] = [
  { id: "reds", label: "Reds" },
  { id: "browns", label: "Browns" },
  { id: "yellows", label: "Yellows" },
  { id: "greens", label: "Greens" },
  { id: "blues", label: "Blues" },
  { id: "greys", label: "Greys" },
];

type Rgb = [number, number, number];

/** Thermal camera stops, from cold to hot. */
const THERMAL_STOPS: Rgb[] = [
  [0, 0, 16],
  [72, 12, 120],
  [190, 30, 90],
  [245, 110, 20],
  [255, 220, 60],
  [255, 255, 240],
];

/** A Vice City sunset, from the night sky down to the sun. */
const SUNSET_STOPS: Rgb[] = [
  [18, 4, 43],
  [61, 15, 110],
  [155, 29, 143],
  [255, 46, 136],
  [255, 122, 69],
  [255, 210, 138],
];

/** Vice City's sea, for what Doom draws in blues and greens. */
const SEA_STOPS: Rgb[] = [
  [6, 26, 48],
  [11, 98, 122],
  [25, 195, 201],
  [127, 245, 232],
  [232, 255, 249],
];

export function packRgb(red: number, green: number, blue: number): number {
  return (red << 16) | (green << 8) | blue;
}

export function toCssColor(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

function channels(rgb: number): [number, number, number] {
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

/** Perceived brightness, from 0 to 1. */
export function getLuminance(rgb: number): number {
  const [red, green, blue] = channels(rgb);
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

/** The color `value`, from 0 to 1, of the way along evenly spaced `stops`. */
function interpolateStops(stops: Rgb[], value: number): string {
  const position = Math.min(1, Math.max(0, value)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const t = position - index;
  const from = stops[index];
  const to = stops[index + 1];
  return toCssColor(
    packRgb(
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ),
  );
}

/** A thermal camera color for `value`, from 0, cold, to 1, hot. */
export function getThermalColor(value: number): string {
  return interpolateStops(THERMAL_STOPS, value);
}

/**
 * A Vice City color for `rgb`: a sunset of purples, pinks, and oranges by
 * brightness, with blues and greens turned to a turquoise sea.
 */
export function getViceCityColor(rgb: number): string {
  // Doom is dark, so brighten it towards the pinks and oranges
  const level = getLuminance(rgb) ** 0.6;
  const group = getColorGroup(rgb);
  return interpolateStops(
    group === "blues" || group === "greens" ? SEA_STOPS : SUNSET_STOPS,
    level,
  );
}

/**
 * The color to draw a palette entry with. `undefined` leaves it to the plot
 * theme's colorway, which picks by series index.
 */
export function getSeriesColor(
  mode: DoomColorMode,
  index: number,
  rgb: number,
): string | undefined {
  if (mode === "colorway") {
    return undefined;
  }
  if (rgb === UNSEEN) {
    // Nothing is drawn in an unseen color, so any color will do
    return "#000000";
  }
  const luminance = getLuminance(rgb);
  switch (mode) {
    case "night-vision": {
      // Lift the shadows, as image intensifiers do
      const level = Math.sqrt(luminance);
      return toCssColor(
        packRgb(
          Math.round(40 * level),
          Math.round(255 * level),
          Math.round(70 * level),
        ),
      );
    }
    case "thermal":
      return getThermalColor(luminance);
    case "vice-city":
      return getViceCityColor(rgb);
    case "rainbow": {
      // Palette ramps run in blocks of 16, so each ramp sweeps the spectrum
      const hue = ((index % 32) * 360) / 32;
      const lightness = 12 + 70 * luminance;
      return `hsl(${hue} 95% ${lightness}%)`;
    }
    default:
      return toCssColor(rgb);
  }
}

/** Sorts a palette color into a broad hue, for hiding colors in groups. */
export function getColorGroup(rgb: number): DoomColorGroup | undefined {
  if (rgb === UNSEEN) {
    return undefined;
  }
  const [red, green, blue] = channels(rgb).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  const saturation =
    chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.2 || lightness < 0.06) {
    return "greys";
  }
  let hue: number;
  if (max === red) {
    hue = (((green - blue) / chroma) % 6) * 60;
  } else if (max === green) {
    hue = ((blue - red) / chroma + 2) * 60;
  } else {
    hue = ((red - green) / chroma + 4) * 60;
  }
  if (hue < 0) {
    hue += 360;
  }
  if (hue < 15 || hue >= 290) {
    return "reds";
  }
  if (hue < 45) {
    return "browns";
  }
  if (hue < 70) {
    return "yellows";
  }
  if (hue < 170) {
    return "greens";
  }
  return "blues";
}
