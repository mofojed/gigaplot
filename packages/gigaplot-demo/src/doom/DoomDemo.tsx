import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PlotTooltipOptions } from "gigaplot";
import { Doom } from "./Doom";
import { PALETTE_SIZE, UNSEEN, type DoomColorMode } from "./doomColors";
import { DoomHeightView } from "./DoomHeightView";
import { DoomPalette } from "./DoomPalette";
import { DoomRidgeView } from "./DoomRidgeView";
import { DoomScatterView } from "./DoomScatterView";
import type {
  DoomFrameSink,
  DoomPaletteSettings,
  DoomViewProps,
} from "./doomViews";

type DoomView = "scatter" | "ridges" | "height";

const VIEWS: {
  id: DoomView;
  label: string;
  component: (props: DoomViewProps) => JSX.Element;
}[] = [
  { id: "scatter", label: "Palette scatter", component: DoomScatterView },
  { id: "ridges", label: "Ridgelines", component: DoomRidgeView },
  { id: "height", label: "Height field (3D)", component: DoomHeightView },
];

const STATS_SAMPLE_MS = 500;

function formatRate(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return `${Math.round(value)}`;
}

interface DoomStats {
  points: number;
  doomFps: number;
  plotFps: number;
}

export interface DoomDemoProps {
  rendererPreference?: readonly string[];
  tooltip?: boolean | PlotTooltipOptions;
  onRendererChanged?: (name: string) => void;
  onError?: (error: unknown) => void;
}

/**
 * Doom, played in a plot. The game keeps running while you switch between
 * views, each a different kind of plot of the same frames.
 */
export function DoomDemo({
  rendererPreference,
  tooltip,
  onRendererChanged,
  onError,
}: DoomDemoProps): JSX.Element {
  const [view, setView] = useState<DoomView>("scatter");
  const [colorMode, setColorMode] = useState<DoomColorMode>("doom");
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const [colors, setColors] = useState<Int32Array>(() =>
    new Int32Array(PALETTE_SIZE).fill(UNSEEN),
  );
  const [stats, setStats] = useState<DoomStats>();
  const [isFocused, setIsFocused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  // Read when the game starts, without restarting it on every toggle
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });

  const [palette] = useState(() => new DoomPalette());
  const sinkRef = useRef<DoomFrameSink>();
  // A callback ref, as switching views mounts a new stage
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const doomRef = useRef<Doom>();
  const doomFramesRef = useRef(0);
  const plotFramesRef = useRef(0);

  useEffect(() => palette.onChanged(setColors), [palette]);

  useEffect(
    function runDoom() {
      const doom = new Doom((frame) => {
        doomFramesRef.current += 1;
        sinkRef.current?.pushFrame(frame);
      });
      doomRef.current = doom;
      doom.setMuted(isMutedRef.current);
      doom.start().catch((error: unknown) => onError?.(error));
      return () => {
        doom.stop();
        doomRef.current = undefined;
      };
    },
    [onError],
  );

  useEffect(function sampleStats() {
    let sampledAt = performance.now();
    doomFramesRef.current = 0;
    plotFramesRef.current = 0;
    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - sampledAt) / 1000;
      setStats({
        points: sinkRef.current?.getPointCount() ?? 0,
        doomFps: doomFramesRef.current / elapsed,
        plotFps: plotFramesRef.current / elapsed,
      });
      doomFramesRef.current = 0;
      plotFramesRef.current = 0;
      sampledAt = now;
    }, STATS_SAMPLE_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(
    function observeSize() {
      if (container == null) {
        return undefined;
      }
      const observer = new ResizeObserver(() => {
        const { width, height } = container.getBoundingClientRect();
        setPlotSize({ width, height });
      });
      observer.observe(container);
      return () => observer.disconnect();
    },
    [container],
  );

  const handlePlotFrame = useCallback(() => {
    plotFramesRef.current += 1;
  }, []);

  const paletteSettings: DoomPaletteSettings = {
    colorMode,
    hidden,
    colors,
    onColorModeChange: setColorMode,
    onHiddenChange: setHidden,
  };

  const layout = (plot: ReactNode, controls: ReactNode): JSX.Element => (
    <div className="doom-demo-body">
      <div className="doom-demo-stage">
        <div
          ref={setContainer}
          className="doom-demo-plot"
          // Focus takes the keyboard, so the rest of the page keeps it otherwise
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="application"
          aria-label="Doom, plotted. Focus to play."
          data-testid="doom-plot"
          onPointerDown={() => {
            container?.focus();
            doomRef.current?.resumeAudio();
          }}
          onKeyDown={(event) => doomRef.current?.keyDown(event.nativeEvent)}
          onKeyUp={(event) => doomRef.current?.keyUp(event.nativeEvent)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        >
          {plot}
          {!isFocused && (
            <div className="doom-demo-focus-hint">
              Click the plot to play, with sound
            </div>
          )}
        </div>
      </div>

      <div className="doom-demo-controls">
        <div className="doom-demo-views" role="tablist">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === view}
              data-testid={`doom-view-${id}`}
              className={id === view ? "is-selected" : undefined}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {controls}
        <label className="plot-demo-checkbox" htmlFor="doom-mute">
          <input
            id="doom-mute"
            type="checkbox"
            data-testid="doom-mute"
            checked={isMuted}
            onChange={(event) => {
              setIsMuted(event.target.checked);
              // In the click handler, so the browser lets the sound start
              doomRef.current?.setMuted(event.target.checked);
            }}
          />
          Mute sound
        </label>
        <p className="plot-demo-hint">
          Arrows move, Ctrl fires, Space opens doors, Enter selects, Alt and the
          arrows strafe, Escape opens the menu.
        </p>
      </div>
    </div>
  );

  const View =
    VIEWS.find((candidate) => candidate.id === view)?.component ??
    DoomScatterView;

  return (
    <div className="doom-demo" data-testid="doom-demo">
      <div className="doom-demo-stats" data-testid="doom-stats">
        {stats == null ? (
          "Loading Doom…"
        ) : (
          <>
            <span>{`${stats.points.toLocaleString()} points per frame`}</span>
            <span>{`${Math.round(stats.doomFps)} Doom fps`}</span>
            <span>{`${Math.round(stats.plotFps)} plot fps`}</span>
            <span>
              {`${formatRate(stats.points * stats.doomFps)} points/s`}
            </span>
          </>
        )}
      </div>
      <View
        key={view}
        palette={palette}
        paletteSettings={paletteSettings}
        sinkRef={sinkRef}
        plotSize={plotSize}
        rendererPreference={rendererPreference}
        tooltip={tooltip}
        onRendererChanged={onRendererChanged}
        onPlotFrame={handlePlotFrame}
        onError={onError}
        layout={layout}
      />
    </div>
  );
}

export default DoomDemo;
