import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlotDataSource } from '../model/PlotDataSource';
import type { Plot3DRendererFactory } from '../renderers/Plot3DRenderer';
import type { RendererRegistry } from '../renderers/RendererRegistry';
import type { Plot3DCamera } from '../scale/projection3d';
import type { PlotThemeOverrides } from '../theme/PlotTheme';
import type { PlotLegendPosition } from '../view/LegendPainter';
import { Plot3DView, type Plot3DPointScaling } from '../view/Plot3DView';
import type { Plot3DHoverPoint } from '../view/hover3d';

export interface Plot3DProps {
  /** A source of `scatter3d` and `line3d` series. */
  source: PlotDataSource;
  /** Renderer names in order of preference. Defaults to WebGPU then Canvas. */
  rendererPreference?: readonly string[];
  registry?: RendererRegistry<Plot3DRendererFactory>;
  /**
   * Applied on top of the Deephaven chart CSS variables in scope. Keep the
   * object identity stable between renders.
   */
  theme?: PlotThemeOverrides;
  /** Follows page theme switches by re-reading CSS variables. Defaults to true. */
  followCssTheme?: boolean;
  /** Enables drag to rotate, wheel to zoom, and double click to reset. Defaults to true. */
  interactive?: boolean;
  /** Marks the point under the cursor and lists its values. Defaults to true. */
  tooltip?: boolean;
  /** Where to draw the legend. Defaults to `overlay`. */
  legendPosition?: PlotLegendPosition;
  /**
   * Where the camera starts, and returns to on double click. Changing it
   * recreates the plot, so keep the object identity stable.
   */
  camera?: Partial<Plot3DCamera>;
  /** Draws the box, its gridlines, and its labels. Defaults to true. */
  showAxes?: boolean;
  /** `fixed`, the default, or `perspective` to size points by distance. */
  pointScaling?: Plot3DPointScaling;
  /** How much the farthest data fades, from 0 to 1. Defaults to 0. */
  depthFade?: number;
  className?: string;
  style?: CSSProperties;
  onRendererChanged?: (name: string) => void;
  onCameraChanged?: (camera: Plot3DCamera) => void;
  /** Called after every frame the renderer draws. */
  onFrame?: () => void;
  /** Called when the point under the cursor changes, including to none. */
  onHover?: (hover: Plot3DHoverPoint | undefined) => void;
  onError?: (error: unknown) => void;
}

const CONTAINER_STYLE: CSSProperties = { width: '100%', height: '100%' };

/**
 * Renders a {@link PlotDataSource} of 3D series. All of the work happens in
 * {@link Plot3DView}; this component only manages its lifetime and forwards
 * events.
 */
export function Plot3D({
  source,
  rendererPreference,
  registry,
  theme,
  followCssTheme,
  interactive,
  tooltip,
  legendPosition,
  camera,
  showAxes,
  pointScaling,
  depthFade,
  className,
  style,
  onRendererChanged,
  onCameraChanged,
  onFrame,
  onHover,
  onError,
}: Plot3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Plot3DView | null>(null);

  // Latest values are read through refs so changing them does not recreate the view
  const callbacksRef = useRef({
    onRendererChanged,
    onCameraChanged,
    onFrame,
    onHover,
    onError,
  });
  callbacksRef.current = {
    onRendererChanged,
    onCameraChanged,
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

  const hasHoverListener = onHover != null;

  useEffect(
    function createView() {
      const container = containerRef.current;
      if (container == null) {
        return undefined;
      }
      const plotView = new Plot3DView(container, source, {
        rendererPreference,
        registry,
        theme: themeRef.current,
        followCssTheme,
        interactive,
        tooltip: tooltipRef.current,
        legendPosition: legendPositionRef.current,
        camera,
        showAxes,
        pointScaling,
        depthFade,
      });
      plotView.addEventListener('rendererchanged', ({ name }) =>
        callbacksRef.current.onRendererChanged?.(name)
      );
      plotView.addEventListener('camerachanged', ({ camera: next }) =>
        callbacksRef.current.onCameraChanged?.(next)
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
      camera,
      showAxes,
      pointScaling,
      depthFade,
    ]
  );

  useEffect(
    function listenForHover() {
      if (view == null || !hasHoverListener) {
        return undefined;
      }
      const listener = ({ hover }: { hover: Plot3DHoverPoint | undefined }) =>
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

export default Plot3D;
