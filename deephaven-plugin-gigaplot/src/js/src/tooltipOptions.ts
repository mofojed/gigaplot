import Log from "@deephaven/log";
import type { PlotTooltipOptions } from "gigaplot";

const log = Log.module("deephaven-plugin-gigaplot.tooltipOptions");

/** The `tooltip` prop from the Python component. */
export type TooltipProp = boolean | readonly string[] | null | undefined;

/** Tooltip part names the Python component accepts, and the option each sets. */
export const TOOLTIP_PARTS: Readonly<Record<string, keyof PlotTooltipOptions>> =
  Object.freeze({
    box: "box",
    markers: "markers",
    guides: "guides",
    x_axis_label: "xAxisLabel",
    y_axis_labels: "yAxisLabels",
  });

/**
 * Turns the `tooltip` prop into Plot options. A list names exactly the parts
 * to draw, so parts it leaves out are off rather than at their defaults.
 */
export function getTooltipOptions(
  tooltip: TooltipProp,
): boolean | PlotTooltipOptions {
  if (tooltip == null || typeof tooltip === "boolean") {
    return tooltip ?? true;
  }
  const options: Required<PlotTooltipOptions> = {
    box: false,
    markers: false,
    guides: false,
    xAxisLabel: false,
    yAxisLabels: false,
  };
  tooltip.forEach((part) => {
    if (Object.prototype.hasOwnProperty.call(TOOLTIP_PARTS, part)) {
      options[TOOLTIP_PARTS[part]] = true;
    } else {
      log.warn("Ignoring unknown tooltip part", part);
    }
  });
  return options;
}
