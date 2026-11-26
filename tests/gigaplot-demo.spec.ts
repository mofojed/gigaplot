import { expect, test, type Page } from "@playwright/test";
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
 * The plot demo runs on its own server and needs no Deephaven backend, so these
 * tests use an absolute URL instead of the shared code-studio `baseURL`.
 */
const PLOT_DEMO_URL =
  process.env.PLOT_DEMO_URL ?? "http://localhost:9020/gigaplot/";

async function hoverPlotCenter(page: Page): Promise<void> {
  const box = await page.locator(DATA_CANVAS).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(PLOT_DEMO_URL);
  await expectReady(page);
});

test("loads with a renderer resolved and both canvas layers present", async ({
  page,
}) => {
  await expect(page.getByTestId("active-renderer")).not.toHaveText(
    "resolving…",
  );
  await expect(
    page.locator(`${PLOT} canvas[data-dh-plot-layer=axes]`),
  ).toBeVisible();
  await expect(page.locator(DATA_CANVAS)).toBeVisible();
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("honours a canvas only renderer preference", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await expect(page.getByTestId("active-renderer")).toHaveText("canvas");
  await expect(page.locator(PLOT)).toHaveAttribute(
    "data-dh-plot-renderer",
    "canvas",
  );
});

/** Reads RGB pixels from a 2D canvas layer at CSS pixel offsets. */
async function sampleLayer(
  page: Page,
  layer: "axes" | "legend",
  points: [number, number][],
): Promise<string[]> {
  return page
    .locator(`${PLOT} canvas[data-dh-plot-layer=${layer}]`)
    .evaluate((canvas: HTMLCanvasElement, cssPoints) => {
      const context = canvas.getContext("2d");
      const ratio = canvas.width / canvas.clientWidth;
      return cssPoints.map(([x, y]) => {
        const [r, g, b] = context?.getImageData(
          Math.round(x * ratio),
          Math.round(y * ratio),
          1,
          1,
        ).data ?? [0, 0, 0];
        return `#${[r, g, b]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")}`;
      });
    }, points);
}

test("matches the Deephaven theme and follows theme switches", async ({
  page,
}) => {
  // The data layer sits exactly on the plot area, whose left edge moves with
  // the y axis title and tick label widths
  const [areaLeft, areaTop] = await page
    .locator(DATA_CANVAS)
    .evaluate((canvas: HTMLCanvasElement) => [
      canvas.offsetLeft,
      canvas.offsetTop,
    ]);
  // Paper corner and inside the data area on the axes layer, and the middle
  // of the first legend swatch, which is inset 8px from the plot area and
  // centered 10px down, on the legend layer
  const axesPoints: [number, number][] = [
    [1, 1],
    [300, 300],
  ];
  const swatch: [number, number][] = [[areaLeft + 8 + 4, areaTop + 10]];
  const sample = async () => [
    ...(await sampleLayer(page, "axes", axesPoints)),
    ...(await sampleLayer(page, "legend", swatch)),
  ];

  // Defaults are the @deephaven/components dark chart colors
  await expect.poll(sample).toEqual(["#2d2a2e", "#322f33", "#74d6e1"]);

  await page.getByTestId("theme-select").selectOption("light");
  await expect.poll(sample).toEqual(["#f7f7f7", "#eeeeee", "#004a73"]);

  await page.getByTestId("theme-select").selectOption("dark");
  await expect.poll(sample).toEqual(["#2d2a2e", "#322f33", "#74d6e1"]);
});

test("draws the legend above the data", async ({ page }) => {
  const layers = await page
    .locator(`${PLOT} canvas`)
    .evaluateAll((canvases) =>
      canvases.map((canvas) => canvas.getAttribute("data-dh-plot-layer")),
    );
  expect(layers.indexOf("legend")).toBeGreaterThan(layers.indexOf("data"));
});

test("moves the legend beside the plot", async ({ page }) => {
  const plotWidth = await page
    .locator(PLOT)
    .evaluate((plot) => plot.clientWidth);
  const getAreaRight = () =>
    page
      .locator(DATA_CANVAS)
      .evaluate(
        (canvas: HTMLCanvasElement) => canvas.offsetLeft + canvas.offsetWidth,
      );
  const overlayRight = await getAreaRight();

  await page.getByTestId("legend-select").selectOption("right");
  // The plot area narrows to leave room for the legend
  await expect.poll(getAreaRight).toBeLessThan(overlayRight);
  const areaRight = await getAreaRight();
  const areaTop = await page
    .locator(DATA_CANVAS)
    .evaluate((canvas: HTMLCanvasElement) => canvas.offsetTop);
  // First swatch sits a legend item gap right of the plot area
  await expect
    .poll(() =>
      sampleLayer(page, "legend", [[areaRight + 16 + 4, areaTop + 9]]),
    )
    .toEqual(["#74d6e1"]);
  expect(areaRight).toBeLessThan(plotWidth);

  await page.getByTestId("legend-select").selectOption("overlay");
  await expect.poll(getAreaRight).toBe(overlayRight);
});

test("renders 64 plots at once", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-many").click();

  // Every plot gets its own pair of canvases and all of them must resolve
  await expectReady(page, 64);
  await expect(page.locator(DATA_CANVAS)).toHaveCount(64);
  await expect(page.getByTestId("plot-stats")).toContainText("64 plots");
  await expect(page.getByTestId("plot-stats")).not.toContainText("measuring");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  await expectDrawn(page, INK_GRID_CELL);
});

