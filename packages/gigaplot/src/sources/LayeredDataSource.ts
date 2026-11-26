import {
  AbstractPlotDataSource,
  type PlotDataSource,
  type PlotDataSourceEventMap,
  type SeriesDataRequest,
  type SeriesDataResult,
} from '../model/PlotDataSource';
import {
  PRIMARY_X_AXIS,
  PRIMARY_Y_AXIS,
  type AxisTickGenerator,
  type AxisValueFormatter,
  type PlotAxis,
  type PlotAxisSide,
  type PlotRange,
  type PlotShape,
  type SeriesDelta,
  type SeriesDescriptor,
} from '../model/PlotTypes';
import type { PlotScale } from '../scale/PlotScale';

/** A source drawn as one layer of a {@link LayeredDataSource}. */
export interface PlotLayer {
  source: PlotDataSource;
  /** Id of the x axis the layer's series are drawn against. Defaults to `x`. */
  xAxis?: string;
  /** Id of the y axis the layer's series are drawn against. Defaults to `y`. */
  yAxis?: string;
}

/** Settings for an axis of a layered plot, in place of its layers'. */
export interface LayeredAxisOptions {
  /**
   * The edge to draw the axis along. Defaults to the bottom for the primary x
   * axis, the left for the primary y, and the top or right for the rest.
   */
  side?: PlotAxisSide;
  /**
   * Title of the axis. Defaults to the first title a layer on it gives the
   * axis. Empty hides it.
   */
  label?: string;
}

export interface LayeredDataSourceOptions {
  /** Defaults to the first layer's title. */
  title?: string;
  /** Settings of each axis, by id, including the primary `x` and `y`. */
  axes?: Readonly<Record<string, LayeredAxisOptions>>;
}

/** What the layers on an axis say about it, the first layer's first. */
interface AxisInfo {
  dimension: 'x' | 'y';
  label?: string;
  ticks?: AxisTickGenerator;
  formatter?: AxisValueFormatter;
  scale?: PlotScale;
  range?: PlotRange;
}

const ID_SEPARATOR = ':';

function hasText(value: string | undefined): value is string {
  return value != null && value !== '';
}

function unionRange(
  range: PlotRange | undefined,
  min: number,
  max: number
): PlotRange | undefined {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return range;
  }
  return range == null
    ? { min, max }
    : { min: Math.min(range.min, min), max: Math.max(range.max, max) };
}

/** The primary axis of a dimension: its default id if any layer uses it, else the first used. */
function getPrimaryId(ids: readonly string[], primary: string): string {
  return ids.length === 0 || ids.includes(primary) ? primary : ids[0];
}

/**
 * Plots several sources together, such as a line over a scatter, or series
 * in other units against a second y axis.
 *
 * Each layer's series keep their own source, so each is requested and
 * downsampled on its own, for the viewport of the axes it is drawn on. Series
 * ids are prefixed with their layer's index. The axes the layers name are
 * added to the shape, each titled, ticked, and scaled by the first layer on
 * it, and ranging over the bounds of every layer on it. When no layer is
 * drawn against a primary axis, the first axis of its dimension that is used
 * takes its place, so a single layer on the right still has a y axis.
 */
export class LayeredDataSource extends AbstractPlotDataSource {
  private layers: readonly PlotLayer[];

  private options: LayeredDataSourceOptions;

  /** The latest shape of each layer, once known. */
  private shapes: (PlotShape | undefined)[];

  private removeListeners: (() => void)[] = [];

