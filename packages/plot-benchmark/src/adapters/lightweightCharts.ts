import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type ISeriesApi,
  type LineData,
  type LineWidth,
  type UTCTimestamp,
} from "lightweight-charts";
import type { DatasetSeries } from "../dataset";
import {
  AXIS_COLOR,
  BACKGROUND_COLOR,
  FONT_FAMILY,
  GRID_COLOR,
  TEXT_COLOR,
} from "../theme";
import type { BenchmarkAdapter, MountAdapter } from "./types";

function toLineData({ x, y }: DatasetSeries): LineData[] {
  const data: LineData[] = new Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    data[i] = { time: x[i] as UTCTimestamp, value: y[i] };
  }
  return data;
}

/**
 * TradingView's Lightweight Charts, on Canvas 2D. It is a time series library
 * with no scatter series. Data must be objects with strictly increasing times,
 * and there is no way to drop points from the front, so a scrolled window is
 * set again in full.
 */
export const mountLightweightCharts: MountAdapter = async (
  container,
  dataset,
  { lineWidth },
): Promise<BenchmarkAdapter> => {
  if (dataset.kind !== "line") {
    throw new Error("Lightweight Charts has no scatter series");
  }
  const { yMin, yMax } = dataset.getBounds();
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: BACKGROUND_COLOR },
      textColor: TEXT_COLOR,
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: GRID_COLOR },
      horzLines: { color: GRID_COLOR },
    },
    rightPriceScale: { borderColor: AXIS_COLOR },
    timeScale: {
      borderColor: AXIS_COLOR,
      // Its default of half a pixel would show only the newest points
      minBarSpacing: 1e-9,
      rightOffset: 0,
      tickMarkFormatter: (time: number) => `${time}`,
    },
    crosshair: { mode: CrosshairMode.Hidden },
    handleScroll: false,
    handleScale: false,
  });

  const series: ISeriesApi<"Line">[] = dataset.series.map(({ color }) =>
    chart.addSeries(LineSeries, {
      color,
      lineWidth: Math.min(4, Math.max(1, Math.round(lineWidth))) as LineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: yMin, maxValue: yMax },
      }),
    }),
  );

  const setData = () =>
    dataset.series.forEach((data, index) =>
      series[index].setData(toLineData(data)),
    );

  setData();
  chart.timeScale().fitContent();

  return {
    update: setData,
    destroy: () => chart.remove(),
  };
};

export default mountLightweightCharts;
