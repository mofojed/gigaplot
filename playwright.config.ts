import { defineConfig, devices } from "@playwright/test";

const TIMEOUT_MS = 120 * 1000;

/** Only run in the project that launches a browser with WebGPU enabled. */
const WEBGPU_TESTS = /.*-webgpu\.spec\.ts/;

export default defineConfig({
  testDir: "./tests",
  timeout: TIMEOUT_MS,
  expect: { timeout: 15 * 1000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    actionTimeout: 15 * 1000,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm start",
      url: "http://localhost:9020/gigaplot/",
      reuseExistingServer: true,
    },
    {
      command: "npm run benchmark",
      url: "http://localhost:9030/",
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: WEBGPU_TESTS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // WebGPU is off in headless browsers, so force it on over SwiftShader
      name: "chromium-webgpu",
      testMatch: WEBGPU_TESTS,
      timeout: TIMEOUT_MS * 2,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan",
            "--use-angle=swiftshader",
            "--use-gl=angle",
            "--enable-gpu",
          ],
        },
      },
    },
  ],
});
