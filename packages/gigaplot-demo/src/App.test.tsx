import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

let boundingRectSpy: jest.SpyInstance;

beforeEach(() => {
  boundingRectSpy = jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 800, 600));
});

afterEach(() => {
  boundingRectSpy.mockRestore();
  // Examples are picked from the hash, which outlives each test
  window.history.replaceState(null, "", "/");
});

it("opens the example named in the URL hash, and names the one picked", () => {
  window.history.replaceState(null, "", "/#line");
  render(<App />);
  expect(screen.getByTestId("example-line").className).toBe("is-selected");

  fireEvent.click(screen.getByTestId("example-scatter"));

  expect(window.location.hash).toBe("#scatter");
  expect(screen.getByTestId("example-scatter").className).toBe("is-selected");
});

it("renders every example option", async () => {
  render(<App />);
  expect(screen.getByTestId("example-scatter")).toBeTruthy();
  expect(screen.getByTestId("example-line")).toBeTruthy();
  expect(screen.getByTestId("example-streaming")).toBeTruthy();
  expect(screen.getByTestId("renderer-select")).toBeTruthy();

  // WebGPU is unavailable in jsdom, so the canvas renderer should be selected
  await waitFor(() =>
    expect(screen.getByTestId("active-renderer").textContent).toBe("canvas"),
  );
});

it("puts six streaming plots on the cube and starts them immediately", async () => {
  const { container } = render(<App />);
  fireEvent.click(screen.getByTestId("example-cube"));

  expect(screen.getByTestId("plot-cube")).toBeTruthy();
  expect(container.querySelectorAll(".plot-cube-face")).toHaveLength(6);
  expect(container.querySelectorAll(".plot-demo-plot")).toHaveLength(6);
  expect(screen.getByText("Oscilloscope")).toBeTruthy();
  expect(screen.getByTestId("toggle-streaming").textContent).toBe(
    "Stop stream",
  );

  await waitFor(() =>
    expect(
      container.querySelectorAll("[data-dh-plot-status=ready]"),
    ).toHaveLength(6),
  );
  await waitFor(() =>
    expect(screen.getByTestId("plot-stats").textContent).toMatch(/\d+ ms$/),
  );

  fireEvent.click(screen.getByTestId("toggle-streaming"));
  expect(screen.getByTestId("toggle-streaming").textContent).toBe(
    "Start stream",
  );
});

it("lets the scatter stress example pick its point count", async () => {
  render(<App />);
  fireEvent.click(screen.getByTestId("example-scatter-stress"));

  expect(screen.getByTestId("plot-stats").textContent).toContain(
    "100,000 points",
  );
  fireEvent.change(screen.getByTestId("stress-point-count"), {
    target: { value: "10000" },
  });
  fireEvent.change(screen.getByTestId("stress-refresh"), {
    target: { value: "1" },
  });
  expect(screen.getByTestId("plot-stats").textContent).toContain(
    "10,000 points · 10,000 replaced per frame",
  );
  await waitFor(() =>
    expect(screen.getByTestId("plot-fps").textContent).toMatch(/fps$/),
  );
  fireEvent.click(screen.getByTestId("toggle-streaming"));
});

it.each(["scatter-3d", "line-3d", "lorenz-3d", "ripple-3d", "star-field"])(
  "draws the %s example as a 3D plot",
  async (exampleId) => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByTestId(`example-${exampleId}`));

    await waitFor(() =>
      expect(
        container.querySelector(".plot-demo-plot[data-dh-plot-status=ready]"),
      ).not.toBeNull(),
    );
    expect(screen.getByTestId("active-renderer").textContent).toBe("canvas");
    expect(screen.queryByTestId("plot-error")).toBeNull();
    // Tooltip parts only apply to 2D plots
    expect(screen.queryByTestId("tooltip-guides")).toBeNull();
  },
);

it.each(["market-hours", "log-scale", "exp-scale"])(
  "stacks the two plots of the %s example with their titles",
  async (exampleId) => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByTestId(`example-${exampleId}`));

    expect(container.querySelectorAll(".plot-demo-stack-item")).toHaveLength(2);
    await waitFor(() =>
      expect(
        container.querySelectorAll(
          ".plot-demo-plot[data-dh-plot-status=ready]",
        ),
      ).toHaveLength(2),
    );
    expect(screen.queryByTestId("plot-error")).toBeNull();
  },
);

it("lays the Great Scott! example out as four titled, streaming plots", async () => {
  const { container } = render(<App />);
  fireEvent.click(screen.getByTestId("example-great-scott"));

  expect(container.querySelector(".plot-demo-quad")).not.toBeNull();
  expect(container.querySelectorAll(".plot-demo-stack-item")).toHaveLength(4);
  expect(screen.getByText("Flux capacitor")).toBeTruthy();
  expect(screen.getByTestId("toggle-streaming").textContent).toBe(
    "Stop stream",
  );
  await waitFor(() =>
    expect(
      container.querySelectorAll(".plot-demo-plot[data-dh-plot-status=ready]"),
    ).toHaveLength(4),
  );
  expect(screen.queryByTestId("plot-error")).toBeNull();
  fireEvent.click(screen.getByTestId("toggle-streaming"));
});
