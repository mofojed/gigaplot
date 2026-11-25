/**
 * WGSL shaders for the WebGPU renderer.
 *
 * Positions live in a storage buffer as `vec2<f32>` relative to a per series
 * origin. Keeping them relative preserves precision for domains such as epoch
 * millisecond timestamps, which lose ~2 minutes of resolution when stored as an
 * absolute f32. Bars store five `f32` per point instead: x, open, high, low,
 * and close, and areas three: x, y, and the base of the fill.
 */

const SHARED = /* wgsl */ `
struct Uniforms {
  // Viewport bounds relative to the series origin: (xMin, xMax, yMin, yMax)
  viewport: vec4<f32>,
  color: vec4<f32>,
  resolution: vec2<f32>,
  size: f32,
  // 1 to sample coverage at grid pixel centres, pixelating the series
  snap: f32,
  // Device pixel grid the series is drawn on, relative to the series origin:
  // (xOrigin, xSize, yOrigin, ySize). The screen's own pixels unless the data
  // is stale, in which case it is the coarser grid the data was made for.
  grid: vec4<f32>,
  // Bars that close below their open are drawn in this instead of color
  decreasingColor: vec4<f32>,
  // (half a bar's width in data units, 1 for candlesticks, unused, unused)
  bar: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Distance the antialiased edge fades over on each side, in grid pixels
const FEATHER: f32 = 0.75;

fn toGrid(point: vec2<f32>) -> vec2<f32> {
  return (point - uniforms.grid.xz) / uniforms.grid.yw;
}

fn gridToClip(position: vec2<f32>) -> vec2<f32> {
  let data = position * uniforms.grid.yw + uniforms.grid.xz;
  let span = vec2<f32>(
    uniforms.viewport.y - uniforms.viewport.x,
    uniforms.viewport.w - uniforms.viewport.z
  );
  return (data - uniforms.viewport.xz) / span * 2.0 - 1.0;
}

// Quads are padded so the antialiased edge, and any grid pixel whose centre
// falls inside it, is not clipped
fn padding() -> f32 {
  return FEATHER + 0.25 + uniforms.snap * 0.75;
}

// Where to measure coverage: the fragment itself, or its grid pixel's centre
// so every screen pixel in a grid pixel matches, like an image scaled up
fn samplePosition(position: vec2<f32>) -> vec2<f32> {
  return select(position, floor(position) + 0.5, uniforms.snap > 0.5);
}

fn coverage(distance: f32) -> f32 {
  let halfWidth = uniforms.size * 0.5;
  return uniforms.color.a * (1.0 - smoothstep(halfWidth - FEATHER, halfWidth + FEATHER, distance));
}

// Unit quad corners in triangle-strip order
fn quadCorner(index: u32) -> vec2<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  return corners[index];
}
`;

const POINTS = /* wgsl */ `
@group(0) @binding(1) var<storage, read> points: array<vec2<f32>>;

fn point(index: u32) -> vec2<f32> {
  return points[index];
}
`;

const AREA_POINTS = /* wgsl */ `
@group(0) @binding(1) var<storage, read> area: array<f32>;

const AREA_STRIDE: u32 = 3u;

fn point(index: u32) -> vec2<f32> {
  return vec2<f32>(area[index * AREA_STRIDE], area[index * AREA_STRIDE + 1u]);
}

fn pointBase(index: u32) -> vec2<f32> {
  return vec2<f32>(area[index * AREA_STRIDE], area[index * AREA_STRIDE + 2u]);
}
`;

export const SCATTER_SHADER = /* wgsl */ `${SHARED}${POINTS}
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) grid: vec2<f32>,
  @location(1) @interpolate(flat) center: vec2<f32>,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let center = toGrid(points[instanceIndex]);
  let radius = uniforms.size * 0.5 + padding();
  let position = center + quadCorner(vertexIndex) * radius;

  var output: VertexOutput;
  output.position = vec4<f32>(gridToClip(position), 0.0, 1.0);
  output.grid = position;
  output.center = center;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let alpha = coverage(length(samplePosition(input.grid) - input.center));
  if (alpha <= 0.0) {
    discard;
  }
  return vec4<f32>(uniforms.color.rgb * alpha, alpha);
}
`;

