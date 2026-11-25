import type { PlotKind } from "./dataset";
import type { RunConfig } from "./runner";

export const POINT_COUNT_PRESETS = [
  1_000, 10_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
  10_000_000, 20_000_000,
];

export const SERIES_COUNTS = [1, 2, 4, 8];

/** Fraction of every series replaced per frame. */
export const TICK_FRACTIONS = [0, 0.001, 0.01, 0.1, 0.25, 1];

export const POINT_SIZES = [1, 2, 3, 5];

export const LINE_WIDTHS = [1, 2];

export const DEFAULT_CONFIG: RunConfig = {
  kind: "scatter",
  pointCount: 100_000,
  seriesCount: 4,
  tickFraction: 0.1,
  pointSize: 2,
  lineWidth: 1,
};

export function formatCount(value: number): string {
  if (value >= 1_000_000 && value % 100_000 === 0) {
    return `${value / 1_000_000}M`;
  }
  if (value >= 1_000 && value % 100 === 0) {
    return `${value / 1_000}K`;
  }
  return value.toLocaleString();
}

/** Parses counts such as `2500`, `250k`, `2.5M`, or `1,000,000`. */
export function parseCount(text: string): number | undefined {
  const match = /^\s*([\d.,_]+)\s*([kKmM]?)\s*$/.exec(text);
  if (match == null) {
    return undefined;
  }
  const value = Number.parseFloat(match[1].replace(/[,_]/g, ""));
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const multiplier = { "": 1, k: 1_000, m: 1_000_000 }[
    match[2].toLowerCase() as "" | "k" | "m"
  ];
  const count = Math.round(value * multiplier);
  return count >= 1 ? count : undefined;
}

export function formatTickFraction(fraction: number): string {
  if (fraction === 0) {
    return "Off (draw once)";
  }
  return `${fraction * 100}% per frame`;
}

function readNumber(
  params: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const text = params.get(key);
  if (text == null) {
    return fallback;
  }
  const value = key === "points" ? parseCount(text) : Number(text);
  return value != null && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

/** Reads a config from the query string, so a run can be linked to. */
export function readConfig(search: string): RunConfig {
  const params = new URLSearchParams(search);
  const kind: PlotKind = params.get("kind") === "line" ? "line" : "scatter";
  return {
    kind,
    pointCount: readNumber(params, "points", DEFAULT_CONFIG.pointCount),
    seriesCount: Math.max(
      1,
      Math.round(readNumber(params, "series", DEFAULT_CONFIG.seriesCount)),
    ),
    tickFraction: Math.min(
      1,
      readNumber(params, "tick", DEFAULT_CONFIG.tickFraction),
    ),
    pointSize: readNumber(params, "size", DEFAULT_CONFIG.pointSize),
    lineWidth: readNumber(params, "width", DEFAULT_CONFIG.lineWidth),
  };
}

export function writeConfig(config: RunConfig, libraryId: string): string {
  const params = new URLSearchParams({
    lib: libraryId,
    kind: config.kind,
    points: `${config.pointCount}`,
    series: `${config.seriesCount}`,
    tick: `${config.tickFraction}`,
    size: `${config.pointSize}`,
    width: `${config.lineWidth}`,
  });
  return `?${params.toString()}`;
}
