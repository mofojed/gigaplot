import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPowerScale,
  Plot,
  type Bounds,
  type PlotHover,
  type PlotScale,
  type PlotThemeOverrides,
  type PlotTooltipOptions,
} from "gigaplot";
import { Doom } from "./Doom";
import { DOOM_HEIGHT, DOOM_WIDTH } from "./doomFrame";
import {
  DOOM_COLOR_GROUPS,
  DOOM_COLOR_MODES,
  PALETTE_SIZE,
  UNSEEN,
  getColorGroup,
  toCssColor,
  type DoomColorGroup,
  type DoomColorMode,
} from "./doomColors";
import {
  DOOM_BOUNDS,
  DoomPaletteSource,
  POINTS_PER_PIXEL_CHOICES,
  getPaletteIndex,
} from "./DoomPaletteSource";

const MARGIN = { top: 8, right: 12, bottom: 22, left: 34 };

/** 256 legend entries would cover the game, so the palette grid stands in. */
const DOOM_THEME: PlotThemeOverrides = {
  margin: MARGIN,
  legendSwatchSize: 0,
  legendTextColor: "transparent",
};

type PointSizeChoice = "fit" | number;

const POINT_SIZE_CHOICES: PointSizeChoice[] = ["fit", 1, 2, 3, 4, 6, 8, 12];

/** Points overlap a little when fitted, or the gaps between circles show. */
const FIT_OVERLAP = 1.3;

type Lens = "none" | "bulge" | "pinch";

/** Created once, as new scales would reload the plot on every render. */
const LENS_SCALES: Record<Lens, PlotScale | undefined> = {
  none: undefined,
  bulge: createPowerScale(0.6),
  pinch: createPowerScale(1.8),
};

const LENSES: { id: Lens; label: string }[] = [
  { id: "none", label: "None" },
  { id: "bulge", label: "Bulge (power 0.6)" },
  { id: "pinch", label: "Pinch (power 1.8)" },
];

const STATS_SAMPLE_MS = 500;

/** Positions checked for the widest gap between points under a lens. */
const GAP_SAMPLES = 64;

/**
 * A power below one stretches the middle without limit, so points fitted to
 * the widest gap there would smear the rest of the frame. Past this many
 * times the median gap, the dots are left to spread apart instead.
 */
const MAX_GAP_TO_MEDIAN = 2;

/**
 * The gap in screen pixels to fit points `spacing` apart to along an axis
 * showing `min` to `max` across `pixels`: the widest between neighbours, so
 * a lens leaves no holes, within {@link MAX_GAP_TO_MEDIAN}.
 */
function getFitGap(
  min: number,
  max: number,
  pixels: number,
  spacing: number,
  scale: PlotScale | undefined,
): number {
  const toPlot = scale?.toPlot ?? ((value: number) => value);
  const pixelsPerUnit = pixels / (toPlot(max) - toPlot(min));
  if (scale == null) {
    return spacing * pixelsPerUnit;
  }
  // Power scales stretch most at zero or at the ends, so check both
  const positions = [-spacing / 2];
  for (let i = 0; i <= GAP_SAMPLES; i += 1) {
    positions.push(min + ((max - min - spacing) * i) / GAP_SAMPLES);
  }
  const gaps = positions
    .filter((position) => position >= min && position + spacing <= max)
    .map((position) => Math.abs(toPlot(position + spacing) - toPlot(position)))
    .sort((a, b) => a - b);
  if (gaps.length === 0) {
    return spacing * pixelsPerUnit;
  }
  const median = gaps[Math.floor(gaps.length / 2)];
  return (
    Math.min(gaps[gaps.length - 1], median * MAX_GAP_TO_MEDIAN) * pixelsPerUnit
  );
}

function formatPointsPerPixel(value: number): string {
  if (value < 1) {
    return `1 per ${Math.round(1 / value)} pixels`;
  }
  return value === 1 ? "1 per pixel" : `${value} per pixel`;
}

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
 * Doom, played in a scatter plot with a series for each of its 256 palette
 * colors.
 */
