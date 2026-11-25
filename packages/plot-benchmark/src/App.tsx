import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONFIG,
  LINE_WIDTHS,
  POINT_COUNT_PRESETS,
  POINT_SIZES,
  SERIES_COUNTS,
  TICK_FRACTIONS,
  formatCount,
  formatTickFraction,
  parseCount,
  readConfig,
  writeConfig,
} from "./config";
import type { PlotKind } from "./dataset";
import { LIBRARIES, getLibrary, getLibraryLabel } from "./libraries";
import { BenchmarkRun, type RunConfig, type RunStats } from "./runner";
import "./App.scss";

type Status = "loading" | "running" | "error";

/** How often the live readout refreshes. */
const LIVE_SAMPLE_MS = 1000;

/** Ticking before measuring, so the first frames' warm up is not counted. */
const WARMUP_MS = 1000;

const COMPARE_DURATIONS_S = [3, 5, 10, 20];

/** Larger sizes are skipped once a library is slower than this. */
const SKIP_BELOW_UPDATES_PER_SECOND = 1;

const SKIP_ABOVE_INIT_MS = 30_000;

export interface ResultRow {
  libraryId: string;
  library: string;
  technology: string;
  kind: PlotKind;
  pointCount: number;
  tickFraction: number;
  initMs?: number;
  stats?: RunStats;
  note?: string;
}

