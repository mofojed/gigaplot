import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useApi } from "@deephaven/jsapi-bootstrap";
import type { dh as DhType } from "@deephaven/jsapi-types";
import Log from "@deephaven/log";
import { getSettings, type RootState } from "@deephaven/redux";
import {
  is3DSeriesType,
  Plot,
  Plot3D,
  type Plot3DCamera,
  type Plot3DPointScaling,
  type PlotFill,
  type PlotLegendPosition,
  type PlotScaleSpec,
  type PlotSeriesType,
} from "gigaplot";
import DownsamplingIndicator from "./DownsamplingIndicator";
import TableDataSource, {
  type InstantFormatterFactory,
  type TableDataSourceOptions,
} from "./TableDataSource";
import type { DownsampleParams } from "./downsampleParams";
import { createInstantFormatter } from "./instantFormatter";
import { getTooltipOptions, type TooltipProp } from "./tooltipOptions";

const log = Log.module("deephaven-plugin-gigaplot.GigaplotView");

const CONTAINER_STYLE = {
  position: "relative",
  width: "100%",
  height: "100%",
} as const;

export interface GigaplotViewProps {
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
  /** Columns of the z values of `scatter3d` and `line3d` series, paired with `y`. */
  z?: string[] | null;
  type?: PlotSeriesType;
  /** True if the `y` columns of an `area` plot hold running totals to stack. */
  stacked?: boolean | null;
  /** Fill of each `area` series: a CSS color, a gradient, or null for the default. */
  fill?: (PlotFill | null)[] | null;
  title?: string | null;
  /** Defaults to the x column name. Empty hides the title. */
  xTitle?: string | null;
  /** Defaults to the y column name if there is only one. Empty hides the title. */
  yTitle?: string | null;
  /** Title of the z axis of a 3D plot. Empty hides it. */
  zTitle?: string | null;
  /** CSS color of each series, or null for the theme's colorway. */
  color?: (string | null)[] | null;
  /** Point diameter or line width of every series, in pixels. */
  size?: number | null;
  /** Where the camera of a 3D plot starts. */
  camera?: Partial<Plot3DCamera> | null;
  /** Draws the box of a 3D plot. Defaults to true. */
  showAxes?: boolean | null;
  /** How the points of a 3D plot are sized. Defaults to `fixed`. */
  pointScaling?: Plot3DPointScaling | null;
  /** How much the farthest data of a 3D plot fades, from 0 to 1. */
  depthFade?: number | null;
  /** The x axis' scale, such as a business calendar, from `x_scale`. */
  xScale?: PlotScaleSpec | null;
  /** The y axis' scale, such as a log scale, from `y_scale`. */
  yScale?: PlotScaleSpec | null;
  /** Fixed `[min, max]` ranges of the axes of a 3D plot. */
  xRange?: [number, number] | null;
  yRange?: [number, number] | null;
  zRange?: [number, number] | null;
  /**
   * What to draw while hovering: a boolean for the default parts or none, or
   * the names of the parts to draw. See `TOOLTIP_PARTS`.
   */
  tooltip?: TooltipProp;
  /** Where to draw the legend. Defaults to over the top of the plot. */
  legendPosition?: PlotLegendPosition;
}

/**
 * Fetches each exported table and hands it to `onTable`, which takes
 * ownership. A fetch that is superseded before it resolves is closed instead.
 */
function useFetchedTable(
  exported: DhType.WidgetExportedObject | undefined,
  onTable: ((table: DhType.Table) => void) | undefined,
  onError: (error: unknown) => void,
): void {
  useEffect(
    function fetchTable() {
      if (exported == null || onTable == null) {
        return undefined;
      }
      let isCancelled = false;
      // Re-export so the table outlives the document update that sent it
      exported
        .reexport()
        .then((reexported) => reexported.fetch())
        .then((result) => {
          const table = result as DhType.Table;
          if (isCancelled) {
            table.close();
            return;
          }
          onTable(table);
        })
        .catch((e) => {
          if (!isCancelled) {
            log.error("Unable to fetch table", e);
            onError(e);
          }
        });
      return () => {
        isCancelled = true;
      };
    },
    [exported, onTable, onError],
  );
}

