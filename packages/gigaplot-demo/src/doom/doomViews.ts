import { useEffect, type MutableRefObject, type ReactNode } from "react";
import type { PlotThemeOverrides, PlotTooltipOptions } from "gigaplot";
import type { DoomColorMode } from "./doomColors";
import type { DoomFrame } from "./doomFrame";
import type { DoomPalette } from "./DoomPalette";

/** Space around the plot area. Kept small, so the game gets the room. */
export const DOOM_MARGIN = { top: 8, right: 12, bottom: 22, left: 34 };

/** Hundreds of legend entries would cover the game, so views go without. */
export const DOOM_THEME: PlotThemeOverrides = {
  margin: DOOM_MARGIN,
  legendSwatchSize: 0,
  legendTextColor: "transparent",
};

/** Takes Doom's frames: the source of whichever view is showing. */
export interface DoomFrameSink {
  pushFrame: (frame: DoomFrame) => void;
  /** Points drawn for the latest frame. */
  getPointCount: () => number;
}

/** Palette settings shared by the views drawn by palette color. */
export interface DoomPaletteSettings {
  colorMode: DoomColorMode;
  hidden: ReadonlySet<number>;
  /** Colors learned so far, for the palette grid. */
  colors: Int32Array;
  onColorModeChange: (mode: DoomColorMode) => void;
  onHiddenChange: (hidden: ReadonlySet<number>) => void;
}

export interface DoomViewProps {
  palette: DoomPalette;
  paletteSettings: DoomPaletteSettings;
  /** Set to the view's source while it is showing, to give it every frame. */
  sinkRef: MutableRefObject<DoomFrameSink | undefined>;
  /** Size of the box the plot fills, including its margins. */
  plotSize: { width: number; height: number };
  rendererPreference?: readonly string[];
  tooltip?: boolean | PlotTooltipOptions;
  onRendererChanged?: (name: string) => void;
  onPlotFrame: () => void;
  onError?: (error: unknown) => void;
  /** Lays a view out, with its plot where it can be played. */
  layout: (plot: ReactNode, controls: ReactNode) => JSX.Element;
}

/**
 * Hands `source` the frames while the view is showing, and closes it after.
 * Closing only drops listeners, which the plot adds again when React's strict
 * mode remounts it.
 */
export function useFrameSink(
  sinkRef: MutableRefObject<DoomFrameSink | undefined>,
  source: DoomFrameSink & { close: () => void },
): void {
  useEffect(() => {
    // eslint-disable-next-line no-param-reassign
    sinkRef.current = source;
    return () => {
      if (sinkRef.current === source) {
        // eslint-disable-next-line no-param-reassign
        sinkRef.current = undefined;
      }
      source.close();
    };
  }, [sinkRef, source]);
}