test("ticks all 64 plots at once", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-many").click();
  await expectReady(page, 64);

  const first = page.locator(DATA_CANVAS).first();
  const last = page.locator(DATA_CANVAS).last();
  const firstBefore = await first.screenshot();
  const lastBefore = await last.screenshot();

  await page.getByTestId("toggle-streaming").click();
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");

  // Both ends of the grid must be updating, not just the plot that was mounted first
  await expect
    .poll(async () => (await first.screenshot()).equals(firstBefore))
    .toBe(false);
  await expect
    .poll(async () => (await last.screenshot()).equals(lastBefore))
    .toBe(false);

  await page.getByTestId("toggle-streaming").click();
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

const EXAMPLES = [
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

EXAMPLES.forEach((example) => {
  test(`draws the ${example} example`, async ({ page }) => {
    await page.getByTestId("renderer-select").selectOption("canvas");
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page);

    await expect(page.getByTestId("plot-error")).toHaveCount(0);
    await expectDrawn(page);
  });
});

test("zooming redraws with data for the new viewport", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-downsample").click();
  await expectReady(page);

  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();

  await hoverPlotCenter(page);
  await page.mouse.wheel(0, -1200);
  await expectReady(page);

  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await expectDrawn(page);
});

test("double click resets the viewport", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await expectReady(page);

  const canvas = page.locator(DATA_CANVAS);
  const home = await canvas.screenshot();

  await hoverPlotCenter(page);
  await page.mouse.wheel(0, -600);
  await expectReady(page);
  expect((await canvas.screenshot()).equals(home)).toBe(false);

  await page.locator(PLOT).dblclick();
  await expectReady(page);
  expect((await canvas.screenshot()).equals(home)).toBe(true);
});

test("streaming appends points over time", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-streaming").click();
  await expectReady(page);

  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();

  await page.getByTestId("toggle-streaming").click();
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);
  await page.getByTestId("toggle-streaming").click();
});

test("streams six plots on a rotating cube", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-cube").click();

  await expectReady(page, 6);
  await expect(page.locator(".plot-cube-face")).toHaveCount(6);
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);

  // Faces are sized from layout, so a face turned edge on is not squashed
  const sizes = await page
    .locator(DATA_CANVAS)
    .evaluateAll((canvases) =>
      canvases.map((canvas) => (canvas as HTMLCanvasElement).width),
    );
  expect(new Set(sizes).size).toBe(1);
  expect(sizes[0]).toBeGreaterThan(100);

  const cube = page.locator(".plot-cube-body");
  const transform = await cube.evaluate((element) => element.style.transform);
  await expect
    .poll(() => cube.evaluate((element) => element.style.transform))
    .not.toBe(transform);
});

test("drags the cube to rotate it", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-cube").click();
  await expectReady(page, 6);
  await page.getByTestId("cube-auto-rotate").uncheck();

  const cube = page.locator(".plot-cube-body");
  const rotation = (): Promise<number> =>
    cube.evaluate((element) =>
      Number(/rotateX\((-?[\d.]+)deg\)/.exec(element.style.transform)?.[1]),
    );
  const before = await rotation();

  const box = await page.getByTestId("plot-cube").boundingBox();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100, { steps: 5 });
  await page.mouse.up();

  expect(await rotation()).toBeLessThan(before);
});

test("scatter stress draws every point and reports a frame rate", async ({
  page,
}) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-scatter-stress").click();
  await expectReady(page);

  await page.getByTestId("stress-point-count").selectOption("10000");
  await expectReady(page);
  await expect(page.getByTestId("plot-stats")).toContainText("10,000 points");
  await expect(page.getByTestId("plot-fps")).toHaveText(/^\d+ fps$/);
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  await expectDrawn(page);

  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);
});

