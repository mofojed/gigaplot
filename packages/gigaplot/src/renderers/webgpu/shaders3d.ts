/**
 * WGSL shaders for the 3D WebGPU renderer.
 *
 * Points live in a storage buffer as `vec4<f32>`: x, y, and z relative to a
 * per series origin, and w, 1 for a point to draw or 0 for a gap. The origin
 * is folded into the matrix on the CPU in 64 bit floats, which keeps values
 * like epoch timestamps precise. WGSL does not reliably keep NaN checks, so
 * gaps are flagged in w rather than left as NaN.
 *
 * Each shader is drawn twice. `depthMain` first writes the depth of every
 * pixel drawn at least half opaque, with color writes masked off, then
 * `fragmentMain` draws color, depth tested but not writing depth. Nearer data
 * then covers farther data whatever order it is drawn in, while antialiased
 * edges still blend. Writing depth from the edges too would let a point's
 * faint fringe hide whatever is drawn behind it later, leaving a dark ring.
 */

const SHARED_3D = /* wgsl */ `
struct Uniforms {
  // Data, relative to the series origin, to clip space
  matrix: mat4x4<f32>,
  color: vec4<f32>,
  // Size of the canvas in device pixels
  resolution: vec2<f32>,
  // Point diameter or line width in device pixels
  size: f32,
  // Distance to the box center when points scale with perspective, else 0
  referenceDepth: f32,
  // (nearest depth, farthest depth, how much the farthest fades, largest point size)
  fade: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> points: array<vec4<f32>>;

// Distance the antialiased edge fades over on each side, in device pixels
const FEATHER: f32 = 0.75;

fn fadeOpacity(depth: f32) -> f32 {
  let span = max(uniforms.fade.y - uniforms.fade.x, 1e-6);
  let t = clamp((depth - uniforms.fade.x) / span, 0.0, 1.0);
  return 1.0 - uniforms.fade.z * t;
}

fn coverage(halfWidth: f32, distance: f32) -> f32 {
  return 1.0 - smoothstep(halfWidth - FEATHER, halfWidth + FEATHER, distance);
}

// Pixels at least this opaque hide what is behind them
const OPAQUE: f32 = 0.5;

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

// Outside every clip plane, so nothing of it is drawn
const CULLED: vec4<f32> = vec4<f32>(2.0, 2.0, 2.0, 1.0);
`;

export const SCATTER_3D_SHADER = /* wgsl */ `${SHARED_3D}
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  // Offset from the point's center in device pixels
  @location(0) offset: vec2<f32>,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) opacity: f32,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let point = points[instanceIndex];
  let clip = uniforms.matrix * vec4<f32>(point.xyz, 1.0);

  var output: VertexOutput;
  if (point.w < 0.5 || clip.w <= 0.0) {
    output.position = CULLED;
    return output;
  }
  var size = uniforms.size;
  if (uniforms.referenceDepth > 0.0) {
    size = min(size * uniforms.referenceDepth / clip.w, uniforms.fade.w);
  }
  let radius = size * 0.5;
  // Padded so the antialiased edge is not clipped
  let offset = quadCorner(vertexIndex) * (radius + FEATHER + 0.25);
  // Offsetting in clip space scaled by w keeps the quad a fixed size on screen
  let ndcOffset = offset * 2.0 / uniforms.resolution;
  output.position = vec4<f32>(clip.xy + ndcOffset * clip.w, clip.zw);
  output.offset = offset;
  output.radius = radius;
  output.opacity = fadeOpacity(clip.w);
  return output;
}

fn pointAlpha(input: VertexOutput) -> f32 {
  return uniforms.color.a * input.opacity
    * coverage(input.radius, length(input.offset));
}

@fragment
fn depthMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (pointAlpha(input) < OPAQUE) {
    discard;
  }
  return vec4<f32>(0.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let alpha = pointAlpha(input);
  if (alpha <= 0.0) {
    discard;
  }
  return vec4<f32>(uniforms.color.rgb * alpha, alpha);
}
`;

export const LINE_3D_SHADER = /* wgsl */ `${SHARED_3D}
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  // Device pixels from the bottom left of the canvas
  @location(0) pixel: vec2<f32>,
  @location(1) @interpolate(flat) start: vec2<f32>,
  @location(2) @interpolate(flat) end: vec2<f32>,
  @location(3) @interpolate(flat) opacity: f32,
};

fn toPixel(clip: vec4<f32>) -> vec2<f32> {
  return (clip.xy / clip.w * 0.5 + 0.5) * uniforms.resolution;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let first = points[instanceIndex];
  let second = points[instanceIndex + 1u];
  var a = uniforms.matrix * vec4<f32>(first.xyz, 1.0);
  var b = uniforms.matrix * vec4<f32>(second.xyz, 1.0);

  var output: VertexOutput;
  // Clip space z is negative behind the near plane
  if (first.w < 0.5 || second.w < 0.5 || (a.z < 0.0 && b.z < 0.0)) {
    output.position = CULLED;
    return output;
  }
  // Cut a segment crossing the near plane where it crosses, since its far
  // end projected through the camera would land on the wrong side
  if (a.z < 0.0) {
    a = mix(a, b, a.z / (a.z - b.z));
  } else if (b.z < 0.0) {
    b = mix(b, a, b.z / (b.z - a.z));
  }

  let start = toPixel(a);
  let end = toPixel(b);
  var direction = end - start;
  let segmentLength = length(direction);
  direction = select(vec2<f32>(1.0, 0.0), direction / segmentLength, segmentLength > 1e-6);
  let normal = vec2<f32>(-direction.y, direction.x);

  let halfWidth = uniforms.size * 0.5 + FEATHER + 0.25;
  let corner = quadCorner(vertexIndex);
  // Extending past each end leaves room for the rounded caps that close joins
  let isEnd = corner.x > 0.0;
  let pixel = select(start, end, isEnd)
    + direction * corner.x * halfWidth
    + normal * corner.y * halfWidth;
  let endpoint = select(a, b, isEnd);

  output.position = vec4<f32>(
    pixel / uniforms.resolution * 2.0 - 1.0,
    endpoint.z / endpoint.w,
    1.0
  );
  output.pixel = pixel;
  output.start = start;
  output.end = end;
  output.opacity = fadeOpacity((a.w + b.w) * 0.5);
  return output;
}

fn segmentAlpha(input: VertexOutput) -> f32 {
  // Distance to the segment, so the ends are rounded and feathered like the sides
  let relative = input.pixel - input.start;
  let segment = input.end - input.start;
  let along = clamp(dot(relative, segment) / max(dot(segment, segment), 1e-12), 0.0, 1.0);
  return uniforms.color.a * input.opacity
    * coverage(uniforms.size * 0.5, length(relative - segment * along));
}

@fragment
fn depthMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (segmentAlpha(input) < OPAQUE) {
    discard;
  }
  return vec4<f32>(0.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let alpha = segmentAlpha(input);
  if (alpha <= 0.0) {
    discard;
  }
  return vec4<f32>(uniforms.color.rgb * alpha, alpha);
}
`;
