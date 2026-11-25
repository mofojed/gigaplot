import Plotly from "plotly.js-dist-min";
import type { Data, Layout } from "plotly.js";
import type { Bounds } from "../dataset";
import {
  AXIS_COLOR,
  BACKGROUND_COLOR,
  FONT_FAMILY,
  GRID_COLOR,
  TEXT_COLOR,
} from "../theme";
import type { BenchmarkAdapter, MountAdapter } from "./types";

function axis(min: number, max: number): Partial<Layout["xaxis"]> {
  return {
    range: [min, max],
    autorange: false,
    gridcolor: GRID_COLOR,
    linecolor: AXIS_COLOR,
    zeroline: false,
  };
}

function buildLayout(bounds: Bounds, revision: number): Partial<Layout> {
  return {
    datarevision: revision,
    paper_bgcolor: BACKGROUND_COLOR,
    plot_bgcolor: BACKGROUND_COLOR,
    font: { color: TEXT_COLOR, family: FONT_FAMILY, size: 11 },
    margin: { l: 50, r: 10, t: 10, b: 30 },
    showlegend: false,
    xaxis: axis(bounds.xMin, bounds.xMax),
    yaxis: axis(bounds.yMin, bounds.yMax),
  };
}

/**
 * Plotly's `scattergl` trace draws with WebGL through regl. `react` with a new
 * `datarevision` is the documented way to redraw arrays mutated in place.
 */
export const mountPlotly: MountAdapter = async (
  container,
  dataset,
  { pointSize, lineWidth },
): Promise<BenchmarkAdapter> => {
  const isScatter = dataset.kind === "scatter";
  let revision = 0;

  const buildTraces = (): Data[] =>
    dataset.series.map(({ name, color, x, y }) => ({
      type: "scattergl",
      mode: isScatter ? "markers" : "lines",
      name,
      x,
      y,
      hoverinfo: "skip",
      ...(isScatter
        ? { marker: { color, size: pointSize } }
        : { line: { color, width: lineWidth } }),
    }));

  await Plotly.newPlot(
    container,
    buildTraces(),
    buildLayout(dataset.getBounds(), revision),
    { staticPlot: true, displayModeBar: false, responsive: true },
  );

  return {
    update: async () => {
      revision += 1;
      await Plotly.react(
        container,
        buildTraces(),
        buildLayout(dataset.getBounds(), revision),
        { staticPlot: true, displayModeBar: false, responsive: true },
      );
    },
    destroy: () => Plotly.purge(container),
  };
};

export default mountPlotly;
