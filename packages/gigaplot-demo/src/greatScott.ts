import {
  identityDownsampler,
  seriesDataFromArrays,
  StaticDataSource,
  type Plot3DCamera,
  type PlotThemeOverrides,
  type SeriesData,
} from "gigaplot";
import type { PlotExample } from "./examples";
import { fluxCore, fluxHousing, fluxPulses } from "./samplers";
import { FireTrailSource } from "./sources/FireTrailSource";
import { SpeedometerSource } from "./sources/SpeedometerSource";
import { RollingScatterSource } from "./sources/RollingScatterSource";

/** The time circuits' displays: destination red, present green, departed amber. */
const DESTINATION_RED = "#ff3b30";
const PRESENT_GREEN = "#39ff14";
const DEPARTED_AMBER = "#ffb000";
const FLUX_BLUE = "#4fc3ff";
const FIRE_ORANGE = "#ff8a1f";

/** Hill Valley at night, whichever mode the demo is in. */
const NIGHT_THEME: PlotThemeOverrides = {
  backgroundColor: "#06080d",
  plotBackgroundColor: "#06080d",
  gridColor: "#1a2230",
  axisColor: "#2b3850",
  tickLabelColor: "#8fa3bf",
  legendTextColor: "#d5deea",
  axisTitleColor: DEPARTED_AMBER,
  colorway: [FIRE_ORANGE, FLUX_BLUE, DESTINATION_RED, PRESENT_GREEN],
};

/** Chasing the DeLorean down the road, low and from behind. */
const FIRE_TRAIL_CAMERA: Partial<Plot3DCamera> = {
  azimuth: -90,
  elevation: 7,
  distance: 1.6,
  fov: 60,
};

/** How fast a flux capacitor pulse runs down an arm, per tick. */
const FLUX_SPEED = 0.012;

const FLUX_BOUND = 1.25;

function createFluxCapacitorSource(): RollingScatterSource {
  const series = [
    {
      id: "housing",
      name: "Housing",
      style: { color: "#56606e", pointSize: 2 },
      sample: fluxHousing(),
      points: 6000,
    },
    {
      id: "glow",
      name: "Glow",
      style: { color: "rgba(79, 195, 255, 0.18)", pointSize: 10 },
      sample: fluxPulses({ speed: FLUX_SPEED, width: 0.05, spread: 0.04 }),
      points: 3000,
    },
    {
      id: "flux",
      name: "Flux",
      style: { color: "#c8f1ff", pointSize: 2.5 },
      sample: fluxPulses({ speed: FLUX_SPEED }),
      points: 4000,
    },
    {
      id: "core",
      name: "Core",
      style: { color: "#ffffff", pointSize: 2 },
      sample: fluxCore({ speed: FLUX_SPEED }),
      points: 1500,
    },
  ];
  // Every series shares a buffer size, so the busiest sets it, and the
  // housing barely changes however often it is resampled
  const pointsPerSeries = Math.max(...series.map(({ points }) => points));
  return new RollingScatterSource(series, {
    seed: 1955,
    pointsPerSeries,
    pointsPerTick: Math.ceil(pointsPerSeries / 8),
    bounds: {
      xMin: -FLUX_BOUND,
      xMax: FLUX_BOUND,
      yMin: -FLUX_BOUND,
      yMax: FLUX_BOUND,
    },
    title: "Flux capacitor",
  });
}

function createSpeedometerSource(car: FireTrailSource): SpeedometerSource {
  return new SpeedometerSource(car, {
    seed: 121,
    title: "88 miles per hour",
    xAxisLabel: "Seconds since leaving the Twin Pines Mall",
    yAxisLabel: "mph",
    styles: {
      speed: {
        color: DEPARTED_AMBER,
        lineWidth: 2,
        fill: {
          type: "linear",
          units: "data",
          stops: [
            { offset: 0, color: FLUX_BLUE, opacity: 0.05 },
            { offset: 60, color: FLUX_BLUE, opacity: 0.45 },
            { offset: 80, color: FIRE_ORANGE, opacity: 0.7 },
            { offset: 88, color: "#fff3b0", opacity: 0.95 },
          ],
        },
      },
      limit: { color: DESTINATION_RED, lineWidth: 1 },
      lightning: { color: "#e0f7ff", lineWidth: 2 },
      gone: { color: "#ffffff", pointSize: 14 },
    },
  });
}

/** Each stay on Marty's journey, in the order he lived them. */
const MARTY_STAYS = [1985, 1955, 1985, 2015, 1985, 1955, 1885, 1985];

