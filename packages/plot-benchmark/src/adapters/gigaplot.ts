import {
  AbstractPlotDataSource,
  PlotView,
  type PlotShape,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
} from "gigaplot";
import type { BenchmarkDataset, DatasetChange } from "../dataset";
import type { AdapterOptions, BenchmarkAdapter, MountAdapter } from "./types";

/**
 * Hands gigaplot every point, never downsampled, and reports each tick as the
 * smallest deltas that describe it. Scatter ticks become `update` deltas over
 * just the replaced points; a scrolled line drops its oldest points with
 * `trimStart` and adds the new ones with `append`.
 */
class DatasetSource extends AbstractPlotDataSource {
  private dataset: BenchmarkDataset;

  private options: AdapterOptions;

  constructor(dataset: BenchmarkDataset, options: AdapterOptions) {
    super();
    this.dataset = dataset;
    this.options = options;
  }

  private buildShape(): PlotShape {
    const { dataset, options } = this;
    const bounds = dataset.getBounds();
    return {
      series: dataset.series.map(({ id, name, color }) => ({
        id,
        name,
        type: dataset.kind,
        style: {
          color,
          pointSize: options.pointSize,
          lineWidth: options.lineWidth,
        },
        bounds,
      })),
      bounds,
    };
  }

  async getShape(): Promise<PlotShape> {
    return this.buildShape();
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    const series = this.dataset.series.find(
      ({ id }) => id === request.seriesId,
    );
    if (series == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    const { x, y } = series;
    // Renderers copy what they are given, so the live arrays can be handed over
    return { data: { x, y, length: x.length }, complete: true };
  }

  apply(change: DatasetChange): void {
    const deltas: SeriesDelta[] = [];
    if (change.kind === "scatter") {
      this.dataset.series.forEach(({ id, x, y }) => {
        change.ranges.forEach(({ offset, count }) => {
          deltas.push({
            type: "update",
            seriesId: id,
            offset,
            data: {
              x: x.subarray(offset, offset + count),
              y: y.subarray(offset, offset + count),
              length: count,
            },
          });
        });
      });
    } else {
      this.fireShapeChanged(this.buildShape());
      const { shift } = change;
      this.dataset.series.forEach(({ id, x, y }) => {
        const start = x.length - shift;
        deltas.push(
          { type: "trimStart", seriesId: id, count: shift },
          {
            type: "append",
            seriesId: id,
            data: {
              x: x.subarray(start),
              y: y.subarray(start),
              length: shift,
            },
          },
        );
      });
    }
    this.fireDataChanged(deltas);
  }
}

export function createGigaplotAdapter(
  renderer: "webgpu" | "canvas",
): MountAdapter {
  return async (container, dataset, options): Promise<BenchmarkAdapter> => {
    const source = new DatasetSource(dataset, options);
    const view = new PlotView(container, source, {
      rendererPreference: [renderer],
      tooltip: false,
      smoothZoom: false,
    });
    try {
      const firstFrame = new Promise<void>((resolve, reject) => {
        view.addEventListener("frame", () => resolve());
        view.addEventListener("error", ({ error }) => reject(error));
      });
      await view.initialize();
      const name = view.getRendererName();
      if (name !== renderer) {
        throw new Error(
          `gigaplot used the ${name ?? "no"} renderer, not ${renderer}`,
        );
      }
      await firstFrame;
    } catch (error) {
      view.destroy();
      source.close();
      throw error;
    }
    return {
      update: (change) => source.apply(change),
      destroy: () => {
        view.destroy();
        source.close();
      },
    };
  };
}