export function DoomDemo({
  rendererPreference,
  tooltip,
  onRendererChanged,
  onError,
}: DoomDemoProps): JSX.Element {
  const [pointsPerPixel, setPointsPerPixel] = useState(1);
  const [pointSizeChoice, setPointSizeChoice] =
    useState<PointSizeChoice>("fit");
  const [colorMode, setColorMode] = useState<DoomColorMode>("doom");
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const [lens, setLens] = useState<Lens>("none");
  const [palette, setPalette] = useState<Int32Array>(() =>
    new Int32Array(PALETTE_SIZE).fill(UNSEEN),
  );
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const [stats, setStats] = useState<DoomStats>();
  const [isFocused, setIsFocused] = useState(false);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Bounds>(DOOM_BOUNDS);

  const containerRef = useRef<HTMLDivElement>(null);
  const doomRef = useRef<Doom>();
  const plotFramesRef = useRef(0);

  const fitPointSize = useMemo(() => {
    const spacing =
      pointsPerPixel < 1
        ? Math.round(1 / Math.sqrt(pointsPerPixel))
        : 1 / Math.round(Math.sqrt(pointsPerPixel));
    const scale = LENS_SCALES[lens];
    const xPixels = getFitGap(
      viewport.xMin,
      viewport.xMax,
      plotSize.width - MARGIN.left - MARGIN.right,
      spacing,
      scale,
    );
    const yPixels = getFitGap(
      viewport.yMin,
      viewport.yMax,
      plotSize.height - MARGIN.top - MARGIN.bottom,
      spacing,
      scale,
    );
    const size = Math.max(xPixels, yPixels) * FIT_OVERLAP;
    return Number.isFinite(size) && size > 0 ? size : 1;
  }, [lens, plotSize, pointsPerPixel, viewport]);

  const pointSize = pointSizeChoice === "fit" ? fitPointSize : pointSizeChoice;

  // The source lives as long as the page, and options are pushed into it
  const [source] = useState(
    () =>
      new DoomPaletteSource({ pointsPerPixel, pointSize, colorMode, hidden }),
  );

  useEffect(
    function updateSource() {
      source.setOptions({ pointsPerPixel, pointSize, colorMode, hidden });
    },
    [source, pointsPerPixel, pointSize, colorMode, hidden],
  );

  useEffect(
    function runDoom() {
      const doom = new Doom((frame) => source.pushFrame(frame));
      doomRef.current = doom;
      doom.start().catch((error: unknown) => onError?.(error));
      const removePaletteListener = source.onPaletteChanged(setPalette);
      return () => {
        removePaletteListener();
        doom.stop();
        doomRef.current = undefined;
        source.close();
      };
    },
    [source, onError],
  );

  useEffect(
    function sampleStats() {
      let sampledAt = performance.now();
      let frames = source.getFrameCount();
      plotFramesRef.current = 0;
      const interval = setInterval(() => {
        const now = performance.now();
        const elapsed = (now - sampledAt) / 1000;
        const nextFrames = source.getFrameCount();
        setStats({
          points: source.getPointCount(),
          doomFps: (nextFrames - frames) / elapsed,
          plotFps: plotFramesRef.current / elapsed,
        });
        frames = nextFrames;
        plotFramesRef.current = 0;
        sampledAt = now;
      }, STATS_SAMPLE_MS);
      return () => clearInterval(interval);
    },
    [source],
  );

  useEffect(function observeSize() {
    const container = containerRef.current;
    if (container == null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      setPlotSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleFrame = useCallback(() => {
    plotFramesRef.current += 1;
  }, []);

  const handleHover = useCallback((hover: PlotHover | undefined) => {
    const point = hover?.points[0];
    setHoveredIndex(
      point == null ? undefined : getPaletteIndex(point.seriesId),
    );
  }, []);

  const toggleIndex = useCallback((index: number, solo: boolean) => {
    setHidden((current) => {
      if (solo) {
        // Shift click keeps only this color
        return new Set(
          Array.from({ length: PALETTE_SIZE }, (_unused, i) => i).filter(
            (i) => i !== index,
          ),
        );
      }
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (group: DoomColorGroup) => {
      const members: number[] = [];
      palette.forEach((rgb, index) => {
        if (getColorGroup(rgb) === group) {
          members.push(index);
        }
      });
      setHidden((current) => {
        const next = new Set(current);
        const isAllHidden = members.every((index) => current.has(index));
        members.forEach((index) =>
          isAllHidden ? next.delete(index) : next.add(index),
        );
        return next;
      });
    },
    [palette],
  );

  const invertHidden = useCallback(() => {
    setHidden(
      (current) =>
        new Set(
          Array.from({ length: PALETTE_SIZE }, (_unused, i) => i).filter(
            (i) => !current.has(i),
          ),
        ),
    );
  }, []);

  const seenCount = palette.reduce(
    (count, rgb) => (rgb === UNSEEN ? count : count + 1),
    0,
  );

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
      <div className="doom-demo-body">
        <div className="doom-demo-stage">
          <div
            ref={containerRef}
            className="doom-demo-plot"
            // Focus takes the keyboard, so the rest of the page keeps it otherwise
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="application"
            aria-label="Doom, plotted. Focus to play."
            data-testid="doom-plot"
            onPointerDown={() => containerRef.current?.focus()}
            onKeyDown={(event) => doomRef.current?.keyDown(event.nativeEvent)}
            onKeyUp={(event) => doomRef.current?.keyUp(event.nativeEvent)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          >
            <Plot
              className="plot-demo-plot"
              source={source}
              theme={DOOM_THEME}
              tooltip={tooltip}
              xScale={LENS_SCALES[lens]}
              yScale={LENS_SCALES[lens]}
              rendererPreference={rendererPreference}
              onRendererChanged={onRendererChanged}
              onViewportChanged={setViewport}
              onFrame={handleFrame}
              onHover={handleHover}
              onError={onError}
            />
            {!isFocused && (
              <div className="doom-demo-focus-hint">Click the plot to play</div>
            )}
          </div>
        </div>

        <div className="doom-demo-controls">
          <label htmlFor="doom-points-per-pixel">Points</label>
          <select
            id="doom-points-per-pixel"
            data-testid="doom-points-per-pixel"
            value={pointsPerPixel}
            onChange={(event) => setPointsPerPixel(Number(event.target.value))}
          >
            {POINTS_PER_PIXEL_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {`${formatPointsPerPixel(choice)} (${(
                  choice *
                  DOOM_WIDTH *
                  DOOM_HEIGHT
                ).toLocaleString()})`}
              </option>
            ))}
          </select>

          <label htmlFor="doom-point-size">Point size</label>
          <select
            id="doom-point-size"
            data-testid="doom-point-size"
            value={pointSizeChoice}
            onChange={(event) =>
              setPointSizeChoice(
                event.target.value === "fit"
                  ? "fit"
                  : Number(event.target.value),
              )
            }
          >
            {POINT_SIZE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice === "fit"
                  ? `Fit (${fitPointSize.toFixed(1)} px)`
                  : `${choice} px`}
              </option>
            ))}
          </select>

          <label htmlFor="doom-color-mode">Colors</label>
          <select
            id="doom-color-mode"
            data-testid="doom-color-mode"
            value={colorMode}
            onChange={(event) =>
              setColorMode(event.target.value as DoomColorMode)
            }
          >
            {DOOM_COLOR_MODES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <label htmlFor="doom-lens">Axis scale</label>
          <select
            id="doom-lens"
            data-testid="doom-lens"
            value={lens}
            onChange={(event) => setLens(event.target.value as Lens)}
          >
            {LENSES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <h3>
            {`Palette series · ${seenCount} seen · ${
              PALETTE_SIZE - hidden.size
            } shown`}
          </h3>
          <div className="doom-demo-groups">
            {DOOM_COLOR_GROUPS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                data-testid={`doom-group-${id}`}
                onClick={() => toggleGroup(id)}
              >
                {label}
              </button>
            ))}
            <button type="button" onClick={invertHidden}>
              Invert
            </button>
            <button
              type="button"
              data-testid="doom-show-all"
              onClick={() => setHidden(new Set())}
            >
              Show all
            </button>
          </div>
          <div className="doom-demo-palette" data-testid="doom-palette">
            {Array.from(palette, (rgb, index) => {
              const classNames = ["doom-demo-swatch"];
              if (rgb === UNSEEN) {
                classNames.push("is-unseen");
              }
              if (hidden.has(index)) {
                classNames.push("is-hidden");
              }
              if (index === hoveredIndex) {
                classNames.push("is-hovered");
              }
              return (
                <button
                  // Palette entries never move, so the index is their identity
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  type="button"
                  className={classNames.join(" ")}
                  style={
                    rgb === UNSEEN
                      ? undefined
                      : { backgroundColor: toCssColor(rgb) }
                  }
                  title={`Palette ${index}${
                    rgb === UNSEEN ? " (not seen yet)" : ` ${toCssColor(rgb)}`
                  }`}
                  aria-pressed={!hidden.has(index)}
                  onClick={(event) => toggleIndex(index, event.shiftKey)}
                />
              );
            })}
          </div>
          <p className="plot-demo-hint">
            Click a color to hide its series, shift click to show it alone.
          </p>
          <p className="plot-demo-hint">
            Arrows move, Ctrl fires, Space opens doors, Enter selects, Alt and
            the arrows strafe, Escape opens the menu.
          </p>
        </div>
      </div>
    </div>
  );
}

export default DoomDemo;
