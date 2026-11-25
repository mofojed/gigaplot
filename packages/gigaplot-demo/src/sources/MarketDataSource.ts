import {
  BusinessCalendar,
  StaticDataSource,
  appendSeriesData,
  createRandom,
  createSeriesData,
  getSeriesBounds,
  seriesDataFromArrays,
  type BusinessCalendarOptions,
  type SeriesData,
  type SeriesDelta,
  type StaticDataSourceOptions,
} from "gigaplot";
import type { StreamableSource } from "./StreamableSource";

export interface MarketSymbol {
  id: string;
  name: string;
  /** Price at the first bar. */
  start: number;
  /** Standard deviation of each bar's return. */
  volatility: number;
}

export interface MarketDataSourceOptions extends StaticDataSourceOptions {
  /** The trading schedule bars are generated in. */
  calendar: BusinessCalendarOptions;
  /** The local date of the first session, as `YYYY-MM-DD`. */
  startDate: string;
  /** Calendar days of history generated before the first tick. */
  initialDays: number;
  /** Milliseconds between bars. Defaults to a minute. */
  barMs?: number;
  /** Bars appended per tick. */
  barsPerTick: number;
  /** Milliseconds between ticks when running. */
  intervalMs: number;
  /** Fixed seed keeps demo and e2e output reproducible. */
  seed?: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Prices that only trade during a market's sessions: a bar every minute
 * from each open to its close, and nothing overnight, on weekends, or on
 * holidays. Prices gap between a close and the next open, like real ones.
 *
 * Ticking runs the market clock forward a few bars at a time, jumping from
 * each close to the next open, and appends them as deltas.
 */
export class MarketDataSource
  extends StaticDataSource
  implements StreamableSource
{
  private symbols: MarketSymbol[];

  private calendar: BusinessCalendar;

  private bars: Generator<{ time: number; isOpen: boolean }>;

  /** The next bar after the history, held back for the first tick. */
  private pending: { time: number; isOpen: boolean } | undefined;

  private prices: number[];

  private random: () => number;

  private barsPerTick: number;

  private intervalMs: number;

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(symbols: MarketSymbol[], options: MarketDataSourceOptions) {
    super(
      symbols.map(({ id, name }) => ({
        id,
        name,
        type: "line",
        data: createSeriesData(),
      })),
      options,
    );
    this.symbols = symbols;
    this.calendar = new BusinessCalendar(options.calendar);
    this.random = createRandom(options.seed ?? 1);
    this.prices = symbols.map((symbol) => symbol.start);
    this.barsPerTick = options.barsPerTick;
    this.intervalMs = options.intervalMs;
    const startDay = Date.parse(`${options.startDate}T00:00:00Z`) / MS_PER_DAY;
    this.bars = this.generateBarTimes(startDay, options.barMs ?? 60_000);

    // History up to the first open after the initial days
    let endDay = startDay + options.initialDays;
    for (
      let i = 0;
      i < 366 && this.calendar.getSessions(endDay).length === 0;
      i += 1
    ) {
      endDay += 1;
    }
    const end = this.calendar.getSessions(endDay)[0]?.open ?? Infinity;
    let count = 0;
    const times: { time: number; isOpen: boolean }[] = [];
    for (;;) {
      const bar = this.bars.next().value as { time: number; isOpen: boolean };
      if (bar.time >= end || count > 1_000_000) {
        this.pending = bar;
        break;
      }
      times.push(bar);
      count += 1;
    }
    this.append(times);
  }

  private *generateBarTimes(
    startDay: number,
    barMs: number,
  ): Generator<{ time: number; isOpen: boolean }> {
    for (let day = startDay; ; day += 1) {
      const sessions = this.calendar.getSessions(day);
      for (let s = 0; s < sessions.length; s += 1) {
        const { open, close } = sessions[s];
        for (let time = open; time < close; time += barMs) {
          yield { time, isOpen: time === open };
        }
      }
    }
  }

  /** Prices each symbol at each bar, and appends them. */
  private append(times: { time: number; isOpen: boolean }[]): SeriesDelta[] {
    const deltas: SeriesDelta[] = [];
    this.symbols.forEach((symbol, s) => {
      const x: number[] = [];
      const y: number[] = [];
      times.forEach(({ time, isOpen }) => {
        // Prices gap at the open, by what moved while the market was closed
        const volatility = symbol.volatility * (isOpen ? 8 : 1);
        const shock = this.random() + this.random() + this.random() - 1.5;
        this.prices[s] *= Math.exp(shock * volatility);
        x.push(time);
        y.push(this.prices[s]);
      });
      const appended = seriesDataFromArrays(x, y);
      appendSeriesData(this.seriesData.get(symbol.id) as SeriesData, appended);
      deltas.push({ type: "append", seriesId: symbol.id, data: appended });
    });
    this.descriptors.forEach((descriptor) => {
      // eslint-disable-next-line no-param-reassign
      descriptor.bounds = getSeriesBounds(
        this.seriesData.get(descriptor.id) as SeriesData,
      );
    });
    return deltas;
  }

  /** Trades the next few bars. Exposed so tests can drive it without timers. */
  tick(): void {
    const times: { time: number; isOpen: boolean }[] = [];
    for (let i = 0; i < this.barsPerTick; i += 1) {
      const bar =
        this.pending ??
        (this.bars.next().value as { time: number; isOpen: boolean });
      this.pending = undefined;
      times.push(bar);
    }
    const deltas = this.append(times);
    this.fireShapeChanged(this.buildShape());
    this.fireDataChanged(deltas);
  }

  start(): void {
    if (this.timer == null) {
      this.timer = setInterval(() => this.tick(), this.intervalMs);
    }
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning(): boolean {
    return this.timer != null;
  }

  close(): void {
    this.stop();
    super.close();
  }
}

export default MarketDataSource;
