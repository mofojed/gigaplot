import type { MountAdapter } from "./adapters/types";
import type { PlotKind } from "./dataset";

export interface LibraryDefinition {
  id: string;
  name: string;
  /** What draws the data. */
  technology: string;
  kinds: readonly PlotKind[];
  /** How the library is configured, and anything that limits the comparison. */
  notes: string;
  /** Loaded on demand so only the library under test is in memory. */
  load: () => Promise<MountAdapter>;
}

export const LIBRARIES: readonly LibraryDefinition[] = [
  {
    id: "gigaplot-webgpu",
    name: "gigaplot",
    technology: "WebGPU",
    kinds: ["scatter", "line"],
    notes:
      "Every point, no downsampling. Ticks upload only the new points: scatter updates them in place, lines trim the oldest and append.",
    load: async () =>
      (await import("./adapters/gigaplot")).createGigaplotAdapter("webgpu"),
  },
  {
    id: "gigaplot-canvas",
    name: "gigaplot",
    technology: "Canvas 2D",
    kinds: ["scatter", "line"],
    notes: "gigaplot's fallback renderer, also without downsampling.",
    load: async () =>
      (await import("./adapters/gigaplot")).createGigaplotAdapter("canvas"),
  },
  {
    id: "plotly-webgl",
    name: "Plotly",
    technology: "WebGL",
    kinds: ["scatter", "line"],
    notes:
      "scattergl traces, static plot, redrawn with react and a datarevision.",
    load: async () => (await import("./adapters/plotly")).mountPlotly,
  },
  {
    id: "uplot",
    name: "uPlot",
    technology: "Canvas 2D",
    kinds: ["scatter", "line"],
    notes:
      "Lines merge points that share a pixel column as they draw. Scatter uses faceted mode with a circle path builder.",
    load: async () => (await import("./adapters/uplot")).mountUplot,
  },
  {
    id: "lightweight-charts",
    name: "Lightweight Charts",
    technology: "Canvas 2D",
    kinds: ["line"],
    notes:
      "TradingView's time series library. No scatter series; data is set again in full on every tick.",
    load: async () =>
      (await import("./adapters/lightweightCharts")).mountLightweightCharts,
  },
  {
    id: "echarts",
    name: "ECharts",
    technology: "Canvas 2D",
    kinds: ["scatter", "line"],
    notes:
      "Large mode scatter, typed array data, no animation, sampling, or progressive rendering.",
    load: async () => (await import("./adapters/echarts")).mountEcharts,
  },
  {
    id: "chartjs",
    name: "Chart.js",
    technology: "Canvas 2D",
    kinds: ["scatter", "line"],
    notes: "No animation, parsing, or events; normalized data.",
    load: async () => (await import("./adapters/chartjs")).mountChartJs,
  },
  {
    id: "deckgl",
    name: "deck.gl",
    technology: "WebGL2",
    kinds: ["scatter", "line"],
    notes:
      "A visualization framework, not a charting library: no axes are drawn. Binary attributes, re-uploaded in full every tick.",
    load: async () => (await import("./adapters/deckgl")).mountDeckGl,
  },
];

export function getLibrary(id: string): LibraryDefinition {
  const library = LIBRARIES.find((definition) => definition.id === id);
  if (library == null) {
    throw new Error(`Unknown library ${id}`);
  }
  return library;
}

export function getLibraryLabel({
  name,
  technology,
}: LibraryDefinition): string {
  return `${name} (${technology})`;
}
