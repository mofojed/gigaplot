import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPowerScale,
  Plot,
  type Bounds,
  type PlotHover,
  type PlotScale,
} from "gigaplot";
import { DOOM_HEIGHT, DOOM_WIDTH } from "./doomFrame";
import {
  DOOM_BOUNDS,
  DoomPaletteSource,
  POINTS_PER_PIXEL_CHOICES,
  getPaletteIndex,
} from "./DoomPaletteSource";
import { DoomPaletteControls } from "./DoomPaletteControls";
import {
  DOOM_MARGIN,
  DOOM_THEME,
  useFrameSink,
  type DoomViewProps,
} from "./doomViews";

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

export function formatPointsPerPixel(value: number): string {
  const label =
    value < 1 ? `1 per ${Math.round(1 / value)} pixels` : `${value} per pixel`;
  return `${label} (${(value * DOOM_WIDTH * DOOM_HEIGHT).toLocaleString()})`;
}

/** Doom in a 2D scatter plot, with a series for each palette color. */
export function DoomScatterView({
  palette,
  paletteSettings,
  sinkRef,
  plotSize,
  rendererPreference,
  tooltip,
  onRendererChanged,
  onPlotFrame,
  onError,
  layout,
}: DoomViewProps): JSX.Element {
  const { colorMode, hidden } = paletteSettings;
  const [pointsPerPixel, setPointsPerPixel] = useState(1);
  const [pointSizeChoice, setPointSizeChoice] =
    useState<PointSizeChoice>("fit");
  const [lens, setLens] = useState<Lens>("none");
  const [viewport, setViewport] = useState<Bounds>(DOOM_BOUNDS);
  const [hoveredIndex, setHoveredIndex] = useState<number>();

  const fitPointSize = useMemo(() => {
    const spacing =
      pointsPerPixel < 1
        ? Math.round(1 / Math.sqrt(pointsPerPixel))
        : 1 / Math.round(Math.sqrt(pointsPerPixel));
    const scale = LENS_SCALES[lens];
    const xPixels = getFitGap(
      viewport.xMin,
      viewport.xMax,
      plotSize.width - DOOM_MARGIN.left - DOOM_MARGIN.right,
      spacing,
      scale,
    );
    const yPixels = getFitGap(
      viewport.yMin,
      viewport.yMax,
      plotSize.height - DOOM_MARGIN.top - DOOM_MARGIN.bottom,
      spacing,
      scale,
    );
    const size = Math.max(xPixels, yPixels) * FIT_OVERLAP;
    return Number.isFinite(size) && size > 0 ? size : 1;
  }, [lens, plotSize, pointsPerPixel, viewport]);

  const pointSize = pointSizeChoice === "fit" ? fitPointSize : pointSizeChoice;

  // The source lives as long as the view, and options are pushed into it
  const [source] = useState(
    () =>
      new DoomPaletteSource(
        { pointsPerPixel, pointSize, colorMode, hidden },
        { palette },
      ),
  );
  useFrameSink(sinkRef, source);

  useEffect(
    function updateSource() {
      source.setOptions({ pointsPerPixel, pointSize, colorMode, hidden });
    },
    [source, pointsPerPixel, pointSize, colorMode, hidden],
  );

  const handleHover = useCallback((hover: PlotHover | undefined) => {
    const point = hover?.points[0];
    setHoveredIndex(
      point == null ? undefined : getPaletteIndex(point.seriesId),
    );
  }, []);

  return layout(
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
      onFrame={onPlotFrame}
      onHover={handleHover}
      onError={onError}
    />,
    <>
      <label htmlFor="doom-points-per-pixel">Points</label>
      <select
        id="doom-points-per-pixel"
        data-testid="doom-points-per-pixel"
        value={pointsPerPixel}
        onChange={(event) => setPointsPerPixel(Number(event.target.value))}
      >
        {POINTS_PER_PIXEL_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {formatPointsPerPixel(choice)}
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
            event.target.value === "fit" ? "fit" : Number(event.target.value),
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

      <DoomPaletteControls
        settings={paletteSettings}
        hoveredIndex={hoveredIndex}
      />
    </>,
  );
}

export default DoomScatterView;
