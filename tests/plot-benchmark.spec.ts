import { expect, test } from "@playwright/test";
import {
  expectTicking,
  openBenchmark,
  PLOT_BENCHMARK_URL,
} from "./plot-benchmark.utils";

/**
 * Smoke tests for the benchmark app: every library draws and keeps up with
 * ticks on a small data set. gigaplot's WebGPU renderer is covered in
 * plot-benchmark-webgpu.spec.ts, which runs with WebGPU forced on.
 */
const LIBRARIES = {
  scatter: [
    "gigaplot-canvas",
    "plotly-webgl",
    "uplot",
    "echarts",
    "chartjs",
    "deckgl",
  ],
  line: [
    "gigaplot-canvas",
    "plotly-webgl",
    "uplot",
    "lightweight-charts",
    "echarts",
    "chartjs",
    "deckgl",
  ],
};

const LIBRARY_IDS = [
  ...new Set([...LIBRARIES.scatter, ...LIBRARIES.line, "gigaplot-webgpu"]),
].map((id) => ({ id }));

Object.entries(LIBRARIES).forEach(([kind, libraries]) => {
  libraries.forEach((lib) => {
    test(`${lib} draws and ticks a ${kind} plot`, async ({ page }) => {
      await openBenchmark(page, { lib, kind, points: "10000", tick: "0.1" });
      await expectTicking(page);
    });
  });
});

test("a library without the plot type is not offered", async ({ page }) => {
  await openBenchmark(page, {
    lib: "lightweight-charts",
    kind: "line",
    points: "1000",
  });
  await page.getByTestId("kind-scatter").click();
  await expect(page.getByTestId("library")).toHaveValue("gigaplot-webgpu");
  await expect(
    page.locator("#library option[value=lightweight-charts]"),
  ).toBeDisabled();
});

test("accepts a custom point count", async ({ page }) => {
  await openBenchmark(page, { lib: "uplot", kind: "line", points: "1000" });
  await page.getByTestId("points").fill("12.5k");
  await page.getByTestId("points").press("Enter");
  await expect(page.getByTestId("stats")).toContainText("12,500 points");
  await expect(page).toHaveURL(/points=12500/);
});

test("compares libraries across sizes", async ({ page }) => {
  await openBenchmark(page, { lib: "uplot", kind: "line", points: "1000" });
  const keep = ["gigaplot-canvas", "uplot"];
  for (const { id } of LIBRARY_IDS) {
    await page
      .getByTestId(`compare-library-${id}`)
      .setChecked(keep.includes(id));
  }
  await page.getByTestId("compare-size-100000").uncheck();
  await page.getByTestId("compare-size-1000000").uncheck();
  await page.getByTestId("compare-size-1000").check();
  await page.getByTestId("compare-size-10000").check();
  await page.locator("#duration").selectOption("3");
  await page.getByTestId("compare").click();
  await expect(page.getByTestId("compare-progress")).toHaveText("Done", {
    timeout: 90_000,
  });
  const rows = page.getByTestId("results").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("gigaplot");
  await expect(rows.nth(1)).toContainText("10K");
  await expect(rows.nth(3)).toContainText("uPlot");
});