  constructor(
    layers: readonly PlotLayer[],
    options: LayeredDataSourceOptions = {}
  ) {
    super();
    const dimensions = new Map<string, 'x' | 'y'>();
    layers.forEach(({ xAxis = PRIMARY_X_AXIS, yAxis = PRIMARY_Y_AXIS }) => {
      [
        [xAxis, 'x'],
        [yAxis, 'y'],
      ].forEach(([id, dimension]) => {
        const known = dimensions.get(id);
        if (
          (known != null && known !== dimension) ||
          (id === PRIMARY_X_AXIS && dimension !== 'x') ||
          (id === PRIMARY_Y_AXIS && dimension !== 'y')
        ) {
          throw new Error(`Axis ${id} cannot be both an x and a y axis`);
        }
        dimensions.set(id, dimension as 'x' | 'y');
      });
    });
    this.layers = layers;
    this.options = options;
    this.shapes = layers.map(() => undefined);
    // Listen before anything awaits, so no layer's change is missed
    layers.forEach((layer, index) => this.listen(layer.source, index));
  }

  private listen(source: PlotDataSource, index: number): void {
    const handlers: {
      [K in keyof PlotDataSourceEventMap]: (
        detail: PlotDataSourceEventMap[K]
      ) => void;
    } = {
      shapechanged: ({ shape }) => {
        this.shapes[index] = shape;
        this.fireShapeChanged(this.buildShape());
      },
      datachanged: ({ deltas }) => {
        this.fireDataChanged(
          deltas.map((delta): SeriesDelta => ({
            ...delta,
            seriesId: `${index}${ID_SEPARATOR}${delta.seriesId}`,
          }))
        );
      },
      disconnect: detail => this.emit('disconnect', detail),
      reconnect: detail => this.emit('reconnect', detail),
      error: ({ error }) => this.fireError(error),
    };
    (Object.keys(handlers) as (keyof PlotDataSourceEventMap)[]).forEach(
      type => {
        const handler = handlers[type] as (detail: unknown) => void;
        source.addEventListener(type, handler);
        this.removeListeners.push(() =>
          source.removeEventListener(type, handler)
        );
      }
    );
  }

  async getShape(): Promise<PlotShape> {
    await Promise.all(
      this.layers.map(async ({ source }, index) => {
        const shape = await source.getShape();
        // A shape that changed while this resolved is newer
        if (this.shapes[index] == null) {
          this.shapes[index] = shape;
        }
      })
    );
    return this.buildShape();
  }

