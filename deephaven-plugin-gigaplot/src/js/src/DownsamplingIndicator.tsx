import type { CSSProperties } from "react";
import { defaultPlotTheme } from "gigaplot";

const { margin } = defaultPlotTheme;

// Sits just inside the bottom right corner of the plot area
const STYLE: CSSProperties = {
  position: "absolute",
  right: margin.right + 6,
  bottom: margin.bottom + 6,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  color: "var(--dh-color-chart-legend-fg, #f0f0ee)",
  background:
    "color-mix(in srgb, var(--dh-color-chart-bg, #2d2a2e) 75%, transparent)",
  opacity: 0.8,
  pointerEvents: "none",
  userSelect: "none",
};

/**
 * A subtle status shown while the plot waits for a downsampled table. The
 * spinner animates in SVG, so no stylesheet is needed.
 */
export function DownsamplingIndicator(): JSX.Element {
  return (
    <div style={STYLE} role="status" data-testid="gigaplot-downsampling">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle
          cx="5"
          cy="5"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.5"
        />
        <path
          d="M5 1 A4 4 0 0 1 9 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 5 5"
            to="360 5 5"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
      Downsampling…
    </div>
  );
}

export default DownsamplingIndicator;
