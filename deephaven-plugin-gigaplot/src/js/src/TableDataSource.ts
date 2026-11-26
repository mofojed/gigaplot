import type { dh as DhType } from "@deephaven/jsapi-types";
import Log from "@deephaven/log";
import {
  StaticDataSource,
  createOhlcSeriesData,
  createSeriesData,
  createPlotScale,
  createSeriesData3D,
  getSeriesBounds,
  identityDownsampler,
  is3DSeriesType,
  isOhlcSeriesType,
  minMaxDownsampler,
  ohlcDownsampler,
  type AxisTickGenerator,
  type AxisValueFormatter,
  type Bounds,
  type PlotFill,
  type PlotScale,
  type PlotScaleSpec,
  type PlotSeriesType,
  type SeriesData,
  type SeriesStyle,
  type SeriesDataRequest,
  type SeriesDataResult,
  type SeriesDelta,
} from "gigaplot";
import {
  downsampleParamsEqual,
  getDownsampleParams,
  getParamsXResolution,
  type DownsampleParams,
} from "./downsampleParams";
import { INSTANT_TYPE, InstantAxis, getOriginNanos } from "./instants";
import {
  createTimeFormatter,
  createTimeTicks,
  utcInstantFormatter,
  type InstantFormatter,
} from "./timeTicks";

/** Creates the formatter for labelling an axis of Instants from a column. */
export type InstantFormatterFactory = (columnName: string) => InstantFormatter;

const defaultInstantFormatterFactory: InstantFormatterFactory = () =>
  utcInstantFormatter;

const log = Log.module("deephaven-plugin-gigaplot.TableDataSource");

/** Minimum time between viewport requests sent to the server. */
const VIEWPORT_THROTTLE_MS = 100;

export interface TableDataSourceOptions {
  x: string;
  /** Columns of `line`, `scatter`, and `area` series, one series each. */
  y?: readonly string[] | null;
  /**
   * Columns of `ohlc` and `candlestick` series. Series `i` is made of
   * `open[i]`, `high[i]`, `low[i]`, and `close[i]`, so all four have the same
   * length.
   */
  open?: readonly string[] | null;
  high?: readonly string[] | null;
  low?: readonly string[] | null;
  close?: readonly string[] | null;
  /**
   * Columns of the z values of `scatter3d` and `line3d` series, paired with
   * `y` by index, so both have the same length.
   */
  z?: readonly string[] | null;
  type: PlotSeriesType;
  /**
   * For `area` series, whose `y` columns already hold running totals: each
   * series is filled down to the one before it, and its value is the
   * difference.
   */
  stacked?: boolean;
  /** Fill of each `area` series, by index. Null keeps the default. */
  fill?: readonly (PlotFill | null)[] | null;
  /** CSS color of each series, by index. Null keeps the theme's colorway. */
  color?: readonly (string | null)[] | null;
  /** Point diameter of scatter series, or line width of line series, in pixels. */
  size?: number | null;
  /**
   * The x axis' scale, such as a business calendar. Calendars and breaks on
   * an Instant column are in time, and on a numeric one in epoch milliseconds.
   */
  xScale?: PlotScaleSpec | null;
  /** The y axis' scale, such as a log scale. */
  yScale?: PlotScaleSpec | null;
  /**
   * Fixed ranges for the axes of a 3D plot, which otherwise fit the data.
   * Each is a `[min, max]` pair.
   */
  ranges?: {
    x?: readonly [number, number] | null;
    y?: readonly [number, number] | null;
    z?: readonly [number, number] | null;
  };
  title?: string;
  /** Title for the x axis. Defaults to the x column name; empty hides it. */
  xAxisLabel?: string;
  /**
   * Title for the y axis. Defaults to the y column name when there is one,
   * and to none for several, which the legend names instead, or for bars,
   * which have no one column to name it after. Empty hides it.
   */
  yAxisLabel?: string;
  /**
   * Title for the z axis of a 3D plot. Defaults to the z column name when
   * every series shares one. Empty hides it.
   */
  zAxisLabel?: string;
  /**
   * Enables server side downsampling. The source calls this with the params
   * for each new viewport, and the caller replies by passing the downsampled
   * table to `setTable`. Bounds then come from `setBoundsTable` rather than
   * from the data, which only covers the viewport.
   */
  onViewportChange?: (params: DownsampleParams) => unknown;
  /**
   * Called when the source starts or stops waiting for a downsampled table
   * that matches the latest viewport.
   */
  onDownsamplingChange?: (isDownsampling: boolean) => void;
  /**
   * Formats axis labels for Instant columns. Defaults to UTC. Can be changed
   * later with `setInstantFormatter`.
   */
  instantFormatter?: InstantFormatterFactory;
  /**
   * Converts Instants on the x axis to plot units. Sources whose x values
   * share an axis, as layers of one plot can, must share one, so they count
   * from the same origin. Defaults to one of the source's own.
   */
  xInstants?: InstantAxis;
  /** Converts Instants on the y axis to plot units, like `xInstants`. */
  yInstants?: InstantAxis;
}

