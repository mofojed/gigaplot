import { Deck, OrthographicView } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { BenchmarkDataset, DatasetChange } from "../dataset";
import type { BenchmarkAdapter, MountAdapter } from "./types";

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * deck.gl on WebGL2, a visualization framework rather than a charting
 * library, so there are no axes, only the data. Positions are packed into
 * binary attributes relative to the first bounds, as deck.gl's GPU positions
 * are 32 bit floats.
 */
export const mountDeckGl: MountAdapter = async (
  container,
  dataset,
  { pointSize, lineWidth },
): Promise<BenchmarkAdapter> => {
  const isScatter = dataset.kind === "scatter";
  const origin = dataset.getBounds();
  const positions = dataset.series.map(
    ({ x }) => new Float32Array(x.length * 2),
  );
  const colors = dataset.series.map(({ color }) => toRgb(color));

  const pack = (change?: DatasetChange): void => {
    dataset.series.forEach(({ x, y }, index) => {
      const target = positions[index];
      const ranges =
        change?.kind === "scatter"
          ? change.ranges
          : [{ offset: 0, count: x.length }];
      ranges.forEach(({ offset, count }) => {
        for (let i = offset; i < offset + count; i += 1) {
          target[2 * i] = x[i] - origin.xMin;
          target[2 * i + 1] = y[i] - origin.yMin;
        }
      });
    });
  };

  const buildLayers = (revision: number) =>
    dataset.series.map(({ id }, index) =>
      isScatter
        ? new ScatterplotLayer({
            id,
            data: {
              length: positions[index].length / 2,
              attributes: {
                getPosition: { value: positions[index], size: 2 },
              },
            },
            getFillColor: colors[index],
            getRadius: pointSize / 2,
            radiusUnits: "pixels",
            stroked: false,
            updateTriggers: { getPosition: revision },
          })
        : new PathLayer({
            id,
            data: {
              length: 1,
              startIndices: [0],
              attributes: { getPath: { value: positions[index], size: 2 } },
            },
            _pathType: "open",
            positionFormat: "XY",
            getColor: colors[index],
            getWidth: lineWidth,
            widthUnits: "pixels",
            updateTriggers: { getPath: revision },
          }),
    );

  const buildViewState = (
    bounds: ReturnType<BenchmarkDataset["getBounds"]>,
  ) => {
    const { width, height } = container.getBoundingClientRect();
    return {
      target: [
        (bounds.xMin + bounds.xMax) / 2 - origin.xMin,
        (bounds.yMin + bounds.yMax) / 2 - origin.yMin,
        0,
      ] as [number, number, number],
      zoom: [
        Math.log2(width / (bounds.xMax - bounds.xMin)),
        Math.log2(height / (bounds.yMax - bounds.yMin)),
      ] as [number, number],
    };
  };

  pack();
  let revision = 0;
  let resolveFirstRender: () => void = () => undefined;
  const firstRender = new Promise<void>((resolve) => {
    resolveFirstRender = resolve;
  });
  let rejectInit: (error: unknown) => void = () => undefined;
  const failed = new Promise<never>((_resolve, reject) => {
    rejectInit = reject;
  });

  const deck = new Deck({
    parent: container as HTMLDivElement,
    width: "100%",
    height: "100%",
    views: new OrthographicView({ flipY: false }),
    viewState: buildViewState(origin),
    controller: false,
    layers: buildLayers(revision),
    onAfterRender: () => resolveFirstRender(),
    onError: (error) => rejectInit(error),
  });

  try {
    await Promise.race([firstRender, failed]);
  } catch (error) {
    deck.finalize();
    throw error;
  }

  return {
    update: (change) => {
      pack(change);
      revision += 1;
      deck.setProps({
        layers: buildLayers(revision),
        viewState: buildViewState(dataset.getBounds()),
      });
    },
    destroy: () => deck.finalize(),
  };
};

export default mountDeckGl;
