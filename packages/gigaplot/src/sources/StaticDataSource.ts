import {
  AbstractPlotDataSource,
  type SeriesDataRequest,
  type SeriesDataResult,
} from '../model/PlotDataSource';
import {
  getSeriesBounds,
  is3DSeriesType,
  isOhlcSeriesType,
  unionBounds,
  type AxisTickGenerator,
  type AxisValueFormatter,
  type Bounds,
  type PlotSeriesType,
  type PlotShape,
  type SeriesData,
  type SeriesDescriptor,
  type SeriesStyle,
} from '../model/PlotTypes';
import {
  minMaxDownsampler,
  ohlcDownsampler,
  type Downsampler,
} from '../downsample/Downsampler';
import type { PlotScale } from '../scale/PlotScale';

export interface StaticSeriesDefinition {
  id: string;
  name: string;
  type: PlotSeriesType;
  style?: SeriesStyle;
  /** See {@link SeriesDescriptor.stacked}. Stack the data with {@link stackSeriesData}. */
  stacked?: boolean;
  data: SeriesData;
}

export interface StaticDataSourceOptions {
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  xAxisTicks?: AxisTickGenerator;
  yAxisTicks?: AxisTickGenerator;
  xAxisFormatter?: AxisValueFormatter;
  yAxisFormatter?: AxisValueFormatter;
  /** See {@link PlotShape.xScale}. */
  xScale?: PlotScale;
  /** See {@link PlotShape.yScale}. */
  yScale?: PlotScale;
  zAxisLabel?: string;
  zAxisTicks?: AxisTickGenerator;
  zAxisFormatter?: AxisValueFormatter;
  /**
   * Applied to every 2D series. Defaults to {@link ohlcDownsampler} for
   * `ohlc` and `candlestick` series, and {@link minMaxDownsampler} for the
   * rest. 3D series are never downsampled.
   */
  downsampler?: Downsampler;
}

/**
 * A source backed entirely by arrays already in memory.
 *
 * Downsampling is applied on request so the renderer only receives the points
 * it can actually resolve, exactly as a server backed source would behave.
 */
export class StaticDataSource extends AbstractPlotDataSource {
  protected seriesData = new Map<string, SeriesData>();

  protected descriptors: SeriesDescriptor[] = [];

  protected options: StaticDataSourceOptions;

  private downsampler: Downsampler | undefined;

  constructor(
    series: StaticSeriesDefinition[],
    options: StaticDataSourceOptions = {}
  ) {
    super();
    this.options = options;
    this.downsampler = options.downsampler;
    for (let i = 0; i < series.length; i += 1) {
      const { data, ...descriptor } = series[i];
      this.seriesData.set(descriptor.id, data);
      this.descriptors.push({
        ...descriptor,
        bounds: getSeriesBounds(data, descriptor.type),
      });
    }
  }

  protected getBounds(): Bounds | undefined {
    let bounds: Bounds | undefined;
    for (let i = 0; i < this.descriptors.length; i += 1) {
      bounds = unionBounds(bounds, this.descriptors[i].bounds);
    }
    return bounds;
  }

  protected buildShape(): PlotShape {
    return {
      series: this.descriptors.map(descriptor => ({ ...descriptor })),
      bounds: this.getBounds(),
      title: this.options.title,
      xAxisLabel: this.options.xAxisLabel,
      yAxisLabel: this.options.yAxisLabel,
      xAxisTicks: this.options.xAxisTicks,
      yAxisTicks: this.options.yAxisTicks,
      xAxisFormatter: this.options.xAxisFormatter,
      yAxisFormatter: this.options.yAxisFormatter,
      xScale: this.options.xScale,
      yScale: this.options.yScale,
      zAxisLabel: this.options.zAxisLabel,
      zAxisTicks: this.options.zAxisTicks,
      zAxisFormatter: this.options.zAxisFormatter,
    };
  }

  async getShape(): Promise<PlotShape> {
    return this.buildShape();
  }

  async requestSeriesData(
    request: SeriesDataRequest
  ): Promise<SeriesDataResult> {
    const data = this.seriesData.get(request.seriesId);
    if (data == null) {
      throw new Error(`Unknown series ${request.seriesId}`);
    }
    const type = this.descriptors.find(
      descriptor => descriptor.id === request.seriesId
    )?.type;
    // A 3D view has no pixel columns to reduce points into
    if (type != null && is3DSeriesType(type)) {
      return { data, complete: true };
    }
    const downsampler =
      this.downsampler ??
      (type != null && isOhlcSeriesType(type)
        ? ohlcDownsampler
        : minMaxDownsampler);
    const downsampled = downsampler(data, request);
    return { data: downsampled, complete: downsampled.length === data.length };
  }
}

export default StaticDataSource;