declare global {
  interface Window {
    /** For automation: the comparison results so far. */
    plotBenchmark?: { results: ResultRow[]; liveStats?: RunStats };
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatMs(value: number | undefined): string {
  if (value == null) {
    return "–";
  }
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatRate(value: number | undefined): string {
  return value == null ? "–" : value.toFixed(1);
}

function getInitialLibraryId(): string {
  const id = new URLSearchParams(window.location.search).get("lib");
  return LIBRARIES.some((library) => library.id === id)
    ? (id as string)
    : LIBRARIES[0].id;
}

function toMarkdown(rows: ResultRow[]): string {
  const header =
    "| Library | Renderer | Plot | Points | Tick | Init (ms) | Page FPS | Updates/s | Update (ms) | p95 frame (ms) | Heap (MB) | Note |";
  const divider = `|${" --- |".repeat(12)}`;
  const lines = rows.map((row) =>
    [
      row.library,
      row.technology,
      row.kind,
      formatCount(row.pointCount),
      formatTickFraction(row.tickFraction),
      formatMs(row.initMs),
      formatRate(row.stats?.pageFps),
      formatRate(row.stats?.updatesPerSecond),
      formatMs(row.stats?.updateMs),
      formatMs(row.stats?.p95FrameMs),
      formatMs(row.stats?.heapMb),
      row.note ?? "",
    ].join(" | "),
  );
  return [header, divider, ...lines.map((line) => `| ${line} |`)].join("\n");
}

export function App(): JSX.Element {
  const [config, setConfig] = useState<RunConfig>(() =>
    readConfig(window.location.search),
  );
  const [libraryId, setLibraryId] = useState(getInitialLibraryId);
  const [pointText, setPointText] = useState(() =>
    formatCount(config.pointCount),
  );
  const [restartCount, setRestartCount] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [initMs, setInitMs] = useState<number>();
  const [liveStats, setLiveStats] = useState<RunStats>();
  const [isTicking, setIsTicking] = useState(true);

  const [compareLibraries, setCompareLibraries] = useState<Set<string>>(
    () => new Set(LIBRARIES.map(({ id }) => id)),
  );
  const [compareSizes, setCompareSizes] = useState<Set<number>>(
    () => new Set([100_000, 1_000_000]),
  );
  const [compareDurationS, setCompareDurationS] = useState(5);
  const [isComparing, setIsComparing] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<ResultRow[]>([]);

  const hostRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<BenchmarkRun>();
  const compareTokenRef = useRef({ isCancelled: false });

  const library = getLibrary(libraryId);

  useEffect(
    function syncUrl() {
      window.history.replaceState(null, "", writeConfig(config, libraryId));
    },
    [config, libraryId],
  );

  useEffect(
    function publishForAutomation() {
      window.plotBenchmark = { results, liveStats };
    },
    [results, liveStats],
  );

  useEffect(
    function runLive() {
      const host = hostRef.current;
      if (host == null || isComparing) {
        return undefined;
      }
      let isCancelled = false;
      const run = new BenchmarkRun(host, getLibrary(libraryId), config, (e) => {
        setError(getErrorMessage(e));
        setStatus("error");
      });
      runRef.current = run;
      setStatus("loading");
      setError("");
      setInitMs(undefined);
      setLiveStats(undefined);
      setIsTicking(run.getTicking());
      run.start().then(
        (ms) => {
          if (!isCancelled) {
            setInitMs(ms);
            setStatus("running");
          }
        },
        (e: unknown) => {
          if (!isCancelled) {
            setError(getErrorMessage(e));
            setStatus("error");
          }
        },
      );
      const interval = setInterval(() => {
        if (run.initMs != null) {
          setLiveStats(run.getStats());
          run.resetStats();
        }
      }, LIVE_SAMPLE_MS);
      return () => {
        isCancelled = true;
        clearInterval(interval);
        run.destroy();
        runRef.current = undefined;
      };
    },
    [config, libraryId, isComparing, restartCount],
  );

  const updateConfig = useCallback((changes: Partial<RunConfig>) => {
    setConfig((previous) => ({ ...previous, ...changes }));
  }, []);

  const handleKindChange = useCallback(
    (kind: PlotKind) => {
      updateConfig({ kind });
      if (!getLibrary(libraryId).kinds.includes(kind)) {
        setLibraryId(LIBRARIES[0].id);
      }
    },
    [libraryId, updateConfig],
  );

  const commitPointText = useCallback(() => {
    const count = parseCount(pointText);
    if (count == null) {
      setPointText(formatCount(config.pointCount));
      return;
    }
    setPointText(formatCount(count));
    if (count !== config.pointCount) {
      updateConfig({ pointCount: count });
    }
  }, [config.pointCount, pointText, updateConfig]);

  const handleToggleTicking = useCallback(() => {
    const run = runRef.current;
    if (run == null) {
      return;
    }
    run.setTicking(!run.getTicking());
    setIsTicking(run.getTicking());
  }, []);

  const toggleInSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  };

  const runComparison = useCallback(async () => {
    const host = hostRef.current;
    if (host == null) {
      return;
    }
    const token = { isCancelled: false };
    compareTokenRef.current = token;
    setIsComparing(true);
    setResults([]);
    const libraries = LIBRARIES.filter(
      ({ id, kinds }) =>
        compareLibraries.has(id) && kinds.includes(config.kind),
    );
    const sizes = [...compareSizes].sort((a, b) => a - b);
    const rows: ResultRow[] = [];
    const addRow = (row: ResultRow) => {
      rows.push(row);
      setResults([...rows]);
    };

    // Let the live run be torn down first
    await sleep(100);

    for (let l = 0; l < libraries.length && !token.isCancelled; l += 1) {
      const definition = libraries[l];
      let skipReason: string | undefined;
      for (let s = 0; s < sizes.length && !token.isCancelled; s += 1) {
        const pointCount = sizes[s];
        const row: ResultRow = {
          libraryId: definition.id,
          library: definition.name,
          technology: definition.technology,
          kind: config.kind,
          pointCount,
          tickFraction: config.tickFraction,
        };
        if (skipReason != null) {
          addRow({ ...row, note: `Skipped: ${skipReason}` });
          continue;
        }
        setProgress(
          `${getLibraryLabel(definition)}, ${formatCount(pointCount)} points`,
        );
        const run = new BenchmarkRun(host, definition, {
          ...config,
          pointCount,
        });
        try {
          row.initMs = await run.start();
          if (config.tickFraction > 0) {
            await sleep(WARMUP_MS);
            run.resetStats();
            await sleep(compareDurationS * 1000);
            row.stats = run.getStats();
          }
          if (run.error != null) {
            row.note = getErrorMessage(run.error);
          }
        } catch (e) {
          row.note = getErrorMessage(e);
        } finally {
          run.destroy();
        }
        addRow(row);
        if (row.note != null) {
          skipReason = "failed at a smaller size";
        } else if ((row.initMs ?? 0) > SKIP_ABOVE_INIT_MS) {
          skipReason = `init over ${SKIP_ABOVE_INIT_MS / 1000}s at a smaller size`;
        } else if (
          row.stats != null &&
          row.stats.updatesPerSecond < SKIP_BELOW_UPDATES_PER_SECOND
        ) {
          skipReason = "under 1 update/s at a smaller size";
        }
        // Give the garbage collector and GPU a moment between libraries
        await sleep(300);
      }
    }
    setProgress(token.isCancelled ? "Stopped" : "Done");
    setIsComparing(false);
  }, [compareDurationS, compareLibraries, compareSizes, config]);

  const handleStopComparison = useCallback(() => {
    compareTokenRef.current.isCancelled = true;
  }, []);

  const handleCopyResults = useCallback(() => {
    navigator.clipboard?.writeText(toMarkdown(results)).catch(() => undefined);
  }, [results]);

  const bestFps = new Map<number, number>();
  results.forEach(({ pointCount, stats }) => {
    if (stats != null) {
      bestFps.set(
        pointCount,
        Math.max(bestFps.get(pointCount) ?? 0, stats.updatesPerSecond),
      );
    }
  });

  const pointCount =
    Math.max(2, Math.ceil(config.pointCount / config.seriesCount)) *
    config.seriesCount;
  const hasWebGpu = "gpu" in navigator;

  return (
    <div className="benchmark">
      <aside className="benchmark-controls">
        <h1>Plot benchmark</h1>
        <p className="benchmark-muted">
          The same seeded data in every library. gigaplot is given every point,
          with no downsampling.
          {!hasWebGpu && " This browser has no WebGPU."}
        </p>

        <fieldset disabled={isComparing}>
          <legend>Plot</legend>
          <div className="benchmark-segmented">
            {(["scatter", "line"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={config.kind === kind ? "active" : undefined}
                data-testid={`kind-${kind}`}
                onClick={() => handleKindChange(kind)}
              >
                {kind === "scatter" ? "Scatter" : "Line"}
              </button>
            ))}
          </div>

          <label htmlFor="library">Library</label>
          <select
            id="library"
            data-testid="library"
            value={libraryId}
            onChange={(event) => setLibraryId(event.target.value)}
          >
            {LIBRARIES.map((definition) => (
              <option
                key={definition.id}
                value={definition.id}
                disabled={!definition.kinds.includes(config.kind)}
              >
                {getLibraryLabel(definition)}
                {!definition.kinds.includes(config.kind) &&
                  ` – no ${config.kind}`}
              </option>
            ))}
          </select>
          <p className="benchmark-muted">{library.notes}</p>

          <label htmlFor="points">Points (total)</label>
          <div className="benchmark-row">
            <select
              aria-label="Point count preset"
              data-testid="points-preset"
              value={
                POINT_COUNT_PRESETS.includes(config.pointCount)
                  ? config.pointCount
                  : ""
              }
              onChange={(event) => {
                const count = Number(event.target.value);
                setPointText(formatCount(count));
                updateConfig({ pointCount: count });
              }}
            >
              {!POINT_COUNT_PRESETS.includes(config.pointCount) && (
                <option value="">Custom</option>
              )}
              {POINT_COUNT_PRESETS.map((count) => (
                <option key={count} value={count}>
                  {formatCount(count)}
                </option>
              ))}
            </select>
            <input
              id="points"
              data-testid="points"
              type="text"
              inputMode="numeric"
              value={pointText}
              title="A count such as 750000, 750k, or 7.5M"
              onChange={(event) => setPointText(event.target.value)}
              onBlur={commitPointText}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitPointText();
                }
              }}
            />
          </div>

          <label htmlFor="series">Series</label>
          <select
            id="series"
            data-testid="series"
            value={config.seriesCount}
            onChange={(event) =>
              updateConfig({ seriesCount: Number(event.target.value) })
            }
          >
            {SERIES_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>

          <label htmlFor="tick">Ticking</label>
          <select
            id="tick"
            data-testid="tick"
            value={config.tickFraction}
            onChange={(event) =>
              updateConfig({ tickFraction: Number(event.target.value) })
            }
          >
            {TICK_FRACTIONS.map((fraction) => (
              <option key={fraction} value={fraction}>
                {formatTickFraction(fraction)}
              </option>
            ))}
          </select>
          <p className="benchmark-muted">
            {config.kind === "scatter"
              ? "Overwrites the oldest points in place."
              : "Drops the oldest points and appends as many, scrolling the window."}
          </p>

          {config.kind === "scatter" ? (
            <>
              <label htmlFor="point-size">Point size</label>
              <select
                id="point-size"
                value={config.pointSize}
                onChange={(event) =>
                  updateConfig({ pointSize: Number(event.target.value) })
                }
              >
                {POINT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="line-width">Line width</label>
              <select
                id="line-width"
                value={config.lineWidth}
                onChange={(event) =>
                  updateConfig({ lineWidth: Number(event.target.value) })
                }
              >
                {LINE_WIDTHS.map((width) => (
                  <option key={width} value={width}>
                    {width}px
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="benchmark-row">
            <button
              type="button"
              onClick={handleToggleTicking}
              disabled={status !== "running" || config.tickFraction === 0}
            >
              {isTicking ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              onClick={() => setRestartCount((count) => count + 1)}
            >
              Restart
            </button>
            <button
              type="button"
              onClick={() => {
                setConfig(DEFAULT_CONFIG);
                setPointText(formatCount(DEFAULT_CONFIG.pointCount));
              }}
            >
              Reset
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Compare</legend>
          <p className="benchmark-muted">
            Runs each library at each size with the settings above, warming up
            for {WARMUP_MS / 1000}s before measuring.
          </p>
          <div className="benchmark-checks">
            {LIBRARIES.map((definition) => (
              <label key={definition.id}>
                <input
                  type="checkbox"
                  data-testid={`compare-library-${definition.id}`}
                  disabled={
                    isComparing || !definition.kinds.includes(config.kind)
                  }
                  checked={
                    compareLibraries.has(definition.id) &&
                    definition.kinds.includes(config.kind)
                  }
                  onChange={() =>
                    setCompareLibraries((set) =>
                      toggleInSet(set, definition.id),
                    )
                  }
                />
                {getLibraryLabel(definition)}
              </label>
            ))}
          </div>
          <div className="benchmark-checks benchmark-checks-sizes">
            {POINT_COUNT_PRESETS.map((count) => (
              <label key={count}>
                <input
                  type="checkbox"
                  data-testid={`compare-size-${count}`}
                  disabled={isComparing}
                  checked={compareSizes.has(count)}
                  onChange={() =>
                    setCompareSizes((set) => toggleInSet(set, count))
                  }
                />
                {formatCount(count)}
              </label>
            ))}
          </div>
          <label htmlFor="duration">Measure for</label>
          <select
            id="duration"
            value={compareDurationS}
            disabled={isComparing}
            onChange={(event) =>
              setCompareDurationS(Number(event.target.value))
            }
          >
            {COMPARE_DURATIONS_S.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds}s
              </option>
            ))}
          </select>
          <div className="benchmark-row">
            {isComparing ? (
              <button type="button" onClick={handleStopComparison}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                data-testid="compare"
                disabled={compareSizes.size === 0}
                onClick={runComparison}
              >
                Run comparison
              </button>
            )}
            <button
              type="button"
              disabled={results.length === 0}
              onClick={handleCopyResults}
            >
              Copy as Markdown
            </button>
          </div>
          {progress !== "" && (
            <p className="benchmark-muted" data-testid="compare-progress">
              {isComparing ? `Running ${progress}…` : progress}
            </p>
          )}
        </fieldset>
      </aside>

      <main className="benchmark-main">
        <div className="benchmark-stats" data-testid="stats">
          {isComparing ? (
            <span>Comparing: {progress}</span>
          ) : (
            <>
              <span className="benchmark-stat-title">
                {getLibraryLabel(library)}
              </span>
              <span>{pointCount.toLocaleString()} points</span>
              {status === "loading" && <span>Loading…</span>}
              {status === "error" && (
                <span className="benchmark-error" data-testid="error">
                  {error}
                </span>
              )}
              {initMs != null && (
                <span title="From mount until the frame after the library's first draw">
                  Init {formatMs(initMs)} ms
                </span>
              )}
              {liveStats != null && config.tickFraction > 0 && (
                <>
                  <span title="Animation frames per second">
                    {formatRate(liveStats.pageFps)} FPS
                  </span>
                  <span title="Ticks the library accepted and finished per second">
                    {formatRate(liveStats.updatesPerSecond)} updates/s
                  </span>
                  <span title="Mean time in the library's update call">
                    update {formatMs(liveStats.updateMs)} ms
                  </span>
                  <span title="95th percentile time between frames">
                    p95 frame {formatMs(liveStats.p95FrameMs)} ms
                  </span>
                  <span title="Mean time generating each tick, the same for every library">
                    data {formatMs(liveStats.dataMs)} ms
                  </span>
                </>
              )}
              {liveStats?.heapMb != null && (
                <span>heap {formatMs(liveStats.heapMb)} MB</span>
              )}
            </>
          )}
        </div>
        <div
          ref={hostRef}
          className="benchmark-host"
          data-testid="plot-host"
          data-benchmark-status={isComparing ? "comparing" : status}
        />
        {results.length > 0 && (
          <div className="benchmark-results">
            <table data-testid="results">
              <thead>
                <tr>
                  <th>Library</th>
                  <th>Renderer</th>
                  <th>Points</th>
                  <th>Init (ms)</th>
                  <th>Page FPS</th>
                  <th>Updates/s</th>
                  <th>Update (ms)</th>
                  <th>p95 frame (ms)</th>
                  <th>Heap (MB)</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={`${row.libraryId}-${row.pointCount}`}>
                    <td>{row.library}</td>
                    <td>{row.technology}</td>
                    <td>{formatCount(row.pointCount)}</td>
                    <td>{formatMs(row.initMs)}</td>
                    <td>{formatRate(row.stats?.pageFps)}</td>
                    <td
                      className={
                        row.stats != null &&
                        row.stats.updatesPerSecond ===
                          bestFps.get(row.pointCount)
                          ? "benchmark-best"
                          : undefined
                      }
                    >
                      {formatRate(row.stats?.updatesPerSecond)}
                    </td>
                    <td>{formatMs(row.stats?.updateMs)}</td>
                    <td>{formatMs(row.stats?.p95FrameMs)}</td>
                    <td>{formatMs(row.stats?.heapMb)}</td>
                    <td className="benchmark-note">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