interface TableSubscription {
  table: DhType.Table;
  subscription: DhType.TableSubscription;
  removeListener: () => void;
  /** The params the table was downsampled for, if known. */
  params?: DownsampleParams;
}

function closeSubscription({
  table,
  subscription,
  removeListener,
}: TableSubscription): void {
  removeListener();
  subscription.close();
  table.close();
}

/**
 * The value columns of each series: `[y]` for points, `[y, z]` for 3D
 * points, and `[open, high, low, close]` for bars.
 */
function getSeriesColumns(options: TableDataSourceOptions): string[][] {
  if (is3DSeriesType(options.type)) {
    const y = options.y ?? [];
    const z = options.z ?? [];
    if (y.length !== z.length) {
      throw new Error("y and z must name the same number of columns");
    }
    return y.map((column, i) => [column, z[i]]);
  }
  if (!isOhlcSeriesType(options.type)) {
    return (options.y ?? []).map((column) => [column]);
  }
  const open = options.open ?? [];
  const high = options.high ?? [];
  const low = options.low ?? [];
  const close = options.close ?? [];
  if (
    open.length !== close.length ||
    high.length !== close.length ||
    low.length !== close.length
  ) {
    throw new Error(
      "open, high, low, and close must name the same number of columns",
    );
  }
  return close.map((column, i) => [open[i], high[i], low[i], column]);
}

/** The one column every series shares at `index`, if they all do. */
function getSharedColumn(
  seriesColumns: readonly string[][],
  index: number,
): string | undefined {
  const first = seriesColumns[0]?.[index];
  return first != null &&
    seriesColumns.every((columns) => columns[index] === first)
    ? first
    : undefined;
}

/**
 * Names a series after its last value column: the close of a bar, the y of a
 * point, or the z of a 3D point, unless several 3D series share that z.
 */
function getSeriesName(
  type: PlotSeriesType,
  columns: readonly string[],
  sharedZ: string | undefined,
): string {
  if (is3DSeriesType(type) && sharedZ != null) {
    return columns[0];
  }
  return columns[columns.length - 1];
}

