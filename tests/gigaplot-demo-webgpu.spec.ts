import { expect, test } from "@playwright/test";
import {
  DATA_CANVAS,
  expectDrawn,
  expectReady,
  getHoverInkFraction,
  hoverDataAt,
  INK_GRID_CELL,
  PLOT,
} from "./gigaplot-demo.utils";

/**
 * WebGPU specific coverage.
 *
 * This file only runs in the `chromium-webgpu` project, which launches Chromium
 * with WebGPU forced on over SwiftShader. Unlike the renderer agnostic suite,
 * these tests fail rather than skip when WebGPU is unavailable, because their
 * whole purpose is to prove the WebGPU renderer works.
 */
const PLOT_DEMO_URL =
  process.env.PLOT_DEMO_URL ?? "http://localhost:9020/gigaplot/";

test.beforeEach(async ({ page }) => {
  await page.goto(PLOT_DEMO_URL);
  await expectReady(page);
});

test("the browser exposes a WebGPU adapter", async ({ page }) => {
  const adapter = await page.evaluate(async () => {
    if (navigator.gpu == null) {
      return "no navigator.gpu";
    }
    const found =
      (await navigator.gpu.requestAdapter()) ??
      (await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }));
    return found == null ? "no adapter" : "ok";
  });
  expect(adapter).toBe("ok");
});

test("auto preference picks WebGPU over canvas when it is available", async ({
  page,
}) => {
  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await expect(page.locator(PLOT)).toHaveAttribute(
    "data-dh-plot-renderer",
    "webgpu",
  );
});

test("does not report WebGPU as unavailable", async ({ page }) => {
  await expect(page.getByTestId("renderer-option-webgpu")).toHaveText(
    "WebGPU only",
  );
});

const WEBGPU_EXAMPLES = [
  "scatter",
  "line",
  "mixed",
  "area",
  "stacked-area",
  "ohlc",
  "candlestick",
  "downsample",
  "streaming",
  "scatter-3d",
  "line-3d",
  "lorenz-3d",
  "ripple-3d",
  "star-field",
];

WEBGPU_EXAMPLES.forEach((example) => {
  test(`draws the ${example} example with WebGPU`, async ({ page }) => {
    await page.getByTestId("renderer-select").selectOption("webgpu");
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page);

    await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
    await expect(page.getByTestId("plot-error")).toHaveCount(0);
    await expectDrawn(page);
  });
});

test("zooming a WebGPU plot redraws it", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-downsample").click();
  await expectReady(page);

  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();

  const box = await canvas.boundingBox();
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.mouse.wheel(0, -1200);
  await expectReady(page);

  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("draws ohlc and candlestick bars without WebGPU errors", async ({
  page,
}) => {
  // Shader and validation errors are only logged, so a broken pipeline would
  // otherwise just draw nothing
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("WebGPU")) {
      errors.push(message.text());
    }
  });
  await page.getByTestId("renderer-select").selectOption("webgpu");
  for (const example of ["ohlc", "candlestick"]) {
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page);
    await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
    await expectDrawn(page);
  }
  expect(errors).toEqual([]);
});

test("fills areas and zooms them without WebGPU errors", async ({ page }) => {
  // The fill pipeline has a bind group of its own, and zooming draws the old
  // data on a coarser grid until new data arrives
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("WebGPU")) {
      errors.push(message.text());
    }
  });
  await page.getByTestId("renderer-select").selectOption("webgpu");
  for (const example of ["area", "stacked-area"]) {
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page);
    await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
    await expectDrawn(page);

    const canvas = page.locator(DATA_CANVAS);
    const before = await canvas.screenshot();
    const box = await canvas.boundingBox();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await page.mouse.wheel(0, -1200);
    await expectReady(page);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    await expectDrawn(page);
  }
  expect(errors).toEqual([]);
});

test("draws, rotates, and ticks 3D plots without WebGPU errors", async ({
  page,
}) => {
  // The 3D pipelines depth test against a texture of their own, so a format
  // or attachment mismatch would only be logged
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("WebGPU")) {
      errors.push(message.text());
    }
  });
  await page.getByTestId("renderer-select").selectOption("webgpu");
  for (const example of ["scatter-3d", "line-3d"]) {
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page);
    await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
    await expectDrawn(page);

    const canvas = page.locator(DATA_CANVAS);
    const before = await canvas.screenshot();
    const box = await canvas.boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 40, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await canvas.screenshot()).equals(before))
      .toBe(false);
  }

  // Every star moves on every frame, as updates written into the GPU buffer
  await page.getByTestId("example-star-field").click();
  await expectReady(page);
  await expectDrawn(page, 0.005);
  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);

  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("draws scaled, calendar, and twin axes with WebGPU without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("WebGPU")) {
      errors.push(message.text());
    }
  });
  await page.getByTestId("renderer-select").selectOption("webgpu");
  for (const example of [
    "market-hours",
    "log-scale",
    "exp-scale",
    "twin-axes",
  ]) {
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page, 2);
    await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
    await expect(page.getByTestId("plot-error")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("applies streaming deltas on the GPU without errors", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-streaming").click();
  await expectReady(page);

  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();

  await page.getByTestId("toggle-streaming").click();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);
  await page.getByTestId("toggle-streaming").click();

  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("renders 64 WebGPU plots from a single shared device", async ({
  page,
}) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-many").click();
  await expectReady(page, 64);

  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await expect(page.locator(DATA_CANVAS)).toHaveCount(64);
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  await expectDrawn(page, INK_GRID_CELL);
});

test("streams every face of the cube with WebGPU", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-cube").click();
  await expectReady(page, 6);

  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await expect(page.locator(DATA_CANVAS)).toHaveCount(6);
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("applies scatter stress updates on the GPU", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-scatter-stress").click();
  await page.getByTestId("stress-point-count").selectOption("10000");
  await expectReady(page);

  const canvas = page.locator(DATA_CANVAS);
  await expectDrawn(page);
  const before = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);

  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await expect(page.getByTestId("plot-fps")).toHaveText(/^\d+ fps$/);
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("hovers the data the WebGPU renderer holds", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-line").click();
  await expectReady(page);
  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await hoverDataAt(page, 0.5, 0.5);
  await expect.poll(() => getHoverInkFraction(page)).toBeGreaterThan(0.002);
});

test("draws the four Great Scott! plots with WebGPU", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("webgpu");
  await page.getByTestId("example-great-scott").click();
  await expectReady(page, 4);

  await expect(page.getByTestId("active-renderer")).toHaveText("webgpu");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  await expectDrawn(page);
});