export function GigaplotView({
  table: exportedTable,
  viewport,
  bounds: exportedBounds,
  onViewportChange,
  x,
  y,
  open,
  high,
  low,
  close,
  z,
  type = "line",
  stacked,
  fill,
  title,
  xTitle,
  yTitle,
  zTitle,
  color,
  size,
  camera,
  showAxes,
  pointScaling,
  depthFade,
  xRange,
  yRange,
  zRange,
  xScale,
  yScale,
  tooltip,
  legendPosition,
}: GigaplotViewProps): JSX.Element {
  const dh = useApi();
  const [error, setError] = useState<unknown>(null);
  const [isDownsampling, setIsDownsampling] = useState(false);

  // The callback may be a new function on each document update
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const isDownsampled = onViewportChange != null;

  // Column arrays are recreated on every render from the server document.
  // The source outlives table swaps, so zooming does not reset the plot.
  const columnsKey = JSON.stringify({ y, open, high, low, close, z });
  const fillKey = JSON.stringify(fill ?? null);
  const styleKey = JSON.stringify({ color: color ?? null, size: size ?? null });
  const rangesKey = JSON.stringify({ x: xRange, y: yRange, z: zRange });
  const scalesKey = JSON.stringify({
    xScale: xScale ?? null,
    yScale: yScale ?? null,
  });
  const source = useMemo(
    () =>
      new TableDataSource(dh, {
        x,
        ...(JSON.parse(columnsKey) as Record<string, string[] | null>),
        type,
        stacked: stacked ?? false,
        fill: JSON.parse(fillKey) as (PlotFill | null)[] | null,
        ...(JSON.parse(styleKey) as {
          color: (string | null)[] | null;
          size: number | null;
        }),
        ranges: JSON.parse(rangesKey) as TableDataSourceOptions["ranges"],
        ...(JSON.parse(scalesKey) as {
          xScale: PlotScaleSpec | null;
          yScale: PlotScaleSpec | null;
        }),
        title: title ?? undefined,
        xAxisLabel: xTitle ?? undefined,
        yAxisLabel: yTitle ?? undefined,
        zAxisLabel: zTitle ?? undefined,
        onViewportChange: isDownsampled
          ? (params) => onViewportChangeRef.current?.(params)
          : undefined,
        onDownsamplingChange: setIsDownsampling,
      }),
    [
      dh,
      x,
      columnsKey,
      type,
      stacked,
      fillKey,
      styleKey,
      rangesKey,
      scalesKey,
      title,
      xTitle,
      yTitle,
      zTitle,
      isDownsampled,
    ],
  );

  // A new camera object comes with every document update, so compare its contents
  const cameraKey = JSON.stringify(camera ?? null);
  const initialCamera = useMemo(
    () => (JSON.parse(cameraKey) as Partial<Plot3DCamera> | null) ?? undefined,
    [cameraKey],
  );

  useEffect(() => {
    setError(null);
    setIsDownsampling(false);
    return () => source.close();
  }, [source]);

  // Instant axes are labelled the way the user's workspace formats dates
  const settings = useSelector(getSettings<RootState>);
  const instantFormatter = useMemo<InstantFormatterFactory>(
    () => (columnName) => createInstantFormatter(dh, settings, columnName),
    [dh, settings],
  );
  useEffect(() => {
    source.setInstantFormatter(instantFormatter);
  }, [source, instantFormatter]);

  // The viewport arrives in the same document update as its table
  const viewportKey = viewport == null ? "" : JSON.stringify(viewport);
  const setTable = useMemo(
    () => (table: DhType.Table) =>
      source.setTable(
        table,
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
  // The list is recreated on every document update, so compare its contents
  const tooltipKey = JSON.stringify(tooltip ?? null);
  const tooltipOptions = useMemo(
    () => getTooltipOptions(JSON.parse(tooltipKey) as TooltipProp),
    [tooltipKey],
  );

  useFetchedTable(exportedTable, setTable, setError);
  useFetchedTable(exportedBounds, setBoundsTable, setError);

  return (
    <div style={CONTAINER_STYLE}>
      {error != null && <div>{`${error}`}</div>}
      {/* Plot reads the Deephaven chart theme from CSS and follows theme switches */}
      {error == null && is3DSeriesType(type) && (
        <Plot3D
          source={source}
          tooltip={tooltipOptions !== false}
          legendPosition={legendPosition}
          camera={initialCamera}
          showAxes={showAxes ?? undefined}
          pointScaling={pointScaling ?? undefined}
          depthFade={depthFade ?? undefined}
          onError={setError}
        />
      )}
      {error == null && !is3DSeriesType(type) && (
        <Plot
          source={source}
          tooltip={tooltipOptions}
          legendPosition={legendPosition}
          onError={setError}
        />
      )}
      {error == null && isDownsampling && <DownsamplingIndicator />}
    </div>
  );
}

export default GigaplotView;