  private buildShape(): PlotShape {
    const { layers, shapes, options } = this;
    const xIds = layers.map(layer => layer.xAxis ?? PRIMARY_X_AXIS);
    const yIds = layers.map(layer => layer.yAxis ?? PRIMARY_Y_AXIS);
    const primaryX = getPrimaryId(xIds, PRIMARY_X_AXIS);
    const primaryY = getPrimaryId(yIds, PRIMARY_Y_AXIS);
    const toId = (id: string): string => {
      if (id === primaryX) {
        return PRIMARY_X_AXIS;
      }
      return id === primaryY ? PRIMARY_Y_AXIS : id;
    };

    const infos = new Map<string, AxisInfo>();
    const getInfo = (id: string, dimension: 'x' | 'y'): AxisInfo => {
      let info = infos.get(id);
      if (info == null) {
        info = { dimension };
        infos.set(id, info);
      }
      return info;
    };
    const series: SeriesDescriptor[] = [];
    shapes.forEach((shape, index) => {
      const xId = toId(xIds[index]);
      const yId = toId(yIds[index]);
      const xInfo = getInfo(xId, 'x');
      const yInfo = getInfo(yId, 'y');
      if (shape == null) {
        return;
      }
      if (!hasText(xInfo.label) && hasText(shape.xAxisLabel)) {
        xInfo.label = shape.xAxisLabel;
      }
      if (!hasText(yInfo.label) && hasText(shape.yAxisLabel)) {
        yInfo.label = shape.yAxisLabel;
      }
      xInfo.ticks = xInfo.ticks ?? shape.xAxisTicks;
      yInfo.ticks = yInfo.ticks ?? shape.yAxisTicks;
      xInfo.formatter = xInfo.formatter ?? shape.xAxisFormatter;
      yInfo.formatter = yInfo.formatter ?? shape.yAxisFormatter;
      xInfo.scale = xInfo.scale ?? shape.xScale;
      yInfo.scale = yInfo.scale ?? shape.yScale;
      if (shape.bounds != null) {
        const { xMin, xMax, yMin, yMax } = shape.bounds;
        xInfo.range = unionRange(xInfo.range, xMin, xMax);
        yInfo.range = unionRange(yInfo.range, yMin, yMax);
      }
      shape.series.forEach(descriptor => {
        const layered: SeriesDescriptor = {
          ...descriptor,
          id: `${index}${ID_SEPARATOR}${descriptor.id}`,
        };
        delete layered.xAxis;
        delete layered.yAxis;
        if (xId !== PRIMARY_X_AXIS) {
          layered.xAxis = xId;
        }
        if (yId !== PRIMARY_Y_AXIS) {
          layered.yAxis = yId;
        }
        series.push(layered);
      });
    });

    // Axes are configured by their ids as the layers name them
    const getOptions = (id: string): LayeredAxisOptions | undefined => {
      if (id === PRIMARY_X_AXIS) {
        return options.axes?.[primaryX];
      }
      return options.axes?.[id === PRIMARY_Y_AXIS ? primaryY : id];
    };
    const getLabel = (id: string, info: AxisInfo): string | undefined => {
      const label = getOptions(id)?.label;
      if (label != null) {
        return hasText(label) ? label : undefined;
      }
      return info.label;
    };

    const x = getInfo(PRIMARY_X_AXIS, 'x');
    const y = getInfo(PRIMARY_Y_AXIS, 'y');
    const axes: PlotAxis[] = [];
    infos.forEach((info, id) => {
      if (id !== PRIMARY_X_AXIS && id !== PRIMARY_Y_AXIS) {
        axes.push({
          id,
          dimension: info.dimension,
          side: getOptions(id)?.side,
          label: getLabel(id, info),
          ticks: info.ticks,
          formatter: info.formatter,
          scale: info.scale,
          range: info.range,
        });
      }
    });
    const xSide = getOptions(PRIMARY_X_AXIS)?.side;
    const ySide = getOptions(PRIMARY_Y_AXIS)?.side;
    // An axis standing in for a missing primary keeps its own default edge
    const defaultYSide = primaryY === PRIMARY_Y_AXIS ? 'left' : 'right';
    const defaultXSide = primaryX === PRIMARY_X_AXIS ? 'bottom' : 'top';
    return {
      series,
      bounds:
        x.range != null && y.range != null
          ? {
              xMin: x.range.min,
              xMax: x.range.max,
              yMin: y.range.min,
              yMax: y.range.max,
            }
          : undefined,
      title: options.title ?? shapes.find(shape => shape?.title)?.title,
      xAxisLabel: getLabel(PRIMARY_X_AXIS, x),
      yAxisLabel: getLabel(PRIMARY_Y_AXIS, y),
      xAxisTicks: x.ticks,
      yAxisTicks: y.ticks,
      xAxisFormatter: x.formatter,
      yAxisFormatter: y.formatter,
      xScale: x.scale,
      yScale: y.scale,
      xAxisSide: xSide === 'top' || xSide === 'bottom' ? xSide : defaultXSide,
      yAxisSide: ySide === 'left' || ySide === 'right' ? ySide : defaultYSide,
      ...(axes.length > 0 ? { axes } : {}),
    };
  }

  async requestSeriesData(
    request: SeriesDataRequest
  ): Promise<SeriesDataResult> {
    const separator = request.seriesId.indexOf(ID_SEPARATOR);
    const layer = this.layers[Number(request.seriesId.slice(0, separator))];
    if (separator < 0 || layer == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    return layer.source.requestSeriesData({
      ...request,
      seriesId: request.seriesId.slice(separator + 1),
    });
  }

  /** Closes every layer's source. */
  close(): void {
    this.removeListeners.forEach(remove => remove());
    this.removeListeners = [];
    this.layers.forEach(({ source }) => source.close?.());
    super.close();
  }
}

export default LayeredDataSource;
