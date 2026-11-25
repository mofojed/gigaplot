import { expect, type Page } from "@playwright/test";

export const PLOT_BENCHMARK_URL =
  process.env.PLOT_BENCHMARK_URL ?? "http://localhost:9030/";

export const PLOT_HOST = "[data-testid=plot-host]";

/** Opens the benchmark on one library and waits for it to draw. */
export async function openBenchmark(
  page: Page,
  params: Record<string, string>,
): Promise<void> {
  await page.goto(`${PLOT_BENCHMARK_URL}?${new URLSearchParams(params)}`);
  await expect(page.locator(PLOT_HOST)).toHaveAttribute(
    "data-benchmark-status",
    /running|error/,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("error")).toHaveCount(0);
}

/** Waits for the live readout to show the library finishing ticks. */
export async function expectTicking(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.plotBenchmark?.liveStats?.updatesPerSecond ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  // Every tick turns the galaxy or scrolls the line, so the picture moves
  const host = page.locator(PLOT_HOST);
  const before = await host.screenshot();
  await expect
    .poll(async () => (await host.screenshot()).equals(before), {
      timeout: 10_000,
    })
    .toBe(false);
}

declare global {
  interface Window {
    plotBenchmark?: { liveStats?: { updatesPerSecond: number } };
  }
}
