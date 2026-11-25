import { createSeriesData3D, type SeriesData3D } from "gigaplot";

/** Half the car's length, front to back. */
export const DELOREAN_HALF_LENGTH = 0.2;

/** Half the car's width, at its sides. */
export const DELOREAN_HALF_WIDTH = 0.12;

/** How far either side of its center the wheels run, for the tire tracks. */
export const DELOREAN_TRACK = 0.12;

/** Bottom of the body, above the road. */
const SILL = 0.03;

/** The crease along each side, where the body meets the cabin. */
const BELT = 0.085;

/** Half the width of the roof. */
const ROOF_HALF_WIDTH = 0.08;

/** The car's profile, from the nose back: a low wedge with a flat roof. */
const PROFILE: [along: number, height: number][] = [
  [0.2, 0.045],
  [0.07, 0.072],
  [0.015, 0.14],
  [-0.06, 0.14],
  [-0.165, 0.092],
  [-0.2, 0.09],
];

/** Where the louvred rear window runs, from the roof down to the deck. */
const LOUVRES_FROM = -0.065;
const LOUVRES_TO = -0.16;
const LOUVRE_COUNT = 7;

const WHEEL_RADIUS = 0.03;
const WHEEL_ALONG = 0.125;

const L = DELOREAN_HALF_LENGTH;
const W = DELOREAN_HALF_WIDTH;

