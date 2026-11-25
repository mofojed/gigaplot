import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type {
  BenchmarkDataset,
  DatasetChange,
  DatasetSeries,
} from "../dataset";
import {
  AXIS_COLOR,
  BACKGROUND_COLOR,
  FONT_FAMILY,
  GRID_COLOR,
  TEXT_COLOR,
} from "../theme";
import type { BenchmarkAdapter, MountAdapter } from "./types";

echarts.use([LineChart, ScatterChart, GridComponent, CanvasRenderer]);

/** ECharts takes typed array data as interleaved x, y pairs. */
function interleave(
  { x, y }: DatasetSeries,
  target: Float64Array,
  offset = 0,
  count = x.length,
): Float64Array {
  for (let i = offset; i < offset + count; i += 1) {
    // eslint-disable-next-line no-param-reassign
    target[2 * i] = x[i];
    // eslint-disable-next-line no-param-reassign
    target[2 * i + 1] = y[i];
  }
  return target;
}

function axis(min: number, max: number) {
  return {
    type: "value" as const,
    min,
    max,
    axisLine: { lineStyle: { color: AXIS_COLOR } },
    splitLine: { lineStyle: { color: GRID_COLOR } },
    axisLabel: { color: TEXT_COLOR },
  };
}

/**
 * Apache ECharts on its Canvas 2D renderer. Scatter series use large mode,
 * ECharts' path for big data sets. Progressive rendering, which spreads one
 * draw over many frames, is off so every update is drawn in full like the
 * other libraries; animation and line sampling are off too.
 */
export const mountEcharts: MountAdapter = async (
  container,
  dataset,
  { pointSize, lineWidth },
): Promise<BenchmarkAdapter> => {
  const isScatter = dataset.kind === "scatter";
  const buffers = dataset.series.map((series) =>
    interleave(series, new Float64Array(series.x.length * 2)),
  );

  const buildSeries = (data: BenchmarkDataset["series"]) =>
    data.map(({ name, color }, index) =>
      isScatter
        ? {
            type: "scatter" as const,
            name,
            data: buffers[index],
            dimensions: ["x", "y"],
            large: true,
            largeThreshold: 0,
            progressive: 0,
            symbolSize: pointSize,
            itemStyle: { color },
            silent: true,
          }
        : {
            type: "line" as const,
            name,
            data: buffers[index],
            dimensions: ["x", "y"],
            showSymbol: false,
            symbol: "none",
            progressive: 0,
            lineStyle: { color, width: lineWidth },
            itemStyle: { color },
            silent: true,
          },
    );

  const chart = echarts.init(container, null, { renderer: "canvas" });
  const bounds = dataset.getBounds();
  chart.setOption({
    animation: false,
    backgroundColor: BACKGROUND_COLOR,
    textStyle: { fontFamily: FONT_FAMILY, fontSize: 11 },
    grid: { left: 50, right: 10, top: 10, bottom: 30 },
    xAxis: axis(bounds.xMin, bounds.xMax),
    yAxis: axis(bounds.yMin, bounds.yMax),
    series: buildSeries(dataset.series),
  });

  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(container);

  return {
    update: (change: DatasetChange) => {
      dataset.series.forEach((series, index) => {
        if (change.kind === "scatter") {
          change.ranges.forEach(({ offset, count }) =>
            interleave(series, buffers[index], offset, count),
          );
        } else {
          interleave(series, buffers[index]);
        }
      });
      const { xMin, xMax } = dataset.getBounds();
      chart.setOption({
        xAxis: { min: xMin, max: xMax },
        series: buildSeries(dataset.series),
      });
    },
    destroy: () => {
      observer.disconnect();
      chart.dispose();
    },
  };
};

export default mountEcharts;
