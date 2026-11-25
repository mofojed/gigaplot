import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlotDataSource } from '../model/PlotDataSource';
import type { Bounds } from '../model/PlotTypes';
import type { RendererRegistry } from '../renderers/RendererRegistry';
import type { PlotScale } from '../scale/PlotScale';
import type { PlotThemeOverrides } from '../theme/PlotTheme';
import type { PlotHover, PlotTooltipOptions } from '../view/hover';
import type { PlotLegendPosition } from '../view/LegendPainter';
import { PlotView } from '../view/PlotView';

export interface PlotProps {
  source: PlotDataSource;
  /** Renderer names in order of preference. Defaults to WebGPU then Canvas. */
  rendererPreference?: readonly string[];
  registry?: RendererRegistry;
  /**
   * Applied on top of the Deephaven chart CSS variables in scope, which in turn
   * fall back to `defaultPlotTheme`. Keep the object identity stable between
   * renders, since every new object re-resolves the theme.
   */
  theme?: PlotThemeOverrides;
  /** Follows page theme switches by re-reading CSS variables. Defaults to true. */
  followCssTheme?: boolean;
  /** Enables wheel zoom, drag pan, and double click reset. Defaults to true. */
  interactive?: boolean;
  /**
   * Pixelates downsampled data in place while zooming in until the more
   * detailed data fills in, and hatches regions still loading after zooming
   * out. Defaults to true.
   */
  smoothZoom?: boolean;
  /**
   * What to draw while hovering. Line series snap to the cursor's x; scatter
   * series need the cursor over a point. `true` or omitted draws a tooltip
   * box and markers, `false` draws nothing, and an object changes only the
   * parts it sets. Changing it does not recreate the plot.
   */
  tooltip?: boolean | PlotTooltipOptions;
  /**
   * Where to draw the legend: `overlay` across the top of the plot area, or
   * `right` beside it. Defaults to `overlay`. Changing it does not recreate
   * the plot.
   */
  legendPosition?: PlotLegendPosition;
  /**
   * The x axis' scale, in place of the source's, such as a business calendar
   * that removes nights and weekends, or `linearScale` to show them. Keep the
   * identity stable: a new scale reloads the plot's data.
   */
  xScale?: PlotScale;
  /** The y axis' scale, in place of the source's, such as a log scale. */
  yScale?: PlotScale;
  className?: string;
  style?: CSSProperties;
  onRendererChanged?: (name: string) => void;
  onViewportChanged?: (viewport: Bounds) => void;
  /** Called after every frame the renderer draws. */
  onFrame?: () => void;
  /** Called when the points under the cursor change, including to none. */
  onHover?: (hover: PlotHover | undefined) => void;
  onError?: (error: unknown) => void;
}

const CONTAINER_STYLE: CSSProperties = { width: '100%', height: '100%' };

/**
 * Renders a {@link PlotDataSource}.
 *
 * All of the work happens in {@link PlotView}; this component only manages its
 * lifetime and forwards events.
 */
export function Plot({
  source,
  rendererPreference,
  registry,
  theme,
  followCssTheme,
  interactive,
  smoothZoom,
  tooltip,
  legendPosition,
  xScale,
  yScale,
  className,
  style,
  onRendererChanged,
  onViewportChanged,
  onFrame,
  onHover,
  onError,
}: PlotProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PlotView | null>(null);

  // Latest values are read through refs so changing them does not recreate the view
  const callbacksRef = useRef({
    onRendererChanged,
    onViewportChanged,
    onFrame,
    onHover,
    onError,
  });
  callbacksRef.current = {
    onRendererChanged,
    onViewportChanged,
    onFrame,
    onHover,
    onError,
  };

  const themeRef = useRef(theme);
  themeRef.current = theme;

  const tooltipRef = useRef(tooltip);
  tooltipRef.current = tooltip;

  const legendPositionRef = useRef(legendPosition);
  legendPositionRef.current = legendPosition;

  const scalesRef = useRef({ xScale, yScale });
  scalesRef.current = { xScale, yScale };

  // Hit testing is skipped when nothing shows the result, so only listen when asked
  const hasHoverListener = onHover != null;

  useEffect(
    function createView() {
      const container = containerRef.current;
      if (container == null) {
        return undefined;
      }
      const plotView = new PlotView(container, source, {
        rendererPreference,
        registry,
        theme: themeRef.current,
        followCssTheme,
        interactive,
        smoothZoom,
        tooltip: tooltipRef.current,
        legendPosition: legendPositionRef.current,
        xScale: scalesRef.current.xScale,
        yScale: scalesRef.current.yScale,
      });
      plotView.addEventListener('rendererchanged', ({ name }) =>
        callbacksRef.current.onRendererChanged?.(name)
      );
      plotView.addEventListener('viewportchanged', ({ viewport }) =>
        callbacksRef.current.onViewportChanged?.(viewport)
      );
      plotView.addEventListener('error', ({ error }) =>
        callbacksRef.current.onError?.(error)
      );
      plotView.addEventListener('frame', () =>
        callbacksRef.current.onFrame?.()
      );
      plotView.initialize().catch(error => {
        callbacksRef.current.onError?.(error);
      });
      setView(plotView);
      return () => {
        plotView.destroy();
        setView(null);
      };
    },
    [
      source,
      rendererPreference,
      registry,
      followCssTheme,
      interactive,
      smoothZoom,
    ]
  );

  useEffect(
    function listenForHover() {
      if (view == null || !hasHoverListener) {
        return undefined;
      }
      const listener = ({ hover }: { hover: PlotHover | undefined }) =>
        callbacksRef.current.onHover?.(hover);
      view.addEventListener('hover', listener);
      return () => view.removeEventListener('hover', listener);
    },
    [view, hasHoverListener]
  );

  useEffect(
    function applyTooltip() {
      view?.setTooltip(tooltip);
    },
    [view, tooltip]
  );

  useEffect(
    function applyLegendPosition() {
      view?.setLegendPosition(legendPosition);
    },
    [view, legendPosition]
  );

  useEffect(
    function applyScales() {
      view?.setScales({ x: xScale, y: yScale });
    },
    [view, xScale, yScale]
  );

  useEffect(
    function applyTheme() {
      view?.setTheme(theme);
    },
    [view, theme]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={style ?? CONTAINER_STYLE}
    />
  );
}

export default Plot;
