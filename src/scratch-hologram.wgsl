struct Parameters {
  camera: vec4f,
  light: vec4f,
  discX: vec4f,
  discY: vec4f,
  normal: vec4f,
  right: vec4f,
  up: vec4f,
  settings: vec4f,
}
struct Scratch {
  circle: vec4f,
  facet: vec4f,
}
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage, read> scratches: array<Scratch>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;

fn unit(v: vec3f) -> vec3f {
  return v / max(length(v), 1e-9);
}
fn local(v: vec3f) -> vec3f {
  return vec3f(dot(v, params.discX.xyz), dot(v, params.discY.xyz), dot(v, params.normal.xyz));
}
fn vinylWave(radius: f32, frequency: f32) -> f32 {
  let phase = frequency * params.discY.w * 0.5;
  if phase >= 1.570796327 { return 0.0; }
  let coverage = sin(max(phase, 0.0001)) / max(phase, 0.0001);
  let fade = clamp((phase / 1.570796327 - 0.65) / 0.35, 0.0, 1.0);
  return cos(radius * frequency) * coverage * (1.0 - fade * fade * (3.0 - 2.0 * fade));
}
fn filteredWave(coordinate: f32, frequency: f32) -> f32 {
  let phase = frequency * params.discY.w;
  return cos(coordinate * frequency) * exp(-0.5 * phase * phase);
}
fn lobe(h: vec3f, along: vec3f, across: vec3f, ra: f32, rb: f32) -> f32 {
  if h.z <= 0.0 { return 0.0; }
  let a = dot(h, along) / (ra * h.z);
  let b = dot(h, across) / (rb * h.z);
  return exp(-(a * a + b * b));
}
fn shade(p: vec3f, camera: vec3f, light: vec3f) -> vec3f {
  let r = length(p.xy);
  let l = unit(light - p);
  let v = unit(camera - p);
  let h = unit(l + v);
  let distance = length(light - p);
  let attenuation = 16.0 / (distance * distance);
  let incidence = max(l.z, 0.0) * attenuation;
  let vinyl = params.settings.y < 0.5;
  var color: vec3f;
  if vinyl {
    let radial = unit(vec3f(p.xy, 0.0));
    let tangent = vec3f(-radial.y, radial.x, 0.0);
    let w0 = vinylWave(r, 320.0);
    let w1 = vinylWave(r, 900.0);
    let w2 = vinylWave(r, 1800.0);
    let rings = w0 * 0.25 + w1 * 0.65 + w2 * 0.1;
    let wave = w0 * 0.002 + w1 * 0.008 + w2 * 0.0025;
    let nh = unit(h - radial * wave);
    let sheen = lobe(nh, tangent, radial, 0.045, 0.34);
    let base = 0.0016 + (0.0007 + 0.0012 * rings) * incidence;
    let highlight = 0.048 * sheen * incidence * (0.78 + 0.22 * rings);
    color = vec3f(base + highlight, base + highlight, base * 1.04 + highlight);
  } else {
    let brush = filteredWave(p.y, 180.0) * 0.7 + filteredWave(p.y, 930.0) * 0.3;
    let sheen = lobe(h, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), 0.09, 0.46);
    let base = 0.035 + (0.085 + 0.009 * brush) * incidence;
    let highlight = 0.38 * sheen * incidence * (0.9 + 0.1 * brush);
    color = vec3f(base + highlight, base * 1.02 + highlight, base * 1.04 + highlight);
  }
  let cell = vec2i(floor((p.xy + vec2f(1.08)) / 2.16 * 64.0));
  let support = 0.0022 + params.discY.w * 0.55;
  let sigma = params.light.w;
  var lines = 0.0;
  var specular = 0.0;
  if all(cell >= vec2i(0)) && all(cell < vec2i(64)) {
    let index = u32(cell.y * 64 + cell.x);
    let end = offsets[index + 1u];
    for (var i = offsets[index]; i < end; i += 1u) {
      let s = scratches[indices[i]];
      let delta = p.xy - s.circle.xy;
      let rr2 = dot(delta, delta);
      let lo = max(s.circle.z - support, 0.0);
      let hi = s.circle.z + support;
      if rr2 < lo * lo || rr2 > hi * hi { continue; }
      let along = dot(delta, vec2f(s.circle.w, s.facet.x));
      if along < 0.0 || along * along < rr2 * params.normal.w * params.normal.w { continue; }
      let rr = sqrt(rr2);
      if rr < 1e-6 { continue; }
      let axis = delta / rr;
      if dot(axis, vec2f(s.circle.w, s.facet.x)) < params.normal.w { continue; }
      let coverage = max(1.0 - abs(rr - s.circle.z) / support, 0.0) * (0.0022 / support);
      lines += coverage;
      let tangent = vec3f(axis.y, -axis.x, 0.0);
      var normal = unit(h - tangent * dot(h, tangent));
      if params.right.w > 0.5 {
        normal = unit(vec3f(axis * s.facet.y, 1.0));
      }
      let nl = dot(normal, l);
      if normal.z < 0.12 || nl <= 0.0 { continue; }
      let reflection = normal * (2.0 * nl) - l;
      let mismatch = max(1.0 - dot(reflection, v), 0.0);
      let response = exp(-mismatch / (sigma * sigma * 0.5));
      specular += coverage * response * sqrt(0.018 / sigma) * nl * attenuation;
    }
  }
  if params.settings.z > 0.5 {
    color += vec3f(0.35, 0.37, 0.39) * min(lines, 1.0);
  } else {
    if vinyl { color += vec3f(0.002 * min(lines, 2.0)); }
    else { color *= 1.0 - min(lines, 1.0) * 0.28; }
    color += vec3f(1.0, 0.96, 0.87) * specular * 3.5;
  }
  if r > 0.982 {
    let a = clamp((r - 0.982) / 0.018, 0.0, 1.0) * 1.25;
    let normal = unit(vec3f(p.xy / r * sin(a), cos(a)));
    let rim = pow(max(dot(normal, h), 0.0), 40.0);
    color += vec3f(rim * select(0.22, 0.018, vinyl));
  }
  return color;
}
fn traceDisc(origin: vec3f, ray: vec3f, light: vec3f) -> vec4f {
  let t = -origin.z / ray.z;
  if t > 0.0 && origin.z >= 0.0 {
    let p = origin + ray * t;
    if dot(p.xy, p.xy) <= 1.0 { return vec4f(shade(p, origin, light), 1.0); }
  }
  let back = (-0.045 - origin.z) / ray.z;
  if back > 0.0 && origin.z < 0.0 {
    let p = origin + ray * back;
    if dot(p.xy, p.xy) <= 1.0 {
      return vec4f(vec3f(select(0.065, 0.0016, params.settings.y < 0.5)), 1.0);
    }
  }
  let a = dot(ray.xy, ray.xy);
  let b = 2.0 * dot(origin.xy, ray.xy);
  let c = dot(origin.xy, origin.xy) - 1.0;
  let discriminant = b * b - 4.0 * a * c;
  if a > 1e-8 && discriminant > 0.0 {
    let root = sqrt(discriminant);
    for (var i = 0u; i < 2u; i += 1u) {
      let tt = (-b + select(-root, root, i == 1u)) / (2.0 * a);
      if tt <= 0.0 { continue; }
      let p = origin + ray * tt;
      if p.z >= -0.045 && p.z < 0.0 {
        let n = unit(vec3f(p.xy, 0.0));
        let h = unit(unit(light - p) + unit(origin - p));
        let rim = pow(max(dot(n, h), 0.0), 24.0);
        let k = select(0.07 + rim * 0.36, 0.0018 + rim * 0.024, params.settings.y < 0.5);
        return vec4f(vec3f(k), 1.0);
      }
    }
  }
  return vec4f(0.0);
}
fn trace(origin: vec3f, ray: vec3f, light: vec3f) -> vec4f {
  let disc = traceDisc(local(origin), local(ray), local(light));
  if disc.a > 0.0 {
    let exposed = max(disc.rgb * 1.75, vec3f(0.0));
    let mapped = exposed / (vec3f(1.0) + exposed);
    return vec4f(floor(pow(mapped, vec3f(1.0 / 2.2)) * 255.0) / 255.0, 1.0);
  }
  let wallZ = params.discX.w;
  let tg = (wallZ - origin.z) / ray.z;
  if tg <= 0.0 { return vec4f(0.0); }
  let p = origin + ray * tg;
  let toLight = light - p;
  let incidence = max(toLight.z / max(length(toLight), 1e-5), 0.0);
  if incidence <= 0.0 || light.z <= 0.01 { return vec4f(0.0); }
  let lp = local(p);
  let at = -lp.z / local(toLight).z;
  let softness = clamp(0.04 + params.light.w * (-wallZ) * 6.0, 0.04, 0.24);
  var visibility = 1.0;
  if at > 0.0 && at < 1.0 {
    let blocked = lp + local(toLight) * at;
    let edge = clamp((length(blocked.xy) - 1.0 + softness) / (2.0 * softness), 0.0, 1.0);
    visibility = edge * edge * (3.0 - 2.0 * edge);
  }
  let beamCenter = light * (wallZ / light.z);
  let radius = length(p - beamCenter) / (1.8 + (-wallZ - 0.32) * 0.15);
  let falloff = pow(clamp(1.0 - radius * radius, 0.0, 1.0), 2.0);
  let shadowAlpha = 0.22 * (1.0 - visibility);
  let lightAlpha = 0.105 * incidence * visibility * falloff;
  let alpha = lightAlpha + shadowAlpha * (1.0 - lightAlpha);
  let value = lightAlpha / max(alpha, 1e-9);
  let a = round(alpha * 255.0) / 255.0;
  // The canvas consumes premultiplied alpha; exports remain transparent.
  return vec4f(vec3f(floor(value * 255.0) / 255.0 * a), a);
}
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[i], 0.0, 1.0);
}
@fragment fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let fov = params.camera.w;
  let sx = (2.0 * pixel.x / params.up.w - 1.0) * (params.up.w / params.settings.x) * fov;
  let sy = (1.0 - 2.0 * pixel.y / params.settings.x) * fov + select(0.0, fov, params.right.w > 0.5);
  let ray = unit(-unit(params.camera.xyz) + params.right.xyz * sx + params.up.xyz * sy);
  return trace(params.camera.xyz, ray, params.light.xyz);
}
