import { nextFrame, type BenchmarkAdapter } from "./adapters/types";
import { BenchmarkDataset, type PlotKind } from "./dataset";
import type { LibraryDefinition } from "./libraries";

export interface RunConfig {
  kind: PlotKind;
  /** Total points across every series. */
  pointCount: number;
  seriesCount: number;
  /** Fraction of every series replaced on each frame. 0 draws once and stops. */
  tickFraction: number;
  pointSize: number;
  lineWidth: number;
}

export interface RunStats {
  /** Milliseconds the window covers. */
  durationMs: number;
  /** Animation frames per second, which falls when the main thread is busy. */
  pageFps: number;
  /** Ticks per second the library accepted and finished. */
  updatesPerSecond: number;
  /** Mean time inside the library's update call, synchronous part only. */
  updateMs: number;
  /** Mean time spent generating each tick's data, the same for every library. */
  dataMs: number;
  /** 95th percentile time between animation frames. */
  p95FrameMs: number;
  maxFrameMs: number;
  /** JS heap in use, where the browser reports it. */
  heapMb?: number;
}

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number };
}

function getHeapMb(): number | undefined {
  const { memory } = performance as MemoryPerformance;
  return memory == null ? undefined : memory.usedJSHeapSize / 1024 / 1024;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

/**
 * Mounts one library with one dataset and drives it from an animation frame
 * loop. Each frame ticks the dataset and hands the change to the library,
 * unless the library is still working through the previous one
 * asynchronously, so slow libraries are measured by how many ticks they can
 * finish rather than queueing them without end.
 */
export class BenchmarkRun {
  readonly library: LibraryDefinition;

  readonly config: RunConfig;

  readonly dataset: BenchmarkDataset;

  /** Mount until the frame after the library reported its first draw. */
  initMs: number | undefined;

  error: unknown;

  private host: HTMLElement;

  /** Positioned in the host. Libraries mount into `container`, inside it. */
  private frameElement: HTMLDivElement;

  private container: HTMLDivElement;

  private adapter: BenchmarkAdapter | undefined;

  private frame: number | undefined;

  private isDestroyed = false;

  private isTicking: boolean;

  private isUpdatePending = false;

  private lastFrameAt: number | undefined;

  private windowStart = performance.now();

  private frameIntervals: number[] = [];

  private frameCount = 0;

  private updates = 0;

  private updateMsTotal = 0;

  private dataMsTotal = 0;

  private ticks = 0;

  private onError: (error: unknown) => void;

  constructor(
    host: HTMLElement,
    library: LibraryDefinition,
    config: RunConfig,
    onError: (error: unknown) => void = () => undefined,
  ) {
    this.host = host;
    this.library = library;
    this.config = config;
    this.onError = onError;
    this.isTicking = config.tickFraction > 0;
    this.dataset = new BenchmarkDataset({
      kind: config.kind,
      pointCount: config.pointCount,
      seriesCount: config.seriesCount,
    });
    // Some libraries restyle the element they mount into
    this.frameElement = document.createElement("div");
    this.frameElement.className = "benchmark-plot";
    this.container = document.createElement("div");
    this.container.className = "benchmark-plot-container";
    this.frameElement.appendChild(this.container);
    host.appendChild(this.frameElement);
    this.handleFrame = this.handleFrame.bind(this);
  }

  /** Mounts the library and starts the loop. Resolves with the init time. */
  async start(): Promise<number> {
    const { library, config, dataset } = this;
    if (!library.kinds.includes(config.kind)) {
      throw new Error(`${library.name} cannot draw ${config.kind} plots`);
    }
    const mount = await library.load();
    // Let the loading state paint before the main thread is tied up mounting
    await nextFrame();
    if (this.isDestroyed) {
      throw new Error("Cancelled");
    }
    const startedAt = performance.now();
    const adapter = await mount(this.container, dataset, {
      pointSize: config.pointSize,
      lineWidth: config.lineWidth,
    });
    if (this.isDestroyed) {
      adapter.destroy();
      throw new Error("Cancelled");
    }
    this.adapter = adapter;
    await nextFrame();
    this.initMs = performance.now() - startedAt;
    this.resetStats();
    this.frame = requestAnimationFrame(this.handleFrame);
    return this.initMs;
  }

  getTicking(): boolean {
    return this.isTicking;
  }

  setTicking(isTicking: boolean): void {
    this.isTicking = isTicking && this.config.tickFraction > 0;
  }

  /** Ticks completed since the run started. */
  getTickCount(): number {
    return this.ticks;
  }

  resetStats(): void {
    this.windowStart = performance.now();
    this.lastFrameAt = undefined;
    this.frameIntervals = [];
    this.frameCount = 0;
    this.updates = 0;
    this.updateMsTotal = 0;
    this.dataMsTotal = 0;
  }

  /** Stats since the last reset. */
  getStats(): RunStats {
    const durationMs = performance.now() - this.windowStart;
    const seconds = durationMs / 1000;
    const intervals = this.frameIntervals;
    return {
      durationMs,
      pageFps: seconds > 0 ? this.frameCount / seconds : 0,
      updatesPerSecond: seconds > 0 ? this.updates / seconds : 0,
      updateMs: this.updates > 0 ? this.updateMsTotal / this.updates : 0,
      dataMs: this.updates > 0 ? this.dataMsTotal / this.updates : 0,
      p95FrameMs: percentile(intervals, 0.95),
      maxFrameMs: intervals.reduce((max, value) => Math.max(max, value), 0),
      heapMb: getHeapMb(),
    };
  }

  private handleFrame(now: number): void {
    this.frame = requestAnimationFrame(this.handleFrame);
    if (this.lastFrameAt != null) {
      this.frameIntervals.push(now - this.lastFrameAt);
    }
    this.lastFrameAt = now;
    this.frameCount += 1;
    const { adapter } = this;
    if (!this.isTicking || this.isUpdatePending || adapter == null) {
      return;
    }
    const count = Math.max(
      1,
      Math.round(this.dataset.pointsPerSeries * this.config.tickFraction),
    );
    const dataStart = performance.now();
    const change = this.dataset.tick(count);
    const updateStart = performance.now();
    try {
      const result = adapter.update(change);
      this.dataMsTotal += updateStart - dataStart;
      this.updateMsTotal += performance.now() - updateStart;
      if (result instanceof Promise) {
        this.isUpdatePending = true;
        result.then(
          () => this.completeUpdate(),
          (error: unknown) => this.fail(error),
        );
      } else {
        this.completeUpdate();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private completeUpdate(): void {
    this.isUpdatePending = false;
    this.updates += 1;
    this.ticks += 1;
  }

  private fail(error: unknown): void {
    this.isUpdatePending = false;
    this.isTicking = false;
    this.error = error;
    this.onError(error);
  }

  destroy(): void {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    if (this.frame != null) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    try {
      this.adapter?.destroy();
    } finally {
      this.adapter = undefined;
      this.frameElement.remove();
    }
  }
}

export default BenchmarkRun;
