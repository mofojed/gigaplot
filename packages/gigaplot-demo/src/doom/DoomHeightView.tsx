import { useCallback, useEffect, useState } from "react";
import { Plot3D, type Plot3DCamera, type Plot3DHoverPoint } from "gigaplot";
import { DoomPaletteSource, getPaletteIndex } from "./DoomPaletteSource";
import { DoomPaletteControls } from "./DoomPaletteControls";
import { formatPointsPerPixel } from "./DoomScatterView";
import { DOOM_THEME, useFrameSink, type DoomViewProps } from "./doomViews";

/** A million points do not fit on screen in 3D, so this stops lower. */
const POINTS_PER_PIXEL_3D = [0.25, 1, 4];

const POINT_SIZES = [1, 2, 3, 4, 6];

/** How far the brightest pixels stand above the darkest, in Doom pixels. */
const HEIGHTS = [0, 12, 25, 50, 100];

/** Looking up the screen from just below its bottom edge, close in. */
const CAMERA: Partial<Plot3DCamera> = {
  azimuth: -82,
  elevation: 35,
  distance: 3.6,
};

/**
 * Doom as a height field: the palette scatter laid flat in a 3D plot, with
 * each pixel standing up by its brightness.
 */
export function DoomHeightView({
  palette,
  paletteSettings,
  sinkRef,
  rendererPreference,
  tooltip,
  onRendererChanged,
  onPlotFrame,
  onError,
  layout,
}: DoomViewProps): JSX.Element {
  const { colorMode, hidden } = paletteSettings;
  const [pointsPerPixel, setPointsPerPixel] = useState(1);
  const [pointSize, setPointSize] = useState(3);
  const [height, setHeight] = useState(50);
  const [hoveredIndex, setHoveredIndex] = useState<number>();

  const [source] = useState(
    () =>
      new DoomPaletteSource(
        { pointsPerPixel, pointSize, colorMode, hidden, height },
        { palette, is3D: true },
      ),
  );
  useFrameSink(sinkRef, source);

  useEffect(
    function updateSource() {
      source.setOptions({
        pointsPerPixel,
        pointSize,
        colorMode,
        hidden,
        height,
      });
    },
    [source, pointsPerPixel, pointSize, colorMode, hidden, height],
  );

  const handleHover = useCallback((hover: Plot3DHoverPoint | undefined) => {
    setHoveredIndex(
      hover == null ? undefined : getPaletteIndex(hover.seriesId),
    );
  }, []);

  return layout(
    <Plot3D
      className="plot-demo-plot"
      source={source}
      theme={DOOM_THEME}
      camera={CAMERA}
      tooltip={tooltip !== false}
      rendererPreference={rendererPreference}
      onRendererChanged={onRendererChanged}
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
        {POINTS_PER_PIXEL_3D.map((choice) => (
          <option key={choice} value={choice}>
            {formatPointsPerPixel(choice)}
          </option>
        ))}
      </select>

      <label htmlFor="doom-point-size">Point size</label>
      <select
        id="doom-point-size"
        data-testid="doom-point-size"
        value={pointSize}
        onChange={(event) => setPointSize(Number(event.target.value))}
      >
        {POINT_SIZES.map((size) => (
          <option key={size} value={size}>
            {`${size} px`}
          </option>
        ))}
      </select>

      <label htmlFor="doom-height">Height</label>
      <select
        id="doom-height"
        data-testid="doom-height"
        value={height}
        onChange={(event) => setHeight(Number(event.target.value))}
      >
        {HEIGHTS.map((value) => (
          <option key={value} value={value}>
            {value === 0 ? "Flat" : `${value} pixels`}
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

export default DoomHeightView;
