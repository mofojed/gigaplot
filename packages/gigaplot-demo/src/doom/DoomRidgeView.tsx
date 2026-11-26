import { useEffect, useMemo, useState } from "react";
import { Plot, type PlotThemeOverrides } from "gigaplot";
import {
  DOOM_RIDGE_STYLES,
  DoomRidgeSource,
  RIDGE_AMPLITUDES,
  RIDGE_LINE_COUNTS,
  type DoomRidgeStyle,
} from "./DoomRidgeSource";
import { DOOM_THEME, useFrameSink, type DoomViewProps } from "./doomViews";

const LINE_WIDTHS = [1, 1.5, 2, 3];

/** The album cover: white lines on black, with nothing else in the way. */
const PULSAR_THEME: PlotThemeOverrides = {
  ...DOOM_THEME,
  plotBackgroundColor: "#000000",
  gridColor: "#000000",
};

/**
 * Doom as a ridgeline plot, after the cover of Joy Division's Unknown
 * Pleasures: a line series for each band of rows, rising with brightness.
 */
export function DoomRidgeView({
  palette,
  sinkRef,
  rendererPreference,
  onRendererChanged,
  onPlotFrame,
  onError,
  layout,
}: DoomViewProps): JSX.Element {
  const [lineCount, setLineCount] = useState(50);
  const [amplitude, setAmplitude] = useState(4);
  const [style, setStyle] = useState<DoomRidgeStyle>("pulsar");
  const [occlude, setOcclude] = useState(true);
  const [lineWidth, setLineWidth] = useState(1.5);

  const [source] = useState(
    () =>
      new DoomRidgeSource(
        { lineCount, amplitude, style, occlude, lineWidth },
        palette,
      ),
  );
  useFrameSink(sinkRef, source);

  useEffect(
    function updateSource() {
      source.setOptions({ lineCount, amplitude, style, occlude, lineWidth });
    },
    [source, lineCount, amplitude, style, occlude, lineWidth],
  );

  const theme = useMemo(
    () => (style === "pulsar" ? PULSAR_THEME : DOOM_THEME),
    [style],
  );

  return layout(
    <Plot
      className="plot-demo-plot"
      source={source}
      theme={theme}
      // Every line is under the cursor along x, so a tooltip would list them all
      tooltip={false}
      rendererPreference={rendererPreference}
      onRendererChanged={onRendererChanged}
      onFrame={onPlotFrame}
      onError={onError}
    />,
    <>
      <label htmlFor="doom-ridge-lines">Lines</label>
      <select
        id="doom-ridge-lines"
        data-testid="doom-ridge-lines"
        value={lineCount}
        onChange={(event) => setLineCount(Number(event.target.value))}
      >
        {RIDGE_LINE_COUNTS.map((count) => (
          <option key={count} value={count}>
            {`${count} lines`}
          </option>
        ))}
      </select>

      <label htmlFor="doom-ridge-amplitude">Height</label>
      <select
        id="doom-ridge-amplitude"
        data-testid="doom-ridge-amplitude"
        value={amplitude}
        onChange={(event) => setAmplitude(Number(event.target.value))}
      >
        {RIDGE_AMPLITUDES.map((value) => (
          <option key={value} value={value}>
            {value === 1 ? "1 line" : `${value} lines`}
          </option>
        ))}
      </select>

      <label htmlFor="doom-ridge-style">Style</label>
      <select
        id="doom-ridge-style"
        data-testid="doom-ridge-style"
        value={style}
        onChange={(event) => setStyle(event.target.value as DoomRidgeStyle)}
      >
        {DOOM_RIDGE_STYLES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>

      <label htmlFor="doom-ridge-width">Line width</label>
      <select
        id="doom-ridge-width"
        value={lineWidth}
        onChange={(event) => setLineWidth(Number(event.target.value))}
      >
        {LINE_WIDTHS.map((width) => (
          <option key={width} value={width}>
            {`${width} px`}
          </option>
        ))}
      </select>

      <label className="plot-demo-checkbox" htmlFor="doom-ridge-occlude">
        <input
          id="doom-ridge-occlude"
          type="checkbox"
          data-testid="doom-ridge-occlude"
          checked={occlude}
          disabled={style === "glow"}
          onChange={(event) => setOcclude(event.target.checked)}
        />
        Hide lines behind the ones in front
      </label>
      <p className="plot-demo-hint">
        Each line is a band of Doom&apos;s rows, rising with their brightness.
        Lines further up the screen sit further back.
      </p>
    </>,
  );
}

export default DoomRidgeView;
