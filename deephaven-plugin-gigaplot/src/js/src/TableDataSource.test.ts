import type { dh as DhType } from "@deephaven/jsapi-types";
import type { SeriesDataRequest } from "gigaplot";
import TableDataSource from "./TableDataSource";
import { INSTANT_TYPE, InstantAxis } from "./instants";

const EVENT_UPDATED = "updated";
const dh = { Table: { EVENT_UPDATED } } as unknown as typeof DhType;

type Row = Record<string, unknown>;

/**
 * `legacy` mirrors `RangeSet.iterator()` before deephaven-core 43, which has
 * `hasNext` and reports `done` as whether more values remain after the one
 * returned. `standard` is the plain JS iterator returned from 43 on.
 */
type IteratorKind = "legacy" | "standard";

function makeIterator(size: number, kind: IteratorKind) {
  if (kind === "standard") {
    return Array.from({ length: size }, (_, i) => i)[Symbol.iterator]();
  }
  let i = 0;
  return {
    hasNext: () => i < size,
    next: () => {
      const value = i;
      i += 1;
      return { value, done: i < size };
    },
  };
}

/** A table whose single subscription can be fed rows with `emit`. */
function makeTable(
  types: Record<string, string> = {},
  iteratorKind: IteratorKind = "legacy",
) {
  let listener: ((event: { detail: unknown }) => void) | undefined;
  const subscription = {
    addEventListener: jest.fn((_type: string, l: typeof listener) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    }),
    close: jest.fn(),
  };
  const table = {
    findColumn: (name: string) => ({ name, type: types[name] ?? "double" }),
    subscribe: jest.fn(() => subscription),
    close: jest.fn(),
  };
  const emit = (rows: Row[]) => {
    listener?.({
      detail: {
        fullIndex: {
          size: rows.length,
          iterator: () => makeIterator(rows.length, iteratorKind),
        },
        getData: (key: number, column: { name: string }) =>
          rows[key][column.name],
      },
    });
  };
  return { table: table as unknown as DhType.Table, emit, subscription };
}

function request(xMax: number): SeriesDataRequest {
  return {
    seriesId: "Y",
    viewport: { xMin: 0, xMax, yMin: 0, yMax: 1 },
    pixelSize: { width: 100, height: 100 },
    style: {},
  };
}

