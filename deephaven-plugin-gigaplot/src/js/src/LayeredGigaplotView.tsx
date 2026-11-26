import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useApi } from "@deephaven/jsapi-bootstrap";
import type { dh as DhType } from "@deephaven/jsapi-types";
import { getSettings, type RootState } from "@deephaven/redux";
import {
  LayeredDataSource,
  Plot,
  type LayeredAxisOptions,
  type PlotAxisSide,
  type PlotFill,
  type PlotLegendPosition,
  type PlotScaleSpec,
  type PlotSeriesType,
} from "gigaplot";
import DownsamplingIndicator from "./DownsamplingIndicator";
import TableDataSource, {
  type InstantFormatterFactory,
} from "./TableDataSource";
import type { DownsampleParams } from "./downsampleParams";
import { InstantAxis } from "./instants";
import { createInstantFormatter } from "./instantFormatter";
import { getTooltipOptions, type TooltipProp } from "./tooltipOptions";
import { useFetchedTable } from "./useFetchedTable";

const CONTAINER_STYLE = {
  position: "relative",
  width: "100%",
  height: "100%",
} as const;

/** One layer of a plot: a table, the series to draw from it, and its axes. */
export interface GigaplotLayerProps {
  /** The table to plot. Absent until the first downsample request is served. */
  table?: DhType.WidgetExportedObject;
  /** The params `table` was downsampled for, present when downsampling. */
  viewport?: DownsampleParams;
  /** One row table with the full extent, present when downsampling. */
  bounds?: DhType.WidgetExportedObject;
  /** Asks the server for a new downsampled table, present when downsampling. */
  onViewportChange?: (params: DownsampleParams) => Promise<unknown>;
  x: string;
  /** Columns of `line`, `scatter`, and `area` series, one series each. */
  y?: string[] | null;
  /** Columns of `ohlc` and `candlestick` series, one series per index. */
  open?: string[] | null;
  high?: string[] | null;
  low?: string[] | null;
  close?: string[] | null;
  type: PlotSeriesType;
  /** True if the `y` columns of an `area` layer hold running totals to stack. */
  stacked?: boolean | null;
  /** Fill of each `area` series: a CSS color, a gradient, or null for the default. */
  fill?: (PlotFill | null)[] | null;
  /** CSS color of each series, or null for the theme's colorway. */
  color?: (string | null)[] | null;
  /** Point diameter or line width of every series, in pixels. */
  size?: number | null;
  /** Id of the x axis the layer is drawn against. Defaults to `x`. */
  xAxis?: string | null;
  /** Id of the y axis the layer is drawn against. Defaults to `y`. */
  yAxis?: string | null;
  /** The scale of the layer's x axis, which every layer on it shares. */
  xScale?: PlotScaleSpec | null;
  /** The scale of the layer's y axis. */
  yScale?: PlotScaleSpec | null;
}

/** Settings of an axis, by id in `axes`. */
export interface GigaplotAxisProps {
  side?: PlotAxisSide | null;
  /** Defaults to the first layer's column on the axis. Empty hides it. */
  title?: string | null;
}

export interface LayeredGigaplotViewProps {
  layers: GigaplotLayerProps[];
  /** Settings of each axis, by id, including the primary `x` and `y`. */
  axes?: Record<string, GigaplotAxisProps> | null;
  title?: string | null;
  /**
   * What to draw while hovering: a boolean for the default parts or none, or
   * the names of the parts to draw. See `TOOLTIP_PARTS`.
   */
  tooltip?: TooltipProp;
  /** Where to draw the legend. Defaults to over the top of the plot. */
  legendPosition?: PlotLegendPosition;
}

/** What a layer's source is made from, which recreates it when it changes. */
type LayerStructure = Omit<
  GigaplotLayerProps,
  "table" | "viewport" | "bounds" | "onViewportChange"
> & { isDownsampled: boolean };

function getLayerStructure({
  table,
  viewport,
  bounds,
  onViewportChange,
  ...rest
}: GigaplotLayerProps): LayerStructure {
  return { ...rest, isDownsampled: onViewportChange != null };
}

/**
 * Fetches a layer's tables into its source. Renders nothing; it is a
 * component so each layer can use hooks however many layers there are.
 */
function LayerTables({
  source,
  table,
  viewport,
  bounds,
  onError,
}: {
  source: TableDataSource;
  table?: DhType.WidgetExportedObject;
  viewport?: DownsampleParams;
  bounds?: DhType.WidgetExportedObject;
  onError: (error: unknown) => void;
}): null {
  // The viewport arrives in the same document update as its table
  const viewportKey = viewport == null ? "" : JSON.stringify(viewport);
  const setTable = useMemo(
    () => (fetched: DhType.Table) =>
      source.setTable(
        fetched,
        viewportKey === ""
          ? undefined
          : (JSON.parse(viewportKey) as DownsampleParams),
      ),
    [source, viewportKey],
  );
  const setBoundsTable = useMemo(
    () => source.setBoundsTable.bind(source),
    [source],
  );
  useFetchedTable(table, setTable, onError);
  useFetchedTable(bounds, setBoundsTable, onError);
  return null;
}

