import type { Bounds, PlotFill } from '../model/PlotTypes';
import { parseColor, type Rgba } from '../theme/parseColor';

/** A gradient stop with its offset normalized to 0 to 1 and its color parsed. */
export interface ResolvedFillStop {
  offset: number;
  /** Not premultiplied, with the stop's opacity applied. */
  color: Rgba;
}

/**
 * An area fill in the terms both renderers draw it in: colors varying along
 * one axis between two values on it. A solid fill is a single stop.
 */
export interface ResolvedAreaFill {
  axis: 'x' | 'y';
  /** The value on `axis` at offset 0. */
  start: number;
  /** The value on `axis` at offset 1. */
  end: number;
  /** At least one, sorted by offset. */
  stops: ResolvedFillStop[];
}

/** Stops the WebGPU fill shader holds. Longer gradients are resampled. */
export const MAX_FILL_STOPS = 16;

/** Fills are resolved every frame, and named colors are parsed by drawing them. */
const parsedColors = new Map<string, Rgba>();

const MAX_PARSED_COLORS = 256;

function parseCachedColor(color: string): Rgba {
  let parsed = parsedColors.get(color);
  if (parsed == null) {
    if (parsedColors.size >= MAX_PARSED_COLORS) {
      parsedColors.clear();
    }
    parsed = parseColor(color);
    parsedColors.set(color, parsed);
  }
  return parsed;
}

function withOpacity(color: Rgba, opacity: number): Rgba {
  return [color[0], color[1], color[2], color[3] * opacity];
}

/**
 * Resolves the fill of an `area` series for the current viewport. Without a
 * fill, an area is its line color at `defaultOpacity`.
 *
 * Offsets are rescaled so the outermost stops sit at 0 and 1, since a canvas
 * gradient only takes stops in that range; `start` and `end` move to match.
 */
export function resolveAreaFill(
  fill: PlotFill | undefined,
  seriesColor: string,
  defaultOpacity: number,
  viewport: Bounds
): ResolvedAreaFill {
  if (fill == null || typeof fill === 'string') {
    const color =
      fill == null
        ? withOpacity(parseCachedColor(seriesColor), defaultOpacity)
        : parseCachedColor(fill);
    return { axis: 'y', start: 0, end: 1, stops: [{ offset: 0, color }] };
  }
  const isVertical = fill.direction !== 'horizontal';
  const axis = isVertical ? 'y' : 'x';
  const isData = fill.units === 'data';
  const count = fill.stops.length;
  const stops = fill.stops
    .map((stop, i) => ({
      offset: stop.offset ?? (count > 1 ? i / (count - 1) : 0),
      color: withOpacity(
        parseCachedColor(stop.color ?? seriesColor),
        stop.opacity ?? 1
      ),
    }))
    .filter(stop => Number.isFinite(stop.offset))
    // Stable, so stops at the same offset keep their order and make a hard edge
    .sort((a, b) => a.offset - b.offset);
  if (stops.length === 0) {
    return {
      axis,
      start: 0,
      end: 1,
      stops: [{ offset: 0, color: parseCachedColor(seriesColor) }],
    };
  }
  let low = stops[0].offset;
  let high = stops[stops.length - 1].offset;
  if (!(high > low)) {
    // Every stop at one offset is a hard edge there, so give it a sliver
    high = low + Math.max(Math.abs(low), 1) * 1e-6;
  }
  // Plot units run from the top, or left, of the plot area to the other side
  let origin = 0;
  let scale = 1;
  if (!isData) {
    origin = isVertical ? viewport.yMax : viewport.xMin;
    scale = isVertical
      ? viewport.yMin - viewport.yMax
      : viewport.xMax - viewport.xMin;
  }
  const span = high - low;
  const from = low;
  low = origin + low * scale;
  high = origin + high * scale;
  return {
    axis,
    start: low,
    end: high,
    stops: stops.map(stop => ({
      offset: (stop.offset - from) / span,
      color: stop.color,
    })),
  };
}

/** The color of a fill at `offset`, between 0 and 1, blended unpremultiplied like a canvas gradient. */
export function sampleFillStops(
  stops: readonly ResolvedFillStop[],
  offset: number
): Rgba {
  if (offset <= stops[0].offset) {
    return stops[0].color;
  }
  for (let i = 1; i < stops.length; i += 1) {
    const next = stops[i];
    if (offset < next.offset) {
      const previous = stops[i - 1];
      const t = (offset - previous.offset) / (next.offset - previous.offset);
      return previous.color.map(
        (channel, c) => channel + (next.color[c] - channel) * t
      ) as Rgba;
    }
  }
  return stops[stops.length - 1].color;
}

/** Evenly resamples a gradient with more stops than the WebGPU shader holds. */
export function limitFillStops(
  stops: ResolvedFillStop[],
  limit = MAX_FILL_STOPS
): ResolvedFillStop[] {
  if (stops.length <= limit) {
    return stops;
  }
  return Array.from({ length: limit }, (_unused, i) => {
    const offset = i / (limit - 1);
    return { offset, color: sampleFillStops(stops, offset) };
  });
}

/** Formats a parsed color for a canvas. */
export function rgbaToCss([red, green, blue, alpha]: Rgba): string {
  const channel = (value: number): number =>
    Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${Math.min(
    1,
    Math.max(0, alpha)
  )})`;
}
