import { BenchmarkDataset } from "./dataset";

function withinBounds(dataset: BenchmarkDataset): boolean {
  const { xMin, xMax, yMin, yMax } = dataset.getBounds();
  return dataset.series.every(({ x, y }) =>
    x.every(
      (value, i) =>
        value >= xMin && value <= xMax && y[i] >= yMin && y[i] <= yMax,
    ),
  );
}

describe("BenchmarkDataset", () => {
  it("splits the points across its series", () => {
    const dataset = new BenchmarkDataset({
      kind: "scatter",
      pointCount: 1001,
      seriesCount: 4,
    });
    expect(dataset.series).toHaveLength(4);
    expect(dataset.pointsPerSeries).toBe(251);
    expect(dataset.getPointCount()).toBe(1004);
    dataset.series.forEach(({ x, y }) => {
      expect(x).toHaveLength(251);
      expect(y).toHaveLength(251);
    });
  });

  it("is reproducible from its seed", () => {
    const options = {
      kind: "scatter",
      pointCount: 500,
      seriesCount: 2,
    } as const;
    const a = new BenchmarkDataset(options);
    const b = new BenchmarkDataset(options);
    a.tick(30);
    b.tick(30);
    expect(a.series[1].x).toEqual(b.series[1].x);
    expect(a.series[1].y).toEqual(b.series[1].y);
  });

  it("replaces scatter points in place, wrapping at the end", () => {
    const dataset = new BenchmarkDataset({
      kind: "scatter",
      pointCount: 10,
      seriesCount: 1,
    });
    const before = dataset.series[0].x.slice();
    expect(dataset.tick(4)).toEqual({
      kind: "scatter",
      ranges: [{ offset: 0, count: 4 }],
    });
    const after = dataset.series[0].x;
    expect(after.slice(4)).toEqual(before.slice(4));
    expect(after.slice(0, 4)).not.toEqual(before.slice(0, 4));

    dataset.tick(4);
    expect(dataset.tick(4)).toEqual({
      kind: "scatter",
      ranges: [
        { offset: 8, count: 2 },
        { offset: 0, count: 2 },
      ],
    });
    expect(withinBounds(dataset)).toBe(true);
  });

  it("scrolls lines, sharing one ascending x array", () => {
    const dataset = new BenchmarkDataset({
      kind: "line",
      pointCount: 300,
      seriesCount: 3,
    });
    const [first, second] = dataset.series;
    expect(first.x).toBe(second.x);
    const before = first.y.slice();
    expect(dataset.tick(25)).toEqual({ kind: "line", shift: 25 });
    expect(first.y.slice(0, 75)).toEqual(before.slice(25));
    expect(first.x[0]).toBe(26);
    expect(dataset.getBounds()).toMatchObject({ xMin: 26, xMax: 125 });
    for (let i = 1; i < first.x.length; i += 1) {
      expect(first.x[i]).toBeGreaterThan(first.x[i - 1]);
    }
    expect(withinBounds(dataset)).toBe(true);
  });

  it("keeps scrolling past the end of its backing arrays", () => {
    const dataset = new BenchmarkDataset({
      kind: "line",
      pointCount: 200,
      seriesCount: 2,
    });
    let previous = dataset.series[1].y.slice();
    for (let tick = 1; tick <= 50; tick += 1) {
      dataset.tick(7);
      const [first, second] = dataset.series;
      expect(first.x).toBe(second.x);
      expect(first.x).toHaveLength(100);
      expect(first.x[0]).toBe(1 + tick * 7);
      expect(first.x[99]).toBe(100 + tick * 7);
      // The points kept are unchanged, just earlier in the window
      expect(second.y.slice(0, 93)).toEqual(previous.slice(7));
      previous = second.y.slice();
    }
    expect(withinBounds(dataset)).toBe(true);
  });

  it("clamps a tick to the size of a series", () => {
    const dataset = new BenchmarkDataset({
      kind: "line",
      pointCount: 10,
      seriesCount: 1,
    });
    expect(dataset.tick(1000)).toEqual({ kind: "line", shift: 10 });
    expect(dataset.tick(0)).toEqual({ kind: "line", shift: 1 });
  });
});
