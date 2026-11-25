import type { BenchmarkDataset, DatasetChange } from "../dataset";

export interface AdapterOptions {
  /** Scatter point diameter in CSS pixels. */
  pointSize: number;
  /** Line width in CSS pixels. */
  lineWidth: number;
}

/** A plot mounted by one library. */
export interface BenchmarkAdapter {
  /**
   * Pushes a change the dataset has already applied to its arrays. A library
   * that updates asynchronously returns a promise, and is not given another
   * tick until it settles.
   */
  update(change: DatasetChange): void | Promise<void>;
  destroy(): void;
}

export type MountAdapter = (
  container: HTMLElement,
  dataset: BenchmarkDataset,
  options: AdapterOptions,
) => Promise<BenchmarkAdapter>;

/** Waits for the next animation frame. */
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}