const LINE = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) grid: vec2<f32>,
  @location(1) @interpolate(flat) start: vec2<f32>,
  @location(2) @interpolate(flat) end: vec2<f32>,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let start = toGrid(point(instanceIndex));
  let end = toGrid(point(instanceIndex + 1u));

  var direction = end - start;
  let segmentLength = length(direction);
  direction = select(vec2<f32>(1.0, 0.0), direction / segmentLength, segmentLength > 1e-6);
  let normal = vec2<f32>(-direction.y, direction.x);

  let halfWidth = uniforms.size * 0.5 + padding();
  let corner = quadCorner(vertexIndex);
  // Extending past each end leaves room for the rounded caps that close joins
  let base = select(start, end, corner.x > 0.0);
  let position = base
    + direction * corner.x * halfWidth
    + normal * corner.y * halfWidth;

  var output: VertexOutput;
  output.position = vec4<f32>(gridToClip(position), 0.0, 1.0);
  output.grid = position;
  output.start = start;
  output.end = end;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Distance to the segment, so the ends are rounded and feathered like the sides
  let relative = samplePosition(input.grid) - input.start;
  let segment = input.end - input.start;
  let along = clamp(dot(relative, segment) / max(dot(segment, segment), 1e-12), 0.0, 1.0);
  let alpha = coverage(length(relative - segment * along));
  if (alpha <= 0.0) {
    discard;
  }
  return vec4<f32>(uniforms.color.rgb * alpha, alpha);
}
`;

export const LINE_SHADER = `${SHARED}${POINTS}${LINE}`;

/** The line along the top of an `area`, read from its three float points. */
export const AREA_LINE_SHADER = `${SHARED}${AREA_POINTS}${LINE}`;

/**
 * Fills an `area` between its points and their base. Each instance covers the
 * bounding box of one segment, and a pixel is filled when its sample lies
 * between the top and base lines over that segment. Ownership is half open in
 * both x and y, so neighbouring segments, and a stacked area and the one it
 * sits on, never both fill a pixel or leave one out. Edges are not
 * antialiased: the line drawn over the top hides the steps there.
 *
 * Colors come from up to 16 gradient stops, blended unpremultiplied like a
 * canvas gradient.
 */
export const AREA_FILL_SHADER = /* wgsl */ `${SHARED}${AREA_POINTS}
struct Fill {
  colors: array<vec4<f32>, 16>,
  offsets: array<vec4<f32>, 4>,
  // (stop count, 1 to vary along y or 0 along x, value at offset 0, value at
  // offset 1), values relative to the series origin
  gradient: vec4<f32>,
  // (opacity, unused, unused, unused)
  options: vec4<f32>,
};

@group(0) @binding(2) var<uniform> fillUniforms: Fill;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  // x of the segment's start and end, in grid pixels
  @location(0) @interpolate(flat) xs: vec2<f32>,
  // (start top, end top, start base, end base), in grid pixels
  @location(1) @interpolate(flat) ys: vec4<f32>,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let start = toGrid(point(instanceIndex));
  let end = toGrid(point(instanceIndex + 1u));
  let startBase = toGrid(pointBase(instanceIndex)).y;
  let endBase = toGrid(pointBase(instanceIndex + 1u)).y;

  let pad = padding();
  let corner = quadCorner(vertexIndex);
  let position = vec2<f32>(
    select(min(start.x, end.x) - pad, max(start.x, end.x) + pad, corner.x > 0.0),
    select(
      min(min(start.y, end.y), min(startBase, endBase)) - pad,
      max(max(start.y, end.y), max(startBase, endBase)) + pad,
      corner.y > 0.0
    )
  );

  var output: VertexOutput;
  output.position = vec4<f32>(gridToClip(position), 0.0, 1.0);
  output.xs = vec2<f32>(start.x, end.x);
  output.ys = vec4<f32>(start.y, end.y, startBase, endBase);
  return output;
}

// The grid position of a fragment, from its framebuffer position alone, so
// every segment computes the same value for a pixel. Interpolating from each
// quad's own corners rounds differently, and a pixel at a shared x would be
// filled by both segments or neither.
fn framebufferToGrid(position: vec2<f32>) -> vec2<f32> {
  let span = vec2<f32>(
    uniforms.viewport.y - uniforms.viewport.x,
    uniforms.viewport.w - uniforms.viewport.z
  );
  let data = vec2<f32>(uniforms.viewport.x, uniforms.viewport.w)
    + vec2<f32>(position.x, -position.y) / uniforms.resolution * span;
  return (data - uniforms.grid.xz) / uniforms.grid.yw;
}

fn stopOffset(index: u32) -> f32 {
  return fillUniforms.offsets[index / 4u][index % 4u];
}