test("plays Doom in a scatter plot of its palette", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-doom").click();
  await expectReady(page);

  await expect(page.getByTestId("doom-stats")).toContainText(
    "64,000 points per frame",
  );
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  await expectDrawn(page);

  await page.getByTestId("doom-points-per-pixel").selectOption("0.25");
  await expect(page.getByTestId("doom-stats")).toContainText(
    "16,000 points per frame",
  );
});

test("drags a 3D plot to rotate it", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-scatter-3d").click();
  await expectReady(page);
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
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("flies through the ticking star field", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-star-field").click();
  await expectReady(page);
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");

  // The box is hidden, so anything drawn is a star
  await expectDrawn(page, 0.005);
  const canvas = page.locator(DATA_CANVAS);
  const before = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);

  await page.getByTestId("toggle-streaming").click();
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Start stream");
});

/**
 * Moves the cursor over the data area in a grid until the hover layer draws,
 * since where a 3D plot's points land depends on the window's shape.
 */
async function hoverUntilDrawn(page: Page): Promise<number> {
  for (let row = 1; row < 10; row += 1) {
    for (let column = 1; column < 10; column += 1) {
      await hoverDataAt(page, column / 10, row / 10);
      const ink = await getHoverInkFraction(page);
      if (ink > 0) {
        return ink;
      }
    }
  }
  return 0;
}

test("shows a 3D tooltip over a point, and hides it on leave", async ({
  page,
}) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-scatter-3d").click();
  await expectReady(page);

  expect(await hoverUntilDrawn(page)).toBeGreaterThan(0);
  await page.mouse.move(0, 0);
  await expect.poll(() => getHoverInkFraction(page)).toBe(0);
});

// WebGPU coverage lives in gigaplot-demo-webgpu.spec.ts, which runs in a browser
// launched with WebGPU enabled rather than skipping when it is unavailable.

test.describe("hover", () => {
  test("shows a tooltip anywhere along a line plot, and hides it on leave", async ({
    page,
  }) => {
    await page.getByTestId("example-line").click();
    await expectReady(page);
    await hoverDataAt(page, 0.5, 0.95);
    // Lines snap to the cursor's x, so the cursor need not be on a line
    await expect.poll(() => getHoverInkFraction(page)).toBeGreaterThan(0.002);

    await page.mouse.move(1, 1);
    await expect.poll(() => getHoverInkFraction(page)).toBe(0);
  });

  test("only shows a scatter tooltip over a point", async ({ page }) => {
    await page.getByTestId("example-scatter").click();
    await expectReady(page);
    // The bottom right corner of the scatter example is empty
    await hoverDataAt(page, 0.97, 0.97);
    await page.waitForTimeout(200);
    expect(await getHoverInkFraction(page)).toBe(0);

    // Step across the dense middle of a cluster until a point is under the cursor
    let fractionX = 0.55;
    await expect
      .poll(async () => {
        fractionX += 0.004;
        await hoverDataAt(page, fractionX, 0.7);
        return getHoverInkFraction(page);
      })
      .toBeGreaterThan(0);
  });

  test("snaps to the bar under the cursor's x on an ohlc plot", async ({
    page,
  }) => {
    await page.getByTestId("example-ohlc").click();
    await expectReady(page);
    await hoverDataAt(page, 0.5, 0.95);
    await expect.poll(() => getHoverInkFraction(page)).toBeGreaterThan(0.002);
  });

  test("snaps along a stacked area plot", async ({ page }) => {
    await page.getByTestId("example-stacked-area").click();
    await expectReady(page);
    await hoverDataAt(page, 0.5, 0.95);
    await expect.poll(() => getHoverInkFraction(page)).toBeGreaterThan(0.002);
  });

  test("draws more of the overlay as parts are turned on", async ({ page }) => {
    await page.getByTestId("example-line").click();
    await expectReady(page);
    await hoverDataAt(page, 0.5, 0.5);
    await expect.poll(() => getHoverInkFraction(page)).toBeGreaterThan(0);
    const defaultInk = await getHoverInkFraction(page);

    for (const part of ["guides", "xAxisLabel", "yAxisLabels"]) {
      await page.getByTestId(`tooltip-${part}`).check();
    }
    await hoverDataAt(page, 0.5, 0.5);
    await expect
      .poll(() => getHoverInkFraction(page))
      .toBeGreaterThan(defaultInk);

    for (const part of [
      "box",
      "markers",
      "guides",
      "xAxisLabel",
      "yAxisLabels",
    ]) {
      await page.getByTestId(`tooltip-${part}`).uncheck();
    }
    await hoverDataAt(page, 0.5, 0.5);
    await expect.poll(() => getHoverInkFraction(page)).toBe(0);
  });
});