/** Height of the top of the car at `along`, measured from its center. */
export function deLoreanHeight(along: number): number {
  for (let i = 1; i < PROFILE.length; i += 1) {
    const [frontAlong, frontHeight] = PROFILE[i - 1];
    const [backAlong, backHeight] = PROFILE[i];
    if (along >= backAlong) {
      const t = (frontAlong - along) / (frontAlong - backAlong);
      return frontHeight + (backHeight - frontHeight) * Math.max(0, t);
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/** Half the width of the car at `height` on its cabin, narrowing to the roof. */
function cabinHalfWidth(height: number): number {
  if (height <= BELT) {
    return W;
  }
  const t = Math.min(1, (height - BELT) / (0.14 - BELT));
  return W + (ROOF_HALF_WIDTH - W) * t;
}

type Part = (random: () => number) => [x: number, along: number, z: number];

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function side(random: () => number): number {
  return random() < 0.5 ? -1 : 1;
}

/** Points scattered over `parts`, each picked in proportion to its weight. */
function sampleParts(
  random: () => number,
  count: number,
  parts: [weight: number, part: Part][],
): SeriesData3D {
  const total = parts.reduce((sum, [weight]) => sum + weight, 0);
  const data = createSeriesData3D(count);
  for (let i = 0; i < count; i += 1) {
    let pick = random() * total;
    const [, part] =
      parts.find(([weight]) => {
        pick -= weight;
        return pick < 0;
      }) ?? parts[parts.length - 1];
    const [x, along, z] = part(random);
    data.x[i] = x;
    data.y[i] = along;
    data.z[i] = z;
  }
  data.length = count;
  return data;
}

/** The stainless steel body, heaviest along its creases so its shape reads. */
function bodyParts(): [number, Part][] {
  return [
    // The top: bonnet, roof, and rear deck, but not the louvred window
    [
      5,
      (random) => {
        let along = between(random, -L, L);
        if (along < LOUVRES_FROM && along > LOUVRES_TO) {
          along = between(random, LOUVRES_FROM, L);
        }
        const z = deLoreanHeight(along);
        const half = z > BELT ? cabinHalfWidth(z) : W;
        return [between(random, -half, half), along, z];
      },
    ],
    // The sides, above the black trim
    [
      4,
      (random) => {
        const along = between(random, -L, L);
        const z = between(
          random,
          SILL + 0.012,
          Math.min(BELT, deLoreanHeight(along)),
        );
        return [side(random) * W, along, z];
      },
    ],
    // The cabin's sides, leaning in to the roof
    [
      2,
      (random) => {
        const along = between(random, LOUVRES_TO, 0.05);
        const top = deLoreanHeight(along);
        if (top <= BELT) {
          return [side(random) * W, along, top];
        }
        const z = between(random, BELT, top);
        return [side(random) * cabinHalfWidth(z), along, z];
      },
    ],
    // The crease along each side
    [
      3,
      (random) => {
        const along = between(random, -L, L);
        return [side(random) * W, along, Math.min(BELT, deLoreanHeight(along))];
      },
    ],
    // The edges of the cabin: windscreen pillars, roof, and rear window
    [
      3,
      (random) => {
        const along = between(random, LOUVRES_TO, 0.07);
        const z = deLoreanHeight(along);
        return [side(random) * cabinHalfWidth(z), along, z];
      },
    ],
    // The flat tail, above and below the light bar
    [
      2,
      (random) => {
        const z =
          random() < 0.5
            ? between(random, SILL, 0.05)
            : between(random, 0.08, deLoreanHeight(-L));
        return [between(random, -W, W), -L, z];
      },
    ],
    // The nose
    [1, (random) => [between(random, -W, W), L, between(random, SILL, 0.045)]],
    // Mr. Fusion, on the rear deck
    [
      0.6,
      (random) => {
        const angle = random() * 2 * Math.PI;
        return [
          Math.cos(angle) * 0.016,
          -0.182 + Math.sin(angle) * 0.016,
          between(random, 0.09, 0.125),
        ];
      },
    ],
  ];
}

/** Black trim: tires, the lower body, the rear louvres, and the light bar. */
function trimParts(): [number, Part][] {
  return [
    // Tires, as discs a little proud of the body
    [
      4,
      (random) => {
        const angle = random() * 2 * Math.PI;
        const r = WHEEL_RADIUS * Math.sqrt(random());
        return [
          side(random) * (W + between(random, 0, 0.012)),
          side(random) * WHEEL_ALONG + Math.cos(angle) * r,
          WHEEL_RADIUS + Math.sin(angle) * r,
        ];
      },
    ],
    // The black band along the bottom of each side
    [
      2,
      (random) => [
        side(random) * W,
        between(random, -L, L),
        between(random, SILL, SILL + 0.012),
      ],
    ],
    // Slats across the rear window
    [
      3,
      (random) => {
        const slat = Math.floor(random() * LOUVRE_COUNT);
        const along =
          LOUVRES_FROM +
          ((LOUVRES_TO - LOUVRES_FROM) * (slat + 0.5)) / LOUVRE_COUNT;
        const z = deLoreanHeight(along) + 0.004;
        const half = cabinHalfWidth(z) * 0.92;
        return [between(random, -half, half), along, z];
      },
    ],
    // The bar the taillights sit in, across the whole tail
    [
      2,
      (random) => [
        between(random, -W, W),
        -L - 0.001,
        between(random, 0.05, 0.08),
      ],
    ],
  ];
}

/** The taillights, a block at each end of the light bar. */
function taillightParts(): [number, Part][] {
  return [
    [
      1,
      (random) => [
        side(random) * between(random, 0.035, W - 0.008),
        -L - 0.002,
        between(random, 0.055, 0.075),
      ],
    ],
  ];
}

export interface DeLoreanShape {
  body: SeriesData3D;
  trim: SeriesData3D;
  taillights: SeriesData3D;
}

/**
 * A DeLorean as points, offset from its center on the road: x across, y along
 * with the nose at +y, and z up from the road.
 */
export function createDeLoreanShape(
  random: () => number,
  {
    bodyPoints = 2400,
    trimPoints = 1400,
    taillightPoints = 160,
  }: {
    bodyPoints?: number;
    trimPoints?: number;
    taillightPoints?: number;
  } = {},
): DeLoreanShape {
  return {
    body: sampleParts(random, bodyPoints, bodyParts()),
    trim: sampleParts(random, trimPoints, trimParts()),
    taillights: sampleParts(random, taillightPoints, taillightParts()),
  };
}