function getSeriesStyle(
  type: PlotSeriesType,
  index: number,
  options: TableDataSourceOptions,
): SeriesStyle | undefined {
  const style: SeriesStyle = {};
  const fill = options.fill?.[index];
  if (fill != null) {
    style.fill = fill;
  }
  const color = options.color?.[index];
  if (color != null) {
    style.color = color;
  }
  if (options.size != null) {
    if (type === "scatter" || type === "scatter3d") {
      style.pointSize = options.size;
    } else {
      style.lineWidth = options.size;
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function getDownsampler(type: PlotSeriesType) {
  if (isOhlcSeriesType(type)) {
    return ohlcDownsampler;
  }
  return type === "scatter" ? identityDownsampler : minMaxDownsampler;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (value == null) {
    return Number.NaN;
  }
  if (typeof value === "object") {
    if ("asNumber" in value && typeof value.asNumber === "function") {
      return value.asNumber() as number;
    }
  }
  return Number(value);
}

/**
 * Plots columns of a Deephaven table.
 *
 * Subscribes to the whole of the current table and replaces every series on
 * each update. The table can be swapped with `setTable`; the previous one keeps
 * drawing until the new one has data, so the plot does not flash while a new
 * downsampled table loads. Tables passed in are owned and closed by the source.
 *
 * Instant columns are plotted as nanoseconds since an origin near the data,
 * which keeps full nanosecond precision, and their axis is labelled with dates.
 */
export class TableDataSource extends StaticDataSource {
  private dh: typeof DhType;

  private x: string;

  /** Value columns of each series; see {@link getSeriesColumns}. */
  private seriesColumns: readonly string[][];

  /** Every column the plot reads, x first, without repeats. */
  private columnNames: readonly string[];

  private type: PlotSeriesType;

  private isStacked: boolean;

  private ranges: TableDataSourceOptions["ranges"];

  private xScaleSpec: PlotScaleSpec | undefined;

  /** The x scale built, and the Instant origin it was built for, if any. */
  private xScaleBuilt: { scale: PlotScale; originSeconds?: number } | undefined;

  private onViewportChange: TableDataSourceOptions["onViewportChange"];

  private onDownsamplingChange: TableDataSourceOptions["onDownsamplingChange"];

  private isDownsamplingValue = false;

  private current: TableSubscription | null = null;

  private pending: TableSubscription | null = null;

  private boundsSubscription: TableSubscription | null = null;

  private hasBounds = false;

  private requestedParams: DownsampleParams | undefined;

  private queuedParams: DownsampleParams | undefined;

  private throttleTimeout: ReturnType<typeof setTimeout> | undefined;

  private isClosed = false;

  private isXInstant = false;

  /** Whether the values of each series are Instants. */
  private isYInstant: boolean[];

  /** Origins are per axis, so every Instant column on an axis shares one. */
  private xInstants: InstantAxis;

  private yInstants: InstantAxis;

  private instantFormatter: InstantFormatterFactory;

  private xTimeTicks: AxisTickGenerator | undefined;

  private yTimeTicks: AxisTickGenerator | undefined;

  /** Formats hovered Instants, made along with the ticks of each axis. */
  private xTimeFormatter: AxisValueFormatter | undefined;

  private yTimeFormatter: AxisValueFormatter | undefined;

  constructor(dh: typeof DhType, options: TableDataSourceOptions) {
    const seriesColumns = getSeriesColumns(options);
    const is3D = is3DSeriesType(options.type);
    const sharedZ = is3D ? getSharedColumn(seriesColumns, 1) : undefined;
    // Series sharing a z column are told apart by y instead
    const zNameShared = seriesColumns.length > 1 ? sharedZ : undefined;
    const {
      x,
      type,
      stacked = false,
      title,
      xAxisLabel = x,
      yAxisLabel = !isOhlcSeriesType(type) && seriesColumns.length === 1
        ? seriesColumns[0][0]
        : is3D
          ? getSharedColumn(seriesColumns, 0)
          : undefined,
      zAxisLabel = sharedZ,
      onViewportChange,
      onDownsamplingChange,
      instantFormatter = defaultInstantFormatterFactory,
    } = options;
    const isStacked = type === "area" && stacked;
    super(
      seriesColumns.map((columns, i) => ({
        // Columns can be shared between bar series, but not all four of them
        id: columns.join("/"),
        name: getSeriesName(type, columns, zNameShared),
        type,
        ...(isStacked ? { stacked: true } : {}),
        style: getSeriesStyle(type, i, options),
        data: isOhlcSeriesType(type)
          ? createOhlcSeriesData()
          : is3D
            ? createSeriesData3D()
            : createSeriesData(),
      })),
      {
        title,
        xAxisLabel: xAxisLabel === "" ? undefined : xAxisLabel,
        yAxisLabel: yAxisLabel === "" ? undefined : yAxisLabel,
        zAxisLabel: zAxisLabel === "" ? undefined : zAxisLabel,
        downsampler: getDownsampler(type),
      },
    );
    this.ranges = options.ranges;
    this.xScaleSpec = options.xScale ?? undefined;
    if (options.yScale != null) {
      this.options.yScale = createPlotScale(options.yScale);
    }
    this.dh = dh;
    this.x = x;
    this.seriesColumns = seriesColumns;
    this.columnNames = Array.from(new Set([x, ...seriesColumns.flat()]));
    this.type = type;
    this.isStacked = isStacked;
    this.onViewportChange = onViewportChange;
    this.onDownsamplingChange = onDownsamplingChange;
    this.instantFormatter = instantFormatter;
    this.xInstants = options.xInstants ?? new InstantAxis();
    this.yInstants = options.yInstants ?? new InstantAxis();
    this.isYInstant = seriesColumns.map(() => false);
  }

  /** The data's bounds, with any fixed ranges of a 3D plot in their place. */
  protected getBounds(): Bounds | undefined {
    const bounds = super.getBounds();
    const { ranges } = this;
    if (bounds == null || ranges == null) {
      return bounds;
    }
    const result = { ...bounds };
    if (ranges.x != null) {
      [result.xMin, result.xMax] = ranges.x;
    }
    if (ranges.y != null) {
      [result.yMin, result.yMax] = ranges.y;
    }
    if (ranges.z != null) {
      [result.zMin, result.zMax] = ranges.z;
    }
    return result;
  }

  /** Changes how Instant axes are labelled, such as when settings change. */
  setInstantFormatter(instantFormatter: InstantFormatterFactory): void {
    if (instantFormatter === this.instantFormatter) {
      return;
    }
    this.instantFormatter = instantFormatter;
    this.xTimeTicks = undefined;
    this.yTimeTicks = undefined;
    this.xTimeFormatter = undefined;
    this.yTimeFormatter = undefined;
    if (this.updateAxisTicks()) {
      this.fireShapeChanged(this.buildShape());
    }
  }

  private get isYAxisInstant(): boolean {
    return this.isYInstant.length > 0 && this.isYInstant.every(Boolean);
  }

  /** Records which columns hold Instants, from the columns of a table. */
  private setColumnTypes(
    xColumn: DhType.Column,
    yColumns: readonly DhType.Column[],
  ): void {
    this.isXInstant = xColumn.type === INSTANT_TYPE;
    this.isYInstant = yColumns.map((column) => column.type === INSTANT_TYPE);
  }

  private toPlotX(value: unknown): number {
    return this.isXInstant
      ? this.xInstants.toPlotValue(value)
      : toNumber(value);
  }

  private toPlotY(value: unknown, index: number): number {
    return this.isYInstant[index]
      ? this.yInstants.toPlotValue(value)
      : toNumber(value);
  }

  /**
   * Labels Instant axes with dates once their origin is known.
   *
   * @returns True if the ticks of either axis changed
   */
  private updateAxisTicks(): boolean {
    const { originSeconds: xOrigin } = this.xInstants;
    if (this.isXInstant && xOrigin != null && this.xTimeTicks == null) {
      const formatter = this.instantFormatter(this.x);
      this.xTimeTicks = createTimeTicks(xOrigin, formatter);
      this.xTimeFormatter = createTimeFormatter(xOrigin, formatter);
    }
    const { originSeconds: yOrigin } = this.yInstants;
    if (this.isYAxisInstant && yOrigin != null && this.yTimeTicks == null) {
      const formatter = this.instantFormatter(this.seriesColumns[0][0]);
      this.yTimeTicks = createTimeTicks(yOrigin, formatter);
      this.yTimeFormatter = createTimeFormatter(yOrigin, formatter);
    }
    const xAxisTicks = this.isXInstant ? this.xTimeTicks : undefined;
    const yAxisTicks = this.isYAxisInstant ? this.yTimeTicks : undefined;
    if (
      xAxisTicks === this.options.xAxisTicks &&
      yAxisTicks === this.options.yAxisTicks
    ) {
      return false;
    }
    // Formatters are made with their ticks, so they change together
    this.options.xAxisTicks = xAxisTicks;
    this.options.yAxisTicks = yAxisTicks;
    this.options.xAxisFormatter = this.isXInstant
      ? this.xTimeFormatter
      : undefined;
    this.options.yAxisFormatter = this.isYAxisInstant
      ? this.yTimeFormatter
      : undefined;
    return true;
  }

  /**
   * Builds the x scale once it can place values: at once for a numeric
   * column, and once the origin is known for an Instant one, whose values
   * count nanoseconds from it.
   *
   * @returns True if the scale changed
   */
  private updateXScale(): boolean {
    const spec = this.xScaleSpec;
    if (spec == null) {
      return false;
    }
    const { originSeconds } = this.xInstants;
    if (this.isXInstant && originSeconds == null) {
      return false;
    }
    const built = this.xScaleBuilt;
    const builtOrigin = this.isXInstant ? originSeconds : undefined;
    if (built != null && built.originSeconds === builtOrigin) {
      return false;
    }
    const scale = createPlotScale(
      spec,
      builtOrigin != null
        ? { originMs: builtOrigin * 1000, msPerUnit: 1e-6 }
        : {},
    );
    this.xScaleBuilt = { scale, originSeconds: builtOrigin };
    this.options.xScale = scale;
    return true;
  }

  /** Adds the origins the server needs to turn plot units into Instants. */
  private addOrigins(params: DownsampleParams): DownsampleParams {
    const result = { ...params };
    const { originSeconds: xOrigin } = this.xInstants;
    if (this.isXInstant && xOrigin != null) {
      result.x_origin = getOriginNanos(xOrigin);
    }
    const { originSeconds: yOrigin } = this.yInstants;
    const isYInstant = this.isYInstant.some(Boolean);
    if (params.y_bin != null && isYInstant && yOrigin != null) {
      result.y_origin = getOriginNanos(yOrigin);
    }
    return result;
  }

  private get is3D(): boolean {
    return is3DSeriesType(this.type);
  }

  private get isServerDownsampled(): boolean {
    return this.onViewportChange != null;
  }

  /** True while the drawn table does not match the latest requested viewport. */
  get isDownsampling(): boolean {
    return this.isDownsamplingValue;
  }

  private updateIsDownsampling(): void {
    const latest = this.queuedParams ?? this.requestedParams;
    const isDownsampling =
      !this.isClosed &&
      latest != null &&
      !downsampleParamsEqual(latest, this.current?.params);
    if (isDownsampling !== this.isDownsamplingValue) {
      this.isDownsamplingValue = isDownsampling;
      this.onDownsamplingChange?.(isDownsampling);
    }
  }

  private subscribe(
    table: DhType.Table,
    columnNames: readonly string[],
    onUpdate: (
      data: DhType.SubscriptionTableData,
      columns: DhType.Column[],
    ) => void,
  ): TableSubscription {
    const columns = columnNames.map((name) => table.findColumn(name));
    const subscription = table.subscribe(columns);
    const removeListener =
      subscription.addEventListener<DhType.SubscriptionTableData>(
        this.dh.Table.EVENT_UPDATED,
        (event) => {
          try {
            onUpdate(event.detail, columns);
          } catch (e) {
            log.error("Unable to read table update", e);
            this.fireError(e);
          }
        },
      );
    return { table, subscription, removeListener };
  }

  /**
   * Replaces the table being plotted. Takes ownership of `table`, and closes
   * the previous table once the new one has delivered its first update.
   *
   * @param params The params the table was downsampled for, if it was
   */
  setTable(table: DhType.Table | null, params?: DownsampleParams): void {
    if (this.isClosed) {
      table?.close();
      return;
    }
    if (this.pending != null) {
      closeSubscription(this.pending);
      this.pending = null;
    }
    if (table == null) {
      return;
    }
    const next = this.subscribe(table, this.columnNames, (data, columns) => {
      if (this.pending === next) {
        if (this.current != null) {
          closeSubscription(this.current);
        }
        this.current = next;
        this.pending = null;
        this.updateIsDownsampling();
      }
      if (this.current === next) {
        this.onUpdate(data, columns);
      }
    });
    next.params = params;
    this.pending = next;
  }

  /**
   * Sets the one row table holding the extent of the full table, as made by
   * `bounds` in `downsample.py`. Takes ownership of `table`.
   */
  setBoundsTable(table: DhType.Table | null): void {
    if (this.boundsSubscription != null) {
      closeSubscription(this.boundsSubscription);
      this.boundsSubscription = null;
    }
    if (this.isClosed) {
      table?.close();
      return;
    }
    if (table == null) {
      return;
    }
    const columnNames = [
      "XMin",
      "XMax",
      ...this.seriesColumns.flatMap((_, i) => [`YMin${i}`, `YMax${i}`]),
    ];
    this.boundsSubscription = this.subscribe(
      table,
      columnNames,
      (data, columns) => this.onBoundsUpdate(data, columns),
    );
  }

  private onBoundsUpdate(
    data: DhType.SubscriptionTableData,
    columns: DhType.Column[],
  ): void {
    // Bounds columns have the types of the columns they measure
    this.setColumnTypes(
      columns[0],
      this.seriesColumns.map((_, i) => columns[2 + i * 2]),
    );
    // Only `next` is used, bounded by `size`: the JS API's row set iterators
    // have no `hasNext` from deephaven-core 43, and report `done` wrongly before
    const iterator = data.fullIndex.iterator();
    const key = data.fullIndex.size > 0 ? iterator.next().value : undefined;
    const readX = (index: number): number =>
      key == null
        ? Number.NaN
        : this.toPlotX(data.getData(key, columns[index]));
    const readY = (index: number, y: number): number =>
      key == null
        ? Number.NaN
        : this.toPlotY(data.getData(key, columns[index]), y);
    const xMin = readX(0);
    const xMax = readX(1);

    let hasBounds = false;
    for (let i = 0; i < this.descriptors.length; i += 1) {
      const bounds: Bounds = {
        xMin,
        xMax,
        yMin: readY(2 + i * 2, i),
        yMax: readY(3 + i * 2, i),
      };
      const isFinite = Object.values(bounds).every(Number.isFinite);
      this.descriptors[i].bounds = isFinite ? bounds : undefined;
      hasBounds = hasBounds || isFinite;
    }
    this.hasBounds = hasBounds;
    this.updateAxisTicks();
    this.updateXScale();
    this.fireShapeChanged(this.buildShape());
  }

  /**
   * @param columns The columns of {@link columnNames}, in the same order
   */
  private onUpdate(
    data: DhType.SubscriptionTableData,
    columns: DhType.Column[],
  ): void {
    const byName = new Map(columns.map((column) => [column.name, column]));
    const getColumn = (name: string) => byName.get(name) as DhType.Column;
    const xColumn = getColumn(this.x);
    const seriesColumns = this.seriesColumns.map((names) =>
      names.map(getColumn),
    );
    // Every value of a series is on the y axis, so its first stands for all
    this.setColumnTypes(
      xColumn,
      seriesColumns.map((series) => series[0]),
    );
    const size = data.fullIndex.size;
    const xs = new Float64Array(size);
    const values = seriesColumns.map((series) =>
      series.map(() => new Float64Array(size)),
    );

    // Bounded by `size` for the same reason as in `onBoundsUpdate`
    const iterator = data.fullIndex.iterator();
    for (let i = 0; i < size; i += 1) {
      const key = iterator.next().value;
      xs[i] = this.toPlotX(data.getData(key, xColumn));
      for (let s = 0; s < seriesColumns.length; s += 1) {
        const series = seriesColumns[s];
        for (let c = 0; c < series.length; c += 1) {
          const value = data.getData(key, series[c]);
          // Only the y axis has an Instant origin, so z is read as a number
          values[s][c][i] =
            this.is3D && c === 1 ? toNumber(value) : this.toPlotY(value, s);
        }
      }
    }
    const isTicksChanged = this.updateAxisTicks();
    const isScaleChanged = this.updateXScale();

    const deltas: SeriesDelta[] = [];
    for (let s = 0; s < this.descriptors.length; s += 1) {
      const descriptor = this.descriptors[s];
      const [first, ...rest] = values[s];
      let series: SeriesData;
      if (rest.length === 3) {
        series = {
          x: xs,
          open: first,
          high: rest[0],
          low: rest[1],
          y: rest[2],
          length: size,
        };
      } else if (this.is3D) {
        series = { x: xs, y: first, z: rest[0], length: size };
      } else {
        series = { x: xs, y: first, length: size };
      }
      // A stacked area sits on the total of the series before it
      if (this.isStacked && s > 0) {
        [series.base] = values[s - 1];
      }
      this.seriesData.set(descriptor.id, series);
      if (!this.isServerDownsampled) {
        descriptor.bounds = getSeriesBounds(series, this.type);
      }
      deltas.push({ type: "replace", seriesId: descriptor.id, data: series });
    }

    if (!this.isServerDownsampled || isTicksChanged || isScaleChanged) {
      this.fireShapeChanged(this.buildShape());
    }
    this.fireDataChanged(deltas);
  }

  async requestSeriesData(
    request: SeriesDataRequest,
  ): Promise<SeriesDataResult> {
    if (!this.isServerDownsampled) {
      return super.requestSeriesData(request);
    }
    // Until the bounds arrive the viewport is a placeholder, not worth a query
    if (this.hasBounds) {
      const params = getDownsampleParams(request, this.type);
      if (params != null) {
        this.requestParams(this.addOrigins(params));
      }
    }
    // Draw what is loaded now. The new table fires a data change when it
    // arrives, and since this is never complete the plot asks again. Until
    // then, report how coarse the loaded table is so the plot can soften it.
    const data = this.seriesData.get(request.seriesId);
    if (data == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    const loadedParams = this.current?.params;
    return {
      data,
      complete: false,
      xResolution:
        loadedParams != null
          ? getParamsXResolution(loadedParams, this.type)
          : undefined,
      xCoverage:
        loadedParams != null
          ? { min: loadedParams.x_min, max: loadedParams.x_max }
          : undefined,
    };
  }

  private requestParams(params: DownsampleParams): void {
    const isRequested = downsampleParamsEqual(params, this.requestedParams);
    if (this.throttleTimeout != null) {
      this.queuedParams = isRequested ? undefined : params;
      this.updateIsDownsampling();
      return;
    }
    if (!isRequested) {
      this.sendParams(params);
    }
  }

  private sendParams(params: DownsampleParams): void {
    this.requestedParams = params;
    this.queuedParams = undefined;
    this.throttleTimeout = setTimeout(() => {
      this.throttleTimeout = undefined;
      const queued = this.queuedParams;
      if (queued != null && !this.isClosed) {
        this.sendParams(queued);
      }
    }, VIEWPORT_THROTTLE_MS);
    this.updateIsDownsampling();
    Promise.resolve(this.onViewportChange?.(params)).catch((e) => {
      log.error("Unable to request downsampled table", e);
      // Nothing is coming for this request, so stop showing it as in progress
      if (downsampleParamsEqual(params, this.requestedParams)) {
        this.requestedParams = this.current?.params;
        this.updateIsDownsampling();
      }
      this.fireError(e);
    });
  }

  close(): void {
    this.isClosed = true;
    if (this.throttleTimeout != null) {
      clearTimeout(this.throttleTimeout);
      this.throttleTimeout = undefined;
    }
    for (const subscription of [
      this.current,
      this.pending,
      this.boundsSubscription,
    ]) {
      if (subscription != null) {
        closeSubscription(subscription);
      }
    }
    this.current = null;
    this.pending = null;
    this.boundsSubscription = null;
    this.updateIsDownsampling();
    super.close();
  }
}

export default TableDataSource;