/** Screenshots of each plot's data layer, which the axes layer shows through. */
async function screenshotPlots(page: Page): Promise<Buffer[]> {
  const canvases = page.locator(DATA_CANVAS);
  const count = await canvases.count();
  return Promise.all(
    Array.from({ length: count }, (_unused, i) => canvases.nth(i).screenshot()),
  );
}

test("plots ticking market prices with and without a business calendar", async ({
  page,
}) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-market-hours").click();
  await expectReady(page, 2);
  await expect(
    page.getByText("Business calendar: only trading sessions"),
  ).toBeVisible();
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);

  // The same prices draw differently once nights and weekends are removed
  const [clock, business] = await screenshotPlots(page);
  expect(clock.equals(business)).toBe(false);

  // Both plots follow the ticking prices
  await expect
    .poll(async () => {
      const [nextClock, nextBusiness] = await screenshotPlots(page);
      return !nextClock.equals(clock) && !nextBusiness.equals(business);
    })
    .toBe(true);
  await page.getByTestId("toggle-streaming").click();
});

["log-scale", "exp-scale"].forEach((example) => {
  test(`draws both plots of the ${example} example`, async ({ page }) => {
    await page.getByTestId("renderer-select").selectOption("canvas");
    await page.getByTestId(`example-${example}`).click();
    await expectReady(page, 2);
    await expect(page.getByTestId("plot-error")).toHaveCount(0);

    const [linear, scaled] = await screenshotPlots(page);
    expect(linear.equals(scaled)).toBe(false);
  });
});

test("zooms the second axis of the twin axes example with the first", async ({
  page,
}) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-twin-axes").click();
  await expectReady(page, 2);
  await expect(page.getByTestId("plot-error")).toHaveCount(0);

  // The volume axis is labelled right of the price plot's data
  const data = page.locator(DATA_CANVAS).first();
  const box = await data.boundingBox();
  const axes = await page
    .locator("canvas[data-dh-plot-layer=axes]")
    .first()
    .boundingBox();
  const right = (box?.x ?? 0) + (box?.width ?? 0);
  const clip = {
    x: right,
    y: box?.y ?? 0,
    width: (axes?.x ?? 0) + (axes?.width ?? 0) - right,
    height: box?.height ?? 0,
  };
  const before = await page.screenshot({ clip });

  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.mouse.wheel(0, -1200);
  await expectReady(page, 2);
  await expect
    .poll(async () => (await page.screenshot({ clip })).equals(before))
    .toBe(false);
});

test("zooms a business calendar axis in to times within sessions", async ({
  page,
}) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-market-hours").click();
  await expectReady(page, 2);
  await page.getByTestId("toggle-streaming").click();

  const business = page.locator(DATA_CANVAS).nth(1);
  const before = await business.screenshot();
  const box = await business.boundingBox();
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.mouse.wheel(0, -3000);
  await expectReady(page, 2);
  expect((await business.screenshot()).equals(before)).toBe(false);
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
});

test("draws and animates the four Great Scott! plots", async ({ page }) => {
  await page.getByTestId("renderer-select").selectOption("canvas");
  await page.getByTestId("example-great-scott").click();
  await expectReady(page, 4);
  await expect(
    page.getByRole("heading", { name: "Flux capacitor" }),
  ).toBeVisible();
  await expect(page.getByTestId("toggle-streaming")).toHaveText("Stop stream");
  await expect(page.getByTestId("plot-error")).toHaveCount(0);
  await expectDrawn(page);

  // The fire trails and the flux capacitor both move on every frame
  const fireTrails = page.locator(DATA_CANVAS).nth(0);
  const fluxCapacitor = page.locator(DATA_CANVAS).nth(1);
  const fireBefore = await fireTrails.screenshot();
  const fluxBefore = await fluxCapacitor.screenshot();
  await expect
    .poll(async () => (await fireTrails.screenshot()).equals(fireBefore))
    .toBe(false);
  await expect
    .poll(async () => (await fluxCapacitor.screenshot()).equals(fluxBefore))
    .toBe(false);
  await page.getByTestId("toggle-streaming").click();
});
