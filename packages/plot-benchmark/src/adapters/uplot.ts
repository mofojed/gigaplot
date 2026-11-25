import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { BenchmarkDataset } from "../dataset";
import { AXIS_COLOR, FONT_FAMILY, GRID_COLOR, TEXT_COLOR } from "../theme";
import type { BenchmarkAdapter, MountAdapter } from "./types";

const AXIS: uPlot.Axis = {
  stroke: TEXT_COLOR,
  font: `11px ${FONT_FAMILY}`,
  grid: { stroke: GRID_COLOR, width: 1 },
  ticks: { stroke: AXIS_COLOR, width: 1 },
};

/** Points per fill. Chrome silently drops a fill of a few hundred thousand arcs. */
const POINTS_PER_FILL = 4096;

/**
 * uPlot has no scatter series of its own; its faceted mode leaves drawing to a
 * path builder. This draws circles like the builder in uPlot's scatter demo,
 * minus the hover quadtree, filling them in batches.
 */
function createPointsBuilder(
  pointSize: number,
  colors: string[],
): uPlot.Series.PathBuilder {
  return (u, seriesIdx) => {
    const [xs, ys] = u.data[seriesIdx] as unknown as [
      Float64Array,
      Float64Array,
    ];
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    const xMin = u.scales.x.min ?? 0;
    const xMax = u.scales.x.max ?? 1;
    const yMin = u.scales.y.min ?? 0;
    const yMax = u.scales.y.max ?? 1;
    const sx = width / (xMax - xMin);
    const sy = height / (yMax - yMin);
    const radius = (pointSize * uPlot.pxRatio) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.fillStyle = colors[seriesIdx - 1];
    for (let start = 0; start < xs.length; start += POINTS_PER_FILL) {
      const end = Math.min(xs.length, start + POINTS_PER_FILL);
      ctx.beginPath();
      for (let i = start; i < end; i += 1) {
        const cx = left + (xs[i] - xMin) * sx;
        const cy = top + height - (ys[i] - yMin) * sy;
        ctx.moveTo(cx + radius, cy);
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    ctx.restore();
    return null;
  };
}

function buildData(dataset: BenchmarkDataset): uPlot.AlignedData {
  if (dataset.kind === "scatter") {
    // Faceted data is [null, [xs, ys], ...], which the typings do not cover
    return [
      null,
      ...dataset.series.map(({ x, y }) => [x, y]),
    ] as unknown as uPlot.AlignedData;
  }
  return [dataset.series[0].x, ...dataset.series.map(({ y }) => y)];
}

/**
 * Canvas 2D. The y scale is fixed, so uPlot never scans the data for its
 * range.
 */
export const mountUplot: MountAdapter = async (
  container,
  dataset,
  { pointSize, lineWidth },
): Promise<BenchmarkAdapter> => {
  const isScatter = dataset.kind === "scatter";
  const bounds = dataset.getBounds();
  const points = createPointsBuilder(
    pointSize,
    dataset.series.map(({ color }) => color),
  );
  const { width, height } = container.getBoundingClientRect();

  const plot = new uPlot(
    {
      mode: isScatter ? 2 : 1,
      width,
      height,
      legend: { show: false },
      cursor: { show: false },
      scales: {
        // A line's x range is its first and last x, which costs nothing to
        // find, and has to be automatic for uPlot to window the data to it
        x: isScatter
          ? { time: false, auto: false, range: [bounds.xMin, bounds.xMax] }
          : {
              time: false,
              auto: true,
              range: () => {
                const { xMin, xMax } = dataset.getBounds();
                return [xMin, xMax];
              },
            },
        y: { auto: false, range: [bounds.yMin, bounds.yMax] },
      },
      axes: [AXIS, AXIS],
      series: [
        {},
        ...dataset.series.map(({ name, color }) =>
          isScatter
            ? { label: name, stroke: color, fill: color, paths: points }
            : {
                label: name,
                stroke: color,
                width: lineWidth,
                points: { show: false },
              },
        ),
      ],
    },
    buildData(dataset),
    container,
  );

  const observer = new ResizeObserver(([entry]) => {
    plot.setSize({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    });
  });
  observer.observe(container);

  return {
    update: () => {
      // Batching draws now, rather than in a microtask, so the draw is timed
      plot.batch(() => plot.setData(buildData(dataset)));
    },
    destroy: () => {
      observer.disconnect();
      plot.destroy();
    },
  };
};

export default mountUplot;