/** The stays each film covers, by index into `MARTY_STAYS`. */
const FILMS = [
  { id: "part-1", name: "Part I", first: 0, last: 2, color: DESTINATION_RED },
  { id: "part-2", name: "Part II", first: 2, last: 5, color: PRESENT_GREEN },
  { id: "part-3", name: "Part III", first: 5, last: 7, color: DEPARTED_AMBER },
];

/**
 * A film's stays as steps: each year held for one jump of the story, then a
 * straight drop or climb to the next, as time travel is instant.
 */
function filmSteps(first: number, last: number): SeriesData {
  // A sequel picks up as the film before it ends, with its last stay
  const x: number[] = [first === 0 ? 0 : first + 1];
  const y: number[] = [MARTY_STAYS[first]];
  for (let stay = first + 1; stay <= last; stay += 1) {
    x.push(stay, stay);
    y.push(MARTY_STAYS[stay - 1], MARTY_STAYS[stay]);
  }
  x.push(last + 1);
  y.push(MARTY_STAYS[last]);
  return seriesDataFromArrays(x, y);
}

function createTimeCircuitsSource(): StaticDataSource {
  const arrivals = seriesDataFromArrays(
    MARTY_STAYS.map((_year, stay) => stay),
    MARTY_STAYS,
  );
  return new StaticDataSource(
    [
      ...FILMS.map(({ id, name, first, last, color }) => ({
        id,
        name,
        type: "line" as const,
        style: { color, lineWidth: 3 },
        data: filmSteps(first, last),
      })),
      {
        id: "biff",
        name: "Old Biff",
        type: "line",
        // Steals the DeLorean while Marty is in 2015, and brings it back
        style: { color: "#b388ff", lineWidth: 2 },
        data: seriesDataFromArrays(
          [3.3, 3.3, 3.6, 3.6],
          [2015, 1955, 1955, 2015],
        ),
      },
      {
        id: "arrivals",
        name: "Arrivals",
        type: "scatter",
        style: { color: "#ffffff", pointSize: 8 },
        data: arrivals,
      },
    ],
    {
      title: "Time circuits",
      xAxisLabel: "Jumps, in the order Marty lives them",
      yAxisLabel: "Year",
      // Jumps are whole, so tick only them
      xAxisTicks: (min, max) => {
        const ticks = [];
        for (let jump = Math.ceil(min); jump <= max; jump += 1) {
          ticks.push({ value: jump, label: `${jump}` });
        }
        return ticks;
      },
      // Steps go straight up and down, which a downsampler would cut corners on
      downsampler: identityDownsampler,
    },
  );
}

export const GREAT_SCOTT_EXAMPLE: PlotExample = {
  id: "great-scott",
  name: "Great Scott!",
  description:
    "\u201c1.21 gigaplots?! 1.21 gigaplots?! Great Scott! Marty, the only " +
    "renderer that can generate that kind of power is a bolt of WebGPU!\u201d " +
    "\u2014 Doc Brown. The DeLorean pulls away through the gears with its " +
    "speedometer keeping pace, and at 88 mph it is gone in a crack of " +
    "lightning, leaving twin trails of fire: over 10,000 3D points moving " +
    "every frame. The flux capacitor fluxes, and the time circuits chart " +
    "every jump of the trilogy.",
  layout: "quad",
  plotCount: 4,
  plotTitles: [
    "Fire trails",
    "Flux capacitor",
    "88 miles per hour",
    "Time circuits",
  ],
  theme: NIGHT_THEME,
  plots3d: [
    {
      camera: FIRE_TRAIL_CAMERA,
      showAxes: false,
      pointScaling: "perspective",
      depthFade: 0.5,
      theme: NIGHT_THEME,
    },
  ],
  autoStart: true,
  createSources: () => {
    const car = new FireTrailSource({
      seed: 1885,
      title: "Fire trails",
      styles: {
        stars: { color: "#8e9bb3", pointSize: 1.5 },
        road: { color: "#3a4352", lineWidth: 2 },
        tracks: { color: "#2a1608", lineWidth: 4 },
        embers: { color: "#ff3d00", pointSize: 1.5 },
        flames: { color: FIRE_ORANGE, pointSize: 2 },
        core: { color: "#fff1b8", pointSize: 1.5 },
        car: { color: "#d4d9e0", pointSize: 1.2 },
        trim: { color: "#5a616b", pointSize: 1.2 },
        taillights: { color: DESTINATION_RED, pointSize: 1.5 },
        sparks: { color: "#9fe6ff", pointSize: 1.5 },
      },
    });
    // The speedometer follows the car, so it reads 88 just as the car goes
    return [
      car,
      createFluxCapacitorSource(),
      createSpeedometerSource(car),
      createTimeCircuitsSource(),
    ];
  },
};
