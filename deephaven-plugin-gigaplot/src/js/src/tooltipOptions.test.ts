import { getTooltipOptions } from "./tooltipOptions";

describe("getTooltipOptions", () => {
  it("passes booleans through, defaulting to on", () => {
    expect(getTooltipOptions(undefined)).toBe(true);
    expect(getTooltipOptions(null)).toBe(true);
    expect(getTooltipOptions(false)).toBe(false);
  });

  it("draws exactly the parts listed", () => {
    expect(getTooltipOptions(["guides", "y_axis_labels"])).toEqual({
      box: false,
      markers: false,
      guides: true,
      xAxisLabel: false,
      yAxisLabels: true,
    });
  });

  it("ignores unknown parts", () => {
    expect(getTooltipOptions(["nope", "constructor", "x_axis_label"])).toEqual({
      box: false,
      markers: false,
      guides: false,
      xAxisLabel: true,
      yAxisLabels: false,
    });
  });
});