describe("TableDataSource", () => {
  it("plots the whole table without downsampling", async () => {
    const source = new TableDataSource(dh, { x: "X", y: ["Y"], type: "line" });
    const { table, emit } = makeTable();
    source.setTable(table);
    emit([
      { X: 0, Y: 1 },
      { X: 2, Y: 3 },
    ]);
    const shape = await source.getShape();
    expect(shape.bounds).toEqual({ xMin: 0, xMax: 2, yMin: 1, yMax: 3 });
    const result = await source.requestSeriesData(request(2));
    expect(result.complete).toBe(true);
    expect(result.data.length).toBe(2);
    source.close();
  });

  it("stacks each area on the running total before it", async () => {
    const fill = { type: "linear" as const, stops: [{ opacity: 0 }] };
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["A", "B"],
      type: "area",
      stacked: true,
      fill: [null, fill],
    });
    const { table, emit } = makeTable();
    source.setTable(table);
    // Totals, as the server sends them: A is 1 then 2, and B 3 then 1
    emit([
      { X: 0, A: 1, B: 4 },
      { X: 1, A: 2, B: 3 },
    ]);

    const shape = await source.getShape();
    expect(shape.series).toEqual([
      expect.objectContaining({ id: "A", type: "area", stacked: true }),
      expect.objectContaining({
        id: "B",
        type: "area",
        stacked: true,
        style: { fill },
      }),
    ]);
    expect(shape.series[0].style).toBeUndefined();
    // Areas are filled down to zero, so the bounds include it
    expect(shape.bounds).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 4 });
    const bottom = await source.requestSeriesData({
      ...request(1),
      seriesId: "A",
    });
    expect(bottom.data.base).toBeUndefined();
    const top = await source.requestSeriesData({
      ...request(1),
      seriesId: "B",
    });
    expect(Array.from(top.data.base ?? [])).toEqual([1, 2]);
    expect(Array.from(top.data.y)).toEqual([4, 3]);
    source.close();
  });

  it("fills areas that are not stacked down to zero", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["A", "B"],
      type: "area",
    });
    const { table, emit } = makeTable();
    source.setTable(table);
    emit([{ X: 0, A: 1, B: 4 }]);

    const top = await source.requestSeriesData({
      ...request(1),
      seriesId: "B",
    });
    expect(top.data.base).toBeUndefined();
    expect((await source.getShape()).series[1].stacked).toBeUndefined();
    source.close();
  });

  it("titles the axes with the column names by default", async () => {
    const single = new TableDataSource(dh, { x: "X", y: ["Y"], type: "line" });
    expect(await single.getShape()).toMatchObject({
      xAxisLabel: "X",
      yAxisLabel: "Y",
    });
    single.close();

    const several = new TableDataSource(dh, {
      x: "X",
      y: ["A", "B"],
      type: "line",
    });
    const shape = await several.getShape();
    expect(shape.xAxisLabel).toBe("X");
    expect(shape.yAxisLabel).toBeUndefined();
    several.close();
  });

  it("uses given axis titles, and hides empty ones", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["A", "B"],
      type: "line",
      xAxisLabel: "",
      yAxisLabel: "Price",
    });
    const shape = await source.getShape();
    expect(shape.xAxisLabel).toBeUndefined();
    expect(shape.yAxisLabel).toBe("Price");
    source.close();
  });

  describe("with bars", () => {
    const BAR_OPTIONS = {
      x: "X",
      open: ["O"],
      high: ["H"],
      low: ["L"],
      close: ["C"],
      type: "ohlc",
    } as const;

    it("reads open, high, low, and close into one series", async () => {
      const source = new TableDataSource(dh, BAR_OPTIONS);
      const { table, emit } = makeTable();
      source.setTable(table);
      emit([
        { X: 0, O: 1, H: 4, L: 0, C: 3 },
        { X: 1, O: 3, H: 5, L: 2, C: 2 },
      ]);
      const shape = await source.getShape();
      expect(shape.series).toEqual([
        expect.objectContaining({ id: "O/H/L/C", name: "C", type: "ohlc" }),
      ]);
      // Bars span from their low to their high, and have no one y to title
      expect(shape.bounds).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 5 });
      expect(shape.yAxisLabel).toBeUndefined();
      const { data, complete } = await source.requestSeriesData({
        ...request(1),
        seriesId: "O/H/L/C",
      });
      expect(complete).toBe(true);
      expect(Array.from(data.open ?? [])).toEqual([1, 3]);
      expect(Array.from(data.high ?? [])).toEqual([4, 5]);
      expect(Array.from(data.low ?? [])).toEqual([0, 2]);
      expect(Array.from(data.y)).toEqual([3, 2]);
      source.close();
    });

    it("subscribes to each column once", () => {
      const source = new TableDataSource(dh, {
        ...BAR_OPTIONS,
        open: ["C", "C"],
        high: ["H", "H2"],
        low: ["L", "L2"],
        close: ["C", "C2"],
      });
      const { table } = makeTable();
      source.setTable(table);
      const subscribed = (table.subscribe as jest.Mock).mock.calls[0][0] as {
        name: string;
      }[];
      expect(subscribed.map((column) => column.name)).toEqual([
        "X",
        "C",
        "H",
        "L",
        "H2",
        "L2",
        "C2",
      ]);
      source.close();
    });

    it("rejects columns of different lengths", () => {
      expect(
        () => new TableDataSource(dh, { ...BAR_OPTIONS, low: ["L", "L2"] }),
      ).toThrow();
    });

    it("ignores null column lists from the server", () => {
      const source = new TableDataSource(dh, {
        ...BAR_OPTIONS,
        y: null,
        type: "candlestick",
      });
      expect(source).toBeDefined();
      source.close();
    });
  });

  describe("with Instant columns", () => {
    /** Mimics a DateWrapper, whose valueOf is the exact long as a string. */
    const instant = (nanos: string) => ({ valueOf: () => nanos });
    const INSTANT_X = {
      X: INSTANT_TYPE,
      XMin: INSTANT_TYPE,
      XMax: INSTANT_TYPE,
    };

    it("plots nanoseconds since an origin without losing precision", async () => {
      const source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
      });
      const { table, emit } = makeTable(INSTANT_X);
      source.setTable(table);
      emit([
        { X: instant("1704067200000000001"), Y: 1 },
        { X: instant("1704067200000000002"), Y: 2 },
        { X: instant("1704067200000000003"), Y: 3 },
      ]);
      const { data } = await source.requestSeriesData(request(1e12));
      expect(data.x[1] - data.x[0]).toBe(1);
      expect(data.x[2] - data.x[1]).toBe(1);
      source.close();
    });

    it("labels the axis with dates", async () => {
      const source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
      });
      const { table, emit } = makeTable(INSTANT_X);
      source.setTable(table);
      expect((await source.getShape()).xAxisTicks).toBeUndefined();
      emit([
        { X: instant("1704067200000000000"), Y: 1 },
        { X: instant("1704067260000000000"), Y: 2 },
      ]);
      const shape = await source.getShape();
      expect(shape.yAxisTicks).toBeUndefined();
      const { xMin, xMax } = shape.bounds!;
      const labels = shape.xAxisTicks!(xMin, xMax, 2).map((t) => t.label);
      expect(labels).toContain("2024-01-01 00:00:00.000");
      expect(labels).toContain("2024-01-01 00:01:00.000");
      source.close();
    });

    it("formats hovered values as dates", async () => {
      const source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
      });
      const { table, emit } = makeTable(INSTANT_X);
      source.setTable(table);
      expect((await source.getShape()).xAxisFormatter).toBeUndefined();
      emit([
        { X: instant("1704067200000000000"), Y: 1 },
        { X: instant("1704067260000000000"), Y: 2 },
      ]);
      const shape = await source.getShape();
      expect(shape.yAxisFormatter).toBeUndefined();
      // A pixel spanning a millisecond needs three fractional digits
      expect(shape.xAxisFormatter!(shape.bounds!.xMax, 1e6)).toBe(
        "2024-01-01 00:01:00.000",
      );
      source.close();
    });

    it("relabels when the formatter changes", async () => {
      const source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
      });
      const { table, emit } = makeTable(INSTANT_X);
      source.setTable(table);
      emit([{ X: instant("1704067200000000000"), Y: 1 }]);
      const listener = jest.fn();
      source.addEventListener("shapechanged", listener);
      const formatter = { format: () => "custom", getOffsetSeconds: () => 0 };
      const factory = jest.fn(() => formatter);
      source.setInstantFormatter(factory);
      expect(factory).toHaveBeenCalledWith("X");
      expect(listener).toHaveBeenCalledTimes(1);
      const { xAxisTicks, bounds } = await source.getShape();
      expect(
        xAxisTicks!(bounds!.xMin - 1e9, bounds!.xMax + 1e9, 2)[0].label,
      ).toBe("custom");
      source.close();
    });

    it("counts from the origin of an axis shared with another source", async () => {
      const xInstants = new InstantAxis();
      const first = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
        xInstants,
      });
      const second = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
        xInstants,
      });
      const firstTable = makeTable(INSTANT_X);
      const secondTable = makeTable(INSTANT_X);
      first.setTable(firstTable.table);
      second.setTable(secondTable.table);
      firstTable.emit([{ X: instant("1704067200000000000"), Y: 1 }]);
      // A day later, which alone would pick an origin of its own
      secondTable.emit([{ X: instant("1704153600000000000"), Y: 2 }]);

      const { data: firstData } = await first.requestSeriesData(request(1));
      const { data: secondData } = await second.requestSeriesData(request(1));
      expect(secondData.x[0] - firstData.x[0]).toBe(86_400e9);
      first.close();
      second.close();
    });

    it("sends the origin with downsample requests", async () => {
      jest.useFakeTimers();
      const onViewportChange = jest.fn();
      const source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
        onViewportChange,
      });
      const bounds = makeTable(INSTANT_X);
      source.setBoundsTable(bounds.table);
      bounds.emit([
        {
          XMin: instant("1704067200000000000"),
          XMax: instant("1704153600000000000"),
          YMin0: 0,
          YMax0: 1,
        },
      ]);
      const shape = await source.getShape();
      expect(shape.bounds!.xMax - shape.bounds!.xMin).toBe(86_400e9);
      expect(shape.xAxisTicks).toBeDefined();
      await source.requestSeriesData({
        ...request(1),
        viewport: { ...shape.bounds! },
      });
      const params = onViewportChange.mock.calls[0][0];
      expect(Number.isInteger(params.x_origin)).toBe(true);
      expect(params.y_origin).toBeUndefined();
      // The origin and plot units together locate the bounds exactly
      expect(BigInt(params.x_origin) + BigInt(shape.bounds!.xMin)).toBe(
        1704067200000000000n,
      );
      source.close();
      jest.useRealTimers();
    });
  });

  describe("with server downsampling", () => {
    let onViewportChange: jest.Mock;
    let source: TableDataSource;

    beforeEach(() => {
      jest.useFakeTimers();
      onViewportChange = jest.fn();
      source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
        onViewportChange,
      });
    });

    afterEach(() => {
      source.close();
      jest.useRealTimers();
    });

    function loadBounds() {
      const bounds = makeTable();
      source.setBoundsTable(bounds.table);
      bounds.emit([{ XMin: 0, XMax: 1000, YMin0: -1, YMax0: 1 }]);
      return bounds;
    }

    it("takes bounds from the bounds table", async () => {
      loadBounds();
      expect((await source.getShape()).bounds).toEqual({
        xMin: 0,
        xMax: 1000,
        yMin: -1,
        yMax: 1,
      });
    });

    it.each<IteratorKind>(["legacy", "standard"])(
      "reads bounds and rows from %s row set iterators",
      async (kind) => {
        const bounds = makeTable({}, kind);
        source.setBoundsTable(bounds.table);
        bounds.emit([{ XMin: 0, XMax: 1000, YMin0: -1, YMax0: 1 }]);
        expect((await source.getShape()).bounds).toEqual({
          xMin: 0,
          xMax: 1000,
          yMin: -1,
          yMax: 1,
        });

        const data = makeTable({}, kind);
        source.setTable(data.table);
        data.emit([
          { X: 0, Y: 1 },
          { X: 500, Y: -1 },
          { X: 1000, Y: 0 },
        ]);
        const result = await source.requestSeriesData(request(1000));
        expect(Array.from(result.data.x)).toEqual([0, 500, 1000]);
        expect(Array.from(result.data.y)).toEqual([1, -1, 0]);
      },
    );

    it("waits for bounds before requesting a viewport", async () => {
      await source.requestSeriesData(request(1));
      expect(onViewportChange).not.toHaveBeenCalled();
      loadBounds();
      await source.requestSeriesData(request(1000));
      expect(onViewportChange).toHaveBeenCalledTimes(1);
    });

    it("does not repeat a request for the same params", async () => {
      loadBounds();
      await source.requestSeriesData(request(1000));
      await source.requestSeriesData(request(1001));
      jest.runAllTimers();
      expect(onViewportChange).toHaveBeenCalledTimes(1);
    });

    it("throttles requests and sends the latest", async () => {
      loadBounds();
      await source.requestSeriesData(request(1000));
      await source.requestSeriesData(request(4000));
      await source.requestSeriesData(request(16000));
      expect(onViewportChange).toHaveBeenCalledTimes(1);
      jest.runAllTimers();
      expect(onViewportChange).toHaveBeenCalledTimes(2);
      expect(onViewportChange.mock.calls[1][0].x_bin).toBe(128);
    });

    it("keeps drawing the old table until the new one has data", async () => {
      loadBounds();
      const first = makeTable();
      source.setTable(first.table);
      first.emit([{ X: 0, Y: 1 }]);
      expect((await source.requestSeriesData(request(1))).data.length).toBe(1);

      const second = makeTable();
      source.setTable(second.table);
      expect(first.table.close).not.toHaveBeenCalled();
      expect((await source.requestSeriesData(request(1))).data.length).toBe(1);

      const listener = jest.fn();
      source.addEventListener("datachanged", listener);
      second.emit([
        { X: 0, Y: 1 },
        { X: 1, Y: 2 },
      ]);
      expect(first.table.close).toHaveBeenCalled();
      expect(first.subscription.close).toHaveBeenCalled();
      expect(listener).toHaveBeenCalled();
      const result = await source.requestSeriesData(request(1));
      expect(result.data.length).toBe(2);
      expect(result.complete).toBe(false);
    });

    it("reports the resolution of the loaded table, not the requested one", async () => {
      loadBounds();
      const coarse = makeTable();
      source.setTable(coarse.table, { x_min: 0, x_max: 2000, x_bin: 8 });
      coarse.emit([{ X: 0, Y: 1 }]);

      // Zoomed in, so a finer table is requested but the coarse one is drawn
      const result = await source.requestSeriesData(request(100));
      expect(onViewportChange.mock.calls[0][0].x_bin).toBe(1);
      expect(result.xResolution).toBe(8);
      expect(result.xCoverage).toEqual({ min: 0, max: 2000 });
    });

    it("closes a pending table that is superseded", () => {
      const first = makeTable();
      const second = makeTable();
      source.setTable(first.table);
      source.setTable(second.table);
      expect(first.table.close).toHaveBeenCalled();
      expect(second.table.close).not.toHaveBeenCalled();
    });

    it("reports downsampling until a table for the latest params has data", async () => {
      const onDownsamplingChange = jest.fn();
      source.close();
      source = new TableDataSource(dh, {
        x: "X",
        y: ["Y"],
        type: "line",
        onViewportChange,
        onDownsamplingChange,
      });
      loadBounds();
      expect(source.isDownsampling).toBe(false);

      await source.requestSeriesData(request(1000));
      expect(source.isDownsampling).toBe(true);
      expect(onDownsamplingChange).toHaveBeenLastCalledWith(true);
      const first = onViewportChange.mock.calls[0][0];

      // A newer request is in flight, so an older table does not finish it
      jest.runAllTimers();
      await source.requestSeriesData(request(4000));
      const second = onViewportChange.mock.calls[1][0];
      const stale = makeTable();
      source.setTable(stale.table, first);
      stale.emit([{ X: 0, Y: 1 }]);
      expect(source.isDownsampling).toBe(true);

      const latest = makeTable();
      source.setTable(latest.table, { ...second });
      expect(source.isDownsampling).toBe(true);
      latest.emit([{ X: 0, Y: 1 }]);
      expect(source.isDownsampling).toBe(false);
      expect(onDownsamplingChange).toHaveBeenLastCalledWith(false);
      expect(onDownsamplingChange).toHaveBeenCalledTimes(2);
    });

    it("stops reporting downsampling when a request fails", async () => {
      onViewportChange.mockRejectedValue(new Error("boom"));
      const onError = jest.fn();
      source.addEventListener("error", onError);
      loadBounds();
      await source.requestSeriesData(request(1000));
      await Promise.resolve();
      await Promise.resolve();
      expect(onViewportChange).toHaveBeenCalledTimes(1);
      expect(source.isDownsampling).toBe(false);
      expect(onError).toHaveBeenCalled();
    });

    it("closes every table it owns", () => {
      const bounds = loadBounds();
      const table = makeTable();
      source.setTable(table.table);
      source.close();
      expect(bounds.table.close).toHaveBeenCalled();
      expect(table.table.close).toHaveBeenCalled();
    });
  });
});