fn sampleStops(offset: f32) -> vec4<f32> {
  let count = u32(fillUniforms.gradient.x);
  var color = fillUniforms.colors[0];
  for (var i = 1u; i < count; i = i + 1u) {
    let previous = stopOffset(i - 1u);
    let next = stopOffset(i);
    if (offset >= next) {
      color = fillUniforms.colors[i];
    } else {
      if (offset > previous) {
        color = mix(fillUniforms.colors[i - 1u], fillUniforms.colors[i], (offset - previous) / (next - previous));
      }
      break;
    }
  }
  return color;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let samplePoint = samplePosition(framebufferToGrid(input.position.xy));
  let left = min(input.xs.x, input.xs.y);
  let right = max(input.xs.x, input.xs.y);
  // Written so NaN, from a missing value, fails and discards
  if (!(samplePoint.x >= left && samplePoint.x < right)) {
    discard;
  }
  let t = (samplePoint.x - input.xs.x) / (input.xs.y - input.xs.x);
  let top = mix(input.ys.x, input.ys.y, t);
  let base = mix(input.ys.z, input.ys.w, t);
  if (!(samplePoint.y >= min(top, base) && samplePoint.y < max(top, base))) {
    discard;
  }
  let data = samplePoint * uniforms.grid.yw + uniforms.grid.xz;
  let along = select(data.x, data.y, fillUniforms.gradient.y > 0.5);
  let color = sampleStops((along - fillUniforms.gradient.z) / (fillUniforms.gradient.w - fillUniforms.gradient.z));
  let alpha = color.a * fillUniforms.options.x;
  return vec4<f32>(color.rgb * alpha, alpha);
}
`;

/**
 * Draws `ohlc` and `candlestick` bars. Every bar is a few axis aligned
 * strokes, one instance each: an `ohlc` bar is a line from low to high plus
 * ticks left at the open and right at the close; a `candlestick` is the same
 * line plus a body from open to close. Ends are square, like a canvas `butt`
 * cap, and a body is outlined by half the line width so a flat one still shows.
 */
export const OHLC_SHADER = /* wgsl */ `${SHARED}
@group(0) @binding(1) var<storage, read> bars: array<f32>;

const BAR_STRIDE: u32 = 5u;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) grid: vec2<f32>,
  @location(1) @interpolate(flat) start: vec2<f32>,
  @location(2) @interpolate(flat) direction: vec2<f32>,
  // (length, half width across, overhang past each end), in grid pixels
  @location(3) @interpolate(flat) extent: vec3<f32>,
  @location(4) @interpolate(flat) color: vec4<f32>,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let isCandlestick = uniforms.bar.y > 0.5;
  let parts = select(3u, 2u, isCandlestick);
  let base = (instanceIndex / parts) * BAR_STRIDE;
  let part = instanceIndex % parts;
  let x = bars[base];
  let barOpen = bars[base + 1u];
  let barHigh = bars[base + 2u];
  let barLow = bars[base + 3u];
  let barClose = bars[base + 4u];
  let halfBar = uniforms.bar.x;
  let halfLine = uniforms.size * 0.5;

  // Strokes run up or right from start to end
  var start = vec2<f32>(x, min(barLow, barHigh));
  var end = vec2<f32>(x, max(barLow, barHigh));
  var direction = vec2<f32>(0.0, 1.0);
  var halfWidth = halfLine;
  var overhang = 0.0;
  if (part == 1u && isCandlestick) {
    start = vec2<f32>(x, min(barOpen, barClose));
    end = vec2<f32>(x, max(barOpen, barClose));
    halfWidth = halfBar / uniforms.grid.y + halfLine;
    overhang = halfLine;
  } else if (part == 1u) {
    start = vec2<f32>(x - halfBar, barOpen);
    end = vec2<f32>(x, barOpen);
    direction = vec2<f32>(1.0, 0.0);
  } else if (part == 2u) {
    start = vec2<f32>(x, barClose);
    end = vec2<f32>(x + halfBar, barClose);
    direction = vec2<f32>(1.0, 0.0);
  }
  let gridStart = toGrid(start);
  let strokeLength = max(dot(toGrid(end) - gridStart, direction), 0.0);
  let normal = vec2<f32>(-direction.y, direction.x);

  let corner = quadCorner(vertexIndex);
  let pad = padding();
  let along = select(-overhang - pad, strokeLength + overhang + pad, corner.x > 0.0);
  let position = gridStart
    + direction * along
    + normal * corner.y * (halfWidth + pad);

  var output: VertexOutput;
  output.position = vec4<f32>(gridToClip(position), 0.0, 1.0);
  output.grid = position;
  output.start = gridStart;
  output.direction = direction;
  output.extent = vec3<f32>(strokeLength, halfWidth, overhang);
  // Matches isOhlcBarIncreasing, so a NaN open or close counts as increasing
  output.color = select(uniforms.color, uniforms.decreasingColor, barClose < barOpen);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let point = samplePosition(input.grid) - input.start;
  let along = dot(point, input.direction);
  let across = abs(dot(point, vec2<f32>(-input.direction.y, input.direction.x)));
  // How far past either end, negative inside
  let beyond = max(-along, along - input.extent.x);
  let alpha = input.color.a
    * (1.0 - smoothstep(input.extent.y - FEATHER, input.extent.y + FEATHER, across))
    * (1.0 - smoothstep(input.extent.z - FEATHER, input.extent.z + FEATHER, beyond));
  if (alpha <= 0.0) {
    discard;
  }
  return vec4<f32>(input.color.rgb * alpha, alpha);
}
`;