/**
 * Plots layers of tables together, each drawn against axes it names. Every
 * layer has its own source, downsampled on its own for the viewport of its
 * axes, and layers on the same axis count Instants from the same origin.
 */
export function LayeredGigaplotView({
  layers,
  axes,
  title,
  tooltip,
  legendPosition,
}: LayeredGigaplotViewProps): JSX.Element {
  const dh = useApi();
  const [error, setError] = useState<unknown>(null);
  const [downsampling, setDownsampling] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  // The callbacks may be new functions on each document update
  const onViewportChangesRef = useRef(
    layers.map((layer) => layer.onViewportChange),
  );
  onViewportChangesRef.current = layers.map((layer) => layer.onViewportChange);

  // Layer and axis settings are recreated on every render from the server
  // document. The sources outlive table swaps, so zooming does not reset them.
  const structureKey = JSON.stringify({
    layers: layers.map(getLayerStructure),
    axes: axes ?? null,
    title: title ?? null,
  });
  const { source, layerSources } = useMemo(() => {
    const structure = JSON.parse(structureKey) as {
      layers: LayerStructure[];
      axes: Record<string, GigaplotAxisProps> | null;
      title: string | null;
    };
    const instantAxes = new Map<string, InstantAxis>();
    const getInstants = (key: string): InstantAxis => {
      let instants = instantAxes.get(key);
      if (instants == null) {
        instants = new InstantAxis();
        instantAxes.set(key, instants);
      }
      return instants;
    };
    const sources = structure.layers.map(
      (
        { isDownsampled, xAxis, yAxis, stacked, xScale, yScale, ...layer },
        index,
      ) =>
        new TableDataSource(dh, {
          ...layer,
          stacked: stacked ?? false,
          xScale,
          yScale,
          xInstants: getInstants(`x:${xAxis ?? "x"}`),
          yInstants: getInstants(`y:${yAxis ?? "y"}`),
          onViewportChange: isDownsampled
            ? (params) => onViewportChangesRef.current[index]?.(params)
            : undefined,
          onDownsamplingChange: (isDownsampling) =>
            setDownsampling((previous) => {
              if (previous.has(index) === isDownsampling) {
                return previous;
              }
              const next = new Set(previous);
              if (isDownsampling) {
                next.add(index);
              } else {
                next.delete(index);
              }
              return next;
            }),
        }),
    );
    const axisOptions: Record<string, LayeredAxisOptions> = {};
    Object.entries(structure.axes ?? {}).forEach(([id, axis]) => {
      axisOptions[id] = {
        side: axis.side ?? undefined,
        label: axis.title ?? undefined,
      };
    });
    return {
      source: new LayeredDataSource(
        sources.map((layerSource, index) => ({
          source: layerSource,
          xAxis: structure.layers[index].xAxis ?? undefined,
          yAxis: structure.layers[index].yAxis ?? undefined,
        })),
        { title: structure.title ?? undefined, axes: axisOptions },
      ),
      layerSources: sources,
    };
  }, [dh, structureKey]);

  useEffect(() => {
    setError(null);
    setDownsampling(new Set());
    // Closes every layer's source too
    return () => source.close();
  }, [source]);

  // Instant axes are labelled the way the user's workspace formats dates
  const settings = useSelector(getSettings<RootState>);
  const instantFormatter = useMemo<InstantFormatterFactory>(
    () => (columnName) => createInstantFormatter(dh, settings, columnName),
    [dh, settings],
  );
  useEffect(() => {
    layerSources.forEach((layerSource) =>
      layerSource.setInstantFormatter(instantFormatter),
    );
  }, [layerSources, instantFormatter]);

  // The list is recreated on every document update, so compare its contents
  const tooltipKey = JSON.stringify(tooltip ?? null);
  const tooltipOptions = useMemo(
    () => getTooltipOptions(JSON.parse(tooltipKey) as TooltipProp),
    [tooltipKey],
  );
  const handleError = useCallback((e: unknown) => setError(e), []);

  return (
    <div style={CONTAINER_STYLE}>
      {layers.map((layer, index) => (
        <LayerTables
          // Layers are recreated with their sources, so their order is stable
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          source={layerSources[index]}
          table={layer.table}
          viewport={layer.viewport}
          bounds={layer.bounds}
          onError={handleError}
        />
      ))}
      {error != null && <div>{`${error}`}</div>}
      {/* Plot reads the Deephaven chart theme from CSS and follows theme switches */}
      {error == null && (
        <Plot
          source={source}
          tooltip={tooltipOptions}
          legendPosition={legendPosition}
          onError={handleError}
        />
      )}
      {error == null && downsampling.size > 0 && <DownsamplingIndicator />}
    </div>
  );
}

export default LayeredGigaplotView;
