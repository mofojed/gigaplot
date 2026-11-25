import { test } from "@playwright/test";
import { expectTicking, openBenchmark } from "./plot-benchmark.utils";

/**
 * Runs only in the `chromium-webgpu` project, so gigaplot's WebGPU renderer
 * fails here rather than the benchmark quietly reporting an error.
 */
["scatter", "line"].forEach((kind) => {
  test(`gigaplot WebGPU draws and ticks a ${kind} plot`, async ({ page }) => {
    await openBenchmark(page, {
      lib: "gigaplot-webgpu",
      kind,
      points: "10000",
      tick: "0.1",
    });
    await expectTicking(page);
  });
});
