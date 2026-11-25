import {
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  type ChartConfiguration,
  type Point,
} from "chart.js";
import { GRID_COLOR, TEXT_COLOR } from "../theme";
import type { BenchmarkAdapter, MountAdapter } from "./types";

Chart.register(
  LineController,
  ScatterController,
  LineElement,
  PointElement,
  LinearScale,
);

/**
 * Chart.js on Canvas 2D, configured per its performance guide: no animation,
 * no parsing, normalized data, and no hover events. Unparsed data must be
 * `{ x, y }` objects, which are kept and rewritten in place.
 */
export const mountChartJs: MountAdapter = async (
  container,
  dataset,
  { pointSize, lineWidth },
): Promise<BenchmarkAdapter> => {
  const isScatter = dataset.kind === "scatter";
  const points: Point[][] = dataset.series.map(({ x, y }) =>
    Array.from(x, (value, i) => ({ x: value, y: y[i] })),
  );
  const bounds = dataset.getBounds();
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  const scale = (min: number, max: number) => ({
    type: "linear" as const,
    min,
    max,
    grid: { color: GRID_COLOR },
    ticks: { color: TEXT_COLOR },
  });

  const config: ChartConfiguration<"scatter" | "line", Point[]> = {
    type: isScatter ? "scatter" : "line",
    data: {
      datasets: dataset.series.map(({ name, color }, index) => ({
        label: name,
        data: points[index],
        borderColor: color,
        backgroundColor: color,
        borderWidth: isScatter ? 0 : lineWidth,
        pointRadius: isScatter ? pointSize / 2 : 0,
        tension: 0,
        spanGaps: true,
      })),
    },
    options: {
      animation: false,
      parsing: false,
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: scale(bounds.xMin, bounds.xMax),
        y: scale(bounds.yMin, bounds.yMax),
      },
    },
  };
  const chart = new Chart(canvas, config);

  return {
    update: (change) => {
      dataset.series.forEach(({ x, y }, index) => {
        const target = points[index];
        const ranges =
          change.kind === "scatter"
            ? change.ranges
            : [{ offset: 0, count: x.length }];
        ranges.forEach(({ offset, count }) => {
          for (let i = offset; i < offset + count; i += 1) {
            target[i].x = x[i];
            target[i].y = y[i];
          }
        });
      });
      if (change.kind === "line") {
        const { xMin, xMax } = dataset.getBounds();
        const xScale = chart.options.scales?.x;
        if (xScale != null) {
          xScale.min = xMin;
          xScale.max = xMax;
        }
      }
      chart.update("none");
    },
    destroy: () => {
      chart.destroy();
      canvas.remove();
    },
  };
};

export default mountChartJs;
