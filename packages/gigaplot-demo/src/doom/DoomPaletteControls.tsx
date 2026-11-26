import { useCallback } from "react";
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
import type { DoomPaletteSettings } from "./doomViews";

const ALL_INDEXES = Array.from({ length: PALETTE_SIZE }, (_unused, i) => i);

export interface DoomPaletteControlsProps {
  settings: DoomPaletteSettings;
  /** Palette index under the cursor, outlined in the grid. */
  hoveredIndex?: number;
}

/**
 * Picks how the palette series are colored, and which are shown, from a grid
 * with a swatch per series.
 */
export function DoomPaletteControls({
  settings: { colorMode, hidden, colors, onColorModeChange, onHiddenChange },
  hoveredIndex,
}: DoomPaletteControlsProps): JSX.Element {
  const toggleIndex = useCallback(
    (index: number, solo: boolean) => {
      if (solo) {
        onHiddenChange(new Set(ALL_INDEXES.filter((i) => i !== index)));
        return;
      }
      const next = new Set(hidden);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      onHiddenChange(next);
    },
    [hidden, onHiddenChange],
  );

  const toggleGroup = useCallback(
    (group: DoomColorGroup) => {
      const members = ALL_INDEXES.filter(
        (index) => getColorGroup(colors[index]) === group,
      );
      const next = new Set(hidden);
      const isAllHidden = members.every((index) => hidden.has(index));
      members.forEach((index) =>
        isAllHidden ? next.delete(index) : next.add(index),
      );
      onHiddenChange(next);
    },
    [colors, hidden, onHiddenChange],
  );

  const seenCount = colors.reduce(
    (count, rgb) => (rgb === UNSEEN ? count : count + 1),
    0,
  );

  return (
    <>
      <label htmlFor="doom-color-mode">Colors</label>
      <select
        id="doom-color-mode"
        data-testid="doom-color-mode"
        value={colorMode}
        onChange={(event) =>
          onColorModeChange(event.target.value as DoomColorMode)
        }
      >
        {DOOM_COLOR_MODES.map(({ id, label }) => (
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
        <button
          type="button"
          onClick={() =>
            onHiddenChange(
              new Set(ALL_INDEXES.filter((index) => !hidden.has(index))),
            )
          }
        >
          Invert
        </button>
        <button
          type="button"
          data-testid="doom-show-all"
          onClick={() => onHiddenChange(new Set())}
        >
          Show all
        </button>
      </div>
      <div className="doom-demo-palette" data-testid="doom-palette">
        {Array.from(colors, (rgb, index) => {
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
    </>
  );
}

export default DoomPaletteControls;