describe("TableDataSource in 3D", () => {
  it("plots y and z columns in pairs, with the z range in the bounds", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["Y", "Y"],
      z: ["A", "B"],
      type: "scatter3d",
      color: ["white", null],
      size: 3,
    });
    const { table, emit } = makeTable();
    source.setTable(table);
    emit([
      { X: 0, Y: 1, A: 5, B: -5 },
      { X: 2, Y: 3, A: 6, B: -6 },
    ]);

    const shape = await source.getShape();
    expect(shape).toMatchObject({
      xAxisLabel: "X",
      yAxisLabel: "Y",
      bounds: { xMin: 0, xMax: 2, yMin: 1, yMax: 3, zMin: -6, zMax: 6 },
    });
    expect(shape.zAxisLabel).toBeUndefined();
    expect(shape.series).toEqual([
      expect.objectContaining({
        id: "Y/A",
        name: "A",
        type: "scatter3d",
        style: { color: "white", pointSize: 3 },
      }),
      expect.objectContaining({
        id: "Y/B",
        name: "B",
        style: { pointSize: 3 },
      }),
    ]);

    // 3D data is never downsampled, so deltas apply directly
    const result = await source.requestSeriesData({
      ...request(2),
      seriesId: "Y/B",
    });
    expect(result.complete).toBe(true);
    expect(Array.from(result.data.z ?? [])).toEqual([-5, -6]);
    source.close();
  });

  it("names series after y when they share one z column", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["P", "Q"],
      z: ["Z", "Z"],
      type: "line3d",
      size: 2,
    });
    const shape = await source.getShape();
    expect(shape.series.map((series) => series.name)).toEqual(["P", "Q"]);
    expect(shape.series[0].style).toEqual({ lineWidth: 2 });
    expect(shape.zAxisLabel).toBe("Z");
    expect(shape.yAxisLabel).toBeUndefined();
    source.close();
  });

  it("keeps fixed ranges in place of the data's extent", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["Y"],
      z: ["Z"],
      type: "scatter3d",
      ranges: { x: [-1, 1], z: [0, 10] },
    });
    const { table, emit } = makeTable();
    source.setTable(table);
    emit([
      { X: 0.5, Y: 2, Z: 3 },
      { X: 0.25, Y: 4, Z: 4 },
    ]);
    expect((await source.getShape()).bounds).toEqual({
      xMin: -1,
      xMax: 1,
      yMin: 2,
      yMax: 4,
      zMin: 0,
      zMax: 10,
    });
    source.close();
  });

  it("rejects y and z lists of different lengths", () => {
    expect(
      () =>
        new TableDataSource(dh, {
          x: "X",
          y: ["A", "B"],
          z: ["Z"],
          type: "scatter3d",
        }),
    ).toThrow(/same number/);
  });
});

it("names a single 3D series after its z column", async () => {
  const source = new TableDataSource(dh, {
    x: "X",
    y: ["Y"],
    z: ["Z"],
    type: "line3d",
  });
  const shape = await source.getShape();
  expect(shape.series[0].name).toBe("Z");
  expect(shape).toMatchObject({ yAxisLabel: "Y", zAxisLabel: "Z" });
  source.close();
});

describe("TableDataSource scales", () => {
  const instant = (nanos: string) => ({ valueOf: () => nanos });
  const nanos = (iso: string) => `${BigInt(Date.parse(iso)) * 1_000_000n}`;

  it("places an Instant axis on a business calendar once its origin is known", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["Y"],
      type: "line",
      xScale: {
        type: "calendar",
        timeZone: "America/New_York",
        sessions: [["09:30", "16:00"]],
      },
      yScale: { type: "log", base: 10 },
    });
    expect((await source.getShape()).xScale).toBeUndefined();
    expect((await source.getShape()).yScale?.type).toBe("log");

    const { table, emit } = makeTable({ X: INSTANT_TYPE });
    source.setTable(table);
    emit([
      // Monday's close and Tuesday's open, in New York
      { X: instant(nanos("2026-01-05T21:00:00Z")), Y: 1 },
      { X: instant(nanos("2026-01-06T14:30:00Z")), Y: 2 },
    ]);
    const { xScale } = await source.getShape();
    expect(xScale?.type).toBe("calendar");
    const { data } = await source.requestSeriesData(request(1e18));
    // Values are nanoseconds since the origin, and the night between is gone
    expect(xScale?.toPlot(data.x[1])).toBe(xScale?.toPlot(data.x[0]));
    source.close();
  });

  it("reads breaks and calendars on a numeric axis as epoch milliseconds", async () => {
    const source = new TableDataSource(dh, {
      x: "X",
      y: ["Y"],
      type: "line",
      xScale: {
        type: "breaks",
        isTime: true,
        breaks: [{ start: 10, end: 20 }],
      },
    });
    const { table, emit } = makeTable();
    source.setTable(table);
    emit([{ X: 0, Y: 1 }]);
    const { xScale } = await source.getShape();
    expect((xScale?.toPlot(25) ?? 0) - (xScale?.toPlot(5) ?? 0)).toBe(10);
    source.close();
  });
});
