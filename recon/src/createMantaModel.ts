import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: Math.max(1, readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: Math.max(1, readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clamp01(readLayerNumber(spec.specularIntensity, ['base'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Manta Delta Star Freighter
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMantaDeltaStarFreighterModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Manta Delta Star Freighter";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 26.0, "aspect": 2.0, "orientation": {"yaw": 96.0, "pitch": -7.0, "roll": 0.0}, "positionHint": [1.4, 2.2, 19.5], "note": "Near-side (port-beam) elevation, slightly below the dorsal plane and yawed a few degrees off pure beam. Narrow FOV because the reference is close to orthographic. INFERRED from silhouette extents, not solved - refine against the comparison sheet."}, "approximationNotes": ["PLANFORM (wing chord, sweep, span) is inferred from a single port-beam elevation. Confidence 0.45. Every planform number is an assumption, not a measurement.", "Starboard flank is mirrored from port; no starboard evidence exists.", "The reference is a cel illustration, so 'material evidence' is flat drawn colour, not photographic PBR. extract_pbr_evidence would return inference about a drawing, not about a surface; the palette is instead sampled directly with ink-line rejection.", "The stern nozzle is modelled as nested triangular prisms rather than a lathed bell, matching the reference's triangular concentric banding.", "Repetition systems are declared with linear/staggered placement; the stock emitter is radial-only, so they are realised as explicitly placed components carrying the same placement data."]};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hull-cream"] = createSculptMaterial(
    "hull-cream",
    {"id": "hull-cream", "name": "Hull plating cream", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#f8f4d9", "color": "#f8f4d9", "albedo": {"dominant": "#f8f4d9", "secondary": ["#fcf7e1", "#e8e2c2"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#f8f4d9", "#fcf7e1", "#e8e2c2"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.7, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "panel-line-seams", "kind": "linework", "technique": "panel-line", "region": "all hull and wing skins", "colorShift": "#3a3428", "width": 0.006, "notes": "Dark AO seam following plate boundaries; no true groove depth.", "detailRefs": ["d02"]}, {"id": "hull-yellow-staining", "kind": "stain", "region": "dorsal deck and wing top skins", "dirtAmount": 0.22, "cavityBias": 0.35, "streak": false, "patinaColor": "#d8c063", "fadedMask": 0.0, "detailRefs": ["d03"]}, {"id": "hull-speckle", "kind": "stain", "region": "dorsal deck", "dirtAmount": 0.12, "cavityBias": 0.0, "streak": false, "patinaColor": "#2a251c", "detailRefs": ["d18"]}, {"id": "blue-bar-decal", "kind": "linework", "technique": "painted-decal", "region": "mid dorsal hull, X=+0.35..+0.62", "colorShift": "#3153b4", "detailRefs": ["d08"]}], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Dominant hull skin. Reference shows 2 value steps: lit #fcf7e1, mid #f8f4d9.", "evidenceRefs": ["full-object"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/hull-cream.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/hull-cream/hull-cream_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/hull-cream/hull-cream_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/hull-cream/hull-cream_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/hull-cream/hull-cream_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/hull-cream/hull-cream_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["hull-grey"] = createSculptMaterial(
    "hull-grey",
    {"id": "hull-grey", "name": "Structural warm grey", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#7e776d", "color": "#7e776d", "albedo": {"dominant": "#7e776d", "secondary": ["#9a9288", "#5f594f"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#7e776d", "#9a9288", "#5f594f"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.72, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Shadowed flank facets, keel fin underside, wing undersurface.", "evidenceRefs": ["bow-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/hull-grey.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/hull-grey/hull-grey_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/hull-grey/hull-grey_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/hull-grey/hull-grey_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/hull-grey/hull-grey_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/hull-grey/hull-grey_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["pod-yellow"] = createSculptMaterial(
    "pod-yellow",
    {"id": "pod-yellow", "name": "Bladder pod yellow", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#e9b708", "color": "#e9b708", "albedo": {"dominant": "#e9b708", "secondary": ["#ae8100", "#f2ce3a"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#e9b708", "#ae8100", "#f2ce3a"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.48, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "pod-slash-highlights", "kind": "gloss", "region": "pod crowns", "roughness": 0.16, "clearcoat": 0.0, "notes": "Painted white slash, not a physical specular lobe.", "detailRefs": ["d06"]}], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Satin: reference carries painted white slash highlights, so one gloss step above hull.", "evidenceRefs": ["belly-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/pod-yellow.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.84, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/pod-yellow/pod-yellow_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/pod-yellow/pod-yellow_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/pod-yellow/pod-yellow_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/pod-yellow/pod-yellow_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/pod-yellow/pod-yellow_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["vane-yellow"] = createSculptMaterial(
    "vane-yellow",
    {"id": "vane-yellow", "name": "Radiator vane yellow", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#d6b301", "color": "#d6b301", "albedo": {"dominant": "#d6b301", "secondary": ["#a88c00"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#d6b301", "#a88c00"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Flat cel fill sampled from the reference at #d6b301.", "evidenceRefs": ["stern-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/vane-yellow.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/vane-yellow/vane-yellow_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/vane-yellow/vane-yellow_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/vane-yellow/vane-yellow_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/vane-yellow/vane-yellow_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/vane-yellow/vane-yellow_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["machine-grey"] = createSculptMaterial(
    "machine-grey",
    {"id": "machine-grey", "name": "Machined fitting grey", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#535a60", "color": "#535a60", "albedo": {"dominant": "#535a60", "secondary": ["#6d757c", "#3b4147"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#535a60", "#6d757c", "#3b4147"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.4, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.65, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Cool grey, distinct in hue from the warm structural grey.", "evidenceRefs": ["mast-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/machine-grey.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/machine-grey/machine-grey_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/machine-grey/machine-grey_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/machine-grey/machine-grey_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/machine-grey/machine-grey_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/machine-grey/machine-grey_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["accent-blue"] = createSculptMaterial(
    "accent-blue",
    {"id": "accent-blue", "name": "Accent enamel blue", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#3153b4", "color": "#3153b4", "albedo": {"dominant": "#3153b4", "secondary": ["#4760de"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#3153b4", "#4760de"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.5, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Flat cel fill sampled from the reference at #3153b4.", "evidenceRefs": ["stern-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/accent-blue.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/accent-blue/accent-blue_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/accent-blue/accent-blue_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/accent-blue/accent-blue_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/accent-blue/accent-blue_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/accent-blue/accent-blue_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["accent-red"] = createSculptMaterial(
    "accent-red",
    {"id": "accent-red", "name": "Accent enamel red", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#971809", "color": "#971809", "albedo": {"dominant": "#971809", "secondary": ["#b42c2c"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#971809", "#b42c2c"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.5, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "nozzle-concentric-bands", "kind": "linework", "technique": "painted-decal", "region": "stern nozzle throat", "colorShift": "#971809 -> #3153b4 -> #dfb000", "detailRefs": ["d11"]}], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Flat cel fill sampled from the reference at #971809.", "evidenceRefs": ["stern-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/accent-red.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/accent-red/accent-red_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/accent-red/accent-red_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/accent-red/accent-red_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/accent-red/accent-red_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/accent-red/accent-red_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["accent-gold"] = createSculptMaterial(
    "accent-gold",
    {"id": "accent-gold", "name": "Pivot boss gold", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#947204", "color": "#947204", "albedo": {"dominant": "#947204", "secondary": ["#c79a12"], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#947204", "#c79a12"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.35, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.7, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Flat cel fill sampled from the reference at #947204.", "evidenceRefs": ["mast-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/accent-gold.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/accent-gold/accent-gold_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/accent-gold/accent-gold_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/accent-gold/accent-gold_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/accent-gold/accent-gold_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/accent-gold/accent-gold_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["accent-teal"] = createSculptMaterial(
    "accent-teal",
    {"id": "accent-teal", "name": "Coolant strip teal", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#1f8f7a", "color": "#1f8f7a", "albedo": {"dominant": "#1f8f7a", "secondary": [], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#1f8f7a"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.45, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Flat cel fill sampled from the reference at #1f8f7a.", "evidenceRefs": ["mast-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/accent-teal.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/accent-teal/accent-teal_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/accent-teal/accent-teal_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/accent-teal/accent-teal_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/accent-teal/accent-teal_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/accent-teal/accent-teal_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );
  materialMap["glass-dark"] = createSculptMaterial(
    "glass-dark",
    {"id": "glass-dark", "name": "Canopy glazing", "type": "toon", "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline", "baseColor": "#242a30", "color": "#242a30", "albedo": {"dominant": "#242a30", "secondary": [], "samplingNotes": "Sampled from the reference with ink-line rejection (recon/ colour probe)."}, "colorVariation": {"palette": ["#242a30"], "pattern": "flat-cel-steps", "amplitude": 0.06, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.15, "variation": 0.05, "map": "none-flat-cel", "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25, "notes": "Kept low: the reference conveys depth with ink contour, not AO."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).", "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.", "Do NOT add environment reflections - the reference medium has no specular lobe."], "notes": "Near-black tinted blister; reference shows a hard white slash highlight, no transmission.", "evidenceRefs": ["bow-zone"], "referencePbr": {"version": "1.0", "sourceImage": "recon/matcrops/glass-dark.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image statistical inference over an ink-and-flat-fill illustration crop", "verdict": "usable", "hardLimit": "The reference is a drawing, not a photograph: extracted roughness/normal/AO describe brush and ink texture, not a physical surface. Only the albedo and the ABSENCE of a specular lobe are treated as load-bearing evidence; the relief maps are deliberately not wired into the toon materials.", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.72, "targetThreshold": 0.7, "mapsWithheldForCelPath": {"albedo": {"path": "recon/pbr/glass-dark/glass-dark_albedo.png", "channel": "rgb"}, "roughness": {"path": "recon/pbr/glass-dark/glass-dark_roughness.png", "channel": "r"}, "height": {"path": "recon/pbr/glass-dark/glass-dark_height.png", "channel": "r"}, "normal": {"path": "recon/pbr/glass-dark/glass-dark_normal.png", "channel": "rgb"}, "ao": {"path": "recon/pbr/glass-dark/glass-dark_ao.png", "channel": "r"}}, "mapsWithheldReason": "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Internal spine__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, -0.06);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Internal spine", "level": "macro", "role": "body", "logicalParent": null, "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Structural spine running the length of the fish, hidden inside the body sections. Kept scale-neutral so it can parent the rest of the tree without distorting it.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-4.91, 0.165], [-4.48, 0.259], [-3.6, 0.286], [-2.73, 0.259], [-1.85, 0.275], [-0.98, 0.286], [-0.1, 0.264], [0.77, 0.231], [1.65, 0.198], [2.52, 0.165], [3.4, 0.116], [4.27, 0.05], [4.71, 0.011], [4.71, -0.011], [4.27, -0.044], [3.4, -0.105], [2.52, -0.165], [1.65, -0.187], [0.77, -0.121], [-0.1, -0.099], [-0.98, -0.099], [-1.85, -0.11], [-2.73, -0.132], [-3.6, -0.099], [-4.48, -0.011]], "depth": 0.12}}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, -0.06], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "deck-plate-ridges", "kind": "seam", "description": "transverse plate seams dividing the hull into bands along its length", "detailRefs": ["d05"]}, {"id": "spar-rivet-rows", "kind": "fastener", "description": "fastener dot rows along the flank rails", "detailRefs": ["d04"]}, {"id": "outline-shell", "kind": "contour", "description": "inverted-hull ink contour carried on the outer silhouette AND every interior part boundary, matching the reference's drawn line", "outlineWidth": 0.012, "outlineColor": "#1a1410", "detailRefs": ["d01"]}, {"id": "tail-needle-taper", "kind": "bevel", "description": "trailing taper converging to a needle point; chamfer collapses to zero at the tip", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object", "bow-zone"], "details": ["d02", "d03", "d05", "d18"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_root_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-4.91, 0.165], [-4.48, 0.259], [-3.6, 0.286], [-2.73, 0.259], [-1.85, 0.275], [-0.98, 0.286], [-0.1, 0.264], [0.77, 0.231], [1.65, 0.198], [2.52, 0.165], [3.4, 0.116], [4.27, 0.05], [4.71, 0.011], [4.71, -0.011], [4.27, -0.044], [3.4, -0.105], [2.52, -0.165], [1.65, -0.187], [0.77, -0.121], [-0.1, -0.099], [-0.98, -0.099], [-1.85, -0.11], [-2.73, -0.132], [-3.6, -0.099], [-4.48, -0.011]], "depth": 0.12});
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Internal spine";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Internal spine", "level": "macro", "role": "body", "logicalParent": null, "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Structural spine running the length of the fish, hidden inside the body sections. Kept scale-neutral so it can parent the rest of the tree without distorting it.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-4.91, 0.165], [-4.48, 0.259], [-3.6, 0.286], [-2.73, 0.259], [-1.85, 0.275], [-0.98, 0.286], [-0.1, 0.264], [0.77, 0.231], [1.65, 0.198], [2.52, 0.165], [3.4, 0.116], [4.27, 0.05], [4.71, 0.011], [4.71, -0.011], [4.27, -0.044], [3.4, -0.105], [2.52, -0.165], [1.65, -0.187], [0.77, -0.121], [-0.1, -0.099], [-0.98, -0.099], [-1.85, -0.11], [-2.73, -0.132], [-3.6, -0.099], [-4.48, -0.011]], "depth": 0.12}}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, -0.06], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "deck-plate-ridges", "kind": "seam", "description": "transverse plate seams dividing the hull into bands along its length", "detailRefs": ["d05"]}, {"id": "spar-rivet-rows", "kind": "fastener", "description": "fastener dot rows along the flank rails", "detailRefs": ["d04"]}, {"id": "outline-shell", "kind": "contour", "description": "inverted-hull ink contour carried on the outer silhouette AND every interior part boundary, matching the reference's drawn line", "outlineWidth": 0.012, "outlineColor": "#1a1410", "detailRefs": ["d01"]}, {"id": "tail-needle-taper", "kind": "bevel", "description": "trailing taper converging to a needle point; chamfer collapses to zero at the tip", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object", "bow-zone"], "details": ["d02", "d03", "d05", "d18"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_01_1 = {"parentId": "root", "parentSocket": "root/body-section-01-mount", "structuralParent": "root", "localStart": [-4.7, 0.182, 0.475], "localEnd": [-4.7, 0.182, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_01_1 = makeAttachmentEndpoint(attachment_body_section_01_1);
  const node_body_section_01_1 = new THREE.Group();
  node_body_section_01_1.name = "Body section 1__pivot";
  if (endpoint_body_section_01_1) {
    node_body_section_01_1.position.copy(endpoint_body_section_01_1.start);
    node_body_section_01_1.rotation.set(0, 0, 0);
    node_body_section_01_1.scale.set(1, 1, 1);
  } else {
    node_body_section_01_1.position.set(-4.7, 0.182, 0.475);
    node_body_section_01_1.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_01_1.scale.set(0.417, 0.445, 0.093);
  }
  node_body_section_01_1.userData.sculptComponent = {"id": "body-section-01", "name": "Body section 1", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-01-mount", "structuralParent": "root", "localStart": [-4.7, 0.182, 0.475], "localEnd": [-4.7, 0.182, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.417, "height": 0.445, "depth": 0.093, "units": "relative", "confidence": 0.5}, "transform": {"position": [-4.7, 0.182, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_01_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_01_1);
  nodes["body-section-01"] = node_body_section_01_1;
  const mesh_body_section_01_1Geometry = endpoint_body_section_01_1
    ? new THREE.CylinderGeometry(endpoint_body_section_01_1.endRadius, endpoint_body_section_01_1.baseRadius, endpoint_body_section_01_1.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_01_1 = new THREE.Mesh(
    mesh_body_section_01_1Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_01_1.name = "Body section 1";
  if (endpoint_body_section_01_1) {
    mesh_body_section_01_1.position.copy(endpoint_body_section_01_1.midpoint);
    mesh_body_section_01_1.quaternion.copy(endpoint_body_section_01_1.quaternion);
  }
  mesh_body_section_01_1.castShadow = options.castShadow ?? true;
  mesh_body_section_01_1.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_01_1.userData.sculptComponent = {"id": "body-section-01", "name": "Body section 1", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-01-mount", "structuralParent": "root", "localStart": [-4.7, 0.182, 0.475], "localEnd": [-4.7, 0.182, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.417, "height": 0.445, "depth": 0.093, "units": "relative", "confidence": 0.5}, "transform": {"position": [-4.7, 0.182, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_01_1.add(mesh_body_section_01_1);
  meshes["body-section-01"] = mesh_body_section_01_1;
  colliders["body-section-01"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_02_2 = {"parentId": "root", "parentSocket": "root/body-section-02-mount", "structuralParent": "root", "localStart": [-4.308, 0.214, 0.475], "localEnd": [-4.308, 0.214, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_02_2 = makeAttachmentEndpoint(attachment_body_section_02_2);
  const node_body_section_02_2 = new THREE.Group();
  node_body_section_02_2.name = "Body section 2__pivot";
  if (endpoint_body_section_02_2) {
    node_body_section_02_2.position.copy(endpoint_body_section_02_2.start);
    node_body_section_02_2.rotation.set(0, 0, 0);
    node_body_section_02_2.scale.set(1, 1, 1);
  } else {
    node_body_section_02_2.position.set(-4.308, 0.214, 0.475);
    node_body_section_02_2.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_02_2.scale.set(0.531, 0.445, 0.128);
  }
  node_body_section_02_2.userData.sculptComponent = {"id": "body-section-02", "name": "Body section 2", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-02-mount", "structuralParent": "root", "localStart": [-4.308, 0.214, 0.475], "localEnd": [-4.308, 0.214, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.531, "height": 0.445, "depth": 0.128, "units": "relative", "confidence": 0.5}, "transform": {"position": [-4.308, 0.214, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_02_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_02_2);
  nodes["body-section-02"] = node_body_section_02_2;
  const mesh_body_section_02_2Geometry = endpoint_body_section_02_2
    ? new THREE.CylinderGeometry(endpoint_body_section_02_2.endRadius, endpoint_body_section_02_2.baseRadius, endpoint_body_section_02_2.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_02_2 = new THREE.Mesh(
    mesh_body_section_02_2Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_02_2.name = "Body section 2";
  if (endpoint_body_section_02_2) {
    mesh_body_section_02_2.position.copy(endpoint_body_section_02_2.midpoint);
    mesh_body_section_02_2.quaternion.copy(endpoint_body_section_02_2.quaternion);
  }
  mesh_body_section_02_2.castShadow = options.castShadow ?? true;
  mesh_body_section_02_2.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_02_2.userData.sculptComponent = {"id": "body-section-02", "name": "Body section 2", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-02-mount", "structuralParent": "root", "localStart": [-4.308, 0.214, 0.475], "localEnd": [-4.308, 0.214, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.531, "height": 0.445, "depth": 0.128, "units": "relative", "confidence": 0.5}, "transform": {"position": [-4.308, 0.214, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_02_2.add(mesh_body_section_02_2);
  meshes["body-section-02"] = mesh_body_section_02_2;
  colliders["body-section-02"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_03_3 = {"parentId": "root", "parentSocket": "root/body-section-03-mount", "structuralParent": "root", "localStart": [-3.916, 0.19, 0.475], "localEnd": [-3.916, 0.19, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_03_3 = makeAttachmentEndpoint(attachment_body_section_03_3);
  const node_body_section_03_3 = new THREE.Group();
  node_body_section_03_3.name = "Body section 3__pivot";
  if (endpoint_body_section_03_3) {
    node_body_section_03_3.position.copy(endpoint_body_section_03_3.start);
    node_body_section_03_3.rotation.set(0, 0, 0);
    node_body_section_03_3.scale.set(1, 1, 1);
  } else {
    node_body_section_03_3.position.set(-3.916, 0.19, 0.475);
    node_body_section_03_3.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_03_3.scale.set(0.646, 0.445, 0.179);
  }
  node_body_section_03_3.userData.sculptComponent = {"id": "body-section-03", "name": "Body section 3", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-03-mount", "structuralParent": "root", "localStart": [-3.916, 0.19, 0.475], "localEnd": [-3.916, 0.19, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.646, "height": 0.445, "depth": 0.179, "units": "relative", "confidence": 0.5}, "transform": {"position": [-3.916, 0.19, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_03_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_03_3);
  nodes["body-section-03"] = node_body_section_03_3;
  const mesh_body_section_03_3Geometry = endpoint_body_section_03_3
    ? new THREE.CylinderGeometry(endpoint_body_section_03_3.endRadius, endpoint_body_section_03_3.baseRadius, endpoint_body_section_03_3.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_03_3 = new THREE.Mesh(
    mesh_body_section_03_3Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_03_3.name = "Body section 3";
  if (endpoint_body_section_03_3) {
    mesh_body_section_03_3.position.copy(endpoint_body_section_03_3.midpoint);
    mesh_body_section_03_3.quaternion.copy(endpoint_body_section_03_3.quaternion);
  }
  mesh_body_section_03_3.castShadow = options.castShadow ?? true;
  mesh_body_section_03_3.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_03_3.userData.sculptComponent = {"id": "body-section-03", "name": "Body section 3", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-03-mount", "structuralParent": "root", "localStart": [-3.916, 0.19, 0.475], "localEnd": [-3.916, 0.19, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.646, "height": 0.445, "depth": 0.179, "units": "relative", "confidence": 0.5}, "transform": {"position": [-3.916, 0.19, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_03_3.add(mesh_body_section_03_3);
  meshes["body-section-03"] = mesh_body_section_03_3;
  colliders["body-section-03"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_04_4 = {"parentId": "root", "parentSocket": "root/body-section-04-mount", "structuralParent": "root", "localStart": [-3.524, 0.165, 0.475], "localEnd": [-3.524, 0.165, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_04_4 = makeAttachmentEndpoint(attachment_body_section_04_4);
  const node_body_section_04_4 = new THREE.Group();
  node_body_section_04_4.name = "Body section 4__pivot";
  if (endpoint_body_section_04_4) {
    node_body_section_04_4.position.copy(endpoint_body_section_04_4.start);
    node_body_section_04_4.rotation.set(0, 0, 0);
    node_body_section_04_4.scale.set(1, 1, 1);
  } else {
    node_body_section_04_4.position.set(-3.524, 0.165, 0.475);
    node_body_section_04_4.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_04_4.scale.set(0.701, 0.445, 0.218);
  }
  node_body_section_04_4.userData.sculptComponent = {"id": "body-section-04", "name": "Body section 4", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-04-mount", "structuralParent": "root", "localStart": [-3.524, 0.165, 0.475], "localEnd": [-3.524, 0.165, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.701, "height": 0.445, "depth": 0.218, "units": "relative", "confidence": 0.5}, "transform": {"position": [-3.524, 0.165, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_04_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_04_4);
  nodes["body-section-04"] = node_body_section_04_4;
  const mesh_body_section_04_4Geometry = endpoint_body_section_04_4
    ? new THREE.CylinderGeometry(endpoint_body_section_04_4.endRadius, endpoint_body_section_04_4.baseRadius, endpoint_body_section_04_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_04_4 = new THREE.Mesh(
    mesh_body_section_04_4Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_04_4.name = "Body section 4";
  if (endpoint_body_section_04_4) {
    mesh_body_section_04_4.position.copy(endpoint_body_section_04_4.midpoint);
    mesh_body_section_04_4.quaternion.copy(endpoint_body_section_04_4.quaternion);
  }
  mesh_body_section_04_4.castShadow = options.castShadow ?? true;
  mesh_body_section_04_4.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_04_4.userData.sculptComponent = {"id": "body-section-04", "name": "Body section 4", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-04-mount", "structuralParent": "root", "localStart": [-3.524, 0.165, 0.475], "localEnd": [-3.524, 0.165, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.701, "height": 0.445, "depth": 0.218, "units": "relative", "confidence": 0.5}, "transform": {"position": [-3.524, 0.165, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_04_4.add(mesh_body_section_04_4);
  meshes["body-section-04"] = mesh_body_section_04_4;
  colliders["body-section-04"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_05_5 = {"parentId": "root", "parentSocket": "root/body-section-05-mount", "structuralParent": "root", "localStart": [-3.132, 0.14, 0.475], "localEnd": [-3.132, 0.14, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_05_5 = makeAttachmentEndpoint(attachment_body_section_05_5);
  const node_body_section_05_5 = new THREE.Group();
  node_body_section_05_5.name = "Body section 5__pivot";
  if (endpoint_body_section_05_5) {
    node_body_section_05_5.position.copy(endpoint_body_section_05_5.start);
    node_body_section_05_5.rotation.set(0, 0, 0);
    node_body_section_05_5.scale.set(1, 1, 1);
  } else {
    node_body_section_05_5.position.set(-3.132, 0.14, 0.475);
    node_body_section_05_5.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_05_5.scale.set(0.73, 0.445, 0.267);
  }
  node_body_section_05_5.userData.sculptComponent = {"id": "body-section-05", "name": "Body section 5", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-05-mount", "structuralParent": "root", "localStart": [-3.132, 0.14, 0.475], "localEnd": [-3.132, 0.14, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.73, "height": 0.445, "depth": 0.267, "units": "relative", "confidence": 0.5}, "transform": {"position": [-3.132, 0.14, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_05_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_05_5);
  nodes["body-section-05"] = node_body_section_05_5;
  const mesh_body_section_05_5Geometry = endpoint_body_section_05_5
    ? new THREE.CylinderGeometry(endpoint_body_section_05_5.endRadius, endpoint_body_section_05_5.baseRadius, endpoint_body_section_05_5.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_05_5 = new THREE.Mesh(
    mesh_body_section_05_5Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_05_5.name = "Body section 5";
  if (endpoint_body_section_05_5) {
    mesh_body_section_05_5.position.copy(endpoint_body_section_05_5.midpoint);
    mesh_body_section_05_5.quaternion.copy(endpoint_body_section_05_5.quaternion);
  }
  mesh_body_section_05_5.castShadow = options.castShadow ?? true;
  mesh_body_section_05_5.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_05_5.userData.sculptComponent = {"id": "body-section-05", "name": "Body section 5", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-05-mount", "structuralParent": "root", "localStart": [-3.132, 0.14, 0.475], "localEnd": [-3.132, 0.14, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.73, "height": 0.445, "depth": 0.267, "units": "relative", "confidence": 0.5}, "transform": {"position": [-3.132, 0.14, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_05_5.add(mesh_body_section_05_5);
  meshes["body-section-05"] = mesh_body_section_05_5;
  colliders["body-section-05"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_06_6 = {"parentId": "root", "parentSocket": "root/body-section-06-mount", "structuralParent": "root", "localStart": [-2.74, 0.116, 0.475], "localEnd": [-2.74, 0.116, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_06_6 = makeAttachmentEndpoint(attachment_body_section_06_6);
  const node_body_section_06_6 = new THREE.Group();
  node_body_section_06_6.name = "Body section 6__pivot";
  if (endpoint_body_section_06_6) {
    node_body_section_06_6.position.copy(endpoint_body_section_06_6.start);
    node_body_section_06_6.rotation.set(0, 0, 0);
    node_body_section_06_6.scale.set(1, 1, 1);
  } else {
    node_body_section_06_6.position.set(-2.74, 0.116, 0.475);
    node_body_section_06_6.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_06_6.scale.set(0.71, 0.445, 0.299);
  }
  node_body_section_06_6.userData.sculptComponent = {"id": "body-section-06", "name": "Body section 6", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-06-mount", "structuralParent": "root", "localStart": [-2.74, 0.116, 0.475], "localEnd": [-2.74, 0.116, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.445, "depth": 0.299, "units": "relative", "confidence": 0.5}, "transform": {"position": [-2.74, 0.116, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_06_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_06_6);
  nodes["body-section-06"] = node_body_section_06_6;
  const mesh_body_section_06_6Geometry = endpoint_body_section_06_6
    ? new THREE.CylinderGeometry(endpoint_body_section_06_6.endRadius, endpoint_body_section_06_6.baseRadius, endpoint_body_section_06_6.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_06_6 = new THREE.Mesh(
    mesh_body_section_06_6Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_06_6.name = "Body section 6";
  if (endpoint_body_section_06_6) {
    mesh_body_section_06_6.position.copy(endpoint_body_section_06_6.midpoint);
    mesh_body_section_06_6.quaternion.copy(endpoint_body_section_06_6.quaternion);
  }
  mesh_body_section_06_6.castShadow = options.castShadow ?? true;
  mesh_body_section_06_6.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_06_6.userData.sculptComponent = {"id": "body-section-06", "name": "Body section 6", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-06-mount", "structuralParent": "root", "localStart": [-2.74, 0.116, 0.475], "localEnd": [-2.74, 0.116, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.445, "depth": 0.299, "units": "relative", "confidence": 0.5}, "transform": {"position": [-2.74, 0.116, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_06_6.add(mesh_body_section_06_6);
  meshes["body-section-06"] = mesh_body_section_06_6;
  colliders["body-section-06"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_07_7 = {"parentId": "root", "parentSocket": "root/body-section-07-mount", "structuralParent": "root", "localStart": [-2.348, 0.13, 0.475], "localEnd": [-2.348, 0.13, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_07_7 = makeAttachmentEndpoint(attachment_body_section_07_7);
  const node_body_section_07_7 = new THREE.Group();
  node_body_section_07_7.name = "Body section 7__pivot";
  if (endpoint_body_section_07_7) {
    node_body_section_07_7.position.copy(endpoint_body_section_07_7.start);
    node_body_section_07_7.rotation.set(0, 0, 0);
    node_body_section_07_7.scale.set(1, 1, 1);
  } else {
    node_body_section_07_7.position.set(-2.348, 0.13, 0.475);
    node_body_section_07_7.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_07_7.scale.set(0.73, 0.445, 0.352);
  }
  node_body_section_07_7.userData.sculptComponent = {"id": "body-section-07", "name": "Body section 7", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-07-mount", "structuralParent": "root", "localStart": [-2.348, 0.13, 0.475], "localEnd": [-2.348, 0.13, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.73, "height": 0.445, "depth": 0.352, "units": "relative", "confidence": 0.5}, "transform": {"position": [-2.348, 0.13, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_07_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_07_7);
  nodes["body-section-07"] = node_body_section_07_7;
  const mesh_body_section_07_7Geometry = endpoint_body_section_07_7
    ? new THREE.CylinderGeometry(endpoint_body_section_07_7.endRadius, endpoint_body_section_07_7.baseRadius, endpoint_body_section_07_7.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_07_7 = new THREE.Mesh(
    mesh_body_section_07_7Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_07_7.name = "Body section 7";
  if (endpoint_body_section_07_7) {
    mesh_body_section_07_7.position.copy(endpoint_body_section_07_7.midpoint);
    mesh_body_section_07_7.quaternion.copy(endpoint_body_section_07_7.quaternion);
  }
  mesh_body_section_07_7.castShadow = options.castShadow ?? true;
  mesh_body_section_07_7.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_07_7.userData.sculptComponent = {"id": "body-section-07", "name": "Body section 7", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-07-mount", "structuralParent": "root", "localStart": [-2.348, 0.13, 0.475], "localEnd": [-2.348, 0.13, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.73, "height": 0.445, "depth": 0.352, "units": "relative", "confidence": 0.5}, "transform": {"position": [-2.348, 0.13, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_07_7.add(mesh_body_section_07_7);
  meshes["body-section-07"] = mesh_body_section_07_7;
  colliders["body-section-07"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_08_8 = {"parentId": "root", "parentSocket": "root/body-section-08-mount", "structuralParent": "root", "localStart": [-1.956, 0.146, 0.475], "localEnd": [-1.956, 0.146, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_08_8 = makeAttachmentEndpoint(attachment_body_section_08_8);
  const node_body_section_08_8 = new THREE.Group();
  node_body_section_08_8.name = "Body section 8__pivot";
  if (endpoint_body_section_08_8) {
    node_body_section_08_8.position.copy(endpoint_body_section_08_8.start);
    node_body_section_08_8.rotation.set(0, 0, 0);
    node_body_section_08_8.scale.set(1, 1, 1);
  } else {
    node_body_section_08_8.position.set(-1.956, 0.146, 0.475);
    node_body_section_08_8.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_08_8.scale.set(0.701, 0.445, 0.381);
  }
  node_body_section_08_8.userData.sculptComponent = {"id": "body-section-08", "name": "Body section 8", "level": "macro", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-08-mount", "structuralParent": "root", "localStart": [-1.956, 0.146, 0.475], "localEnd": [-1.956, 0.146, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.701, "height": 0.445, "depth": 0.381, "units": "relative", "confidence": 0.5}, "transform": {"position": [-1.956, 0.146, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_08_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_08_8);
  nodes["body-section-08"] = node_body_section_08_8;
  const mesh_body_section_08_8Geometry = endpoint_body_section_08_8
    ? new THREE.CylinderGeometry(endpoint_body_section_08_8.endRadius, endpoint_body_section_08_8.baseRadius, endpoint_body_section_08_8.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_08_8 = new THREE.Mesh(
    mesh_body_section_08_8Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_08_8.name = "Body section 8";
  if (endpoint_body_section_08_8) {
    mesh_body_section_08_8.position.copy(endpoint_body_section_08_8.midpoint);
    mesh_body_section_08_8.quaternion.copy(endpoint_body_section_08_8.quaternion);
  }
  mesh_body_section_08_8.castShadow = options.castShadow ?? true;
  mesh_body_section_08_8.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_08_8.userData.sculptComponent = {"id": "body-section-08", "name": "Body section 8", "level": "macro", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-08-mount", "structuralParent": "root", "localStart": [-1.956, 0.146, 0.475], "localEnd": [-1.956, 0.146, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.701, "height": 0.445, "depth": 0.381, "units": "relative", "confidence": 0.5}, "transform": {"position": [-1.956, 0.146, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_08_8.add(mesh_body_section_08_8);
  meshes["body-section-08"] = mesh_body_section_08_8;
  colliders["body-section-08"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_09_9 = {"parentId": "root", "parentSocket": "root/body-section-09-mount", "structuralParent": "root", "localStart": [-1.564, 0.157, 0.475], "localEnd": [-1.564, 0.157, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_09_9 = makeAttachmentEndpoint(attachment_body_section_09_9);
  const node_body_section_09_9 = new THREE.Group();
  node_body_section_09_9.name = "Body section 9__pivot";
  if (endpoint_body_section_09_9) {
    node_body_section_09_9.position.copy(endpoint_body_section_09_9.start);
    node_body_section_09_9.rotation.set(0, 0, 0);
    node_body_section_09_9.scale.set(1, 1, 1);
  } else {
    node_body_section_09_9.position.set(-1.564, 0.157, 0.475);
    node_body_section_09_9.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_09_9.scale.set(0.724, 0.445, 0.425);
  }
  node_body_section_09_9.userData.sculptComponent = {"id": "body-section-09", "name": "Body section 9", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-09-mount", "structuralParent": "root", "localStart": [-1.564, 0.157, 0.475], "localEnd": [-1.564, 0.157, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.724, "height": 0.445, "depth": 0.425, "units": "relative", "confidence": 0.5}, "transform": {"position": [-1.564, 0.157, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_09_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_09_9);
  nodes["body-section-09"] = node_body_section_09_9;
  const mesh_body_section_09_9Geometry = endpoint_body_section_09_9
    ? new THREE.CylinderGeometry(endpoint_body_section_09_9.endRadius, endpoint_body_section_09_9.baseRadius, endpoint_body_section_09_9.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_09_9 = new THREE.Mesh(
    mesh_body_section_09_9Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_09_9.name = "Body section 9";
  if (endpoint_body_section_09_9) {
    mesh_body_section_09_9.position.copy(endpoint_body_section_09_9.midpoint);
    mesh_body_section_09_9.quaternion.copy(endpoint_body_section_09_9.quaternion);
  }
  mesh_body_section_09_9.castShadow = options.castShadow ?? true;
  mesh_body_section_09_9.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_09_9.userData.sculptComponent = {"id": "body-section-09", "name": "Body section 9", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-09-mount", "structuralParent": "root", "localStart": [-1.564, 0.157, 0.475], "localEnd": [-1.564, 0.157, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.724, "height": 0.445, "depth": 0.425, "units": "relative", "confidence": 0.5}, "transform": {"position": [-1.564, 0.157, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_09_9.add(mesh_body_section_09_9);
  meshes["body-section-09"] = mesh_body_section_09_9;
  colliders["body-section-09"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_10_10 = {"parentId": "root", "parentSocket": "root/body-section-10-mount", "structuralParent": "root", "localStart": [-1.172, 0.166, 0.475], "localEnd": [-1.172, 0.166, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_10_10 = makeAttachmentEndpoint(attachment_body_section_10_10);
  const node_body_section_10_10 = new THREE.Group();
  node_body_section_10_10.name = "Body section 10__pivot";
  if (endpoint_body_section_10_10) {
    node_body_section_10_10.position.copy(endpoint_body_section_10_10.start);
    node_body_section_10_10.rotation.set(0, 0, 0);
    node_body_section_10_10.scale.set(1, 1, 1);
  } else {
    node_body_section_10_10.position.set(-1.172, 0.166, 0.475);
    node_body_section_10_10.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_10_10.scale.set(0.7, 0.445, 0.437);
  }
  node_body_section_10_10.userData.sculptComponent = {"id": "body-section-10", "name": "Body section 10", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-10-mount", "structuralParent": "root", "localStart": [-1.172, 0.166, 0.475], "localEnd": [-1.172, 0.166, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.445, "depth": 0.437, "units": "relative", "confidence": 0.5}, "transform": {"position": [-1.172, 0.166, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_10_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_10_10);
  nodes["body-section-10"] = node_body_section_10_10;
  const mesh_body_section_10_10Geometry = endpoint_body_section_10_10
    ? new THREE.CylinderGeometry(endpoint_body_section_10_10.endRadius, endpoint_body_section_10_10.baseRadius, endpoint_body_section_10_10.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_10_10 = new THREE.Mesh(
    mesh_body_section_10_10Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_10_10.name = "Body section 10";
  if (endpoint_body_section_10_10) {
    mesh_body_section_10_10.position.copy(endpoint_body_section_10_10.midpoint);
    mesh_body_section_10_10.quaternion.copy(endpoint_body_section_10_10.quaternion);
  }
  mesh_body_section_10_10.castShadow = options.castShadow ?? true;
  mesh_body_section_10_10.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_10_10.userData.sculptComponent = {"id": "body-section-10", "name": "Body section 10", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-10-mount", "structuralParent": "root", "localStart": [-1.172, 0.166, 0.475], "localEnd": [-1.172, 0.166, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.445, "depth": 0.437, "units": "relative", "confidence": 0.5}, "transform": {"position": [-1.172, 0.166, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_10_10.add(mesh_body_section_10_10);
  meshes["body-section-10"] = mesh_body_section_10_10;
  colliders["body-section-10"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_11_11 = {"parentId": "root", "parentSocket": "root/body-section-11-mount", "structuralParent": "root", "localStart": [-0.78, 0.165, 0.475], "localEnd": [-0.78, 0.165, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_11_11 = makeAttachmentEndpoint(attachment_body_section_11_11);
  const node_body_section_11_11 = new THREE.Group();
  node_body_section_11_11.name = "Body section 11__pivot";
  if (endpoint_body_section_11_11) {
    node_body_section_11_11.position.copy(endpoint_body_section_11_11.start);
    node_body_section_11_11.rotation.set(0, 0, 0);
    node_body_section_11_11.scale.set(1, 1, 1);
  } else {
    node_body_section_11_11.position.set(-0.78, 0.165, 0.475);
    node_body_section_11_11.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_11_11.scale.set(0.715, 0.445, 0.472);
  }
  node_body_section_11_11.userData.sculptComponent = {"id": "body-section-11", "name": "Body section 11", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-11-mount", "structuralParent": "root", "localStart": [-0.78, 0.165, 0.475], "localEnd": [-0.78, 0.165, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.715, "height": 0.445, "depth": 0.472, "units": "relative", "confidence": 0.5}, "transform": {"position": [-0.78, 0.165, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_11_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_11_11);
  nodes["body-section-11"] = node_body_section_11_11;
  const mesh_body_section_11_11Geometry = endpoint_body_section_11_11
    ? new THREE.CylinderGeometry(endpoint_body_section_11_11.endRadius, endpoint_body_section_11_11.baseRadius, endpoint_body_section_11_11.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_11_11 = new THREE.Mesh(
    mesh_body_section_11_11Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_11_11.name = "Body section 11";
  if (endpoint_body_section_11_11) {
    mesh_body_section_11_11.position.copy(endpoint_body_section_11_11.midpoint);
    mesh_body_section_11_11.quaternion.copy(endpoint_body_section_11_11.quaternion);
  }
  mesh_body_section_11_11.castShadow = options.castShadow ?? true;
  mesh_body_section_11_11.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_11_11.userData.sculptComponent = {"id": "body-section-11", "name": "Body section 11", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-11-mount", "structuralParent": "root", "localStart": [-0.78, 0.165, 0.475], "localEnd": [-0.78, 0.165, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.715, "height": 0.445, "depth": 0.472, "units": "relative", "confidence": 0.5}, "transform": {"position": [-0.78, 0.165, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_11_11.add(mesh_body_section_11_11);
  meshes["body-section-11"] = mesh_body_section_11_11;
  colliders["body-section-11"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_12_12 = {"parentId": "root", "parentSocket": "root/body-section-12-mount", "structuralParent": "root", "localStart": [-0.388, 0.157, 0.475], "localEnd": [-0.388, 0.157, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_12_12 = makeAttachmentEndpoint(attachment_body_section_12_12);
  const node_body_section_12_12 = new THREE.Group();
  node_body_section_12_12.name = "Body section 12__pivot";
  if (endpoint_body_section_12_12) {
    node_body_section_12_12.position.copy(endpoint_body_section_12_12.start);
    node_body_section_12_12.rotation.set(0, 0, 0);
    node_body_section_12_12.scale.set(1, 1, 1);
  } else {
    node_body_section_12_12.position.set(-0.388, 0.157, 0.475);
    node_body_section_12_12.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_12_12.scale.set(0.673, 0.445, 0.467);
  }
  node_body_section_12_12.userData.sculptComponent = {"id": "body-section-12", "name": "Body section 12", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-12-mount", "structuralParent": "root", "localStart": [-0.388, 0.157, 0.475], "localEnd": [-0.388, 0.157, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.673, "height": 0.445, "depth": 0.467, "units": "relative", "confidence": 0.5}, "transform": {"position": [-0.388, 0.157, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_12_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_12_12);
  nodes["body-section-12"] = node_body_section_12_12;
  const mesh_body_section_12_12Geometry = endpoint_body_section_12_12
    ? new THREE.CylinderGeometry(endpoint_body_section_12_12.endRadius, endpoint_body_section_12_12.baseRadius, endpoint_body_section_12_12.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_12_12 = new THREE.Mesh(
    mesh_body_section_12_12Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_12_12.name = "Body section 12";
  if (endpoint_body_section_12_12) {
    mesh_body_section_12_12.position.copy(endpoint_body_section_12_12.midpoint);
    mesh_body_section_12_12.quaternion.copy(endpoint_body_section_12_12.quaternion);
  }
  mesh_body_section_12_12.castShadow = options.castShadow ?? true;
  mesh_body_section_12_12.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_12_12.userData.sculptComponent = {"id": "body-section-12", "name": "Body section 12", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-12-mount", "structuralParent": "root", "localStart": [-0.388, 0.157, 0.475], "localEnd": [-0.388, 0.157, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.673, "height": 0.445, "depth": 0.467, "units": "relative", "confidence": 0.5}, "transform": {"position": [-0.388, 0.157, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_12_12.add(mesh_body_section_12_12);
  meshes["body-section-12"] = mesh_body_section_12_12;
  colliders["body-section-12"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_13_13 = {"parentId": "root", "parentSocket": "root/body-section-13-mount", "structuralParent": "root", "localStart": [0.004, 0.144, 0.475], "localEnd": [0.004, 0.144, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_13_13 = makeAttachmentEndpoint(attachment_body_section_13_13);
  const node_body_section_13_13 = new THREE.Group();
  node_body_section_13_13.name = "Body section 13__pivot";
  if (endpoint_body_section_13_13) {
    node_body_section_13_13.position.copy(endpoint_body_section_13_13.start);
    node_body_section_13_13.rotation.set(0, 0, 0);
    node_body_section_13_13.scale.set(1, 1, 1);
  } else {
    node_body_section_13_13.position.set(0.004, 0.144, 0.475);
    node_body_section_13_13.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_13_13.scale.set(0.681, 0.445, 0.491);
  }
  node_body_section_13_13.userData.sculptComponent = {"id": "body-section-13", "name": "Body section 13", "level": "macro", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-13-mount", "structuralParent": "root", "localStart": [0.004, 0.144, 0.475], "localEnd": [0.004, 0.144, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.681, "height": 0.445, "depth": 0.491, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.004, 0.144, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_13_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_13_13);
  nodes["body-section-13"] = node_body_section_13_13;
  const mesh_body_section_13_13Geometry = endpoint_body_section_13_13
    ? new THREE.CylinderGeometry(endpoint_body_section_13_13.endRadius, endpoint_body_section_13_13.baseRadius, endpoint_body_section_13_13.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_13_13 = new THREE.Mesh(
    mesh_body_section_13_13Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_13_13.name = "Body section 13";
  if (endpoint_body_section_13_13) {
    mesh_body_section_13_13.position.copy(endpoint_body_section_13_13.midpoint);
    mesh_body_section_13_13.quaternion.copy(endpoint_body_section_13_13.quaternion);
  }
  mesh_body_section_13_13.castShadow = options.castShadow ?? true;
  mesh_body_section_13_13.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_13_13.userData.sculptComponent = {"id": "body-section-13", "name": "Body section 13", "level": "macro", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-13-mount", "structuralParent": "root", "localStart": [0.004, 0.144, 0.475], "localEnd": [0.004, 0.144, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.681, "height": 0.445, "depth": 0.491, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.004, 0.144, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_13_13.add(mesh_body_section_13_13);
  meshes["body-section-13"] = mesh_body_section_13_13;
  colliders["body-section-13"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_14_14 = {"parentId": "root", "parentSocket": "root/body-section-14-mount", "structuralParent": "root", "localStart": [0.396, 0.121, 0.475], "localEnd": [0.396, 0.121, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_14_14 = makeAttachmentEndpoint(attachment_body_section_14_14);
  const node_body_section_14_14 = new THREE.Group();
  node_body_section_14_14.name = "Body section 14__pivot";
  if (endpoint_body_section_14_14) {
    node_body_section_14_14.position.copy(endpoint_body_section_14_14.start);
    node_body_section_14_14.rotation.set(0, 0, 0);
    node_body_section_14_14.scale.set(1, 1, 1);
  } else {
    node_body_section_14_14.position.set(0.396, 0.121, 0.475);
    node_body_section_14_14.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_14_14.scale.set(0.649, 0.445, 0.469);
  }
  node_body_section_14_14.userData.sculptComponent = {"id": "body-section-14", "name": "Body section 14", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-14-mount", "structuralParent": "root", "localStart": [0.396, 0.121, 0.475], "localEnd": [0.396, 0.121, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.649, "height": 0.445, "depth": 0.469, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.396, 0.121, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_14_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_14_14);
  nodes["body-section-14"] = node_body_section_14_14;
  const mesh_body_section_14_14Geometry = endpoint_body_section_14_14
    ? new THREE.CylinderGeometry(endpoint_body_section_14_14.endRadius, endpoint_body_section_14_14.baseRadius, endpoint_body_section_14_14.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_14_14 = new THREE.Mesh(
    mesh_body_section_14_14Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_14_14.name = "Body section 14";
  if (endpoint_body_section_14_14) {
    mesh_body_section_14_14.position.copy(endpoint_body_section_14_14.midpoint);
    mesh_body_section_14_14.quaternion.copy(endpoint_body_section_14_14.quaternion);
  }
  mesh_body_section_14_14.castShadow = options.castShadow ?? true;
  mesh_body_section_14_14.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_14_14.userData.sculptComponent = {"id": "body-section-14", "name": "Body section 14", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-14-mount", "structuralParent": "root", "localStart": [0.396, 0.121, 0.475], "localEnd": [0.396, 0.121, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.649, "height": 0.445, "depth": 0.469, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.396, 0.121, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_14_14.add(mesh_body_section_14_14);
  meshes["body-section-14"] = mesh_body_section_14_14;
  colliders["body-section-14"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_15_15 = {"parentId": "root", "parentSocket": "root/body-section-15-mount", "structuralParent": "root", "localStart": [0.788, 0.098, 0.475], "localEnd": [0.788, 0.098, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_15_15 = makeAttachmentEndpoint(attachment_body_section_15_15);
  const node_body_section_15_15 = new THREE.Group();
  node_body_section_15_15.name = "Body section 15__pivot";
  if (endpoint_body_section_15_15) {
    node_body_section_15_15.position.copy(endpoint_body_section_15_15.start);
    node_body_section_15_15.rotation.set(0, 0, 0);
    node_body_section_15_15.scale.set(1, 1, 1);
  } else {
    node_body_section_15_15.position.set(0.788, 0.098, 0.475);
    node_body_section_15_15.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_15_15.scale.set(0.664, 0.445, 0.479);
  }
  node_body_section_15_15.userData.sculptComponent = {"id": "body-section-15", "name": "Body section 15", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-15-mount", "structuralParent": "root", "localStart": [0.788, 0.098, 0.475], "localEnd": [0.788, 0.098, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.664, "height": 0.445, "depth": 0.479, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.788, 0.098, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_15_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_15_15);
  nodes["body-section-15"] = node_body_section_15_15;
  const mesh_body_section_15_15Geometry = endpoint_body_section_15_15
    ? new THREE.CylinderGeometry(endpoint_body_section_15_15.endRadius, endpoint_body_section_15_15.baseRadius, endpoint_body_section_15_15.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_15_15 = new THREE.Mesh(
    mesh_body_section_15_15Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_15_15.name = "Body section 15";
  if (endpoint_body_section_15_15) {
    mesh_body_section_15_15.position.copy(endpoint_body_section_15_15.midpoint);
    mesh_body_section_15_15.quaternion.copy(endpoint_body_section_15_15.quaternion);
  }
  mesh_body_section_15_15.castShadow = options.castShadow ?? true;
  mesh_body_section_15_15.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_15_15.userData.sculptComponent = {"id": "body-section-15", "name": "Body section 15", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-15-mount", "structuralParent": "root", "localStart": [0.788, 0.098, 0.475], "localEnd": [0.788, 0.098, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.664, "height": 0.445, "depth": 0.479, "units": "relative", "confidence": 0.5}, "transform": {"position": [0.788, 0.098, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_15_15.add(mesh_body_section_15_15);
  meshes["body-section-15"] = mesh_body_section_15_15;
  colliders["body-section-15"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_16_16 = {"parentId": "root", "parentSocket": "root/body-section-16-mount", "structuralParent": "root", "localStart": [1.18, 0.058, 0.475], "localEnd": [1.18, 0.058, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_16_16 = makeAttachmentEndpoint(attachment_body_section_16_16);
  const node_body_section_16_16 = new THREE.Group();
  node_body_section_16_16.name = "Body section 16__pivot";
  if (endpoint_body_section_16_16) {
    node_body_section_16_16.position.copy(endpoint_body_section_16_16.start);
    node_body_section_16_16.rotation.set(0, 0, 0);
    node_body_section_16_16.scale.set(1, 1, 1);
  } else {
    node_body_section_16_16.position.set(1.18, 0.058, 0.475);
    node_body_section_16_16.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_16_16.scale.set(0.668, 0.445, 0.445);
  }
  node_body_section_16_16.userData.sculptComponent = {"id": "body-section-16", "name": "Body section 16", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-16-mount", "structuralParent": "root", "localStart": [1.18, 0.058, 0.475], "localEnd": [1.18, 0.058, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.668, "height": 0.445, "depth": 0.445, "units": "relative", "confidence": 0.5}, "transform": {"position": [1.18, 0.058, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_16_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_16_16);
  nodes["body-section-16"] = node_body_section_16_16;
  const mesh_body_section_16_16Geometry = endpoint_body_section_16_16
    ? new THREE.CylinderGeometry(endpoint_body_section_16_16.endRadius, endpoint_body_section_16_16.baseRadius, endpoint_body_section_16_16.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_16_16 = new THREE.Mesh(
    mesh_body_section_16_16Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_16_16.name = "Body section 16";
  if (endpoint_body_section_16_16) {
    mesh_body_section_16_16.position.copy(endpoint_body_section_16_16.midpoint);
    mesh_body_section_16_16.quaternion.copy(endpoint_body_section_16_16.quaternion);
  }
  mesh_body_section_16_16.castShadow = options.castShadow ?? true;
  mesh_body_section_16_16.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_16_16.userData.sculptComponent = {"id": "body-section-16", "name": "Body section 16", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-16-mount", "structuralParent": "root", "localStart": [1.18, 0.058, 0.475], "localEnd": [1.18, 0.058, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.668, "height": 0.445, "depth": 0.445, "units": "relative", "confidence": 0.5}, "transform": {"position": [1.18, 0.058, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_16_16.add(mesh_body_section_16_16);
  meshes["body-section-16"] = mesh_body_section_16_16;
  colliders["body-section-16"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_17_17 = {"parentId": "root", "parentSocket": "root/body-section-17-mount", "structuralParent": "root", "localStart": [1.572, 0.018, 0.475], "localEnd": [1.572, 0.018, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_17_17 = makeAttachmentEndpoint(attachment_body_section_17_17);
  const node_body_section_17_17 = new THREE.Group();
  node_body_section_17_17.name = "Body section 17__pivot";
  if (endpoint_body_section_17_17) {
    node_body_section_17_17.position.copy(endpoint_body_section_17_17.start);
    node_body_section_17_17.rotation.set(0, 0, 0);
    node_body_section_17_17.scale.set(1, 1, 1);
  } else {
    node_body_section_17_17.position.set(1.572, 0.018, 0.475);
    node_body_section_17_17.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_17_17.scale.set(0.719, 0.445, 0.443);
  }
  node_body_section_17_17.userData.sculptComponent = {"id": "body-section-17", "name": "Body section 17", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-17-mount", "structuralParent": "root", "localStart": [1.572, 0.018, 0.475], "localEnd": [1.572, 0.018, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.719, "height": 0.445, "depth": 0.443, "units": "relative", "confidence": 0.5}, "transform": {"position": [1.572, 0.018, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_17_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_17_17);
  nodes["body-section-17"] = node_body_section_17_17;
  const mesh_body_section_17_17Geometry = endpoint_body_section_17_17
    ? new THREE.CylinderGeometry(endpoint_body_section_17_17.endRadius, endpoint_body_section_17_17.baseRadius, endpoint_body_section_17_17.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_17_17 = new THREE.Mesh(
    mesh_body_section_17_17Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_17_17.name = "Body section 17";
  if (endpoint_body_section_17_17) {
    mesh_body_section_17_17.position.copy(endpoint_body_section_17_17.midpoint);
    mesh_body_section_17_17.quaternion.copy(endpoint_body_section_17_17.quaternion);
  }
  mesh_body_section_17_17.castShadow = options.castShadow ?? true;
  mesh_body_section_17_17.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_17_17.userData.sculptComponent = {"id": "body-section-17", "name": "Body section 17", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-17-mount", "structuralParent": "root", "localStart": [1.572, 0.018, 0.475], "localEnd": [1.572, 0.018, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.719, "height": 0.445, "depth": 0.443, "units": "relative", "confidence": 0.5}, "transform": {"position": [1.572, 0.018, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_17_17.add(mesh_body_section_17_17);
  meshes["body-section-17"] = mesh_body_section_17_17;
  colliders["body-section-17"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_18_18 = {"parentId": "root", "parentSocket": "root/body-section-18-mount", "structuralParent": "root", "localStart": [1.964, 0.006, 0.475], "localEnd": [1.964, 0.006, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_18_18 = makeAttachmentEndpoint(attachment_body_section_18_18);
  const node_body_section_18_18 = new THREE.Group();
  node_body_section_18_18.name = "Body section 18__pivot";
  if (endpoint_body_section_18_18) {
    node_body_section_18_18.position.copy(endpoint_body_section_18_18.start);
    node_body_section_18_18.rotation.set(0, 0, 0);
    node_body_section_18_18.scale.set(1, 1, 1);
  } else {
    node_body_section_18_18.position.set(1.964, 0.006, 0.475);
    node_body_section_18_18.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_18_18.scale.set(0.664, 0.445, 0.386);
  }
  node_body_section_18_18.userData.sculptComponent = {"id": "body-section-18", "name": "Body section 18", "level": "macro", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-18-mount", "structuralParent": "root", "localStart": [1.964, 0.006, 0.475], "localEnd": [1.964, 0.006, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.664, "height": 0.445, "depth": 0.386, "units": "relative", "confidence": 0.5}, "transform": {"position": [1.964, 0.006, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_18_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_18_18);
  nodes["body-section-18"] = node_body_section_18_18;
  const mesh_body_section_18_18Geometry = endpoint_body_section_18_18
    ? new THREE.CylinderGeometry(endpoint_body_section_18_18.endRadius, endpoint_body_section_18_18.baseRadius, endpoint_body_section_18_18.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_18_18 = new THREE.Mesh(
    mesh_body_section_18_18Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_18_18.name = "Body section 18";
  if (endpoint_body_section_18_18) {
    mesh_body_section_18_18.position.copy(endpoint_body_section_18_18.midpoint);
    mesh_body_section_18_18.quaternion.copy(endpoint_body_section_18_18.quaternion);
  }
  mesh_body_section_18_18.castShadow = options.castShadow ?? true;
  mesh_body_section_18_18.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_18_18.userData.sculptComponent = {"id": "body-section-18", "name": "Body section 18", "level": "macro", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-18-mount", "structuralParent": "root", "localStart": [1.964, 0.006, 0.475], "localEnd": [1.964, 0.006, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.664, "height": 0.445, "depth": 0.386, "units": "relative", "confidence": 0.5}, "transform": {"position": [1.964, 0.006, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_18_18.add(mesh_body_section_18_18);
  meshes["body-section-18"] = mesh_body_section_18_18;
  colliders["body-section-18"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_19_19 = {"parentId": "root", "parentSocket": "root/body-section-19-mount", "structuralParent": "root", "localStart": [2.356, 0.002, 0.475], "localEnd": [2.356, 0.002, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_19_19 = makeAttachmentEndpoint(attachment_body_section_19_19);
  const node_body_section_19_19 = new THREE.Group();
  node_body_section_19_19.name = "Body section 19__pivot";
  if (endpoint_body_section_19_19) {
    node_body_section_19_19.position.copy(endpoint_body_section_19_19.start);
    node_body_section_19_19.rotation.set(0, 0, 0);
    node_body_section_19_19.scale.set(1, 1, 1);
  } else {
    node_body_section_19_19.position.set(2.356, 0.002, 0.475);
    node_body_section_19_19.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_19_19.scale.set(0.641, 0.445, 0.351);
  }
  node_body_section_19_19.userData.sculptComponent = {"id": "body-section-19", "name": "Body section 19", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-19-mount", "structuralParent": "root", "localStart": [2.356, 0.002, 0.475], "localEnd": [2.356, 0.002, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.641, "height": 0.445, "depth": 0.351, "units": "relative", "confidence": 0.5}, "transform": {"position": [2.356, 0.002, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_19_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_19_19);
  nodes["body-section-19"] = node_body_section_19_19;
  const mesh_body_section_19_19Geometry = endpoint_body_section_19_19
    ? new THREE.CylinderGeometry(endpoint_body_section_19_19.endRadius, endpoint_body_section_19_19.baseRadius, endpoint_body_section_19_19.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_19_19 = new THREE.Mesh(
    mesh_body_section_19_19Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_19_19.name = "Body section 19";
  if (endpoint_body_section_19_19) {
    mesh_body_section_19_19.position.copy(endpoint_body_section_19_19.midpoint);
    mesh_body_section_19_19.quaternion.copy(endpoint_body_section_19_19.quaternion);
  }
  mesh_body_section_19_19.castShadow = options.castShadow ?? true;
  mesh_body_section_19_19.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_19_19.userData.sculptComponent = {"id": "body-section-19", "name": "Body section 19", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-19-mount", "structuralParent": "root", "localStart": [2.356, 0.002, 0.475], "localEnd": [2.356, 0.002, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.641, "height": 0.445, "depth": 0.351, "units": "relative", "confidence": 0.5}, "transform": {"position": [2.356, 0.002, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_19_19.add(mesh_body_section_19_19);
  meshes["body-section-19"] = mesh_body_section_19_19;
  colliders["body-section-19"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_20_20 = {"parentId": "root", "parentSocket": "root/body-section-20-mount", "structuralParent": "root", "localStart": [2.748, 0.003, 0.475], "localEnd": [2.748, 0.003, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_20_20 = makeAttachmentEndpoint(attachment_body_section_20_20);
  const node_body_section_20_20 = new THREE.Group();
  node_body_section_20_20.name = "Body section 20__pivot";
  if (endpoint_body_section_20_20) {
    node_body_section_20_20.position.copy(endpoint_body_section_20_20.start);
    node_body_section_20_20.rotation.set(0, 0, 0);
    node_body_section_20_20.scale.set(1, 1, 1);
  } else {
    node_body_section_20_20.position.set(2.748, 0.003, 0.475);
    node_body_section_20_20.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_20_20.scale.set(0.548, 0.445, 0.278);
  }
  node_body_section_20_20.userData.sculptComponent = {"id": "body-section-20", "name": "Body section 20", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-20-mount", "structuralParent": "root", "localStart": [2.748, 0.003, 0.475], "localEnd": [2.748, 0.003, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.548, "height": 0.445, "depth": 0.278, "units": "relative", "confidence": 0.5}, "transform": {"position": [2.748, 0.003, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_20_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_20_20);
  nodes["body-section-20"] = node_body_section_20_20;
  const mesh_body_section_20_20Geometry = endpoint_body_section_20_20
    ? new THREE.CylinderGeometry(endpoint_body_section_20_20.endRadius, endpoint_body_section_20_20.baseRadius, endpoint_body_section_20_20.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_20_20 = new THREE.Mesh(
    mesh_body_section_20_20Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_20_20.name = "Body section 20";
  if (endpoint_body_section_20_20) {
    mesh_body_section_20_20.position.copy(endpoint_body_section_20_20.midpoint);
    mesh_body_section_20_20.quaternion.copy(endpoint_body_section_20_20.quaternion);
  }
  mesh_body_section_20_20.castShadow = options.castShadow ?? true;
  mesh_body_section_20_20.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_20_20.userData.sculptComponent = {"id": "body-section-20", "name": "Body section 20", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-20-mount", "structuralParent": "root", "localStart": [2.748, 0.003, 0.475], "localEnd": [2.748, 0.003, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.548, "height": 0.445, "depth": 0.278, "units": "relative", "confidence": 0.5}, "transform": {"position": [2.748, 0.003, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_20_20.add(mesh_body_section_20_20);
  meshes["body-section-20"] = mesh_body_section_20_20;
  colliders["body-section-20"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_21_21 = {"parentId": "root", "parentSocket": "root/body-section-21-mount", "structuralParent": "root", "localStart": [3.14, 0.007, 0.475], "localEnd": [3.14, 0.007, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_21_21 = makeAttachmentEndpoint(attachment_body_section_21_21);
  const node_body_section_21_21 = new THREE.Group();
  node_body_section_21_21.name = "Body section 21__pivot";
  if (endpoint_body_section_21_21) {
    node_body_section_21_21.position.copy(endpoint_body_section_21_21.start);
    node_body_section_21_21.rotation.set(0, 0, 0);
    node_body_section_21_21.scale.set(1, 1, 1);
  } else {
    node_body_section_21_21.position.set(3.14, 0.007, 0.475);
    node_body_section_21_21.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_21_21.scale.set(0.475, 0.445, 0.214);
  }
  node_body_section_21_21.userData.sculptComponent = {"id": "body-section-21", "name": "Body section 21", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-21-mount", "structuralParent": "root", "localStart": [3.14, 0.007, 0.475], "localEnd": [3.14, 0.007, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.475, "height": 0.445, "depth": 0.214, "units": "relative", "confidence": 0.5}, "transform": {"position": [3.14, 0.007, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_21_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_21_21);
  nodes["body-section-21"] = node_body_section_21_21;
  const mesh_body_section_21_21Geometry = endpoint_body_section_21_21
    ? new THREE.CylinderGeometry(endpoint_body_section_21_21.endRadius, endpoint_body_section_21_21.baseRadius, endpoint_body_section_21_21.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_21_21 = new THREE.Mesh(
    mesh_body_section_21_21Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_21_21.name = "Body section 21";
  if (endpoint_body_section_21_21) {
    mesh_body_section_21_21.position.copy(endpoint_body_section_21_21.midpoint);
    mesh_body_section_21_21.quaternion.copy(endpoint_body_section_21_21.quaternion);
  }
  mesh_body_section_21_21.castShadow = options.castShadow ?? true;
  mesh_body_section_21_21.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_21_21.userData.sculptComponent = {"id": "body-section-21", "name": "Body section 21", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-21-mount", "structuralParent": "root", "localStart": [3.14, 0.007, 0.475], "localEnd": [3.14, 0.007, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.475, "height": 0.445, "depth": 0.214, "units": "relative", "confidence": 0.5}, "transform": {"position": [3.14, 0.007, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_21_21.add(mesh_body_section_21_21);
  meshes["body-section-21"] = mesh_body_section_21_21;
  colliders["body-section-21"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_22_22 = {"parentId": "root", "parentSocket": "root/body-section-22-mount", "structuralParent": "root", "localStart": [3.532, 0.009, 0.475], "localEnd": [3.532, 0.009, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_22_22 = makeAttachmentEndpoint(attachment_body_section_22_22);
  const node_body_section_22_22 = new THREE.Group();
  node_body_section_22_22.name = "Body section 22__pivot";
  if (endpoint_body_section_22_22) {
    node_body_section_22_22.position.copy(endpoint_body_section_22_22.start);
    node_body_section_22_22.rotation.set(0, 0, 0);
    node_body_section_22_22.scale.set(1, 1, 1);
  } else {
    node_body_section_22_22.position.set(3.532, 0.009, 0.475);
    node_body_section_22_22.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_22_22.scale.set(0.365, 0.445, 0.158);
  }
  node_body_section_22_22.userData.sculptComponent = {"id": "body-section-22", "name": "Body section 22", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-22-mount", "structuralParent": "root", "localStart": [3.532, 0.009, 0.475], "localEnd": [3.532, 0.009, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.365, "height": 0.445, "depth": 0.158, "units": "relative", "confidence": 0.5}, "transform": {"position": [3.532, 0.009, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_22_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_22_22);
  nodes["body-section-22"] = node_body_section_22_22;
  const mesh_body_section_22_22Geometry = endpoint_body_section_22_22
    ? new THREE.CylinderGeometry(endpoint_body_section_22_22.endRadius, endpoint_body_section_22_22.baseRadius, endpoint_body_section_22_22.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_22_22 = new THREE.Mesh(
    mesh_body_section_22_22Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_22_22.name = "Body section 22";
  if (endpoint_body_section_22_22) {
    mesh_body_section_22_22.position.copy(endpoint_body_section_22_22.midpoint);
    mesh_body_section_22_22.quaternion.copy(endpoint_body_section_22_22.quaternion);
  }
  mesh_body_section_22_22.castShadow = options.castShadow ?? true;
  mesh_body_section_22_22.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_22_22.userData.sculptComponent = {"id": "body-section-22", "name": "Body section 22", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-22-mount", "structuralParent": "root", "localStart": [3.532, 0.009, 0.475], "localEnd": [3.532, 0.009, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.365, "height": 0.445, "depth": 0.158, "units": "relative", "confidence": 0.5}, "transform": {"position": [3.532, 0.009, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_22_22.add(mesh_body_section_22_22);
  meshes["body-section-22"] = mesh_body_section_22_22;
  colliders["body-section-22"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_23_23 = {"parentId": "root", "parentSocket": "root/body-section-23-mount", "structuralParent": "root", "localStart": [3.924, 0.007, 0.475], "localEnd": [3.924, 0.007, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_23_23 = makeAttachmentEndpoint(attachment_body_section_23_23);
  const node_body_section_23_23 = new THREE.Group();
  node_body_section_23_23.name = "Body section 23__pivot";
  if (endpoint_body_section_23_23) {
    node_body_section_23_23.position.copy(endpoint_body_section_23_23.start);
    node_body_section_23_23.rotation.set(0, 0, 0);
    node_body_section_23_23.scale.set(1, 1, 1);
  } else {
    node_body_section_23_23.position.set(3.924, 0.007, 0.475);
    node_body_section_23_23.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_23_23.scale.set(0.271, 0.445, 0.115);
  }
  node_body_section_23_23.userData.sculptComponent = {"id": "body-section-23", "name": "Body section 23", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-23-mount", "structuralParent": "root", "localStart": [3.924, 0.007, 0.475], "localEnd": [3.924, 0.007, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.271, "height": 0.445, "depth": 0.115, "units": "relative", "confidence": 0.5}, "transform": {"position": [3.924, 0.007, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_23_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_23_23);
  nodes["body-section-23"] = node_body_section_23_23;
  const mesh_body_section_23_23Geometry = endpoint_body_section_23_23
    ? new THREE.CylinderGeometry(endpoint_body_section_23_23.endRadius, endpoint_body_section_23_23.baseRadius, endpoint_body_section_23_23.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_23_23 = new THREE.Mesh(
    mesh_body_section_23_23Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_23_23.name = "Body section 23";
  if (endpoint_body_section_23_23) {
    mesh_body_section_23_23.position.copy(endpoint_body_section_23_23.midpoint);
    mesh_body_section_23_23.quaternion.copy(endpoint_body_section_23_23.quaternion);
  }
  mesh_body_section_23_23.castShadow = options.castShadow ?? true;
  mesh_body_section_23_23.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_23_23.userData.sculptComponent = {"id": "body-section-23", "name": "Body section 23", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-23-mount", "structuralParent": "root", "localStart": [3.924, 0.007, 0.475], "localEnd": [3.924, 0.007, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.271, "height": 0.445, "depth": 0.115, "units": "relative", "confidence": 0.5}, "transform": {"position": [3.924, 0.007, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_23_23.add(mesh_body_section_23_23);
  meshes["body-section-23"] = mesh_body_section_23_23;
  colliders["body-section-23"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_24_24 = {"parentId": "root", "parentSocket": "root/body-section-24-mount", "structuralParent": "root", "localStart": [4.316, 0.004, 0.475], "localEnd": [4.316, 0.004, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_24_24 = makeAttachmentEndpoint(attachment_body_section_24_24);
  const node_body_section_24_24 = new THREE.Group();
  node_body_section_24_24.name = "Body section 24__pivot";
  if (endpoint_body_section_24_24) {
    node_body_section_24_24.position.copy(endpoint_body_section_24_24.start);
    node_body_section_24_24.rotation.set(0, 0, 0);
    node_body_section_24_24.scale.set(1, 1, 1);
  } else {
    node_body_section_24_24.position.set(4.316, 0.004, 0.475);
    node_body_section_24_24.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_24_24.scale.set(0.156, 0.445, 0.09);
  }
  node_body_section_24_24.userData.sculptComponent = {"id": "body-section-24", "name": "Body section 24", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-24-mount", "structuralParent": "root", "localStart": [4.316, 0.004, 0.475], "localEnd": [4.316, 0.004, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.156, "height": 0.445, "depth": 0.09, "units": "relative", "confidence": 0.5}, "transform": {"position": [4.316, 0.004, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_24_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_24_24);
  nodes["body-section-24"] = node_body_section_24_24;
  const mesh_body_section_24_24Geometry = endpoint_body_section_24_24
    ? new THREE.CylinderGeometry(endpoint_body_section_24_24.endRadius, endpoint_body_section_24_24.baseRadius, endpoint_body_section_24_24.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_24_24 = new THREE.Mesh(
    mesh_body_section_24_24Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_24_24.name = "Body section 24";
  if (endpoint_body_section_24_24) {
    mesh_body_section_24_24.position.copy(endpoint_body_section_24_24.midpoint);
    mesh_body_section_24_24.quaternion.copy(endpoint_body_section_24_24.quaternion);
  }
  mesh_body_section_24_24.castShadow = options.castShadow ?? true;
  mesh_body_section_24_24.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_24_24.userData.sculptComponent = {"id": "body-section-24", "name": "Body section 24", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-24-mount", "structuralParent": "root", "localStart": [4.316, 0.004, 0.475], "localEnd": [4.316, 0.004, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.156, "height": 0.445, "depth": 0.09, "units": "relative", "confidence": 0.5}, "transform": {"position": [4.316, 0.004, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_24_24.add(mesh_body_section_24_24);
  meshes["body-section-24"] = mesh_body_section_24_24;
  colliders["body-section-24"] = {"type": "box", "fit": "tight"};

  const attachment_body_section_25_25 = {"parentId": "root", "parentSocket": "root/body-section-25-mount", "structuralParent": "root", "localStart": [4.708, 0.0, 0.475], "localEnd": [4.708, 0.0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_body_section_25_25 = makeAttachmentEndpoint(attachment_body_section_25_25);
  const node_body_section_25_25 = new THREE.Group();
  node_body_section_25_25.name = "Body section 25__pivot";
  if (endpoint_body_section_25_25) {
    node_body_section_25_25.position.copy(endpoint_body_section_25_25.start);
    node_body_section_25_25.rotation.set(0, 0, 0);
    node_body_section_25_25.scale.set(1, 1, 1);
  } else {
    node_body_section_25_25.position.set(4.708, 0.0, 0.475);
    node_body_section_25_25.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_body_section_25_25.scale.set(0.114, 0.445, 0.093);
  }
  node_body_section_25_25.userData.sculptComponent = {"id": "body-section-25", "name": "Body section 25", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-25-mount", "structuralParent": "root", "localStart": [4.708, 0.0, 0.475], "localEnd": [4.708, 0.0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.114, "height": 0.445, "depth": 0.093, "units": "relative", "confidence": 0.5}, "transform": {"position": [4.708, 0.0, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_25_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_body_section_25_25);
  nodes["body-section-25"] = node_body_section_25_25;
  const mesh_body_section_25_25Geometry = endpoint_body_section_25_25
    ? new THREE.CylinderGeometry(endpoint_body_section_25_25.endRadius, endpoint_body_section_25_25.baseRadius, endpoint_body_section_25_25.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_body_section_25_25 = new THREE.Mesh(
    mesh_body_section_25_25Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_section_25_25.name = "Body section 25";
  if (endpoint_body_section_25_25) {
    mesh_body_section_25_25.position.copy(endpoint_body_section_25_25.midpoint);
    mesh_body_section_25_25.quaternion.copy(endpoint_body_section_25_25.quaternion);
  }
  mesh_body_section_25_25.castShadow = options.castShadow ?? true;
  mesh_body_section_25_25.receiveShadow = options.receiveShadow ?? true;
  mesh_body_section_25_25.userData.sculptComponent = {"id": "body-section-25", "name": "Body section 25", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Transverse elliptical body section. Stacked along the axis these loft the fish's rounded form, and each rim doubles as one of the reference's transverse plate seams. Height is traced from the silhouette; beam is inferred from a fish taper.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/body-section-25-mount", "structuralParent": "root", "localStart": [4.708, 0.0, 0.475], "localEnd": [4.708, 0.0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.114, "height": 0.445, "depth": 0.093, "units": "relative", "confidence": 0.5}, "transform": {"position": [4.708, 0.0, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_body_section_25_25.add(mesh_body_section_25_25);
  meshes["body-section-25"] = mesh_body_section_25_25;
  colliders["body-section-25"] = {"type": "box", "fit": "tight"};

  const attachment_caudal_lobe_upper_26 = {"parentId": "root", "parentSocket": "root/caudal-lobe-upper-mount", "structuralParent": "root", "localStart": [0, 0, 0.385], "localEnd": [0, 0, 0.385], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_caudal_lobe_upper_26 = makeAttachmentEndpoint(attachment_caudal_lobe_upper_26);
  const node_caudal_lobe_upper_26 = new THREE.Group();
  node_caudal_lobe_upper_26.name = "Caudal fin, upper lobe__pivot";
  if (endpoint_caudal_lobe_upper_26) {
    node_caudal_lobe_upper_26.position.copy(endpoint_caudal_lobe_upper_26.start);
    node_caudal_lobe_upper_26.rotation.set(0, 0, 0);
    node_caudal_lobe_upper_26.scale.set(1, 1, 1);
  } else {
    node_caudal_lobe_upper_26.position.set(0.0, 0.0, 0.385);
    node_caudal_lobe_upper_26.rotation.set(0.0, 0.0, 0.0);
    node_caudal_lobe_upper_26.scale.set(1.0, 1.0, 1.0);
  }
  node_caudal_lobe_upper_26.userData.sculptComponent = {"id": "caudal-lobe-upper", "name": "Caudal fin, upper lobe", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Upper lobe of a heterocercal (shark-style) tail. Earlier passes read this end as the BOW and modelled it first as a delta wing and then as a bow plane; it is the fluke.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-4.95, 0.56], [-3.28, 0.3], [-3.22, 0.02], [-4.82, 0.3]], "depth": 0.18}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/caudal-lobe-upper-mount", "structuralParent": "root", "localStart": [0, 0, 0.385], "localEnd": [0, 0, 0.385], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.75}, "transform": {"position": [0, 0, 0.385], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leading-edge-chamfer", "kind": "bevel", "description": "chamfered fin edge", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d09", "d04"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_caudal_lobe_upper_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_caudal_lobe_upper_26);
  nodes["caudal-lobe-upper"] = node_caudal_lobe_upper_26;
  const mesh_caudal_lobe_upper_26Geometry = endpoint_caudal_lobe_upper_26
    ? new THREE.CylinderGeometry(endpoint_caudal_lobe_upper_26.endRadius, endpoint_caudal_lobe_upper_26.baseRadius, endpoint_caudal_lobe_upper_26.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-4.95, 0.56], [-3.28, 0.3], [-3.22, 0.02], [-4.82, 0.3]], "depth": 0.18});
  const mesh_caudal_lobe_upper_26 = new THREE.Mesh(
    mesh_caudal_lobe_upper_26Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caudal_lobe_upper_26.name = "Caudal fin, upper lobe";
  if (endpoint_caudal_lobe_upper_26) {
    mesh_caudal_lobe_upper_26.position.copy(endpoint_caudal_lobe_upper_26.midpoint);
    mesh_caudal_lobe_upper_26.quaternion.copy(endpoint_caudal_lobe_upper_26.quaternion);
  }
  mesh_caudal_lobe_upper_26.castShadow = options.castShadow ?? true;
  mesh_caudal_lobe_upper_26.receiveShadow = options.receiveShadow ?? true;
  mesh_caudal_lobe_upper_26.userData.sculptComponent = {"id": "caudal-lobe-upper", "name": "Caudal fin, upper lobe", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Upper lobe of a heterocercal (shark-style) tail. Earlier passes read this end as the BOW and modelled it first as a delta wing and then as a bow plane; it is the fluke.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-4.95, 0.56], [-3.28, 0.3], [-3.22, 0.02], [-4.82, 0.3]], "depth": 0.18}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/caudal-lobe-upper-mount", "structuralParent": "root", "localStart": [0, 0, 0.385], "localEnd": [0, 0, 0.385], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.75}, "transform": {"position": [0, 0, 0.385], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leading-edge-chamfer", "kind": "bevel", "description": "chamfered fin edge", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d09", "d04"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_caudal_lobe_upper_26.add(mesh_caudal_lobe_upper_26);
  meshes["caudal-lobe-upper"] = mesh_caudal_lobe_upper_26;
  colliders["caudal-lobe-upper"] = {"type": "box", "fit": "tight"};

  const attachment_caudal_lobe_lower_27 = {"parentId": "root", "parentSocket": "root/caudal-lobe-lower-mount", "structuralParent": "root", "localStart": [0, 0, 0.395], "localEnd": [0, 0, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_caudal_lobe_lower_27 = makeAttachmentEndpoint(attachment_caudal_lobe_lower_27);
  const node_caudal_lobe_lower_27 = new THREE.Group();
  node_caudal_lobe_lower_27.name = "Caudal fin, lower lobe__pivot";
  if (endpoint_caudal_lobe_lower_27) {
    node_caudal_lobe_lower_27.position.copy(endpoint_caudal_lobe_lower_27.start);
    node_caudal_lobe_lower_27.rotation.set(0, 0, 0);
    node_caudal_lobe_lower_27.scale.set(1, 1, 1);
  } else {
    node_caudal_lobe_lower_27.position.set(0.0, 0.0, 0.39499999999999996);
    node_caudal_lobe_lower_27.rotation.set(0.0, 0.0, 0.0);
    node_caudal_lobe_lower_27.scale.set(1.0, 1.0, 1.0);
  }
  node_caudal_lobe_lower_27.userData.sculptComponent = {"id": "caudal-lobe-lower", "name": "Caudal fin, lower lobe", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.7, "confidence": 0.72, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Shorter lower lobe of the tail, below and forward of the upper lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.3, -0.1], [-2.52, -0.22], [-3.12, -0.6], [-3.9, -0.8]], "depth": 0.16}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/caudal-lobe-lower-mount", "structuralParent": "root", "localStart": [0, 0, 0.395], "localEnd": [0, 0, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.72}, "transform": {"position": [0, 0, 0.39499999999999996], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_caudal_lobe_lower_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_caudal_lobe_lower_27);
  nodes["caudal-lobe-lower"] = node_caudal_lobe_lower_27;
  const mesh_caudal_lobe_lower_27Geometry = endpoint_caudal_lobe_lower_27
    ? new THREE.CylinderGeometry(endpoint_caudal_lobe_lower_27.endRadius, endpoint_caudal_lobe_lower_27.baseRadius, endpoint_caudal_lobe_lower_27.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-3.3, -0.1], [-2.52, -0.22], [-3.12, -0.6], [-3.9, -0.8]], "depth": 0.16});
  const mesh_caudal_lobe_lower_27 = new THREE.Mesh(
    mesh_caudal_lobe_lower_27Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caudal_lobe_lower_27.name = "Caudal fin, lower lobe";
  if (endpoint_caudal_lobe_lower_27) {
    mesh_caudal_lobe_lower_27.position.copy(endpoint_caudal_lobe_lower_27.midpoint);
    mesh_caudal_lobe_lower_27.quaternion.copy(endpoint_caudal_lobe_lower_27.quaternion);
  }
  mesh_caudal_lobe_lower_27.castShadow = options.castShadow ?? true;
  mesh_caudal_lobe_lower_27.receiveShadow = options.receiveShadow ?? true;
  mesh_caudal_lobe_lower_27.userData.sculptComponent = {"id": "caudal-lobe-lower", "name": "Caudal fin, lower lobe", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.7, "confidence": 0.72, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Shorter lower lobe of the tail, below and forward of the upper lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.3, -0.1], [-2.52, -0.22], [-3.12, -0.6], [-3.9, -0.8]], "depth": 0.16}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/caudal-lobe-lower-mount", "structuralParent": "root", "localStart": [0, 0, 0.395], "localEnd": [0, 0, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.72}, "transform": {"position": [0, 0, 0.39499999999999996], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_caudal_lobe_lower_27.add(mesh_caudal_lobe_lower_27);
  meshes["caudal-lobe-lower"] = mesh_caudal_lobe_lower_27;
  colliders["caudal-lobe-lower"] = {"type": "box", "fit": "tight"};

  const attachment_ventral_keel_fin_28 = {"parentId": "root", "parentSocket": "root/ventral-keel-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.305], "localEnd": [0, 0, 0.305], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_ventral_keel_fin_28 = makeAttachmentEndpoint(attachment_ventral_keel_fin_28);
  const node_ventral_keel_fin_28 = new THREE.Group();
  node_ventral_keel_fin_28.name = "Ventral / anal fin__pivot";
  if (endpoint_ventral_keel_fin_28) {
    node_ventral_keel_fin_28.position.copy(endpoint_ventral_keel_fin_28.start);
    node_ventral_keel_fin_28.rotation.set(0, 0, 0);
    node_ventral_keel_fin_28.scale.set(1, 1, 1);
  } else {
    node_ventral_keel_fin_28.position.set(0.0, 0.0, 0.30499999999999994);
    node_ventral_keel_fin_28.rotation.set(0.0, 0.0, 0.0);
    node_ventral_keel_fin_28.scale.set(1.0, 1.0, 1.0);
  }
  node_ventral_keel_fin_28.userData.sculptComponent = {"id": "ventral-keel-fin", "name": "Ventral / anal fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.7, "confidence": 0.7, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Ventral fin reaching Y=-1.00. Read as a jaw when the vehicle was thought to face the other way; on a fish facing +X it sits between the vent and the tail.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.05, -0.16], [-1.95, -0.26], [-1.88, -1.0], [-2.62, -1.02], [-3.1, -0.62]], "depth": 0.34}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/ventral-keel-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.305], "localEnd": [0, 0, 0.305], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.30499999999999994], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_ventral_keel_fin_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_ventral_keel_fin_28);
  nodes["ventral-keel-fin"] = node_ventral_keel_fin_28;
  const mesh_ventral_keel_fin_28Geometry = endpoint_ventral_keel_fin_28
    ? new THREE.CylinderGeometry(endpoint_ventral_keel_fin_28.endRadius, endpoint_ventral_keel_fin_28.baseRadius, endpoint_ventral_keel_fin_28.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-3.05, -0.16], [-1.95, -0.26], [-1.88, -1.0], [-2.62, -1.02], [-3.1, -0.62]], "depth": 0.34});
  const mesh_ventral_keel_fin_28 = new THREE.Mesh(
    mesh_ventral_keel_fin_28Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ventral_keel_fin_28.name = "Ventral / anal fin";
  if (endpoint_ventral_keel_fin_28) {
    mesh_ventral_keel_fin_28.position.copy(endpoint_ventral_keel_fin_28.midpoint);
    mesh_ventral_keel_fin_28.quaternion.copy(endpoint_ventral_keel_fin_28.quaternion);
  }
  mesh_ventral_keel_fin_28.castShadow = options.castShadow ?? true;
  mesh_ventral_keel_fin_28.receiveShadow = options.receiveShadow ?? true;
  mesh_ventral_keel_fin_28.userData.sculptComponent = {"id": "ventral-keel-fin", "name": "Ventral / anal fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.7, "confidence": 0.7, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Ventral fin reaching Y=-1.00. Read as a jaw when the vehicle was thought to face the other way; on a fish facing +X it sits between the vent and the tail.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.05, -0.16], [-1.95, -0.26], [-1.88, -1.0], [-2.62, -1.02], [-3.1, -0.62]], "depth": 0.34}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/ventral-keel-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.305], "localEnd": [0, 0, 0.305], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.30499999999999994], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_ventral_keel_fin_28.add(mesh_ventral_keel_fin_28);
  meshes["ventral-keel-fin"] = mesh_ventral_keel_fin_28;
  colliders["ventral-keel-fin"] = {"type": "box", "fit": "tight"};

  const attachment_dorsal_mast_fin_29 = {"parentId": "root", "parentSocket": "root/dorsal-mast-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_dorsal_mast_fin_29 = makeAttachmentEndpoint(attachment_dorsal_mast_fin_29);
  const node_dorsal_mast_fin_29 = new THREE.Group();
  node_dorsal_mast_fin_29.name = "Dorsal mast fin shell__pivot";
  if (endpoint_dorsal_mast_fin_29) {
    node_dorsal_mast_fin_29.position.copy(endpoint_dorsal_mast_fin_29.start);
    node_dorsal_mast_fin_29.rotation.set(0, 0, 0);
    node_dorsal_mast_fin_29.scale.set(1, 1, 1);
  } else {
    node_dorsal_mast_fin_29.position.set(0.0, 0.0, 0.365);
    node_dorsal_mast_fin_29.rotation.set(0.0, 0.0, 0.0);
    node_dorsal_mast_fin_29.scale.set(1.0, 1.0, 1.0);
  }
  node_dorsal_mast_fin_29.userData.sculptComponent = {"id": "dorsal-mast-fin", "name": "Dorsal mast fin shell", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.92, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Tapered blade shell, authored as a BACK PLATE plus separate leading- and trailing-edge spars. The reference's outer white skin wraps the two edges and leaves the middle of the face open, exposing the machinery bay; a single full-thickness blade enclosed and hid every internal part.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.58, 2.53], [-1.24, 0.88], [-1.03, 0.26]], "depth": 0.06}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/dorsal-mast-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "explicit", "offset": [-1.62, 0.38, 0.0]}, "transformChannels": {"translate": false, "rotate": true, "scale": false}, "sockets": [{"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "fit": "tight"}, "constraints": [{"axis": "z", "minDeg": -84.0, "maxDeg": 0.0, "note": "folds aft flat onto the deck"}], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-pivot-bosses", "kind": "fastener", "description": "twin gold hinge bosses on a lateral axis at the fin root", "count": 2, "distribution": "mirrored-pair", "headShape": "disc", "detailRefs": ["d12"]}, {"id": "mast-shell-notch", "kind": "seam", "description": "notch between the shell leaves exposing the inner machinery bay", "detailRefs": ["d13"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12", "d13"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_dorsal_mast_fin_29.userData.actionProfile = {"animationRole": "hinge", "pivot": {"mode": "explicit", "offset": [-1.62, 0.38, 0.0]}, "transformChannels": {"translate": false, "rotate": true, "scale": false}, "sockets": [{"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "fit": "tight"}, "constraints": [{"axis": "z", "minDeg": -84.0, "maxDeg": 0.0, "note": "folds aft flat onto the deck"}], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_dorsal_mast_fin_29);
  nodes["dorsal-mast-fin"] = node_dorsal_mast_fin_29;
  const mesh_dorsal_mast_fin_29Geometry = endpoint_dorsal_mast_fin_29
    ? new THREE.CylinderGeometry(endpoint_dorsal_mast_fin_29.endRadius, endpoint_dorsal_mast_fin_29.baseRadius, endpoint_dorsal_mast_fin_29.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.58, 2.53], [-1.24, 0.88], [-1.03, 0.26]], "depth": 0.06});
  const mesh_dorsal_mast_fin_29 = new THREE.Mesh(
    mesh_dorsal_mast_fin_29Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dorsal_mast_fin_29.name = "Dorsal mast fin shell";
  if (endpoint_dorsal_mast_fin_29) {
    mesh_dorsal_mast_fin_29.position.copy(endpoint_dorsal_mast_fin_29.midpoint);
    mesh_dorsal_mast_fin_29.quaternion.copy(endpoint_dorsal_mast_fin_29.quaternion);
  }
  mesh_dorsal_mast_fin_29.castShadow = options.castShadow ?? true;
  mesh_dorsal_mast_fin_29.receiveShadow = options.receiveShadow ?? true;
  mesh_dorsal_mast_fin_29.userData.sculptComponent = {"id": "dorsal-mast-fin", "name": "Dorsal mast fin shell", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.92, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Tapered blade shell, authored as a BACK PLATE plus separate leading- and trailing-edge spars. The reference's outer white skin wraps the two edges and leaves the middle of the face open, exposing the machinery bay; a single full-thickness blade enclosed and hid every internal part.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.58, 2.53], [-1.24, 0.88], [-1.03, 0.26]], "depth": 0.06}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/dorsal-mast-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "explicit", "offset": [-1.62, 0.38, 0.0]}, "transformChannels": {"translate": false, "rotate": true, "scale": false}, "sockets": [{"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "fit": "tight"}, "constraints": [{"axis": "z", "minDeg": -84.0, "maxDeg": 0.0, "note": "folds aft flat onto the deck"}], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-pivot-bosses", "kind": "fastener", "description": "twin gold hinge bosses on a lateral axis at the fin root", "count": 2, "distribution": "mirrored-pair", "headShape": "disc", "detailRefs": ["d12"]}, {"id": "mast-shell-notch", "kind": "seam", "description": "notch between the shell leaves exposing the inner machinery bay", "detailRefs": ["d13"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12", "d13"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_dorsal_mast_fin_29.add(mesh_dorsal_mast_fin_29);
  meshes["dorsal-mast-fin"] = mesh_dorsal_mast_fin_29;
  colliders["dorsal-mast-fin"] = {"type": "box", "fit": "tight"};
  const socket_dorsal_mast_fin_mast_hinge_0 = new THREE.Object3D();
  socket_dorsal_mast_fin_mast_hinge_0.name = "mast-hinge";
  socket_dorsal_mast_fin_mast_hinge_0.position.set(-1.62, 0.38, 0.0);
  socket_dorsal_mast_fin_mast_hinge_0.rotation.set(0.0, 0.0, 0.0);
  socket_dorsal_mast_fin_mast_hinge_0.userData.socket = {"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]};
  node_dorsal_mast_fin_29.add(socket_dorsal_mast_fin_mast_hinge_0);
  sockets["dorsal-mast-fin:mast-hinge"] = socket_dorsal_mast_fin_mast_hinge_0;

  const attachment_mast_spar_leading_30 = {"parentId": "root", "parentSocket": "root/mast-spar-leading-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_spar_leading_30 = makeAttachmentEndpoint(attachment_mast_spar_leading_30);
  const node_mast_spar_leading_30 = new THREE.Group();
  node_mast_spar_leading_30.name = "Mast Spar Leading__pivot";
  if (endpoint_mast_spar_leading_30) {
    node_mast_spar_leading_30.position.copy(endpoint_mast_spar_leading_30.start);
    node_mast_spar_leading_30.rotation.set(0, 0, 0);
    node_mast_spar_leading_30.scale.set(1, 1, 1);
  } else {
    node_mast_spar_leading_30.position.set(0.0, 0.0, 0.365);
    node_mast_spar_leading_30.rotation.set(0.0, 0.0, 0.0);
    node_mast_spar_leading_30.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_spar_leading_30.userData.sculptComponent = {"id": "mast-spar-leading", "name": "Mast Spar Leading", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.66, 2.53], [-1.7, 0.88], [-1.93, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-leading-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_leading_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mast_spar_leading_30);
  nodes["mast-spar-leading"] = node_mast_spar_leading_30;
  const mesh_mast_spar_leading_30Geometry = endpoint_mast_spar_leading_30
    ? new THREE.CylinderGeometry(endpoint_mast_spar_leading_30.endRadius, endpoint_mast_spar_leading_30.baseRadius, endpoint_mast_spar_leading_30.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.66, 2.53], [-1.7, 0.88], [-1.93, 0.26]], "depth": 0.22});
  const mesh_mast_spar_leading_30 = new THREE.Mesh(
    mesh_mast_spar_leading_30Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_spar_leading_30.name = "Mast Spar Leading";
  if (endpoint_mast_spar_leading_30) {
    mesh_mast_spar_leading_30.position.copy(endpoint_mast_spar_leading_30.midpoint);
    mesh_mast_spar_leading_30.quaternion.copy(endpoint_mast_spar_leading_30.quaternion);
  }
  mesh_mast_spar_leading_30.castShadow = options.castShadow ?? true;
  mesh_mast_spar_leading_30.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_spar_leading_30.userData.sculptComponent = {"id": "mast-spar-leading", "name": "Mast Spar Leading", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.66, 2.53], [-1.7, 0.88], [-1.93, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-leading-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_leading_30.add(mesh_mast_spar_leading_30);
  meshes["mast-spar-leading"] = mesh_mast_spar_leading_30;
  colliders["mast-spar-leading"] = {"type": "box", "fit": "tight"};

  const attachment_mast_spar_trailing_31 = {"parentId": "root", "parentSocket": "root/mast-spar-trailing-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_spar_trailing_31 = makeAttachmentEndpoint(attachment_mast_spar_trailing_31);
  const node_mast_spar_trailing_31 = new THREE.Group();
  node_mast_spar_trailing_31.name = "Mast Spar Trailing__pivot";
  if (endpoint_mast_spar_trailing_31) {
    node_mast_spar_trailing_31.position.copy(endpoint_mast_spar_trailing_31.start);
    node_mast_spar_trailing_31.rotation.set(0, 0, 0);
    node_mast_spar_trailing_31.scale.set(1, 1, 1);
  } else {
    node_mast_spar_trailing_31.position.set(0.0, 0.0, 0.365);
    node_mast_spar_trailing_31.rotation.set(0.0, 0.0, 0.0);
    node_mast_spar_trailing_31.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_spar_trailing_31.userData.sculptComponent = {"id": "mast-spar-trailing", "name": "Mast Spar Trailing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.4, 0.26], [-1.35, 0.88], [-1.51, 2.53], [-1.58, 2.53], [-1.42, 0.88], [-1.03, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-trailing-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_trailing_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mast_spar_trailing_31);
  nodes["mast-spar-trailing"] = node_mast_spar_trailing_31;
  const mesh_mast_spar_trailing_31Geometry = endpoint_mast_spar_trailing_31
    ? new THREE.CylinderGeometry(endpoint_mast_spar_trailing_31.endRadius, endpoint_mast_spar_trailing_31.baseRadius, endpoint_mast_spar_trailing_31.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.4, 0.26], [-1.35, 0.88], [-1.51, 2.53], [-1.58, 2.53], [-1.42, 0.88], [-1.03, 0.26]], "depth": 0.22});
  const mesh_mast_spar_trailing_31 = new THREE.Mesh(
    mesh_mast_spar_trailing_31Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_spar_trailing_31.name = "Mast Spar Trailing";
  if (endpoint_mast_spar_trailing_31) {
    mesh_mast_spar_trailing_31.position.copy(endpoint_mast_spar_trailing_31.midpoint);
    mesh_mast_spar_trailing_31.quaternion.copy(endpoint_mast_spar_trailing_31.quaternion);
  }
  mesh_mast_spar_trailing_31.castShadow = options.castShadow ?? true;
  mesh_mast_spar_trailing_31.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_spar_trailing_31.userData.sculptComponent = {"id": "mast-spar-trailing", "name": "Mast Spar Trailing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.4, 0.26], [-1.35, 0.88], [-1.51, 2.53], [-1.58, 2.53], [-1.42, 0.88], [-1.03, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-trailing-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_trailing_31.add(mesh_mast_spar_trailing_31);
  meshes["mast-spar-trailing"] = mesh_mast_spar_trailing_31;
  colliders["mast-spar-trailing"] = {"type": "box", "fit": "tight"};

  const attachment_visceral_cavity_32 = {"parentId": "root", "parentSocket": "root/visceral-cavity-mount", "structuralParent": "root", "localStart": [-0.8, -0.26, 0.475], "localEnd": [-0.8, -0.26, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_cavity_32 = makeAttachmentEndpoint(attachment_visceral_cavity_32);
  const node_visceral_cavity_32 = new THREE.Group();
  node_visceral_cavity_32.name = "Visceral cavity shell__pivot";
  if (endpoint_visceral_cavity_32) {
    node_visceral_cavity_32.position.copy(endpoint_visceral_cavity_32.start);
    node_visceral_cavity_32.rotation.set(0, 0, 0);
    node_visceral_cavity_32.scale.set(1, 1, 1);
  } else {
    node_visceral_cavity_32.position.set(-0.8, -0.26, 0.475);
    node_visceral_cavity_32.rotation.set(0.0, 0.0, 0.0);
    node_visceral_cavity_32.scale.set(3.7, 0.24, 0.8);
  }
  node_visceral_cavity_32.userData.sculptComponent = {"id": "visceral-cavity", "name": "Visceral cavity shell", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Open bay the tubing spills out of - a shallow shelf, not an enclosure. The tubes must hang clear below it as they do in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-cavity-mount", "structuralParent": "root", "localStart": [-0.8, -0.26, 0.475], "localEnd": [-0.8, -0.26, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 3.7, "height": 0.24, "depth": 0.8, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.8, -0.26, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pod-banding-straps", "kind": "fastener", "description": "steel bands cinching every third gut lobe", "count": 4, "distribution": "every-third-lobe", "headShape": "band", "detailRefs": ["d07"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_cavity_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_visceral_cavity_32);
  nodes["visceral-cavity"] = node_visceral_cavity_32;
  const mesh_visceral_cavity_32Geometry = endpoint_visceral_cavity_32
    ? new THREE.CylinderGeometry(endpoint_visceral_cavity_32.endRadius, endpoint_visceral_cavity_32.baseRadius, endpoint_visceral_cavity_32.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_visceral_cavity_32 = new THREE.Mesh(
    mesh_visceral_cavity_32Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_cavity_32.name = "Visceral cavity shell";
  if (endpoint_visceral_cavity_32) {
    mesh_visceral_cavity_32.position.copy(endpoint_visceral_cavity_32.midpoint);
    mesh_visceral_cavity_32.quaternion.copy(endpoint_visceral_cavity_32.quaternion);
  }
  mesh_visceral_cavity_32.castShadow = options.castShadow ?? true;
  mesh_visceral_cavity_32.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_cavity_32.userData.sculptComponent = {"id": "visceral-cavity", "name": "Visceral cavity shell", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Open bay the tubing spills out of - a shallow shelf, not an enclosure. The tubes must hang clear below it as they do in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-cavity-mount", "structuralParent": "root", "localStart": [-0.8, -0.26, 0.475], "localEnd": [-0.8, -0.26, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 3.7, "height": 0.24, "depth": 0.8, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.8, -0.26, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pod-banding-straps", "kind": "fastener", "description": "steel bands cinching every third gut lobe", "count": 4, "distribution": "every-third-lobe", "headShape": "band", "detailRefs": ["d07"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_cavity_32.add(mesh_visceral_cavity_32);
  meshes["visceral-cavity"] = mesh_visceral_cavity_32;
  colliders["visceral-cavity"] = {"type": "box", "fit": "tight"};

  const attachment_stern_bay_housing_33 = {"parentId": "root", "parentSocket": "root/stern-bay-housing-mount", "structuralParent": "root", "localStart": [2.05, -0.09, -0.045], "localEnd": [2.05, -0.09, -0.045], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_stern_bay_housing_33 = makeAttachmentEndpoint(attachment_stern_bay_housing_33);
  const node_stern_bay_housing_33 = new THREE.Group();
  node_stern_bay_housing_33.name = "Gill bay housing__pivot";
  if (endpoint_stern_bay_housing_33) {
    node_stern_bay_housing_33.position.copy(endpoint_stern_bay_housing_33.start);
    node_stern_bay_housing_33.rotation.set(0, 0, 0);
    node_stern_bay_housing_33.scale.set(1, 1, 1);
  } else {
    node_stern_bay_housing_33.position.set(2.05, -0.09, -0.04500000000000004);
    node_stern_bay_housing_33.rotation.set(0.0, 0.0, 0.0);
    node_stern_bay_housing_33.scale.set(1.7, 0.58, 0.34);
  }
  node_stern_bay_housing_33.userData.sculptComponent = {"id": "stern-bay-housing", "name": "Gill bay housing", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.85, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back wall of the open gill bay behind the head. The reference bay is OPEN toward the viewer with the gill slits and mouth set into it; a full-depth solid box occluded both.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/stern-bay-housing-mount", "structuralParent": "root", "localStart": [2.05, -0.09, -0.045], "localEnd": [2.05, -0.09, -0.045], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.7, "height": 0.58, "depth": 0.34, "units": "relative", "confidence": 0.75}, "transform": {"position": [2.05, -0.09, -0.04500000000000004], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gill-slit-array", "kind": "linework", "description": "two mirrored banks of 5 slanted gill slits behind the head", "technique": "engraved-groove", "count": 10, "detailRefs": ["d10"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10", "d11"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_stern_bay_housing_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_stern_bay_housing_33);
  nodes["stern-bay-housing"] = node_stern_bay_housing_33;
  const mesh_stern_bay_housing_33Geometry = endpoint_stern_bay_housing_33
    ? new THREE.CylinderGeometry(endpoint_stern_bay_housing_33.endRadius, endpoint_stern_bay_housing_33.baseRadius, endpoint_stern_bay_housing_33.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_stern_bay_housing_33 = new THREE.Mesh(
    mesh_stern_bay_housing_33Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stern_bay_housing_33.name = "Gill bay housing";
  if (endpoint_stern_bay_housing_33) {
    mesh_stern_bay_housing_33.position.copy(endpoint_stern_bay_housing_33.midpoint);
    mesh_stern_bay_housing_33.quaternion.copy(endpoint_stern_bay_housing_33.quaternion);
  }
  mesh_stern_bay_housing_33.castShadow = options.castShadow ?? true;
  mesh_stern_bay_housing_33.receiveShadow = options.receiveShadow ?? true;
  mesh_stern_bay_housing_33.userData.sculptComponent = {"id": "stern-bay-housing", "name": "Gill bay housing", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.85, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back wall of the open gill bay behind the head. The reference bay is OPEN toward the viewer with the gill slits and mouth set into it; a full-depth solid box occluded both.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/stern-bay-housing-mount", "structuralParent": "root", "localStart": [2.05, -0.09, -0.045], "localEnd": [2.05, -0.09, -0.045], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.7, "height": 0.58, "depth": 0.34, "units": "relative", "confidence": 0.75}, "transform": {"position": [2.05, -0.09, -0.04500000000000004], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gill-slit-array", "kind": "linework", "description": "two mirrored banks of 5 slanted gill slits behind the head", "technique": "engraved-groove", "count": 10, "detailRefs": ["d10"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10", "d11"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_stern_bay_housing_33.add(mesh_stern_bay_housing_33);
  meshes["stern-bay-housing"] = mesh_stern_bay_housing_33;
  colliders["stern-bay-housing"] = {"type": "box", "fit": "tight"};

  const attachment_canopy_blister_34 = {"parentId": "root", "parentSocket": "root/canopy-blister-mount", "structuralParent": "root", "localStart": [-1.85, 0.52, 0.635], "localEnd": [-1.85, 0.52, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_canopy_blister_34 = makeAttachmentEndpoint(attachment_canopy_blister_34);
  const node_canopy_blister_34 = new THREE.Group();
  node_canopy_blister_34.name = "Canopy / sensor blister__pivot";
  if (endpoint_canopy_blister_34) {
    node_canopy_blister_34.position.copy(endpoint_canopy_blister_34.start);
    node_canopy_blister_34.rotation.set(0, 0, 0);
    node_canopy_blister_34.scale.set(1, 1, 1);
  } else {
    node_canopy_blister_34.position.set(-1.85, 0.52, 0.635);
    node_canopy_blister_34.rotation.set(0.0, 0.0, 0.0);
    node_canopy_blister_34.scale.set(0.42, 0.26, 0.34);
  }
  node_canopy_blister_34.userData.sculptComponent = {"id": "canopy-blister", "name": "Canopy / sensor blister", "level": "meso", "role": "detail", "logicalParent": "root", "importance": 0.55, "confidence": 0.6, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Doubly-curved blister; a sphere section is the correct topology class, not a faceted box.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/canopy-blister-mount", "structuralParent": "root", "localStart": [-1.85, 0.52, 0.635], "localEnd": [-1.85, 0.52, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.42, "height": 0.26, "depth": 0.34, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.85, 0.52, 0.635], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "canopy-slash-highlight", "kind": "gloss", "description": "hard painted white slash on the glazing, drawn not simulated", "roughness": 0.08, "detailRefs": ["d01"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 42, 48, 1.0)", "secondaryAlbedo": "rgba(36, 42, 48, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.65, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(36, 42, 48, 1.0)"}, {"position": 1.0, "color": "rgba(36, 42, 48, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_canopy_blister_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_canopy_blister_34);
  nodes["canopy-blister"] = node_canopy_blister_34;
  const mesh_canopy_blister_34Geometry = endpoint_canopy_blister_34
    ? new THREE.CylinderGeometry(endpoint_canopy_blister_34.endRadius, endpoint_canopy_blister_34.baseRadius, endpoint_canopy_blister_34.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  const mesh_canopy_blister_34 = new THREE.Mesh(
    mesh_canopy_blister_34Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_canopy_blister_34.name = "Canopy / sensor blister";
  if (endpoint_canopy_blister_34) {
    mesh_canopy_blister_34.position.copy(endpoint_canopy_blister_34.midpoint);
    mesh_canopy_blister_34.quaternion.copy(endpoint_canopy_blister_34.quaternion);
  }
  mesh_canopy_blister_34.castShadow = options.castShadow ?? true;
  mesh_canopy_blister_34.receiveShadow = options.receiveShadow ?? true;
  mesh_canopy_blister_34.userData.sculptComponent = {"id": "canopy-blister", "name": "Canopy / sensor blister", "level": "meso", "role": "detail", "logicalParent": "root", "importance": 0.55, "confidence": 0.6, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Doubly-curved blister; a sphere section is the correct topology class, not a faceted box.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/canopy-blister-mount", "structuralParent": "root", "localStart": [-1.85, 0.52, 0.635], "localEnd": [-1.85, 0.52, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.42, "height": 0.26, "depth": 0.34, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.85, 0.52, 0.635], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "canopy-slash-highlight", "kind": "gloss", "description": "hard painted white slash on the glazing, drawn not simulated", "roughness": 0.08, "detailRefs": ["d01"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 42, 48, 1.0)", "secondaryAlbedo": "rgba(36, 42, 48, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.65, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(36, 42, 48, 1.0)"}, {"position": 1.0, "color": "rgba(36, 42, 48, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_canopy_blister_34.add(mesh_canopy_blister_34);
  meshes["canopy-blister"] = mesh_canopy_blister_34;
  colliders["canopy-blister"] = {"type": "box", "fit": "tight"};

  const attachment_wing_leading_spar_35 = {"parentId": "root", "parentSocket": "root/wing-leading-spar-mount", "structuralParent": "root", "localStart": [-3.3, 0.06, 0.475], "localEnd": [-3.3, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_wing_leading_spar_35 = makeAttachmentEndpoint(attachment_wing_leading_spar_35);
  const node_wing_leading_spar_35 = new THREE.Group();
  node_wing_leading_spar_35.name = "Tail root spar__pivot";
  if (endpoint_wing_leading_spar_35) {
    node_wing_leading_spar_35.position.copy(endpoint_wing_leading_spar_35.start);
    node_wing_leading_spar_35.rotation.set(0, 0, 0);
    node_wing_leading_spar_35.scale.set(1, 1, 1);
  } else {
    node_wing_leading_spar_35.position.set(-3.3, 0.06, 0.475);
    node_wing_leading_spar_35.rotation.set(0.0, 0.0, 0.0);
    node_wing_leading_spar_35.scale.set(0.34, 0.07, 0.46);
  }
  node_wing_leading_spar_35.userData.sculptComponent = {"id": "wing-leading-spar", "name": "Tail root spar", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight spar box across the caudal fin roots.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/wing-leading-spar-mount", "structuralParent": "root", "localStart": [-3.3, 0.06, 0.475], "localEnd": [-3.3, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.34, "height": 0.07, "depth": 0.46, "units": "relative", "confidence": 0.55}, "transform": {"position": [-3.3, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_wing_leading_spar_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_wing_leading_spar_35);
  nodes["wing-leading-spar"] = node_wing_leading_spar_35;
  const mesh_wing_leading_spar_35Geometry = endpoint_wing_leading_spar_35
    ? new THREE.CylinderGeometry(endpoint_wing_leading_spar_35.endRadius, endpoint_wing_leading_spar_35.baseRadius, endpoint_wing_leading_spar_35.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_wing_leading_spar_35 = new THREE.Mesh(
    mesh_wing_leading_spar_35Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_leading_spar_35.name = "Tail root spar";
  if (endpoint_wing_leading_spar_35) {
    mesh_wing_leading_spar_35.position.copy(endpoint_wing_leading_spar_35.midpoint);
    mesh_wing_leading_spar_35.quaternion.copy(endpoint_wing_leading_spar_35.quaternion);
  }
  mesh_wing_leading_spar_35.castShadow = options.castShadow ?? true;
  mesh_wing_leading_spar_35.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_leading_spar_35.userData.sculptComponent = {"id": "wing-leading-spar", "name": "Tail root spar", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight spar box across the caudal fin roots.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/wing-leading-spar-mount", "structuralParent": "root", "localStart": [-3.3, 0.06, 0.475], "localEnd": [-3.3, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.34, "height": 0.07, "depth": 0.46, "units": "relative", "confidence": 0.55}, "transform": {"position": [-3.3, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_wing_leading_spar_35.add(mesh_wing_leading_spar_35);
  meshes["wing-leading-spar"] = mesh_wing_leading_spar_35;
  colliders["wing-leading-spar"] = {"type": "box", "fit": "tight"};

  const attachment_tail_spine_rail_36 = {"parentId": "root", "parentSocket": "root/tail-spine-rail-mount", "structuralParent": "root", "localStart": [2.9, 0.02, 0.475], "localEnd": [2.9, 0.02, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_spine_rail_36 = makeAttachmentEndpoint(attachment_tail_spine_rail_36);
  const node_tail_spine_rail_36 = new THREE.Group();
  node_tail_spine_rail_36.name = "Tail spine rail__pivot";
  if (endpoint_tail_spine_rail_36) {
    node_tail_spine_rail_36.position.copy(endpoint_tail_spine_rail_36.start);
    node_tail_spine_rail_36.rotation.set(0, 0, 0);
    node_tail_spine_rail_36.scale.set(1, 1, 1);
  } else {
    node_tail_spine_rail_36.position.set(2.9, 0.02, 0.475);
    node_tail_spine_rail_36.rotation.set(0.0, 0.0, 0.0);
    node_tail_spine_rail_36.scale.set(4.1, 0.06, 0.18);
  }
  node_tail_spine_rail_36.userData.sculptComponent = {"id": "tail-spine-rail", "name": "Tail spine rail", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Continuous dark rail along the tail blade centreline in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-spine-rail-mount", "structuralParent": "root", "localStart": [2.9, 0.02, 0.475], "localEnd": [2.9, 0.02, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.1, "height": 0.06, "depth": 0.18, "units": "relative", "confidence": 0.65}, "transform": {"position": [2.9, 0.02, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_spine_rail_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_spine_rail_36);
  nodes["tail-spine-rail"] = node_tail_spine_rail_36;
  const mesh_tail_spine_rail_36Geometry = endpoint_tail_spine_rail_36
    ? new THREE.CylinderGeometry(endpoint_tail_spine_rail_36.endRadius, endpoint_tail_spine_rail_36.baseRadius, endpoint_tail_spine_rail_36.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_spine_rail_36 = new THREE.Mesh(
    mesh_tail_spine_rail_36Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_spine_rail_36.name = "Tail spine rail";
  if (endpoint_tail_spine_rail_36) {
    mesh_tail_spine_rail_36.position.copy(endpoint_tail_spine_rail_36.midpoint);
    mesh_tail_spine_rail_36.quaternion.copy(endpoint_tail_spine_rail_36.quaternion);
  }
  mesh_tail_spine_rail_36.castShadow = options.castShadow ?? true;
  mesh_tail_spine_rail_36.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_spine_rail_36.userData.sculptComponent = {"id": "tail-spine-rail", "name": "Tail spine rail", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Continuous dark rail along the tail blade centreline in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-spine-rail-mount", "structuralParent": "root", "localStart": [2.9, 0.02, 0.475], "localEnd": [2.9, 0.02, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.1, "height": 0.06, "depth": 0.18, "units": "relative", "confidence": 0.65}, "transform": {"position": [2.9, 0.02, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_spine_rail_36.add(mesh_tail_spine_rail_36);
  meshes["tail-spine-rail"] = mesh_tail_spine_rail_36;
  colliders["tail-spine-rail"] = {"type": "box", "fit": "tight"};

  const attachment_mid_stabilizer_fin_37 = {"parentId": "root", "parentSocket": "root/mid-stabilizer-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.405], "localEnd": [0, 0, 0.405], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_mid_stabilizer_fin_37 = makeAttachmentEndpoint(attachment_mid_stabilizer_fin_37);
  const node_mid_stabilizer_fin_37 = new THREE.Group();
  node_mid_stabilizer_fin_37.name = "Mid stabiliser fin__pivot";
  if (endpoint_mid_stabilizer_fin_37) {
    node_mid_stabilizer_fin_37.position.copy(endpoint_mid_stabilizer_fin_37.start);
    node_mid_stabilizer_fin_37.rotation.set(0, 0, 0);
    node_mid_stabilizer_fin_37.scale.set(1, 1, 1);
  } else {
    node_mid_stabilizer_fin_37.position.set(0.0, 0.0, 0.40499999999999997);
    node_mid_stabilizer_fin_37.rotation.set(0.0, 0.0, 0.0);
    node_mid_stabilizer_fin_37.scale.set(1.0, 1.0, 1.0);
  }
  node_mid_stabilizer_fin_37.userData.sculptComponent = {"id": "mid-stabilizer-fin", "name": "Mid stabiliser fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Small tapered blade sheet echoing the mast fin. Macro rather than meso because it is a distinct silhouette landmark in the reference, not a sub-part of the tail.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[1.02, 0.24], [1.14, 0.99], [1.24, 0.99], [1.5, 0.26]], "depth": 0.14}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mid-stabilizer-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.405], "localEnd": [0, 0, 0.405], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.40499999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "midfin-blue-strip", "kind": "linework", "description": "blue leading-edge strip", "detailRefs": ["d08"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mid_stabilizer_fin_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mid_stabilizer_fin_37);
  nodes["mid-stabilizer-fin"] = node_mid_stabilizer_fin_37;
  const mesh_mid_stabilizer_fin_37Geometry = endpoint_mid_stabilizer_fin_37
    ? new THREE.CylinderGeometry(endpoint_mid_stabilizer_fin_37.endRadius, endpoint_mid_stabilizer_fin_37.baseRadius, endpoint_mid_stabilizer_fin_37.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.02, 0.24], [1.14, 0.99], [1.24, 0.99], [1.5, 0.26]], "depth": 0.14});
  const mesh_mid_stabilizer_fin_37 = new THREE.Mesh(
    mesh_mid_stabilizer_fin_37Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mid_stabilizer_fin_37.name = "Mid stabiliser fin";
  if (endpoint_mid_stabilizer_fin_37) {
    mesh_mid_stabilizer_fin_37.position.copy(endpoint_mid_stabilizer_fin_37.midpoint);
    mesh_mid_stabilizer_fin_37.quaternion.copy(endpoint_mid_stabilizer_fin_37.quaternion);
  }
  mesh_mid_stabilizer_fin_37.castShadow = options.castShadow ?? true;
  mesh_mid_stabilizer_fin_37.receiveShadow = options.receiveShadow ?? true;
  mesh_mid_stabilizer_fin_37.userData.sculptComponent = {"id": "mid-stabilizer-fin", "name": "Mid stabiliser fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Small tapered blade sheet echoing the mast fin. Macro rather than meso because it is a distinct silhouette landmark in the reference, not a sub-part of the tail.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[1.02, 0.24], [1.14, 0.99], [1.24, 0.99], [1.5, 0.26]], "depth": 0.14}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mid-stabilizer-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.405], "localEnd": [0, 0, 0.405], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.40499999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "midfin-blue-strip", "kind": "linework", "description": "blue leading-edge strip", "detailRefs": ["d08"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mid_stabilizer_fin_37.add(mesh_mid_stabilizer_fin_37);
  meshes["mid-stabilizer-fin"] = mesh_mid_stabilizer_fin_37;
  colliders["mid-stabilizer-fin"] = {"type": "box", "fit": "tight"};

  const attachment_mast_inner_machinery_38 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-inner-machinery-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.67, 1.05, 0.01], "localEnd": [-1.67, 1.05, 0.01], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_inner_machinery_38 = makeAttachmentEndpoint(attachment_mast_inner_machinery_38);
  const node_mast_inner_machinery_38 = new THREE.Group();
  node_mast_inner_machinery_38.name = "Mast inner machinery box__pivot";
  if (endpoint_mast_inner_machinery_38) {
    node_mast_inner_machinery_38.position.copy(endpoint_mast_inner_machinery_38.start);
    node_mast_inner_machinery_38.rotation.set(0, 0, 0);
    node_mast_inner_machinery_38.scale.set(1, 1, 1);
  } else {
    node_mast_inner_machinery_38.position.set(-1.67, 1.05, 0.01);
    node_mast_inner_machinery_38.rotation.set(0.0, 0.0, 0.0);
    node_mast_inner_machinery_38.scale.set(0.2, 0.85, 0.16);
  }
  node_mast_inner_machinery_38.userData.sculptComponent = {"id": "mast-inner-machinery", "name": "Mast inner machinery box", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.7, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Boxy exposed equipment stack visible between the shell leaves.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-inner-machinery-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.67, 1.05, 0.01], "localEnd": [-1.67, 1.05, 0.01], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.2, "height": 0.85, "depth": 0.16, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.67, 1.05, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_inner_machinery_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_inner_machinery_38);
  nodes["mast-inner-machinery"] = node_mast_inner_machinery_38;
  const mesh_mast_inner_machinery_38Geometry = endpoint_mast_inner_machinery_38
    ? new THREE.CylinderGeometry(endpoint_mast_inner_machinery_38.endRadius, endpoint_mast_inner_machinery_38.baseRadius, endpoint_mast_inner_machinery_38.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_inner_machinery_38 = new THREE.Mesh(
    mesh_mast_inner_machinery_38Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_inner_machinery_38.name = "Mast inner machinery box";
  if (endpoint_mast_inner_machinery_38) {
    mesh_mast_inner_machinery_38.position.copy(endpoint_mast_inner_machinery_38.midpoint);
    mesh_mast_inner_machinery_38.quaternion.copy(endpoint_mast_inner_machinery_38.quaternion);
  }
  mesh_mast_inner_machinery_38.castShadow = options.castShadow ?? true;
  mesh_mast_inner_machinery_38.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_inner_machinery_38.userData.sculptComponent = {"id": "mast-inner-machinery", "name": "Mast inner machinery box", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.7, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Boxy exposed equipment stack visible between the shell leaves.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-inner-machinery-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.67, 1.05, 0.01], "localEnd": [-1.67, 1.05, 0.01], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.2, "height": 0.85, "depth": 0.16, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.67, 1.05, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_inner_machinery_38.add(mesh_mast_inner_machinery_38);
  meshes["mast-inner-machinery"] = mesh_mast_inner_machinery_38;
  colliders["mast-inner-machinery"] = {"type": "box", "fit": "tight"};

  const attachment_mast_coolant_strip_39 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-coolant-strip-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.73, 1.72, 0.02], "localEnd": [-1.73, 1.72, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_coolant_strip_39 = makeAttachmentEndpoint(attachment_mast_coolant_strip_39);
  const node_mast_coolant_strip_39 = new THREE.Group();
  node_mast_coolant_strip_39.name = "Mast coolant strip__pivot";
  if (endpoint_mast_coolant_strip_39) {
    node_mast_coolant_strip_39.position.copy(endpoint_mast_coolant_strip_39.start);
    node_mast_coolant_strip_39.rotation.set(0, 0, 0);
    node_mast_coolant_strip_39.scale.set(1, 1, 1);
  } else {
    node_mast_coolant_strip_39.position.set(-1.73, 1.72, 0.02);
    node_mast_coolant_strip_39.rotation.set(0.0, 0.0, 0.0);
    node_mast_coolant_strip_39.scale.set(0.09, 0.62, 0.1);
  }
  node_mast_coolant_strip_39.userData.sculptComponent = {"id": "mast-coolant-strip", "name": "Mast coolant strip", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat teal strip inboard of the shell.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-coolant-strip-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.73, 1.72, 0.02], "localEnd": [-1.73, 1.72, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.62, "depth": 0.1, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.73, 1.72, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-teal", "materialLayers": ["accent-teal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 143, 122, 1.0)", "secondaryAlbedo": "rgba(31, 143, 122, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.5, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(31, 143, 122, 1.0)"}, {"position": 1.0, "color": "rgba(31, 143, 122, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_coolant_strip_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_coolant_strip_39);
  nodes["mast-coolant-strip"] = node_mast_coolant_strip_39;
  const mesh_mast_coolant_strip_39Geometry = endpoint_mast_coolant_strip_39
    ? new THREE.CylinderGeometry(endpoint_mast_coolant_strip_39.endRadius, endpoint_mast_coolant_strip_39.baseRadius, endpoint_mast_coolant_strip_39.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_coolant_strip_39 = new THREE.Mesh(
    mesh_mast_coolant_strip_39Geometry,
    materialMap["accent-teal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_coolant_strip_39.name = "Mast coolant strip";
  if (endpoint_mast_coolant_strip_39) {
    mesh_mast_coolant_strip_39.position.copy(endpoint_mast_coolant_strip_39.midpoint);
    mesh_mast_coolant_strip_39.quaternion.copy(endpoint_mast_coolant_strip_39.quaternion);
  }
  mesh_mast_coolant_strip_39.castShadow = options.castShadow ?? true;
  mesh_mast_coolant_strip_39.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_coolant_strip_39.userData.sculptComponent = {"id": "mast-coolant-strip", "name": "Mast coolant strip", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat teal strip inboard of the shell.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-coolant-strip-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.73, 1.72, 0.02], "localEnd": [-1.73, 1.72, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.62, "depth": 0.1, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.73, 1.72, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-teal", "materialLayers": ["accent-teal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 143, 122, 1.0)", "secondaryAlbedo": "rgba(31, 143, 122, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.5, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(31, 143, 122, 1.0)"}, {"position": 1.0, "color": "rgba(31, 143, 122, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_coolant_strip_39.add(mesh_mast_coolant_strip_39);
  meshes["mast-coolant-strip"] = mesh_mast_coolant_strip_39;
  colliders["mast-coolant-strip"] = {"type": "box", "fit": "tight"};

  const attachment_mast_terminal_block_40 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-terminal-block-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.61, 0.6, 0.02], "localEnd": [-1.61, 0.6, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_terminal_block_40 = makeAttachmentEndpoint(attachment_mast_terminal_block_40);
  const node_mast_terminal_block_40 = new THREE.Group();
  node_mast_terminal_block_40.name = "Mast terminal block__pivot";
  if (endpoint_mast_terminal_block_40) {
    node_mast_terminal_block_40.position.copy(endpoint_mast_terminal_block_40.start);
    node_mast_terminal_block_40.rotation.set(0, 0, 0);
    node_mast_terminal_block_40.scale.set(1, 1, 1);
  } else {
    node_mast_terminal_block_40.position.set(-1.61, 0.6, 0.02);
    node_mast_terminal_block_40.rotation.set(0.0, 0.0, 0.0);
    node_mast_terminal_block_40.scale.set(0.13, 0.16, 0.11);
  }
  node_mast_terminal_block_40.userData.sculptComponent = {"id": "mast-terminal-block", "name": "Mast terminal block", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.45, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small red equipment block at the machinery stack root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-terminal-block-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.61, 0.6, 0.02], "localEnd": [-1.61, 0.6, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.11, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.61, 0.6, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_terminal_block_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_terminal_block_40);
  nodes["mast-terminal-block"] = node_mast_terminal_block_40;
  const mesh_mast_terminal_block_40Geometry = endpoint_mast_terminal_block_40
    ? new THREE.CylinderGeometry(endpoint_mast_terminal_block_40.endRadius, endpoint_mast_terminal_block_40.baseRadius, endpoint_mast_terminal_block_40.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_terminal_block_40 = new THREE.Mesh(
    mesh_mast_terminal_block_40Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_terminal_block_40.name = "Mast terminal block";
  if (endpoint_mast_terminal_block_40) {
    mesh_mast_terminal_block_40.position.copy(endpoint_mast_terminal_block_40.midpoint);
    mesh_mast_terminal_block_40.quaternion.copy(endpoint_mast_terminal_block_40.quaternion);
  }
  mesh_mast_terminal_block_40.castShadow = options.castShadow ?? true;
  mesh_mast_terminal_block_40.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_terminal_block_40.userData.sculptComponent = {"id": "mast-terminal-block", "name": "Mast terminal block", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.45, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small red equipment block at the machinery stack root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-terminal-block-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.61, 0.6, 0.02], "localEnd": [-1.61, 0.6, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.11, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.61, 0.6, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_terminal_block_40.add(mesh_mast_terminal_block_40);
  meshes["mast-terminal-block"] = mesh_mast_terminal_block_40;
  colliders["mast-terminal-block"] = {"type": "box", "fit": "tight"};

  const attachment_mast_pivot_boss_port_41 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-port-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, -0.17], "localEnd": [-1.62, 0.38, -0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_pivot_boss_port_41 = makeAttachmentEndpoint(attachment_mast_pivot_boss_port_41);
  const node_mast_pivot_boss_port_41 = new THREE.Group();
  node_mast_pivot_boss_port_41.name = "Mast pivot boss (port)__pivot";
  if (endpoint_mast_pivot_boss_port_41) {
    node_mast_pivot_boss_port_41.position.copy(endpoint_mast_pivot_boss_port_41.start);
    node_mast_pivot_boss_port_41.rotation.set(0, 0, 0);
    node_mast_pivot_boss_port_41.scale.set(1, 1, 1);
  } else {
    node_mast_pivot_boss_port_41.position.set(-1.62, 0.38, -0.17);
    node_mast_pivot_boss_port_41.rotation.set(1.5707963267948966, 0.0, 0.0);
    node_mast_pivot_boss_port_41.scale.set(0.28, 0.1, 0.28);
  }
  node_mast_pivot_boss_port_41.userData.sculptComponent = {"id": "mast-pivot-boss-port", "name": "Mast pivot boss (port)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-port-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, -0.17], "localEnd": [-1.62, 0.38, -0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, -0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_port_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_pivot_boss_port_41);
  nodes["mast-pivot-boss-port"] = node_mast_pivot_boss_port_41;
  const mesh_mast_pivot_boss_port_41Geometry = endpoint_mast_pivot_boss_port_41
    ? new THREE.CylinderGeometry(endpoint_mast_pivot_boss_port_41.endRadius, endpoint_mast_pivot_boss_port_41.baseRadius, endpoint_mast_pivot_boss_port_41.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_mast_pivot_boss_port_41 = new THREE.Mesh(
    mesh_mast_pivot_boss_port_41Geometry,
    materialMap["accent-gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_pivot_boss_port_41.name = "Mast pivot boss (port)";
  if (endpoint_mast_pivot_boss_port_41) {
    mesh_mast_pivot_boss_port_41.position.copy(endpoint_mast_pivot_boss_port_41.midpoint);
    mesh_mast_pivot_boss_port_41.quaternion.copy(endpoint_mast_pivot_boss_port_41.quaternion);
  }
  mesh_mast_pivot_boss_port_41.castShadow = options.castShadow ?? true;
  mesh_mast_pivot_boss_port_41.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_pivot_boss_port_41.userData.sculptComponent = {"id": "mast-pivot-boss-port", "name": "Mast pivot boss (port)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-port-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, -0.17], "localEnd": [-1.62, 0.38, -0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, -0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_port_41.add(mesh_mast_pivot_boss_port_41);
  meshes["mast-pivot-boss-port"] = mesh_mast_pivot_boss_port_41;
  colliders["mast-pivot-boss-port"] = {"type": "box", "fit": "tight"};

  const attachment_mast_pivot_boss_stbd_42 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-stbd-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, 0.17], "localEnd": [-1.62, 0.38, 0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_pivot_boss_stbd_42 = makeAttachmentEndpoint(attachment_mast_pivot_boss_stbd_42);
  const node_mast_pivot_boss_stbd_42 = new THREE.Group();
  node_mast_pivot_boss_stbd_42.name = "Mast pivot boss (stbd)__pivot";
  if (endpoint_mast_pivot_boss_stbd_42) {
    node_mast_pivot_boss_stbd_42.position.copy(endpoint_mast_pivot_boss_stbd_42.start);
    node_mast_pivot_boss_stbd_42.rotation.set(0, 0, 0);
    node_mast_pivot_boss_stbd_42.scale.set(1, 1, 1);
  } else {
    node_mast_pivot_boss_stbd_42.position.set(-1.62, 0.38, 0.17);
    node_mast_pivot_boss_stbd_42.rotation.set(1.5707963267948966, 0.0, 0.0);
    node_mast_pivot_boss_stbd_42.scale.set(0.28, 0.1, 0.28);
  }
  node_mast_pivot_boss_stbd_42.userData.sculptComponent = {"id": "mast-pivot-boss-stbd", "name": "Mast pivot boss (stbd)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-stbd-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, 0.17], "localEnd": [-1.62, 0.38, 0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, 0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_stbd_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_pivot_boss_stbd_42);
  nodes["mast-pivot-boss-stbd"] = node_mast_pivot_boss_stbd_42;
  const mesh_mast_pivot_boss_stbd_42Geometry = endpoint_mast_pivot_boss_stbd_42
    ? new THREE.CylinderGeometry(endpoint_mast_pivot_boss_stbd_42.endRadius, endpoint_mast_pivot_boss_stbd_42.baseRadius, endpoint_mast_pivot_boss_stbd_42.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_mast_pivot_boss_stbd_42 = new THREE.Mesh(
    mesh_mast_pivot_boss_stbd_42Geometry,
    materialMap["accent-gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_pivot_boss_stbd_42.name = "Mast pivot boss (stbd)";
  if (endpoint_mast_pivot_boss_stbd_42) {
    mesh_mast_pivot_boss_stbd_42.position.copy(endpoint_mast_pivot_boss_stbd_42.midpoint);
    mesh_mast_pivot_boss_stbd_42.quaternion.copy(endpoint_mast_pivot_boss_stbd_42.quaternion);
  }
  mesh_mast_pivot_boss_stbd_42.castShadow = options.castShadow ?? true;
  mesh_mast_pivot_boss_stbd_42.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_pivot_boss_stbd_42.userData.sculptComponent = {"id": "mast-pivot-boss-stbd", "name": "Mast pivot boss (stbd)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-stbd-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, 0.17], "localEnd": [-1.62, 0.38, 0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, 0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_stbd_42.add(mesh_mast_pivot_boss_stbd_42);
  meshes["mast-pivot-boss-stbd"] = mesh_mast_pivot_boss_stbd_42;
  colliders["mast-pivot-boss-stbd"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_housing_43 = {"parentId": "root", "parentSocket": "root/mast-base-housing-mount", "structuralParent": "root", "localStart": [0, 0, 0.175], "localEnd": [0, 0, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_housing_43 = makeAttachmentEndpoint(attachment_mast_base_housing_43);
  const node_mast_base_housing_43 = new THREE.Group();
  node_mast_base_housing_43.name = "Mast base housing__pivot";
  if (endpoint_mast_base_housing_43) {
    node_mast_base_housing_43.position.copy(endpoint_mast_base_housing_43.start);
    node_mast_base_housing_43.rotation.set(0, 0, 0);
    node_mast_base_housing_43.scale.set(1, 1, 1);
  } else {
    node_mast_base_housing_43.position.set(0.0, 0.0, 0.175);
    node_mast_base_housing_43.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_housing_43.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_base_housing_43.userData.sculptComponent = {"id": "mast-base-housing", "name": "Mast base housing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Faceted pyramidal housing; planar facets with hard creases, so an extruded polygon is correct.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.15, 0.28], [-1.85, 0.9], [-1.17, 0.9], [-1.01, 0.28], [-1.15, 0.1], [-2.05, 0.1]], "depth": 0.6}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-base-housing-mount", "structuralParent": "root", "localStart": [0, 0, 0.175], "localEnd": [0, 0, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.175], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-base-vents", "kind": "linework", "description": "two banks of 4 yellow louvre slats flanking the base housing", "technique": "engraved-groove", "count": 8, "detailRefs": ["d14"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14", "d15"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_housing_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mast_base_housing_43);
  nodes["mast-base-housing"] = node_mast_base_housing_43;
  const mesh_mast_base_housing_43Geometry = endpoint_mast_base_housing_43
    ? new THREE.CylinderGeometry(endpoint_mast_base_housing_43.endRadius, endpoint_mast_base_housing_43.baseRadius, endpoint_mast_base_housing_43.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.15, 0.28], [-1.85, 0.9], [-1.17, 0.9], [-1.01, 0.28], [-1.15, 0.1], [-2.05, 0.1]], "depth": 0.6});
  const mesh_mast_base_housing_43 = new THREE.Mesh(
    mesh_mast_base_housing_43Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_housing_43.name = "Mast base housing";
  if (endpoint_mast_base_housing_43) {
    mesh_mast_base_housing_43.position.copy(endpoint_mast_base_housing_43.midpoint);
    mesh_mast_base_housing_43.quaternion.copy(endpoint_mast_base_housing_43.quaternion);
  }
  mesh_mast_base_housing_43.castShadow = options.castShadow ?? true;
  mesh_mast_base_housing_43.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_housing_43.userData.sculptComponent = {"id": "mast-base-housing", "name": "Mast base housing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Faceted pyramidal housing; planar facets with hard creases, so an extruded polygon is correct.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.15, 0.28], [-1.85, 0.9], [-1.17, 0.9], [-1.01, 0.28], [-1.15, 0.1], [-2.05, 0.1]], "depth": 0.6}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-base-housing-mount", "structuralParent": "root", "localStart": [0, 0, 0.175], "localEnd": [0, 0, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.175], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-base-vents", "kind": "linework", "description": "two banks of 4 yellow louvre slats flanking the base housing", "technique": "engraved-groove", "count": 8, "detailRefs": ["d14"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14", "d15"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_housing_43.add(mesh_mast_base_housing_43);
  meshes["mast-base-housing"] = mesh_mast_base_housing_43;
  colliders["mast-base-housing"] = {"type": "box", "fit": "tight"};

  const attachment_visceral_bundle_01_44 = {"parentId": "root", "parentSocket": "root/visceral-bundle-01-mount", "structuralParent": "root", "localStart": [-2.38, -0.52, 0.615], "localEnd": [-2.38, -0.52, 0.615], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_01_44 = makeAttachmentEndpoint(attachment_visceral_bundle_01_44);
  const node_visceral_bundle_01_44 = new THREE.Group();
  node_visceral_bundle_01_44.name = "Gut lobe 1__pivot";
  if (endpoint_visceral_bundle_01_44) {
    node_visceral_bundle_01_44.position.copy(endpoint_visceral_bundle_01_44.start);
    node_visceral_bundle_01_44.rotation.set(0, 0, 0);
    node_visceral_bundle_01_44.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_01_44.position.set(-2.38, -0.52, 0.615);
    node_visceral_bundle_01_44.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_01_44.scale.set(0.686, 0.7, 0.686);
  }
  node_visceral_bundle_01_44.userData.sculptComponent = {"id": "visceral-bundle-01", "name": "Gut lobe 1", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-01-mount", "structuralParent": "root", "localStart": [-2.38, -0.52, 0.615], "localEnd": [-2.38, -0.52, 0.615], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.686, "height": 0.7, "depth": 0.686, "units": "relative", "confidence": 0.65}, "transform": {"position": [-2.38, -0.52, 0.615], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-01", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_01_44.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-01", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_01_44);
  nodes["visceral-bundle-01"] = node_visceral_bundle_01_44;
  const mesh_visceral_bundle_01_44Geometry = endpoint_visceral_bundle_01_44
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_01_44.endRadius, endpoint_visceral_bundle_01_44.baseRadius, endpoint_visceral_bundle_01_44.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_01_44 = new THREE.Mesh(
    mesh_visceral_bundle_01_44Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_01_44.name = "Gut lobe 1";
  if (endpoint_visceral_bundle_01_44) {
    mesh_visceral_bundle_01_44.position.copy(endpoint_visceral_bundle_01_44.midpoint);
    mesh_visceral_bundle_01_44.quaternion.copy(endpoint_visceral_bundle_01_44.quaternion);
  }
  mesh_visceral_bundle_01_44.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_01_44.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_01_44.userData.sculptComponent = {"id": "visceral-bundle-01", "name": "Gut lobe 1", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-01-mount", "structuralParent": "root", "localStart": [-2.38, -0.52, 0.615], "localEnd": [-2.38, -0.52, 0.615], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.686, "height": 0.7, "depth": 0.686, "units": "relative", "confidence": 0.65}, "transform": {"position": [-2.38, -0.52, 0.615], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-01", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_01_44.add(mesh_visceral_bundle_01_44);
  meshes["visceral-bundle-01"] = mesh_visceral_bundle_01_44;
  colliders["visceral-bundle-01"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_01_viscera_mount_01_0 = new THREE.Object3D();
  socket_visceral_bundle_01_viscera_mount_01_0.name = "viscera-mount-01";
  socket_visceral_bundle_01_viscera_mount_01_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_01_viscera_mount_01_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_01_viscera_mount_01_0.userData.socket = {"id": "viscera-mount-01", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_01_44.add(socket_visceral_bundle_01_viscera_mount_01_0);
  sockets["visceral-bundle-01:viscera-mount-01"] = socket_visceral_bundle_01_viscera_mount_01_0;

  const attachment_viscera_band_01a_45 = {"parentId": "root", "parentSocket": "root/viscera-band-01a-mount", "structuralParent": "root", "localStart": [-2.38, -0.41, 0.615], "localEnd": [-2.38, -0.41, 0.615], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_viscera_band_01a_45 = makeAttachmentEndpoint(attachment_viscera_band_01a_45);
  const node_viscera_band_01a_45 = new THREE.Group();
  node_viscera_band_01a_45.name = "Gut band 1__pivot";
  if (endpoint_viscera_band_01a_45) {
    node_viscera_band_01a_45.position.copy(endpoint_viscera_band_01a_45.start);
    node_viscera_band_01a_45.rotation.set(0, 0, 0);
    node_viscera_band_01a_45.scale.set(1, 1, 1);
  } else {
    node_viscera_band_01a_45.position.set(-2.38, -0.41000000000000003, 0.615);
    node_viscera_band_01a_45.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_viscera_band_01a_45.scale.set(0.564, 0.564, 0.564);
  }
  node_viscera_band_01a_45.userData.sculptComponent = {"id": "viscera-band-01a", "name": "Gut band 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-01a-mount", "structuralParent": "root", "localStart": [-2.38, -0.41, 0.615], "localEnd": [-2.38, -0.41, 0.615], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.564, "height": 0.564, "depth": 0.564, "units": "relative", "confidence": 0.62}, "transform": {"position": [-2.38, -0.41000000000000003, 0.615], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_01a_45.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_viscera_band_01a_45);
  nodes["viscera-band-01a"] = node_viscera_band_01a_45;
  const mesh_viscera_band_01a_45Geometry = endpoint_viscera_band_01a_45
    ? new THREE.CylinderGeometry(endpoint_viscera_band_01a_45.endRadius, endpoint_viscera_band_01a_45.baseRadius, endpoint_viscera_band_01a_45.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_viscera_band_01a_45 = new THREE.Mesh(
    mesh_viscera_band_01a_45Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_viscera_band_01a_45.name = "Gut band 1";
  if (endpoint_viscera_band_01a_45) {
    mesh_viscera_band_01a_45.position.copy(endpoint_viscera_band_01a_45.midpoint);
    mesh_viscera_band_01a_45.quaternion.copy(endpoint_viscera_band_01a_45.quaternion);
  }
  mesh_viscera_band_01a_45.castShadow = options.castShadow ?? true;
  mesh_viscera_band_01a_45.receiveShadow = options.receiveShadow ?? true;
  mesh_viscera_band_01a_45.userData.sculptComponent = {"id": "viscera-band-01a", "name": "Gut band 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-01a-mount", "structuralParent": "root", "localStart": [-2.38, -0.41, 0.615], "localEnd": [-2.38, -0.41, 0.615], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.564, "height": 0.564, "depth": 0.564, "units": "relative", "confidence": 0.62}, "transform": {"position": [-2.38, -0.41000000000000003, 0.615], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_01a_45.add(mesh_viscera_band_01a_45);
  meshes["viscera-band-01a"] = mesh_viscera_band_01a_45;
  colliders["viscera-band-01a"] = {"type": "box", "fit": "tight"};

  const attachment_visceral_bundle_02_46 = {"parentId": "root", "parentSocket": "root/visceral-bundle-02-mount", "structuralParent": "root", "localStart": [-2.02, -0.7, 0.455], "localEnd": [-2.02, -0.7, 0.455], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_02_46 = makeAttachmentEndpoint(attachment_visceral_bundle_02_46);
  const node_visceral_bundle_02_46 = new THREE.Group();
  node_visceral_bundle_02_46.name = "Gut lobe 2__pivot";
  if (endpoint_visceral_bundle_02_46) {
    node_visceral_bundle_02_46.position.copy(endpoint_visceral_bundle_02_46.start);
    node_visceral_bundle_02_46.rotation.set(0, 0, 0);
    node_visceral_bundle_02_46.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_02_46.position.set(-2.02, -0.7, 0.45499999999999996);
    node_visceral_bundle_02_46.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_02_46.scale.set(0.886, 1.1, 0.886);
  }
  node_visceral_bundle_02_46.userData.sculptComponent = {"id": "visceral-bundle-02", "name": "Gut lobe 2", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-02-mount", "structuralParent": "root", "localStart": [-2.02, -0.7, 0.455], "localEnd": [-2.02, -0.7, 0.455], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.886, "height": 1.1, "depth": 0.886, "units": "relative", "confidence": 0.65}, "transform": {"position": [-2.02, -0.7, 0.45499999999999996], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-02", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_02_46.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-02", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_02_46);
  nodes["visceral-bundle-02"] = node_visceral_bundle_02_46;
  const mesh_visceral_bundle_02_46Geometry = endpoint_visceral_bundle_02_46
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_02_46.endRadius, endpoint_visceral_bundle_02_46.baseRadius, endpoint_visceral_bundle_02_46.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_02_46 = new THREE.Mesh(
    mesh_visceral_bundle_02_46Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_02_46.name = "Gut lobe 2";
  if (endpoint_visceral_bundle_02_46) {
    mesh_visceral_bundle_02_46.position.copy(endpoint_visceral_bundle_02_46.midpoint);
    mesh_visceral_bundle_02_46.quaternion.copy(endpoint_visceral_bundle_02_46.quaternion);
  }
  mesh_visceral_bundle_02_46.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_02_46.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_02_46.userData.sculptComponent = {"id": "visceral-bundle-02", "name": "Gut lobe 2", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-02-mount", "structuralParent": "root", "localStart": [-2.02, -0.7, 0.455], "localEnd": [-2.02, -0.7, 0.455], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.886, "height": 1.1, "depth": 0.886, "units": "relative", "confidence": 0.65}, "transform": {"position": [-2.02, -0.7, 0.45499999999999996], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-02", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_02_46.add(mesh_visceral_bundle_02_46);
  meshes["visceral-bundle-02"] = mesh_visceral_bundle_02_46;
  colliders["visceral-bundle-02"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_02_viscera_mount_02_0 = new THREE.Object3D();
  socket_visceral_bundle_02_viscera_mount_02_0.name = "viscera-mount-02";
  socket_visceral_bundle_02_viscera_mount_02_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_02_viscera_mount_02_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_02_viscera_mount_02_0.userData.socket = {"id": "viscera-mount-02", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_02_46.add(socket_visceral_bundle_02_viscera_mount_02_0);
  sockets["visceral-bundle-02:viscera-mount-02"] = socket_visceral_bundle_02_viscera_mount_02_0;

  const attachment_visceral_bundle_03_47 = {"parentId": "root", "parentSocket": "root/visceral-bundle-03-mount", "structuralParent": "root", "localStart": [-1.66, -0.58, 0.635], "localEnd": [-1.66, -0.58, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_03_47 = makeAttachmentEndpoint(attachment_visceral_bundle_03_47);
  const node_visceral_bundle_03_47 = new THREE.Group();
  node_visceral_bundle_03_47.name = "Gut lobe 3__pivot";
  if (endpoint_visceral_bundle_03_47) {
    node_visceral_bundle_03_47.position.copy(endpoint_visceral_bundle_03_47.start);
    node_visceral_bundle_03_47.rotation.set(0, 0, 0);
    node_visceral_bundle_03_47.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_03_47.position.set(-1.66, -0.58, 0.635);
    node_visceral_bundle_03_47.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_03_47.scale.set(0.714, 0.8, 0.714);
  }
  node_visceral_bundle_03_47.userData.sculptComponent = {"id": "visceral-bundle-03", "name": "Gut lobe 3", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-03-mount", "structuralParent": "root", "localStart": [-1.66, -0.58, 0.635], "localEnd": [-1.66, -0.58, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.714, "height": 0.8, "depth": 0.714, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.66, -0.58, 0.635], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-03", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_03_47.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-03", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_03_47);
  nodes["visceral-bundle-03"] = node_visceral_bundle_03_47;
  const mesh_visceral_bundle_03_47Geometry = endpoint_visceral_bundle_03_47
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_03_47.endRadius, endpoint_visceral_bundle_03_47.baseRadius, endpoint_visceral_bundle_03_47.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_03_47 = new THREE.Mesh(
    mesh_visceral_bundle_03_47Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_03_47.name = "Gut lobe 3";
  if (endpoint_visceral_bundle_03_47) {
    mesh_visceral_bundle_03_47.position.copy(endpoint_visceral_bundle_03_47.midpoint);
    mesh_visceral_bundle_03_47.quaternion.copy(endpoint_visceral_bundle_03_47.quaternion);
  }
  mesh_visceral_bundle_03_47.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_03_47.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_03_47.userData.sculptComponent = {"id": "visceral-bundle-03", "name": "Gut lobe 3", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-03-mount", "structuralParent": "root", "localStart": [-1.66, -0.58, 0.635], "localEnd": [-1.66, -0.58, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.714, "height": 0.8, "depth": 0.714, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.66, -0.58, 0.635], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-03", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_03_47.add(mesh_visceral_bundle_03_47);
  meshes["visceral-bundle-03"] = mesh_visceral_bundle_03_47;
  colliders["visceral-bundle-03"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_03_viscera_mount_03_0 = new THREE.Object3D();
  socket_visceral_bundle_03_viscera_mount_03_0.name = "viscera-mount-03";
  socket_visceral_bundle_03_viscera_mount_03_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_03_viscera_mount_03_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_03_viscera_mount_03_0.userData.socket = {"id": "viscera-mount-03", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_03_47.add(socket_visceral_bundle_03_viscera_mount_03_0);
  sockets["visceral-bundle-03:viscera-mount-03"] = socket_visceral_bundle_03_viscera_mount_03_0;

  const attachment_visceral_bundle_04_48 = {"parentId": "root", "parentSocket": "root/visceral-bundle-04-mount", "structuralParent": "root", "localStart": [-1.26, -0.76, 0.395], "localEnd": [-1.26, -0.76, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_04_48 = makeAttachmentEndpoint(attachment_visceral_bundle_04_48);
  const node_visceral_bundle_04_48 = new THREE.Group();
  node_visceral_bundle_04_48.name = "Gut lobe 4__pivot";
  if (endpoint_visceral_bundle_04_48) {
    node_visceral_bundle_04_48.position.copy(endpoint_visceral_bundle_04_48.start);
    node_visceral_bundle_04_48.rotation.set(0, 0, 0);
    node_visceral_bundle_04_48.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_04_48.position.set(-1.26, -0.76, 0.39499999999999996);
    node_visceral_bundle_04_48.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_04_48.scale.set(0.943, 1.2, 0.943);
  }
  node_visceral_bundle_04_48.userData.sculptComponent = {"id": "visceral-bundle-04", "name": "Gut lobe 4", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-04-mount", "structuralParent": "root", "localStart": [-1.26, -0.76, 0.395], "localEnd": [-1.26, -0.76, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.943, "height": 1.2, "depth": 0.943, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.26, -0.76, 0.39499999999999996], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-04", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_04_48.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-04", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_04_48);
  nodes["visceral-bundle-04"] = node_visceral_bundle_04_48;
  const mesh_visceral_bundle_04_48Geometry = endpoint_visceral_bundle_04_48
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_04_48.endRadius, endpoint_visceral_bundle_04_48.baseRadius, endpoint_visceral_bundle_04_48.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_04_48 = new THREE.Mesh(
    mesh_visceral_bundle_04_48Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_04_48.name = "Gut lobe 4";
  if (endpoint_visceral_bundle_04_48) {
    mesh_visceral_bundle_04_48.position.copy(endpoint_visceral_bundle_04_48.midpoint);
    mesh_visceral_bundle_04_48.quaternion.copy(endpoint_visceral_bundle_04_48.quaternion);
  }
  mesh_visceral_bundle_04_48.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_04_48.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_04_48.userData.sculptComponent = {"id": "visceral-bundle-04", "name": "Gut lobe 4", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-04-mount", "structuralParent": "root", "localStart": [-1.26, -0.76, 0.395], "localEnd": [-1.26, -0.76, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.943, "height": 1.2, "depth": 0.943, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.26, -0.76, 0.39499999999999996], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-04", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_04_48.add(mesh_visceral_bundle_04_48);
  meshes["visceral-bundle-04"] = mesh_visceral_bundle_04_48;
  colliders["visceral-bundle-04"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_04_viscera_mount_04_0 = new THREE.Object3D();
  socket_visceral_bundle_04_viscera_mount_04_0.name = "viscera-mount-04";
  socket_visceral_bundle_04_viscera_mount_04_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_04_viscera_mount_04_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_04_viscera_mount_04_0.userData.socket = {"id": "viscera-mount-04", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_04_48.add(socket_visceral_bundle_04_viscera_mount_04_0);
  sockets["visceral-bundle-04:viscera-mount-04"] = socket_visceral_bundle_04_viscera_mount_04_0;

  const attachment_viscera_band_04a_49 = {"parentId": "root", "parentSocket": "root/viscera-band-04a-mount", "structuralParent": "root", "localStart": [-1.26, -0.536, 0.395], "localEnd": [-1.26, -0.536, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_viscera_band_04a_49 = makeAttachmentEndpoint(attachment_viscera_band_04a_49);
  const node_viscera_band_04a_49 = new THREE.Group();
  node_viscera_band_04a_49.name = "Gut band 4__pivot";
  if (endpoint_viscera_band_04a_49) {
    node_viscera_band_04a_49.position.copy(endpoint_viscera_band_04a_49.start);
    node_viscera_band_04a_49.rotation.set(0, 0, 0);
    node_viscera_band_04a_49.scale.set(1, 1, 1);
  } else {
    node_viscera_band_04a_49.position.set(-1.26, -0.5356, 0.39499999999999996);
    node_viscera_band_04a_49.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_viscera_band_04a_49.scale.set(0.776, 0.776, 0.776);
  }
  node_viscera_band_04a_49.userData.sculptComponent = {"id": "viscera-band-04a", "name": "Gut band 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-04a-mount", "structuralParent": "root", "localStart": [-1.26, -0.536, 0.395], "localEnd": [-1.26, -0.536, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.776, "height": 0.776, "depth": 0.776, "units": "relative", "confidence": 0.62}, "transform": {"position": [-1.26, -0.5356, 0.39499999999999996], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_04a_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_viscera_band_04a_49);
  nodes["viscera-band-04a"] = node_viscera_band_04a_49;
  const mesh_viscera_band_04a_49Geometry = endpoint_viscera_band_04a_49
    ? new THREE.CylinderGeometry(endpoint_viscera_band_04a_49.endRadius, endpoint_viscera_band_04a_49.baseRadius, endpoint_viscera_band_04a_49.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_viscera_band_04a_49 = new THREE.Mesh(
    mesh_viscera_band_04a_49Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_viscera_band_04a_49.name = "Gut band 4";
  if (endpoint_viscera_band_04a_49) {
    mesh_viscera_band_04a_49.position.copy(endpoint_viscera_band_04a_49.midpoint);
    mesh_viscera_band_04a_49.quaternion.copy(endpoint_viscera_band_04a_49.quaternion);
  }
  mesh_viscera_band_04a_49.castShadow = options.castShadow ?? true;
  mesh_viscera_band_04a_49.receiveShadow = options.receiveShadow ?? true;
  mesh_viscera_band_04a_49.userData.sculptComponent = {"id": "viscera-band-04a", "name": "Gut band 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-04a-mount", "structuralParent": "root", "localStart": [-1.26, -0.536, 0.395], "localEnd": [-1.26, -0.536, 0.395], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.776, "height": 0.776, "depth": 0.776, "units": "relative", "confidence": 0.62}, "transform": {"position": [-1.26, -0.5356, 0.39499999999999996], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_04a_49.add(mesh_viscera_band_04a_49);
  meshes["viscera-band-04a"] = mesh_viscera_band_04a_49;
  colliders["viscera-band-04a"] = {"type": "box", "fit": "tight"};

  const attachment_visceral_bundle_05_50 = {"parentId": "root", "parentSocket": "root/visceral-bundle-05-mount", "structuralParent": "root", "localStart": [-0.9, -0.55, 0.595], "localEnd": [-0.9, -0.55, 0.595], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_05_50 = makeAttachmentEndpoint(attachment_visceral_bundle_05_50);
  const node_visceral_bundle_05_50 = new THREE.Group();
  node_visceral_bundle_05_50.name = "Gut lobe 5__pivot";
  if (endpoint_visceral_bundle_05_50) {
    node_visceral_bundle_05_50.position.copy(endpoint_visceral_bundle_05_50.start);
    node_visceral_bundle_05_50.rotation.set(0, 0, 0);
    node_visceral_bundle_05_50.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_05_50.position.set(-0.9, -0.55, 0.595);
    node_visceral_bundle_05_50.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_05_50.scale.set(0.657, 0.714, 0.657);
  }
  node_visceral_bundle_05_50.userData.sculptComponent = {"id": "visceral-bundle-05", "name": "Gut lobe 5", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-05-mount", "structuralParent": "root", "localStart": [-0.9, -0.55, 0.595], "localEnd": [-0.9, -0.55, 0.595], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.657, "height": 0.714, "depth": 0.657, "units": "relative", "confidence": 0.65}, "transform": {"position": [-0.9, -0.55, 0.595], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-05", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_05_50.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-05", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_05_50);
  nodes["visceral-bundle-05"] = node_visceral_bundle_05_50;
  const mesh_visceral_bundle_05_50Geometry = endpoint_visceral_bundle_05_50
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_05_50.endRadius, endpoint_visceral_bundle_05_50.baseRadius, endpoint_visceral_bundle_05_50.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_05_50 = new THREE.Mesh(
    mesh_visceral_bundle_05_50Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_05_50.name = "Gut lobe 5";
  if (endpoint_visceral_bundle_05_50) {
    mesh_visceral_bundle_05_50.position.copy(endpoint_visceral_bundle_05_50.midpoint);
    mesh_visceral_bundle_05_50.quaternion.copy(endpoint_visceral_bundle_05_50.quaternion);
  }
  mesh_visceral_bundle_05_50.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_05_50.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_05_50.userData.sculptComponent = {"id": "visceral-bundle-05", "name": "Gut lobe 5", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-05-mount", "structuralParent": "root", "localStart": [-0.9, -0.55, 0.595], "localEnd": [-0.9, -0.55, 0.595], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.657, "height": 0.714, "depth": 0.657, "units": "relative", "confidence": 0.65}, "transform": {"position": [-0.9, -0.55, 0.595], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-05", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_05_50.add(mesh_visceral_bundle_05_50);
  meshes["visceral-bundle-05"] = mesh_visceral_bundle_05_50;
  colliders["visceral-bundle-05"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_05_viscera_mount_05_0 = new THREE.Object3D();
  socket_visceral_bundle_05_viscera_mount_05_0.name = "viscera-mount-05";
  socket_visceral_bundle_05_viscera_mount_05_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_05_viscera_mount_05_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_05_viscera_mount_05_0.userData.socket = {"id": "viscera-mount-05", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_05_50.add(socket_visceral_bundle_05_viscera_mount_05_0);
  sockets["visceral-bundle-05:viscera-mount-05"] = socket_visceral_bundle_05_viscera_mount_05_0;

  const attachment_visceral_bundle_06_51 = {"parentId": "root", "parentSocket": "root/visceral-bundle-06-mount", "structuralParent": "root", "localStart": [-0.52, -0.72, 0.435], "localEnd": [-0.52, -0.72, 0.435], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_06_51 = makeAttachmentEndpoint(attachment_visceral_bundle_06_51);
  const node_visceral_bundle_06_51 = new THREE.Group();
  node_visceral_bundle_06_51.name = "Gut lobe 6__pivot";
  if (endpoint_visceral_bundle_06_51) {
    node_visceral_bundle_06_51.position.copy(endpoint_visceral_bundle_06_51.start);
    node_visceral_bundle_06_51.rotation.set(0, 0, 0);
    node_visceral_bundle_06_51.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_06_51.position.set(-0.52, -0.72, 0.435);
    node_visceral_bundle_06_51.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_06_51.scale.set(0.857, 1.057, 0.857);
  }
  node_visceral_bundle_06_51.userData.sculptComponent = {"id": "visceral-bundle-06", "name": "Gut lobe 6", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-06-mount", "structuralParent": "root", "localStart": [-0.52, -0.72, 0.435], "localEnd": [-0.52, -0.72, 0.435], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.857, "height": 1.057, "depth": 0.857, "units": "relative", "confidence": 0.65}, "transform": {"position": [-0.52, -0.72, 0.435], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-06", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_06_51.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-06", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_06_51);
  nodes["visceral-bundle-06"] = node_visceral_bundle_06_51;
  const mesh_visceral_bundle_06_51Geometry = endpoint_visceral_bundle_06_51
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_06_51.endRadius, endpoint_visceral_bundle_06_51.baseRadius, endpoint_visceral_bundle_06_51.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_06_51 = new THREE.Mesh(
    mesh_visceral_bundle_06_51Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_06_51.name = "Gut lobe 6";
  if (endpoint_visceral_bundle_06_51) {
    mesh_visceral_bundle_06_51.position.copy(endpoint_visceral_bundle_06_51.midpoint);
    mesh_visceral_bundle_06_51.quaternion.copy(endpoint_visceral_bundle_06_51.quaternion);
  }
  mesh_visceral_bundle_06_51.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_06_51.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_06_51.userData.sculptComponent = {"id": "visceral-bundle-06", "name": "Gut lobe 6", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-06-mount", "structuralParent": "root", "localStart": [-0.52, -0.72, 0.435], "localEnd": [-0.52, -0.72, 0.435], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.857, "height": 1.057, "depth": 0.857, "units": "relative", "confidence": 0.65}, "transform": {"position": [-0.52, -0.72, 0.435], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-06", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_06_51.add(mesh_visceral_bundle_06_51);
  meshes["visceral-bundle-06"] = mesh_visceral_bundle_06_51;
  colliders["visceral-bundle-06"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_06_viscera_mount_06_0 = new THREE.Object3D();
  socket_visceral_bundle_06_viscera_mount_06_0.name = "viscera-mount-06";
  socket_visceral_bundle_06_viscera_mount_06_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_06_viscera_mount_06_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_06_viscera_mount_06_0.userData.socket = {"id": "viscera-mount-06", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_06_51.add(socket_visceral_bundle_06_viscera_mount_06_0);
  sockets["visceral-bundle-06:viscera-mount-06"] = socket_visceral_bundle_06_viscera_mount_06_0;

  const attachment_visceral_bundle_07_52 = {"parentId": "root", "parentSocket": "root/visceral-bundle-07-mount", "structuralParent": "root", "localStart": [-0.14, -0.6, 0.625], "localEnd": [-0.14, -0.6, 0.625], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_07_52 = makeAttachmentEndpoint(attachment_visceral_bundle_07_52);
  const node_visceral_bundle_07_52 = new THREE.Group();
  node_visceral_bundle_07_52.name = "Gut lobe 7__pivot";
  if (endpoint_visceral_bundle_07_52) {
    node_visceral_bundle_07_52.position.copy(endpoint_visceral_bundle_07_52.start);
    node_visceral_bundle_07_52.rotation.set(0, 0, 0);
    node_visceral_bundle_07_52.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_07_52.position.set(-0.14, -0.6, 0.625);
    node_visceral_bundle_07_52.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_07_52.scale.set(0.743, 0.843, 0.743);
  }
  node_visceral_bundle_07_52.userData.sculptComponent = {"id": "visceral-bundle-07", "name": "Gut lobe 7", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-07-mount", "structuralParent": "root", "localStart": [-0.14, -0.6, 0.625], "localEnd": [-0.14, -0.6, 0.625], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.743, "height": 0.843, "depth": 0.743, "units": "relative", "confidence": 0.65}, "transform": {"position": [-0.14, -0.6, 0.625], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-07", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_07_52.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-07", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_07_52);
  nodes["visceral-bundle-07"] = node_visceral_bundle_07_52;
  const mesh_visceral_bundle_07_52Geometry = endpoint_visceral_bundle_07_52
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_07_52.endRadius, endpoint_visceral_bundle_07_52.baseRadius, endpoint_visceral_bundle_07_52.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_07_52 = new THREE.Mesh(
    mesh_visceral_bundle_07_52Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_07_52.name = "Gut lobe 7";
  if (endpoint_visceral_bundle_07_52) {
    mesh_visceral_bundle_07_52.position.copy(endpoint_visceral_bundle_07_52.midpoint);
    mesh_visceral_bundle_07_52.quaternion.copy(endpoint_visceral_bundle_07_52.quaternion);
  }
  mesh_visceral_bundle_07_52.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_07_52.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_07_52.userData.sculptComponent = {"id": "visceral-bundle-07", "name": "Gut lobe 7", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-07-mount", "structuralParent": "root", "localStart": [-0.14, -0.6, 0.625], "localEnd": [-0.14, -0.6, 0.625], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.743, "height": 0.843, "depth": 0.743, "units": "relative", "confidence": 0.65}, "transform": {"position": [-0.14, -0.6, 0.625], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-07", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_07_52.add(mesh_visceral_bundle_07_52);
  meshes["visceral-bundle-07"] = mesh_visceral_bundle_07_52;
  colliders["visceral-bundle-07"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_07_viscera_mount_07_0 = new THREE.Object3D();
  socket_visceral_bundle_07_viscera_mount_07_0.name = "viscera-mount-07";
  socket_visceral_bundle_07_viscera_mount_07_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_07_viscera_mount_07_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_07_viscera_mount_07_0.userData.socket = {"id": "viscera-mount-07", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_07_52.add(socket_visceral_bundle_07_viscera_mount_07_0);
  sockets["visceral-bundle-07:viscera-mount-07"] = socket_visceral_bundle_07_viscera_mount_07_0;

  const attachment_viscera_band_07a_53 = {"parentId": "root", "parentSocket": "root/viscera-band-07a-mount", "structuralParent": "root", "localStart": [-0.14, -0.455, 0.625], "localEnd": [-0.14, -0.455, 0.625], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_viscera_band_07a_53 = makeAttachmentEndpoint(attachment_viscera_band_07a_53);
  const node_viscera_band_07a_53 = new THREE.Group();
  node_viscera_band_07a_53.name = "Gut band 7__pivot";
  if (endpoint_viscera_band_07a_53) {
    node_viscera_band_07a_53.position.copy(endpoint_viscera_band_07a_53.start);
    node_viscera_band_07a_53.rotation.set(0, 0, 0);
    node_viscera_band_07a_53.scale.set(1, 1, 1);
  } else {
    node_viscera_band_07a_53.position.set(-0.14, -0.4548, 0.625);
    node_viscera_band_07a_53.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_viscera_band_07a_53.scale.set(0.611, 0.611, 0.611);
  }
  node_viscera_band_07a_53.userData.sculptComponent = {"id": "viscera-band-07a", "name": "Gut band 7", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-07a-mount", "structuralParent": "root", "localStart": [-0.14, -0.455, 0.625], "localEnd": [-0.14, -0.455, 0.625], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.611, "height": 0.611, "depth": 0.611, "units": "relative", "confidence": 0.62}, "transform": {"position": [-0.14, -0.4548, 0.625], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_07a_53.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_viscera_band_07a_53);
  nodes["viscera-band-07a"] = node_viscera_band_07a_53;
  const mesh_viscera_band_07a_53Geometry = endpoint_viscera_band_07a_53
    ? new THREE.CylinderGeometry(endpoint_viscera_band_07a_53.endRadius, endpoint_viscera_band_07a_53.baseRadius, endpoint_viscera_band_07a_53.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_viscera_band_07a_53 = new THREE.Mesh(
    mesh_viscera_band_07a_53Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_viscera_band_07a_53.name = "Gut band 7";
  if (endpoint_viscera_band_07a_53) {
    mesh_viscera_band_07a_53.position.copy(endpoint_viscera_band_07a_53.midpoint);
    mesh_viscera_band_07a_53.quaternion.copy(endpoint_viscera_band_07a_53.quaternion);
  }
  mesh_viscera_band_07a_53.castShadow = options.castShadow ?? true;
  mesh_viscera_band_07a_53.receiveShadow = options.receiveShadow ?? true;
  mesh_viscera_band_07a_53.userData.sculptComponent = {"id": "viscera-band-07a", "name": "Gut band 7", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-07a-mount", "structuralParent": "root", "localStart": [-0.14, -0.455, 0.625], "localEnd": [-0.14, -0.455, 0.625], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.611, "height": 0.611, "depth": 0.611, "units": "relative", "confidence": 0.62}, "transform": {"position": [-0.14, -0.4548, 0.625], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_07a_53.add(mesh_viscera_band_07a_53);
  meshes["viscera-band-07a"] = mesh_viscera_band_07a_53;
  colliders["viscera-band-07a"] = {"type": "box", "fit": "tight"};

  const attachment_visceral_bundle_08_54 = {"parentId": "root", "parentSocket": "root/visceral-bundle-08-mount", "structuralParent": "root", "localStart": [0.26, -0.68, 0.415], "localEnd": [0.26, -0.68, 0.415], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_08_54 = makeAttachmentEndpoint(attachment_visceral_bundle_08_54);
  const node_visceral_bundle_08_54 = new THREE.Group();
  node_visceral_bundle_08_54.name = "Gut lobe 8__pivot";
  if (endpoint_visceral_bundle_08_54) {
    node_visceral_bundle_08_54.position.copy(endpoint_visceral_bundle_08_54.start);
    node_visceral_bundle_08_54.rotation.set(0, 0, 0);
    node_visceral_bundle_08_54.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_08_54.position.set(0.26, -0.68, 0.415);
    node_visceral_bundle_08_54.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_08_54.scale.set(0.8, 0.971, 0.8);
  }
  node_visceral_bundle_08_54.userData.sculptComponent = {"id": "visceral-bundle-08", "name": "Gut lobe 8", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-08-mount", "structuralParent": "root", "localStart": [0.26, -0.68, 0.415], "localEnd": [0.26, -0.68, 0.415], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.8, "height": 0.971, "depth": 0.8, "units": "relative", "confidence": 0.65}, "transform": {"position": [0.26, -0.68, 0.415], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-08", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_08_54.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-08", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_08_54);
  nodes["visceral-bundle-08"] = node_visceral_bundle_08_54;
  const mesh_visceral_bundle_08_54Geometry = endpoint_visceral_bundle_08_54
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_08_54.endRadius, endpoint_visceral_bundle_08_54.baseRadius, endpoint_visceral_bundle_08_54.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_08_54 = new THREE.Mesh(
    mesh_visceral_bundle_08_54Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_08_54.name = "Gut lobe 8";
  if (endpoint_visceral_bundle_08_54) {
    mesh_visceral_bundle_08_54.position.copy(endpoint_visceral_bundle_08_54.midpoint);
    mesh_visceral_bundle_08_54.quaternion.copy(endpoint_visceral_bundle_08_54.quaternion);
  }
  mesh_visceral_bundle_08_54.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_08_54.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_08_54.userData.sculptComponent = {"id": "visceral-bundle-08", "name": "Gut lobe 8", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-08-mount", "structuralParent": "root", "localStart": [0.26, -0.68, 0.415], "localEnd": [0.26, -0.68, 0.415], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.8, "height": 0.971, "depth": 0.8, "units": "relative", "confidence": 0.65}, "transform": {"position": [0.26, -0.68, 0.415], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-08", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_08_54.add(mesh_visceral_bundle_08_54);
  meshes["visceral-bundle-08"] = mesh_visceral_bundle_08_54;
  colliders["visceral-bundle-08"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_08_viscera_mount_08_0 = new THREE.Object3D();
  socket_visceral_bundle_08_viscera_mount_08_0.name = "viscera-mount-08";
  socket_visceral_bundle_08_viscera_mount_08_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_08_viscera_mount_08_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_08_viscera_mount_08_0.userData.socket = {"id": "viscera-mount-08", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_08_54.add(socket_visceral_bundle_08_viscera_mount_08_0);
  sockets["visceral-bundle-08:viscera-mount-08"] = socket_visceral_bundle_08_viscera_mount_08_0;

  const attachment_visceral_bundle_09_55 = {"parentId": "root", "parentSocket": "root/visceral-bundle-09-mount", "structuralParent": "root", "localStart": [0.62, -0.5, 0.575], "localEnd": [0.62, -0.5, 0.575], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_09_55 = makeAttachmentEndpoint(attachment_visceral_bundle_09_55);
  const node_visceral_bundle_09_55 = new THREE.Group();
  node_visceral_bundle_09_55.name = "Gut lobe 9__pivot";
  if (endpoint_visceral_bundle_09_55) {
    node_visceral_bundle_09_55.position.copy(endpoint_visceral_bundle_09_55.start);
    node_visceral_bundle_09_55.rotation.set(0, 0, 0);
    node_visceral_bundle_09_55.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_09_55.position.set(0.62, -0.5, 0.575);
    node_visceral_bundle_09_55.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_09_55.scale.set(0.629, 0.629, 0.629);
  }
  node_visceral_bundle_09_55.userData.sculptComponent = {"id": "visceral-bundle-09", "name": "Gut lobe 9", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-09-mount", "structuralParent": "root", "localStart": [0.62, -0.5, 0.575], "localEnd": [0.62, -0.5, 0.575], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.629, "height": 0.629, "depth": 0.629, "units": "relative", "confidence": 0.65}, "transform": {"position": [0.62, -0.5, 0.575], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-09", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_09_55.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-09", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_09_55);
  nodes["visceral-bundle-09"] = node_visceral_bundle_09_55;
  const mesh_visceral_bundle_09_55Geometry = endpoint_visceral_bundle_09_55
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_09_55.endRadius, endpoint_visceral_bundle_09_55.baseRadius, endpoint_visceral_bundle_09_55.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_09_55 = new THREE.Mesh(
    mesh_visceral_bundle_09_55Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_09_55.name = "Gut lobe 9";
  if (endpoint_visceral_bundle_09_55) {
    mesh_visceral_bundle_09_55.position.copy(endpoint_visceral_bundle_09_55.midpoint);
    mesh_visceral_bundle_09_55.quaternion.copy(endpoint_visceral_bundle_09_55.quaternion);
  }
  mesh_visceral_bundle_09_55.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_09_55.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_09_55.userData.sculptComponent = {"id": "visceral-bundle-09", "name": "Gut lobe 9", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-09-mount", "structuralParent": "root", "localStart": [0.62, -0.5, 0.575], "localEnd": [0.62, -0.5, 0.575], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.629, "height": 0.629, "depth": 0.629, "units": "relative", "confidence": 0.65}, "transform": {"position": [0.62, -0.5, 0.575], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-09", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_09_55.add(mesh_visceral_bundle_09_55);
  meshes["visceral-bundle-09"] = mesh_visceral_bundle_09_55;
  colliders["visceral-bundle-09"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_09_viscera_mount_09_0 = new THREE.Object3D();
  socket_visceral_bundle_09_viscera_mount_09_0.name = "viscera-mount-09";
  socket_visceral_bundle_09_viscera_mount_09_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_09_viscera_mount_09_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_09_viscera_mount_09_0.userData.socket = {"id": "viscera-mount-09", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_09_55.add(socket_visceral_bundle_09_viscera_mount_09_0);
  sockets["visceral-bundle-09:viscera-mount-09"] = socket_visceral_bundle_09_viscera_mount_09_0;

  const attachment_visceral_bundle_10_56 = {"parentId": "root", "parentSocket": "root/visceral-bundle-10-mount", "structuralParent": "root", "localStart": [-2.16, -0.4, 0.295], "localEnd": [-2.16, -0.4, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_10_56 = makeAttachmentEndpoint(attachment_visceral_bundle_10_56);
  const node_visceral_bundle_10_56 = new THREE.Group();
  node_visceral_bundle_10_56.name = "Gut lobe 10__pivot";
  if (endpoint_visceral_bundle_10_56) {
    node_visceral_bundle_10_56.position.copy(endpoint_visceral_bundle_10_56.start);
    node_visceral_bundle_10_56.rotation.set(0, 0, 0);
    node_visceral_bundle_10_56.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_10_56.position.set(-2.16, -0.4, 0.295);
    node_visceral_bundle_10_56.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_10_56.scale.set(0.571, 0.557, 0.571);
  }
  node_visceral_bundle_10_56.userData.sculptComponent = {"id": "visceral-bundle-10", "name": "Gut lobe 10", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-10-mount", "structuralParent": "root", "localStart": [-2.16, -0.4, 0.295], "localEnd": [-2.16, -0.4, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.571, "height": 0.557, "depth": 0.571, "units": "relative", "confidence": 0.65}, "transform": {"position": [-2.16, -0.4, 0.295], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-10", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_10_56.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-10", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_10_56);
  nodes["visceral-bundle-10"] = node_visceral_bundle_10_56;
  const mesh_visceral_bundle_10_56Geometry = endpoint_visceral_bundle_10_56
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_10_56.endRadius, endpoint_visceral_bundle_10_56.baseRadius, endpoint_visceral_bundle_10_56.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_10_56 = new THREE.Mesh(
    mesh_visceral_bundle_10_56Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_10_56.name = "Gut lobe 10";
  if (endpoint_visceral_bundle_10_56) {
    mesh_visceral_bundle_10_56.position.copy(endpoint_visceral_bundle_10_56.midpoint);
    mesh_visceral_bundle_10_56.quaternion.copy(endpoint_visceral_bundle_10_56.quaternion);
  }
  mesh_visceral_bundle_10_56.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_10_56.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_10_56.userData.sculptComponent = {"id": "visceral-bundle-10", "name": "Gut lobe 10", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-10-mount", "structuralParent": "root", "localStart": [-2.16, -0.4, 0.295], "localEnd": [-2.16, -0.4, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.571, "height": 0.557, "depth": 0.571, "units": "relative", "confidence": 0.65}, "transform": {"position": [-2.16, -0.4, 0.295], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-10", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_10_56.add(mesh_visceral_bundle_10_56);
  meshes["visceral-bundle-10"] = mesh_visceral_bundle_10_56;
  colliders["visceral-bundle-10"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_10_viscera_mount_10_0 = new THREE.Object3D();
  socket_visceral_bundle_10_viscera_mount_10_0.name = "viscera-mount-10";
  socket_visceral_bundle_10_viscera_mount_10_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_10_viscera_mount_10_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_10_viscera_mount_10_0.userData.socket = {"id": "viscera-mount-10", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_10_56.add(socket_visceral_bundle_10_viscera_mount_10_0);
  sockets["visceral-bundle-10:viscera-mount-10"] = socket_visceral_bundle_10_viscera_mount_10_0;

  const attachment_viscera_band_10a_57 = {"parentId": "root", "parentSocket": "root/viscera-band-10a-mount", "structuralParent": "root", "localStart": [-2.16, -0.316, 0.295], "localEnd": [-2.16, -0.316, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_viscera_band_10a_57 = makeAttachmentEndpoint(attachment_viscera_band_10a_57);
  const node_viscera_band_10a_57 = new THREE.Group();
  node_viscera_band_10a_57.name = "Gut band 10__pivot";
  if (endpoint_viscera_band_10a_57) {
    node_viscera_band_10a_57.position.copy(endpoint_viscera_band_10a_57.start);
    node_viscera_band_10a_57.rotation.set(0, 0, 0);
    node_viscera_band_10a_57.scale.set(1, 1, 1);
  } else {
    node_viscera_band_10a_57.position.set(-2.16, -0.3164, 0.295);
    node_viscera_band_10a_57.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_viscera_band_10a_57.scale.set(0.47, 0.47, 0.47);
  }
  node_viscera_band_10a_57.userData.sculptComponent = {"id": "viscera-band-10a", "name": "Gut band 10", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-10a-mount", "structuralParent": "root", "localStart": [-2.16, -0.316, 0.295], "localEnd": [-2.16, -0.316, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.47, "height": 0.47, "depth": 0.47, "units": "relative", "confidence": 0.62}, "transform": {"position": [-2.16, -0.3164, 0.295], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_10a_57.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_viscera_band_10a_57);
  nodes["viscera-band-10a"] = node_viscera_band_10a_57;
  const mesh_viscera_band_10a_57Geometry = endpoint_viscera_band_10a_57
    ? new THREE.CylinderGeometry(endpoint_viscera_band_10a_57.endRadius, endpoint_viscera_band_10a_57.baseRadius, endpoint_viscera_band_10a_57.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_viscera_band_10a_57 = new THREE.Mesh(
    mesh_viscera_band_10a_57Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_viscera_band_10a_57.name = "Gut band 10";
  if (endpoint_viscera_band_10a_57) {
    mesh_viscera_band_10a_57.position.copy(endpoint_viscera_band_10a_57.midpoint);
    mesh_viscera_band_10a_57.quaternion.copy(endpoint_viscera_band_10a_57.quaternion);
  }
  mesh_viscera_band_10a_57.castShadow = options.castShadow ?? true;
  mesh_viscera_band_10a_57.receiveShadow = options.receiveShadow ?? true;
  mesh_viscera_band_10a_57.userData.sculptComponent = {"id": "viscera-band-10a", "name": "Gut band 10", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.35, "confidence": 0.62, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Steel band cinching a gut lobe.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/viscera-band-10a-mount", "structuralParent": "root", "localStart": [-2.16, -0.316, 0.295], "localEnd": [-2.16, -0.316, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.47, "height": 0.47, "depth": 0.47, "units": "relative", "confidence": 0.62}, "transform": {"position": [-2.16, -0.3164, 0.295], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_viscera_band_10a_57.add(mesh_viscera_band_10a_57);
  meshes["viscera-band-10a"] = mesh_viscera_band_10a_57;
  colliders["viscera-band-10a"] = {"type": "box", "fit": "tight"};

  const attachment_visceral_bundle_11_58 = {"parentId": "root", "parentSocket": "root/visceral-bundle-11-mount", "structuralParent": "root", "localStart": [-1.08, -0.44, 0.275], "localEnd": [-1.08, -0.44, 0.275], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_11_58 = makeAttachmentEndpoint(attachment_visceral_bundle_11_58);
  const node_visceral_bundle_11_58 = new THREE.Group();
  node_visceral_bundle_11_58.name = "Gut lobe 11__pivot";
  if (endpoint_visceral_bundle_11_58) {
    node_visceral_bundle_11_58.position.copy(endpoint_visceral_bundle_11_58.start);
    node_visceral_bundle_11_58.rotation.set(0, 0, 0);
    node_visceral_bundle_11_58.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_11_58.position.set(-1.08, -0.44, 0.27499999999999997);
    node_visceral_bundle_11_58.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_11_58.scale.set(0.6, 0.629, 0.6);
  }
  node_visceral_bundle_11_58.userData.sculptComponent = {"id": "visceral-bundle-11", "name": "Gut lobe 11", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-11-mount", "structuralParent": "root", "localStart": [-1.08, -0.44, 0.275], "localEnd": [-1.08, -0.44, 0.275], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.6, "height": 0.629, "depth": 0.6, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.08, -0.44, 0.27499999999999997], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-11", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_11_58.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-11", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_11_58);
  nodes["visceral-bundle-11"] = node_visceral_bundle_11_58;
  const mesh_visceral_bundle_11_58Geometry = endpoint_visceral_bundle_11_58
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_11_58.endRadius, endpoint_visceral_bundle_11_58.baseRadius, endpoint_visceral_bundle_11_58.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_11_58 = new THREE.Mesh(
    mesh_visceral_bundle_11_58Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_11_58.name = "Gut lobe 11";
  if (endpoint_visceral_bundle_11_58) {
    mesh_visceral_bundle_11_58.position.copy(endpoint_visceral_bundle_11_58.midpoint);
    mesh_visceral_bundle_11_58.quaternion.copy(endpoint_visceral_bundle_11_58.quaternion);
  }
  mesh_visceral_bundle_11_58.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_11_58.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_11_58.userData.sculptComponent = {"id": "visceral-bundle-11", "name": "Gut lobe 11", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-11-mount", "structuralParent": "root", "localStart": [-1.08, -0.44, 0.275], "localEnd": [-1.08, -0.44, 0.275], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.6, "height": 0.629, "depth": 0.6, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.08, -0.44, 0.27499999999999997], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-11", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_11_58.add(mesh_visceral_bundle_11_58);
  meshes["visceral-bundle-11"] = mesh_visceral_bundle_11_58;
  colliders["visceral-bundle-11"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_11_viscera_mount_11_0 = new THREE.Object3D();
  socket_visceral_bundle_11_viscera_mount_11_0.name = "viscera-mount-11";
  socket_visceral_bundle_11_viscera_mount_11_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_11_viscera_mount_11_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_11_viscera_mount_11_0.userData.socket = {"id": "viscera-mount-11", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_11_58.add(socket_visceral_bundle_11_viscera_mount_11_0);
  sockets["visceral-bundle-11:viscera-mount-11"] = socket_visceral_bundle_11_viscera_mount_11_0;

  const attachment_visceral_bundle_12_59 = {"parentId": "root", "parentSocket": "root/visceral-bundle-12-mount", "structuralParent": "root", "localStart": [0.08, -0.4, 0.295], "localEnd": [0.08, -0.4, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_visceral_bundle_12_59 = makeAttachmentEndpoint(attachment_visceral_bundle_12_59);
  const node_visceral_bundle_12_59 = new THREE.Group();
  node_visceral_bundle_12_59.name = "Gut lobe 12__pivot";
  if (endpoint_visceral_bundle_12_59) {
    node_visceral_bundle_12_59.position.copy(endpoint_visceral_bundle_12_59.start);
    node_visceral_bundle_12_59.rotation.set(0, 0, 0);
    node_visceral_bundle_12_59.scale.set(1, 1, 1);
  } else {
    node_visceral_bundle_12_59.position.set(0.08, -0.4, 0.295);
    node_visceral_bundle_12_59.rotation.set(0.0, 0.0, 0.0);
    node_visceral_bundle_12_59.scale.set(0.543, 0.529, 0.543);
  }
  node_visceral_bundle_12_59.userData.sculptComponent = {"id": "visceral-bundle-12", "name": "Gut lobe 12", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-12-mount", "structuralParent": "root", "localStart": [0.08, -0.4, 0.295], "localEnd": [0.08, -0.4, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.543, "height": 0.529, "depth": 0.543, "units": "relative", "confidence": 0.65}, "transform": {"position": [0.08, -0.4, 0.295], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-12", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_12_59.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-12", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}};
  (nodes["root"] ?? root).add(node_visceral_bundle_12_59);
  nodes["visceral-bundle-12"] = node_visceral_bundle_12_59;
  const mesh_visceral_bundle_12_59Geometry = endpoint_visceral_bundle_12_59
    ? new THREE.CylinderGeometry(endpoint_visceral_bundle_12_59.endRadius, endpoint_visceral_bundle_12_59.baseRadius, endpoint_visceral_bundle_12_59.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_visceral_bundle_12_59 = new THREE.Mesh(
    mesh_visceral_bundle_12_59Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_visceral_bundle_12_59.name = "Gut lobe 12";
  if (endpoint_visceral_bundle_12_59) {
    mesh_visceral_bundle_12_59.position.copy(endpoint_visceral_bundle_12_59.midpoint);
    mesh_visceral_bundle_12_59.quaternion.copy(endpoint_visceral_bundle_12_59.quaternion);
  }
  mesh_visceral_bundle_12_59.castShadow = options.castShadow ?? true;
  mesh_visceral_bundle_12_59.receiveShadow = options.receiveShadow ?? true;
  mesh_visceral_bundle_12_59.userData.sculptComponent = {"id": "visceral-bundle-12", "name": "Gut lobe 12", "level": "meso", "role": "payload", "logicalParent": "root", "importance": 0.85, "confidence": 0.65, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "One gut lobe: a fat vertical sausage overlapping its neighbours. Distinct capsules rather than one swept tube, because the reference's character is the hard dark notch where two lobes press together, and a continuous sweep has no notches.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/visceral-bundle-12-mount", "structuralParent": "root", "localStart": [0.08, -0.4, 0.295], "localEnd": [0.08, -0.4, 0.295], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.543, "height": 0.529, "depth": 0.543, "units": "relative", "confidence": 0.65}, "transform": {"position": [0.08, -0.4, 0.295], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "viscera-mount-12", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "loose"}, "constraints": [], "destruction": {"breakable": true, "group": "viscera"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_visceral_bundle_12_59.add(mesh_visceral_bundle_12_59);
  meshes["visceral-bundle-12"] = mesh_visceral_bundle_12_59;
  colliders["visceral-bundle-12"] = {"type": "capsule", "fit": "loose"};
  const socket_visceral_bundle_12_viscera_mount_12_0 = new THREE.Object3D();
  socket_visceral_bundle_12_viscera_mount_12_0.name = "viscera-mount-12";
  socket_visceral_bundle_12_viscera_mount_12_0.position.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_12_viscera_mount_12_0.rotation.set(0.0, 0.0, 0.0);
  socket_visceral_bundle_12_viscera_mount_12_0.userData.socket = {"id": "viscera-mount-12", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_visceral_bundle_12_59.add(socket_visceral_bundle_12_viscera_mount_12_0);
  sockets["visceral-bundle-12:viscera-mount-12"] = socket_visceral_bundle_12_viscera_mount_12_0;

  const attachment_gut_bridge_01_60 = {"parentId": "root", "parentSocket": "root/gut-bridge-01-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_01_60 = makeAttachmentEndpoint(attachment_gut_bridge_01_60);
  const node_gut_bridge_01_60 = new THREE.Group();
  node_gut_bridge_01_60.name = "Gut bridge 1__pivot";
  if (endpoint_gut_bridge_01_60) {
    node_gut_bridge_01_60.position.copy(endpoint_gut_bridge_01_60.start);
    node_gut_bridge_01_60.rotation.set(0, 0, 0);
    node_gut_bridge_01_60.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_01_60.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_01_60.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_01_60.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_01_60.userData.sculptComponent = {"id": "gut-bridge-01", "name": "Gut bridge 1", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-2.38, -0.37, 0.14], [-2.2, -0.32, 0.06], [-2.02, -0.42399999999999993, -0.02]], "radius": 0.197, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-01-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_01_60.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_01_60);
  nodes["gut-bridge-01"] = node_gut_bridge_01_60;
  const mesh_gut_bridge_01_60Geometry = endpoint_gut_bridge_01_60
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_01_60.endRadius, endpoint_gut_bridge_01_60.baseRadius, endpoint_gut_bridge_01_60.length, 32, 12)
    : buildTubeGeometry({"points": [[-2.38, -0.37, 0.14], [-2.2, -0.32, 0.06], [-2.02, -0.42399999999999993, -0.02]], "radius": 0.197, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_01_60 = new THREE.Mesh(
    mesh_gut_bridge_01_60Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_01_60.name = "Gut bridge 1";
  if (endpoint_gut_bridge_01_60) {
    mesh_gut_bridge_01_60.position.copy(endpoint_gut_bridge_01_60.midpoint);
    mesh_gut_bridge_01_60.quaternion.copy(endpoint_gut_bridge_01_60.quaternion);
  }
  mesh_gut_bridge_01_60.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_01_60.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_01_60.userData.sculptComponent = {"id": "gut-bridge-01", "name": "Gut bridge 1", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-2.38, -0.37, 0.14], [-2.2, -0.32, 0.06], [-2.02, -0.42399999999999993, -0.02]], "radius": 0.197, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-01-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_01_60.add(mesh_gut_bridge_01_60);
  meshes["gut-bridge-01"] = mesh_gut_bridge_01_60;
  colliders["gut-bridge-01"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_02_61 = {"parentId": "root", "parentSocket": "root/gut-bridge-02-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_02_61 = makeAttachmentEndpoint(attachment_gut_bridge_02_61);
  const node_gut_bridge_02_61 = new THREE.Group();
  node_gut_bridge_02_61.name = "Gut bridge 2__pivot";
  if (endpoint_gut_bridge_02_61) {
    node_gut_bridge_02_61.position.copy(endpoint_gut_bridge_02_61.start);
    node_gut_bridge_02_61.rotation.set(0, 0, 0);
    node_gut_bridge_02_61.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_02_61.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_02_61.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_02_61.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_02_61.userData.sculptComponent = {"id": "gut-bridge-02", "name": "Gut bridge 2", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-2.02, -0.42399999999999993, -0.02], [-1.84, -0.38, 0.07], [-1.66, -0.39399999999999996, 0.16]], "radius": 0.205, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-02-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_02_61.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_02_61);
  nodes["gut-bridge-02"] = node_gut_bridge_02_61;
  const mesh_gut_bridge_02_61Geometry = endpoint_gut_bridge_02_61
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_02_61.endRadius, endpoint_gut_bridge_02_61.baseRadius, endpoint_gut_bridge_02_61.length, 32, 12)
    : buildTubeGeometry({"points": [[-2.02, -0.42399999999999993, -0.02], [-1.84, -0.38, 0.07], [-1.66, -0.39399999999999996, 0.16]], "radius": 0.205, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_02_61 = new THREE.Mesh(
    mesh_gut_bridge_02_61Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_02_61.name = "Gut bridge 2";
  if (endpoint_gut_bridge_02_61) {
    mesh_gut_bridge_02_61.position.copy(endpoint_gut_bridge_02_61.midpoint);
    mesh_gut_bridge_02_61.quaternion.copy(endpoint_gut_bridge_02_61.quaternion);
  }
  mesh_gut_bridge_02_61.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_02_61.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_02_61.userData.sculptComponent = {"id": "gut-bridge-02", "name": "Gut bridge 2", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-2.02, -0.42399999999999993, -0.02], [-1.84, -0.38, 0.07], [-1.66, -0.39399999999999996, 0.16]], "radius": 0.205, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-02-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_02_61.add(mesh_gut_bridge_02_61);
  meshes["gut-bridge-02"] = mesh_gut_bridge_02_61;
  colliders["gut-bridge-02"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_03_62 = {"parentId": "root", "parentSocket": "root/gut-bridge-03-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_03_62 = makeAttachmentEndpoint(attachment_gut_bridge_03_62);
  const node_gut_bridge_03_62 = new THREE.Group();
  node_gut_bridge_03_62.name = "Gut bridge 3__pivot";
  if (endpoint_gut_bridge_03_62) {
    node_gut_bridge_03_62.position.copy(endpoint_gut_bridge_03_62.start);
    node_gut_bridge_03_62.rotation.set(0, 0, 0);
    node_gut_bridge_03_62.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_03_62.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_03_62.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_03_62.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_03_62.userData.sculptComponent = {"id": "gut-bridge-03", "name": "Gut bridge 3", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-1.66, -0.39399999999999996, 0.16], [-1.46, -0.38, 0.04], [-1.26, -0.454, -0.08]], "radius": 0.205, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-03-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_03_62.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_03_62);
  nodes["gut-bridge-03"] = node_gut_bridge_03_62;
  const mesh_gut_bridge_03_62Geometry = endpoint_gut_bridge_03_62
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_03_62.endRadius, endpoint_gut_bridge_03_62.baseRadius, endpoint_gut_bridge_03_62.length, 32, 12)
    : buildTubeGeometry({"points": [[-1.66, -0.39399999999999996, 0.16], [-1.46, -0.38, 0.04], [-1.26, -0.454, -0.08]], "radius": 0.205, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_03_62 = new THREE.Mesh(
    mesh_gut_bridge_03_62Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_03_62.name = "Gut bridge 3";
  if (endpoint_gut_bridge_03_62) {
    mesh_gut_bridge_03_62.position.copy(endpoint_gut_bridge_03_62.midpoint);
    mesh_gut_bridge_03_62.quaternion.copy(endpoint_gut_bridge_03_62.quaternion);
  }
  mesh_gut_bridge_03_62.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_03_62.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_03_62.userData.sculptComponent = {"id": "gut-bridge-03", "name": "Gut bridge 3", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-1.66, -0.39399999999999996, 0.16], [-1.46, -0.38, 0.04], [-1.26, -0.454, -0.08]], "radius": 0.205, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-03-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_03_62.add(mesh_gut_bridge_03_62);
  meshes["gut-bridge-03"] = mesh_gut_bridge_03_62;
  colliders["gut-bridge-03"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_05_63 = {"parentId": "root", "parentSocket": "root/gut-bridge-05-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_05_63 = makeAttachmentEndpoint(attachment_gut_bridge_05_63);
  const node_gut_bridge_05_63 = new THREE.Group();
  node_gut_bridge_05_63.name = "Gut bridge 5__pivot";
  if (endpoint_gut_bridge_05_63) {
    node_gut_bridge_05_63.position.copy(endpoint_gut_bridge_05_63.start);
    node_gut_bridge_05_63.rotation.set(0, 0, 0);
    node_gut_bridge_05_63.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_05_63.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_05_63.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_05_63.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_05_63.userData.sculptComponent = {"id": "gut-bridge-05", "name": "Gut bridge 5", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-0.9, -0.388, 0.12], [-0.71, -0.35, 0.04], [-0.52, -0.45599999999999996, -0.04]], "radius": 0.189, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-05-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_05_63.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_05_63);
  nodes["gut-bridge-05"] = node_gut_bridge_05_63;
  const mesh_gut_bridge_05_63Geometry = endpoint_gut_bridge_05_63
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_05_63.endRadius, endpoint_gut_bridge_05_63.baseRadius, endpoint_gut_bridge_05_63.length, 32, 12)
    : buildTubeGeometry({"points": [[-0.9, -0.388, 0.12], [-0.71, -0.35, 0.04], [-0.52, -0.45599999999999996, -0.04]], "radius": 0.189, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_05_63 = new THREE.Mesh(
    mesh_gut_bridge_05_63Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_05_63.name = "Gut bridge 5";
  if (endpoint_gut_bridge_05_63) {
    mesh_gut_bridge_05_63.position.copy(endpoint_gut_bridge_05_63.midpoint);
    mesh_gut_bridge_05_63.quaternion.copy(endpoint_gut_bridge_05_63.quaternion);
  }
  mesh_gut_bridge_05_63.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_05_63.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_05_63.userData.sculptComponent = {"id": "gut-bridge-05", "name": "Gut bridge 5", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-0.9, -0.388, 0.12], [-0.71, -0.35, 0.04], [-0.52, -0.45599999999999996, -0.04]], "radius": 0.189, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-05-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_05_63.add(mesh_gut_bridge_05_63);
  meshes["gut-bridge-05"] = mesh_gut_bridge_05_63;
  colliders["gut-bridge-05"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_06_64 = {"parentId": "root", "parentSocket": "root/gut-bridge-06-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_06_64 = makeAttachmentEndpoint(attachment_gut_bridge_06_64);
  const node_gut_bridge_06_64 = new THREE.Group();
  node_gut_bridge_06_64.name = "Gut bridge 6__pivot";
  if (endpoint_gut_bridge_06_64) {
    node_gut_bridge_06_64.position.copy(endpoint_gut_bridge_06_64.start);
    node_gut_bridge_06_64.rotation.set(0, 0, 0);
    node_gut_bridge_06_64.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_06_64.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_06_64.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_06_64.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_06_64.userData.sculptComponent = {"id": "gut-bridge-06", "name": "Gut bridge 6", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-0.52, -0.45599999999999996, -0.04], [-0.33, -0.4, 0.055], [-0.14, -0.40199999999999997, 0.15]], "radius": 0.213, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-06-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_06_64.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_06_64);
  nodes["gut-bridge-06"] = node_gut_bridge_06_64;
  const mesh_gut_bridge_06_64Geometry = endpoint_gut_bridge_06_64
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_06_64.endRadius, endpoint_gut_bridge_06_64.baseRadius, endpoint_gut_bridge_06_64.length, 32, 12)
    : buildTubeGeometry({"points": [[-0.52, -0.45599999999999996, -0.04], [-0.33, -0.4, 0.055], [-0.14, -0.40199999999999997, 0.15]], "radius": 0.213, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_06_64 = new THREE.Mesh(
    mesh_gut_bridge_06_64Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_06_64.name = "Gut bridge 6";
  if (endpoint_gut_bridge_06_64) {
    mesh_gut_bridge_06_64.position.copy(endpoint_gut_bridge_06_64.midpoint);
    mesh_gut_bridge_06_64.quaternion.copy(endpoint_gut_bridge_06_64.quaternion);
  }
  mesh_gut_bridge_06_64.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_06_64.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_06_64.userData.sculptComponent = {"id": "gut-bridge-06", "name": "Gut bridge 6", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-0.52, -0.45599999999999996, -0.04], [-0.33, -0.4, 0.055], [-0.14, -0.40199999999999997, 0.15]], "radius": 0.213, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-06-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_06_64.add(mesh_gut_bridge_06_64);
  meshes["gut-bridge-06"] = mesh_gut_bridge_06_64;
  colliders["gut-bridge-06"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_07_65 = {"parentId": "root", "parentSocket": "root/gut-bridge-07-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_07_65 = makeAttachmentEndpoint(attachment_gut_bridge_07_65);
  const node_gut_bridge_07_65 = new THREE.Group();
  node_gut_bridge_07_65.name = "Gut bridge 7__pivot";
  if (endpoint_gut_bridge_07_65) {
    node_gut_bridge_07_65.position.copy(endpoint_gut_bridge_07_65.start);
    node_gut_bridge_07_65.rotation.set(0, 0, 0);
    node_gut_bridge_07_65.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_07_65.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_07_65.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_07_65.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_07_65.userData.sculptComponent = {"id": "gut-bridge-07", "name": "Gut bridge 7", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-0.14, -0.40199999999999997, 0.15], [0.06, -0.4, 0.045], [0.26, -0.44000000000000006, -0.06]], "radius": 0.213, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-07-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_07_65.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_07_65);
  nodes["gut-bridge-07"] = node_gut_bridge_07_65;
  const mesh_gut_bridge_07_65Geometry = endpoint_gut_bridge_07_65
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_07_65.endRadius, endpoint_gut_bridge_07_65.baseRadius, endpoint_gut_bridge_07_65.length, 32, 12)
    : buildTubeGeometry({"points": [[-0.14, -0.40199999999999997, 0.15], [0.06, -0.4, 0.045], [0.26, -0.44000000000000006, -0.06]], "radius": 0.213, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_07_65 = new THREE.Mesh(
    mesh_gut_bridge_07_65Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_07_65.name = "Gut bridge 7";
  if (endpoint_gut_bridge_07_65) {
    mesh_gut_bridge_07_65.position.copy(endpoint_gut_bridge_07_65.midpoint);
    mesh_gut_bridge_07_65.quaternion.copy(endpoint_gut_bridge_07_65.quaternion);
  }
  mesh_gut_bridge_07_65.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_07_65.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_07_65.userData.sculptComponent = {"id": "gut-bridge-07", "name": "Gut bridge 7", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-0.14, -0.40199999999999997, 0.15], [0.06, -0.4, 0.045], [0.26, -0.44000000000000006, -0.06]], "radius": 0.213, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-07-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_07_65.add(mesh_gut_bridge_07_65);
  meshes["gut-bridge-07"] = mesh_gut_bridge_07_65;
  colliders["gut-bridge-07"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_08_66 = {"parentId": "root", "parentSocket": "root/gut-bridge-08-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_08_66 = makeAttachmentEndpoint(attachment_gut_bridge_08_66);
  const node_gut_bridge_08_66 = new THREE.Group();
  node_gut_bridge_08_66.name = "Gut bridge 8__pivot";
  if (endpoint_gut_bridge_08_66) {
    node_gut_bridge_08_66.position.copy(endpoint_gut_bridge_08_66.start);
    node_gut_bridge_08_66.rotation.set(0, 0, 0);
    node_gut_bridge_08_66.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_08_66.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_08_66.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_08_66.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_08_66.userData.sculptComponent = {"id": "gut-bridge-08", "name": "Gut bridge 8", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[0.26, -0.44000000000000006, -0.06], [0.44, -0.3, 0.02], [0.62, -0.368, 0.1]], "radius": 0.18, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-08-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_08_66.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_08_66);
  nodes["gut-bridge-08"] = node_gut_bridge_08_66;
  const mesh_gut_bridge_08_66Geometry = endpoint_gut_bridge_08_66
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_08_66.endRadius, endpoint_gut_bridge_08_66.baseRadius, endpoint_gut_bridge_08_66.length, 32, 12)
    : buildTubeGeometry({"points": [[0.26, -0.44000000000000006, -0.06], [0.44, -0.3, 0.02], [0.62, -0.368, 0.1]], "radius": 0.18, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_08_66 = new THREE.Mesh(
    mesh_gut_bridge_08_66Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_08_66.name = "Gut bridge 8";
  if (endpoint_gut_bridge_08_66) {
    mesh_gut_bridge_08_66.position.copy(endpoint_gut_bridge_08_66.midpoint);
    mesh_gut_bridge_08_66.quaternion.copy(endpoint_gut_bridge_08_66.quaternion);
  }
  mesh_gut_bridge_08_66.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_08_66.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_08_66.userData.sculptComponent = {"id": "gut-bridge-08", "name": "Gut bridge 8", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[0.26, -0.44000000000000006, -0.06], [0.44, -0.3, 0.02], [0.62, -0.368, 0.1]], "radius": 0.18, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-08-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_08_66.add(mesh_gut_bridge_08_66);
  meshes["gut-bridge-08"] = mesh_gut_bridge_08_66;
  colliders["gut-bridge-08"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_09_67 = {"parentId": "root", "parentSocket": "root/gut-bridge-09-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_09_67 = makeAttachmentEndpoint(attachment_gut_bridge_09_67);
  const node_gut_bridge_09_67 = new THREE.Group();
  node_gut_bridge_09_67.name = "Gut bridge 9__pivot";
  if (endpoint_gut_bridge_09_67) {
    node_gut_bridge_09_67.position.copy(endpoint_gut_bridge_09_67.start);
    node_gut_bridge_09_67.rotation.set(0, 0, 0);
    node_gut_bridge_09_67.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_09_67.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_09_67.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_09_67.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_09_67.userData.sculptComponent = {"id": "gut-bridge-09", "name": "Gut bridge 9", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[0.62, -0.368, 0.1], [-0.77, -0.2, -0.04], [-2.16, -0.28600000000000003, -0.18]], "radius": 0.164, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-09-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_09_67.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_09_67);
  nodes["gut-bridge-09"] = node_gut_bridge_09_67;
  const mesh_gut_bridge_09_67Geometry = endpoint_gut_bridge_09_67
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_09_67.endRadius, endpoint_gut_bridge_09_67.baseRadius, endpoint_gut_bridge_09_67.length, 32, 12)
    : buildTubeGeometry({"points": [[0.62, -0.368, 0.1], [-0.77, -0.2, -0.04], [-2.16, -0.28600000000000003, -0.18]], "radius": 0.164, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_09_67 = new THREE.Mesh(
    mesh_gut_bridge_09_67Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_09_67.name = "Gut bridge 9";
  if (endpoint_gut_bridge_09_67) {
    mesh_gut_bridge_09_67.position.copy(endpoint_gut_bridge_09_67.midpoint);
    mesh_gut_bridge_09_67.quaternion.copy(endpoint_gut_bridge_09_67.quaternion);
  }
  mesh_gut_bridge_09_67.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_09_67.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_09_67.userData.sculptComponent = {"id": "gut-bridge-09", "name": "Gut bridge 9", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[0.62, -0.368, 0.1], [-0.77, -0.2, -0.04], [-2.16, -0.28600000000000003, -0.18]], "radius": 0.164, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-09-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_09_67.add(mesh_gut_bridge_09_67);
  meshes["gut-bridge-09"] = mesh_gut_bridge_09_67;
  colliders["gut-bridge-09"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_10_68 = {"parentId": "root", "parentSocket": "root/gut-bridge-10-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_10_68 = makeAttachmentEndpoint(attachment_gut_bridge_10_68);
  const node_gut_bridge_10_68 = new THREE.Group();
  node_gut_bridge_10_68.name = "Gut bridge 10__pivot";
  if (endpoint_gut_bridge_10_68) {
    node_gut_bridge_10_68.position.copy(endpoint_gut_bridge_10_68.start);
    node_gut_bridge_10_68.rotation.set(0, 0, 0);
    node_gut_bridge_10_68.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_10_68.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_10_68.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_10_68.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_10_68.userData.sculptComponent = {"id": "gut-bridge-10", "name": "Gut bridge 10", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-2.16, -0.28600000000000003, -0.18], [-1.62, -0.2, -0.19], [-1.08, -0.302, -0.2]], "radius": 0.164, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-10-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_10_68.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_10_68);
  nodes["gut-bridge-10"] = node_gut_bridge_10_68;
  const mesh_gut_bridge_10_68Geometry = endpoint_gut_bridge_10_68
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_10_68.endRadius, endpoint_gut_bridge_10_68.baseRadius, endpoint_gut_bridge_10_68.length, 32, 12)
    : buildTubeGeometry({"points": [[-2.16, -0.28600000000000003, -0.18], [-1.62, -0.2, -0.19], [-1.08, -0.302, -0.2]], "radius": 0.164, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_10_68 = new THREE.Mesh(
    mesh_gut_bridge_10_68Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_10_68.name = "Gut bridge 10";
  if (endpoint_gut_bridge_10_68) {
    mesh_gut_bridge_10_68.position.copy(endpoint_gut_bridge_10_68.midpoint);
    mesh_gut_bridge_10_68.quaternion.copy(endpoint_gut_bridge_10_68.quaternion);
  }
  mesh_gut_bridge_10_68.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_10_68.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_10_68.userData.sculptComponent = {"id": "gut-bridge-10", "name": "Gut bridge 10", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-2.16, -0.28600000000000003, -0.18], [-1.62, -0.2, -0.19], [-1.08, -0.302, -0.2]], "radius": 0.164, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-10-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_10_68.add(mesh_gut_bridge_10_68);
  meshes["gut-bridge-10"] = mesh_gut_bridge_10_68;
  colliders["gut-bridge-10"] = {"type": "box", "fit": "tight"};

  const attachment_gut_bridge_11_69 = {"parentId": "root", "parentSocket": "root/gut-bridge-11-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_gut_bridge_11_69 = makeAttachmentEndpoint(attachment_gut_bridge_11_69);
  const node_gut_bridge_11_69 = new THREE.Group();
  node_gut_bridge_11_69.name = "Gut bridge 11__pivot";
  if (endpoint_gut_bridge_11_69) {
    node_gut_bridge_11_69.position.copy(endpoint_gut_bridge_11_69.start);
    node_gut_bridge_11_69.rotation.set(0, 0, 0);
    node_gut_bridge_11_69.scale.set(1, 1, 1);
  } else {
    node_gut_bridge_11_69.position.set(0.0, 0.0, 0.475);
    node_gut_bridge_11_69.rotation.set(0.0, 0.0, 0.0);
    node_gut_bridge_11_69.scale.set(1.0, 1.0, 1.0);
  }
  node_gut_bridge_11_69.userData.sculptComponent = {"id": "gut-bridge-11", "name": "Gut bridge 11", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-1.08, -0.302, -0.2], [-0.5, -0.2, -0.19], [0.08, -0.29200000000000004, -0.18]], "radius": 0.156, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-11-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_11_69.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gut_bridge_11_69);
  nodes["gut-bridge-11"] = node_gut_bridge_11_69;
  const mesh_gut_bridge_11_69Geometry = endpoint_gut_bridge_11_69
    ? new THREE.CylinderGeometry(endpoint_gut_bridge_11_69.endRadius, endpoint_gut_bridge_11_69.baseRadius, endpoint_gut_bridge_11_69.length, 32, 12)
    : buildTubeGeometry({"points": [[-1.08, -0.302, -0.2], [-0.5, -0.2, -0.19], [0.08, -0.29200000000000004, -0.18]], "radius": 0.156, "radialSegments": 10, "closed": false});
  const mesh_gut_bridge_11_69 = new THREE.Mesh(
    mesh_gut_bridge_11_69Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gut_bridge_11_69.name = "Gut bridge 11";
  if (endpoint_gut_bridge_11_69) {
    mesh_gut_bridge_11_69.position.copy(endpoint_gut_bridge_11_69.midpoint);
    mesh_gut_bridge_11_69.quaternion.copy(endpoint_gut_bridge_11_69.quaternion);
  }
  mesh_gut_bridge_11_69.castShadow = options.castShadow ?? true;
  mesh_gut_bridge_11_69.receiveShadow = options.receiveShadow ?? true;
  mesh_gut_bridge_11_69.userData.sculptComponent = {"id": "gut-bridge-11", "name": "Gut bridge 11", "level": "micro", "role": "payload", "logicalParent": "root", "importance": 0.4, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "U-bend joining two adjacent lobes, so the bundle reads as one continuous gut.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "tubePath": {"points": [[-1.08, -0.302, -0.2], [-0.5, -0.2, -0.19], [0.08, -0.29200000000000004, -0.18]], "radius": 0.156, "radialSegments": 10, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/gut-bridge-11-mount", "structuralParent": "root", "localStart": [0, 0, 0.475], "localEnd": [0, 0, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 0, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gut_bridge_11_69.add(mesh_gut_bridge_11_69);
  meshes["gut-bridge-11"] = mesh_gut_bridge_11_69;
  colliders["gut-bridge-11"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_spine_70 = {"parentId": "root", "parentSocket": "visceral-cavity/manifold-spine-mount", "structuralParent": "visceral-cavity", "localStart": [-0.9, -0.04, 0.315], "localEnd": [-0.9, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_spine_70 = makeAttachmentEndpoint(attachment_manifold_spine_70);
  const node_manifold_spine_70 = new THREE.Group();
  node_manifold_spine_70.name = "Plumbing manifold spine__pivot";
  if (endpoint_manifold_spine_70) {
    node_manifold_spine_70.position.copy(endpoint_manifold_spine_70.start);
    node_manifold_spine_70.rotation.set(0, 0, 0);
    node_manifold_spine_70.scale.set(1, 1, 1);
  } else {
    node_manifold_spine_70.position.set(-0.9, -0.04, 0.31499999999999995);
    node_manifold_spine_70.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_spine_70.scale.set(0.17, 3.1, 0.17);
  }
  node_manifold_spine_70.userData.sculptComponent = {"id": "manifold-spine", "name": "Plumbing manifold spine", "level": "meso", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight pipe run above the pods.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-spine-mount", "structuralParent": "visceral-cavity", "localStart": [-0.9, -0.04, 0.315], "localEnd": [-0.9, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.17, "height": 3.1, "depth": 0.17, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.9, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "manifold-collar-bands", "kind": "ridge", "description": "raised collar bands and coloured pipe segments along the manifold run", "detailRefs": ["d16"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_spine_70.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_spine_70);
  nodes["manifold-spine"] = node_manifold_spine_70;
  const mesh_manifold_spine_70Geometry = endpoint_manifold_spine_70
    ? new THREE.CylinderGeometry(endpoint_manifold_spine_70.endRadius, endpoint_manifold_spine_70.baseRadius, endpoint_manifold_spine_70.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_spine_70 = new THREE.Mesh(
    mesh_manifold_spine_70Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_spine_70.name = "Plumbing manifold spine";
  if (endpoint_manifold_spine_70) {
    mesh_manifold_spine_70.position.copy(endpoint_manifold_spine_70.midpoint);
    mesh_manifold_spine_70.quaternion.copy(endpoint_manifold_spine_70.quaternion);
  }
  mesh_manifold_spine_70.castShadow = options.castShadow ?? true;
  mesh_manifold_spine_70.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_spine_70.userData.sculptComponent = {"id": "manifold-spine", "name": "Plumbing manifold spine", "level": "meso", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight pipe run above the pods.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-spine-mount", "structuralParent": "visceral-cavity", "localStart": [-0.9, -0.04, 0.315], "localEnd": [-0.9, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.17, "height": 3.1, "depth": 0.17, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.9, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "manifold-collar-bands", "kind": "ridge", "description": "raised collar bands and coloured pipe segments along the manifold run", "detailRefs": ["d16"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_spine_70.add(mesh_manifold_spine_70);
  meshes["manifold-spine"] = mesh_manifold_spine_70;
  colliders["manifold-spine"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_seg_red_71 = {"parentId": "root", "parentSocket": "visceral-cavity/manifold-seg-red-mount", "structuralParent": "visceral-cavity", "localStart": [-0.95, -0.04, 0.315], "localEnd": [-0.95, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_seg_red_71 = makeAttachmentEndpoint(attachment_manifold_seg_red_71);
  const node_manifold_seg_red_71 = new THREE.Group();
  node_manifold_seg_red_71.name = "Manifold Seg Red__pivot";
  if (endpoint_manifold_seg_red_71) {
    node_manifold_seg_red_71.position.copy(endpoint_manifold_seg_red_71.start);
    node_manifold_seg_red_71.rotation.set(0, 0, 0);
    node_manifold_seg_red_71.scale.set(1, 1, 1);
  } else {
    node_manifold_seg_red_71.position.set(-0.95, -0.04, 0.31499999999999995);
    node_manifold_seg_red_71.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_seg_red_71.scale.set(0.2, 0.62, 0.2);
  }
  node_manifold_seg_red_71.userData.sculptComponent = {"id": "manifold-seg-red", "name": "Manifold Seg Red", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-seg-red-mount", "structuralParent": "visceral-cavity", "localStart": [-0.95, -0.04, 0.315], "localEnd": [-0.95, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.95, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_red_71.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_seg_red_71);
  nodes["manifold-seg-red"] = node_manifold_seg_red_71;
  const mesh_manifold_seg_red_71Geometry = endpoint_manifold_seg_red_71
    ? new THREE.CylinderGeometry(endpoint_manifold_seg_red_71.endRadius, endpoint_manifold_seg_red_71.baseRadius, endpoint_manifold_seg_red_71.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_seg_red_71 = new THREE.Mesh(
    mesh_manifold_seg_red_71Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_seg_red_71.name = "Manifold Seg Red";
  if (endpoint_manifold_seg_red_71) {
    mesh_manifold_seg_red_71.position.copy(endpoint_manifold_seg_red_71.midpoint);
    mesh_manifold_seg_red_71.quaternion.copy(endpoint_manifold_seg_red_71.quaternion);
  }
  mesh_manifold_seg_red_71.castShadow = options.castShadow ?? true;
  mesh_manifold_seg_red_71.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_seg_red_71.userData.sculptComponent = {"id": "manifold-seg-red", "name": "Manifold Seg Red", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-seg-red-mount", "structuralParent": "visceral-cavity", "localStart": [-0.95, -0.04, 0.315], "localEnd": [-0.95, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.95, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_red_71.add(mesh_manifold_seg_red_71);
  meshes["manifold-seg-red"] = mesh_manifold_seg_red_71;
  colliders["manifold-seg-red"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_seg_blue_72 = {"parentId": "root", "parentSocket": "visceral-cavity/manifold-seg-blue-mount", "structuralParent": "visceral-cavity", "localStart": [0.62, -0.04, 0.315], "localEnd": [0.62, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_seg_blue_72 = makeAttachmentEndpoint(attachment_manifold_seg_blue_72);
  const node_manifold_seg_blue_72 = new THREE.Group();
  node_manifold_seg_blue_72.name = "Manifold Seg Blue__pivot";
  if (endpoint_manifold_seg_blue_72) {
    node_manifold_seg_blue_72.position.copy(endpoint_manifold_seg_blue_72.start);
    node_manifold_seg_blue_72.rotation.set(0, 0, 0);
    node_manifold_seg_blue_72.scale.set(1, 1, 1);
  } else {
    node_manifold_seg_blue_72.position.set(0.62, -0.04, 0.31499999999999995);
    node_manifold_seg_blue_72.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_seg_blue_72.scale.set(0.2, 0.62, 0.2);
  }
  node_manifold_seg_blue_72.userData.sculptComponent = {"id": "manifold-seg-blue", "name": "Manifold Seg Blue", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-seg-blue-mount", "structuralParent": "visceral-cavity", "localStart": [0.62, -0.04, 0.315], "localEnd": [0.62, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.62, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_blue_72.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_seg_blue_72);
  nodes["manifold-seg-blue"] = node_manifold_seg_blue_72;
  const mesh_manifold_seg_blue_72Geometry = endpoint_manifold_seg_blue_72
    ? new THREE.CylinderGeometry(endpoint_manifold_seg_blue_72.endRadius, endpoint_manifold_seg_blue_72.baseRadius, endpoint_manifold_seg_blue_72.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_seg_blue_72 = new THREE.Mesh(
    mesh_manifold_seg_blue_72Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_seg_blue_72.name = "Manifold Seg Blue";
  if (endpoint_manifold_seg_blue_72) {
    mesh_manifold_seg_blue_72.position.copy(endpoint_manifold_seg_blue_72.midpoint);
    mesh_manifold_seg_blue_72.quaternion.copy(endpoint_manifold_seg_blue_72.quaternion);
  }
  mesh_manifold_seg_blue_72.castShadow = options.castShadow ?? true;
  mesh_manifold_seg_blue_72.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_seg_blue_72.userData.sculptComponent = {"id": "manifold-seg-blue", "name": "Manifold Seg Blue", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-seg-blue-mount", "structuralParent": "visceral-cavity", "localStart": [0.62, -0.04, 0.315], "localEnd": [0.62, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.62, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_blue_72.add(mesh_manifold_seg_blue_72);
  meshes["manifold-seg-blue"] = mesh_manifold_seg_blue_72;
  colliders["manifold-seg-blue"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_collar_a_73 = {"parentId": "root", "parentSocket": "visceral-cavity/manifold-collar-a-mount", "structuralParent": "visceral-cavity", "localStart": [-0.3, -0.04, 0.315], "localEnd": [-0.3, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_collar_a_73 = makeAttachmentEndpoint(attachment_manifold_collar_a_73);
  const node_manifold_collar_a_73 = new THREE.Group();
  node_manifold_collar_a_73.name = "Manifold Collar A__pivot";
  if (endpoint_manifold_collar_a_73) {
    node_manifold_collar_a_73.position.copy(endpoint_manifold_collar_a_73.start);
    node_manifold_collar_a_73.rotation.set(0, 0, 0);
    node_manifold_collar_a_73.scale.set(1, 1, 1);
  } else {
    node_manifold_collar_a_73.position.set(-0.3, -0.04, 0.31499999999999995);
    node_manifold_collar_a_73.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_collar_a_73.scale.set(0.2, 0.16, 0.2);
  }
  node_manifold_collar_a_73.userData.sculptComponent = {"id": "manifold-collar-a", "name": "Manifold Collar A", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-collar-a-mount", "structuralParent": "visceral-cavity", "localStart": [-0.3, -0.04, 0.315], "localEnd": [-0.3, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.3, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_a_73.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_collar_a_73);
  nodes["manifold-collar-a"] = node_manifold_collar_a_73;
  const mesh_manifold_collar_a_73Geometry = endpoint_manifold_collar_a_73
    ? new THREE.CylinderGeometry(endpoint_manifold_collar_a_73.endRadius, endpoint_manifold_collar_a_73.baseRadius, endpoint_manifold_collar_a_73.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_collar_a_73 = new THREE.Mesh(
    mesh_manifold_collar_a_73Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_collar_a_73.name = "Manifold Collar A";
  if (endpoint_manifold_collar_a_73) {
    mesh_manifold_collar_a_73.position.copy(endpoint_manifold_collar_a_73.midpoint);
    mesh_manifold_collar_a_73.quaternion.copy(endpoint_manifold_collar_a_73.quaternion);
  }
  mesh_manifold_collar_a_73.castShadow = options.castShadow ?? true;
  mesh_manifold_collar_a_73.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_collar_a_73.userData.sculptComponent = {"id": "manifold-collar-a", "name": "Manifold Collar A", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-collar-a-mount", "structuralParent": "visceral-cavity", "localStart": [-0.3, -0.04, 0.315], "localEnd": [-0.3, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.3, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_a_73.add(mesh_manifold_collar_a_73);
  meshes["manifold-collar-a"] = mesh_manifold_collar_a_73;
  colliders["manifold-collar-a"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_collar_b_74 = {"parentId": "root", "parentSocket": "visceral-cavity/manifold-collar-b-mount", "structuralParent": "visceral-cavity", "localStart": [0.2, -0.04, 0.315], "localEnd": [0.2, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_collar_b_74 = makeAttachmentEndpoint(attachment_manifold_collar_b_74);
  const node_manifold_collar_b_74 = new THREE.Group();
  node_manifold_collar_b_74.name = "Manifold Collar B__pivot";
  if (endpoint_manifold_collar_b_74) {
    node_manifold_collar_b_74.position.copy(endpoint_manifold_collar_b_74.start);
    node_manifold_collar_b_74.rotation.set(0, 0, 0);
    node_manifold_collar_b_74.scale.set(1, 1, 1);
  } else {
    node_manifold_collar_b_74.position.set(0.2, -0.04, 0.31499999999999995);
    node_manifold_collar_b_74.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_collar_b_74.scale.set(0.2, 0.16, 0.2);
  }
  node_manifold_collar_b_74.userData.sculptComponent = {"id": "manifold-collar-b", "name": "Manifold Collar B", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-collar-b-mount", "structuralParent": "visceral-cavity", "localStart": [0.2, -0.04, 0.315], "localEnd": [0.2, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.2, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_b_74.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_collar_b_74);
  nodes["manifold-collar-b"] = node_manifold_collar_b_74;
  const mesh_manifold_collar_b_74Geometry = endpoint_manifold_collar_b_74
    ? new THREE.CylinderGeometry(endpoint_manifold_collar_b_74.endRadius, endpoint_manifold_collar_b_74.baseRadius, endpoint_manifold_collar_b_74.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_collar_b_74 = new THREE.Mesh(
    mesh_manifold_collar_b_74Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_collar_b_74.name = "Manifold Collar B";
  if (endpoint_manifold_collar_b_74) {
    mesh_manifold_collar_b_74.position.copy(endpoint_manifold_collar_b_74.midpoint);
    mesh_manifold_collar_b_74.quaternion.copy(endpoint_manifold_collar_b_74.quaternion);
  }
  mesh_manifold_collar_b_74.castShadow = options.castShadow ?? true;
  mesh_manifold_collar_b_74.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_collar_b_74.userData.sculptComponent = {"id": "manifold-collar-b", "name": "Manifold Collar B", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-collar-b-mount", "structuralParent": "visceral-cavity", "localStart": [0.2, -0.04, 0.315], "localEnd": [0.2, -0.04, 0.315], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.2, -0.04, 0.31499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_b_74.add(mesh_manifold_collar_b_74);
  meshes["manifold-collar-b"] = mesh_manifold_collar_b_74;
  colliders["manifold-collar-b"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_round_port_75 = {"parentId": "root", "parentSocket": "visceral-cavity/manifold-round-port-mount", "structuralParent": "visceral-cavity", "localStart": [-0.4, -0.34, 0.935], "localEnd": [-0.4, -0.34, 0.935], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_round_port_75 = makeAttachmentEndpoint(attachment_manifold_round_port_75);
  const node_manifold_round_port_75 = new THREE.Group();
  node_manifold_round_port_75.name = "Manifold round port__pivot";
  if (endpoint_manifold_round_port_75) {
    node_manifold_round_port_75.position.copy(endpoint_manifold_round_port_75.start);
    node_manifold_round_port_75.rotation.set(0, 0, 0);
    node_manifold_round_port_75.scale.set(1, 1, 1);
  } else {
    node_manifold_round_port_75.position.set(-0.4, -0.34, 0.935);
    node_manifold_round_port_75.rotation.set(1.5707963267948966, 0.0, 0.0);
    node_manifold_round_port_75.scale.set(0.4, 0.14, 0.4);
  }
  node_manifold_round_port_75.userData.sculptComponent = {"id": "manifold-round-port", "name": "Manifold round port", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.4, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Circular port with a red interior and blue rim.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-round-port-mount", "structuralParent": "visceral-cavity", "localStart": [-0.4, -0.34, 0.935], "localEnd": [-0.4, -0.34, 0.935], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.4, "height": 0.14, "depth": 0.4, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4, -0.34, 0.935], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d17"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_round_port_75.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_round_port_75);
  nodes["manifold-round-port"] = node_manifold_round_port_75;
  const mesh_manifold_round_port_75Geometry = endpoint_manifold_round_port_75
    ? new THREE.CylinderGeometry(endpoint_manifold_round_port_75.endRadius, endpoint_manifold_round_port_75.baseRadius, endpoint_manifold_round_port_75.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_round_port_75 = new THREE.Mesh(
    mesh_manifold_round_port_75Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_round_port_75.name = "Manifold round port";
  if (endpoint_manifold_round_port_75) {
    mesh_manifold_round_port_75.position.copy(endpoint_manifold_round_port_75.midpoint);
    mesh_manifold_round_port_75.quaternion.copy(endpoint_manifold_round_port_75.quaternion);
  }
  mesh_manifold_round_port_75.castShadow = options.castShadow ?? true;
  mesh_manifold_round_port_75.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_round_port_75.userData.sculptComponent = {"id": "manifold-round-port", "name": "Manifold round port", "level": "micro", "role": "detail", "logicalParent": "visceral-cavity", "importance": 0.4, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Circular port with a red interior and blue rim.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "visceral-cavity/manifold-round-port-mount", "structuralParent": "visceral-cavity", "localStart": [-0.4, -0.34, 0.935], "localEnd": [-0.4, -0.34, 0.935], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.4, "height": 0.14, "depth": 0.4, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4, -0.34, 0.935], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d17"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_round_port_75.add(mesh_manifold_round_port_75);
  meshes["manifold-round-port"] = mesh_manifold_round_port_75;
  colliders["manifold-round-port"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_01_76 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-01-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.815], "localEnd": [1.48, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_01_76 = makeAttachmentEndpoint(attachment_gill_slit_01_76);
  const node_gill_slit_01_76 = new THREE.Group();
  node_gill_slit_01_76.name = "Gill slit 1__pivot";
  if (endpoint_gill_slit_01_76) {
    node_gill_slit_01_76.position.copy(endpoint_gill_slit_01_76.start);
    node_gill_slit_01_76.rotation.set(0, 0, 0);
    node_gill_slit_01_76.scale.set(1, 1, 1);
  } else {
    node_gill_slit_01_76.position.set(1.48, 0.01, 0.815);
    node_gill_slit_01_76.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_gill_slit_01_76.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_01_76.userData.sculptComponent = {"id": "gill-slit-01", "name": "Gill slit 1", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-01-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.815], "localEnd": [1.48, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_01_76.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_01_76);
  nodes["gill-slit-01"] = node_gill_slit_01_76;
  const mesh_gill_slit_01_76Geometry = endpoint_gill_slit_01_76
    ? new THREE.CylinderGeometry(endpoint_gill_slit_01_76.endRadius, endpoint_gill_slit_01_76.baseRadius, endpoint_gill_slit_01_76.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_01_76 = new THREE.Mesh(
    mesh_gill_slit_01_76Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_01_76.name = "Gill slit 1";
  if (endpoint_gill_slit_01_76) {
    mesh_gill_slit_01_76.position.copy(endpoint_gill_slit_01_76.midpoint);
    mesh_gill_slit_01_76.quaternion.copy(endpoint_gill_slit_01_76.quaternion);
  }
  mesh_gill_slit_01_76.castShadow = options.castShadow ?? true;
  mesh_gill_slit_01_76.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_01_76.userData.sculptComponent = {"id": "gill-slit-01", "name": "Gill slit 1", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-01-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.815], "localEnd": [1.48, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_01_76.add(mesh_gill_slit_01_76);
  meshes["gill-slit-01"] = mesh_gill_slit_01_76;
  colliders["gill-slit-01"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_02_77 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-02-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.815], "localEnd": [1.74, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_02_77 = makeAttachmentEndpoint(attachment_gill_slit_02_77);
  const node_gill_slit_02_77 = new THREE.Group();
  node_gill_slit_02_77.name = "Gill slit 2__pivot";
  if (endpoint_gill_slit_02_77) {
    node_gill_slit_02_77.position.copy(endpoint_gill_slit_02_77.start);
    node_gill_slit_02_77.rotation.set(0, 0, 0);
    node_gill_slit_02_77.scale.set(1, 1, 1);
  } else {
    node_gill_slit_02_77.position.set(1.74, 0.01, 0.815);
    node_gill_slit_02_77.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_gill_slit_02_77.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_02_77.userData.sculptComponent = {"id": "gill-slit-02", "name": "Gill slit 2", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-02-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.815], "localEnd": [1.74, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_02_77.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_02_77);
  nodes["gill-slit-02"] = node_gill_slit_02_77;
  const mesh_gill_slit_02_77Geometry = endpoint_gill_slit_02_77
    ? new THREE.CylinderGeometry(endpoint_gill_slit_02_77.endRadius, endpoint_gill_slit_02_77.baseRadius, endpoint_gill_slit_02_77.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_02_77 = new THREE.Mesh(
    mesh_gill_slit_02_77Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_02_77.name = "Gill slit 2";
  if (endpoint_gill_slit_02_77) {
    mesh_gill_slit_02_77.position.copy(endpoint_gill_slit_02_77.midpoint);
    mesh_gill_slit_02_77.quaternion.copy(endpoint_gill_slit_02_77.quaternion);
  }
  mesh_gill_slit_02_77.castShadow = options.castShadow ?? true;
  mesh_gill_slit_02_77.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_02_77.userData.sculptComponent = {"id": "gill-slit-02", "name": "Gill slit 2", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-02-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.815], "localEnd": [1.74, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_02_77.add(mesh_gill_slit_02_77);
  meshes["gill-slit-02"] = mesh_gill_slit_02_77;
  colliders["gill-slit-02"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_03_78 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-03-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.815], "localEnd": [2.0, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_03_78 = makeAttachmentEndpoint(attachment_gill_slit_03_78);
  const node_gill_slit_03_78 = new THREE.Group();
  node_gill_slit_03_78.name = "Gill slit 3__pivot";
  if (endpoint_gill_slit_03_78) {
    node_gill_slit_03_78.position.copy(endpoint_gill_slit_03_78.start);
    node_gill_slit_03_78.rotation.set(0, 0, 0);
    node_gill_slit_03_78.scale.set(1, 1, 1);
  } else {
    node_gill_slit_03_78.position.set(2.0, 0.01, 0.815);
    node_gill_slit_03_78.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_gill_slit_03_78.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_03_78.userData.sculptComponent = {"id": "gill-slit-03", "name": "Gill slit 3", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-03-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.815], "localEnd": [2.0, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_03_78.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_03_78);
  nodes["gill-slit-03"] = node_gill_slit_03_78;
  const mesh_gill_slit_03_78Geometry = endpoint_gill_slit_03_78
    ? new THREE.CylinderGeometry(endpoint_gill_slit_03_78.endRadius, endpoint_gill_slit_03_78.baseRadius, endpoint_gill_slit_03_78.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_03_78 = new THREE.Mesh(
    mesh_gill_slit_03_78Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_03_78.name = "Gill slit 3";
  if (endpoint_gill_slit_03_78) {
    mesh_gill_slit_03_78.position.copy(endpoint_gill_slit_03_78.midpoint);
    mesh_gill_slit_03_78.quaternion.copy(endpoint_gill_slit_03_78.quaternion);
  }
  mesh_gill_slit_03_78.castShadow = options.castShadow ?? true;
  mesh_gill_slit_03_78.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_03_78.userData.sculptComponent = {"id": "gill-slit-03", "name": "Gill slit 3", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-03-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.815], "localEnd": [2.0, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_03_78.add(mesh_gill_slit_03_78);
  meshes["gill-slit-03"] = mesh_gill_slit_03_78;
  colliders["gill-slit-03"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_04_79 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-04-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.815], "localEnd": [2.26, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_04_79 = makeAttachmentEndpoint(attachment_gill_slit_04_79);
  const node_gill_slit_04_79 = new THREE.Group();
  node_gill_slit_04_79.name = "Gill slit 4__pivot";
  if (endpoint_gill_slit_04_79) {
    node_gill_slit_04_79.position.copy(endpoint_gill_slit_04_79.start);
    node_gill_slit_04_79.rotation.set(0, 0, 0);
    node_gill_slit_04_79.scale.set(1, 1, 1);
  } else {
    node_gill_slit_04_79.position.set(2.2600000000000002, 0.01, 0.815);
    node_gill_slit_04_79.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_gill_slit_04_79.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_04_79.userData.sculptComponent = {"id": "gill-slit-04", "name": "Gill slit 4", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-04-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.815], "localEnd": [2.26, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_04_79.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_04_79);
  nodes["gill-slit-04"] = node_gill_slit_04_79;
  const mesh_gill_slit_04_79Geometry = endpoint_gill_slit_04_79
    ? new THREE.CylinderGeometry(endpoint_gill_slit_04_79.endRadius, endpoint_gill_slit_04_79.baseRadius, endpoint_gill_slit_04_79.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_04_79 = new THREE.Mesh(
    mesh_gill_slit_04_79Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_04_79.name = "Gill slit 4";
  if (endpoint_gill_slit_04_79) {
    mesh_gill_slit_04_79.position.copy(endpoint_gill_slit_04_79.midpoint);
    mesh_gill_slit_04_79.quaternion.copy(endpoint_gill_slit_04_79.quaternion);
  }
  mesh_gill_slit_04_79.castShadow = options.castShadow ?? true;
  mesh_gill_slit_04_79.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_04_79.userData.sculptComponent = {"id": "gill-slit-04", "name": "Gill slit 4", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-04-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.815], "localEnd": [2.26, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_04_79.add(mesh_gill_slit_04_79);
  meshes["gill-slit-04"] = mesh_gill_slit_04_79;
  colliders["gill-slit-04"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_05_80 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-05-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.815], "localEnd": [2.52, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_05_80 = makeAttachmentEndpoint(attachment_gill_slit_05_80);
  const node_gill_slit_05_80 = new THREE.Group();
  node_gill_slit_05_80.name = "Gill slit 5__pivot";
  if (endpoint_gill_slit_05_80) {
    node_gill_slit_05_80.position.copy(endpoint_gill_slit_05_80.start);
    node_gill_slit_05_80.rotation.set(0, 0, 0);
    node_gill_slit_05_80.scale.set(1, 1, 1);
  } else {
    node_gill_slit_05_80.position.set(2.52, 0.01, 0.815);
    node_gill_slit_05_80.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_gill_slit_05_80.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_05_80.userData.sculptComponent = {"id": "gill-slit-05", "name": "Gill slit 5", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-05-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.815], "localEnd": [2.52, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_05_80.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_05_80);
  nodes["gill-slit-05"] = node_gill_slit_05_80;
  const mesh_gill_slit_05_80Geometry = endpoint_gill_slit_05_80
    ? new THREE.CylinderGeometry(endpoint_gill_slit_05_80.endRadius, endpoint_gill_slit_05_80.baseRadius, endpoint_gill_slit_05_80.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_05_80 = new THREE.Mesh(
    mesh_gill_slit_05_80Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_05_80.name = "Gill slit 5";
  if (endpoint_gill_slit_05_80) {
    mesh_gill_slit_05_80.position.copy(endpoint_gill_slit_05_80.midpoint);
    mesh_gill_slit_05_80.quaternion.copy(endpoint_gill_slit_05_80.quaternion);
  }
  mesh_gill_slit_05_80.castShadow = options.castShadow ?? true;
  mesh_gill_slit_05_80.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_05_80.userData.sculptComponent = {"id": "gill-slit-05", "name": "Gill slit 5", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-05-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.815], "localEnd": [2.52, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_05_80.add(mesh_gill_slit_05_80);
  meshes["gill-slit-05"] = mesh_gill_slit_05_80;
  colliders["gill-slit-05"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_06_81 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-06-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.495], "localEnd": [1.48, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_06_81 = makeAttachmentEndpoint(attachment_gill_slit_06_81);
  const node_gill_slit_06_81 = new THREE.Group();
  node_gill_slit_06_81.name = "Gill slit 6__pivot";
  if (endpoint_gill_slit_06_81) {
    node_gill_slit_06_81.position.copy(endpoint_gill_slit_06_81.start);
    node_gill_slit_06_81.rotation.set(0, 0, 0);
    node_gill_slit_06_81.scale.set(1, 1, 1);
  } else {
    node_gill_slit_06_81.position.set(1.48, 0.01, 0.495);
    node_gill_slit_06_81.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_gill_slit_06_81.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_06_81.userData.sculptComponent = {"id": "gill-slit-06", "name": "Gill slit 6", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-06-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.495], "localEnd": [1.48, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_06_81.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_06_81);
  nodes["gill-slit-06"] = node_gill_slit_06_81;
  const mesh_gill_slit_06_81Geometry = endpoint_gill_slit_06_81
    ? new THREE.CylinderGeometry(endpoint_gill_slit_06_81.endRadius, endpoint_gill_slit_06_81.baseRadius, endpoint_gill_slit_06_81.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_06_81 = new THREE.Mesh(
    mesh_gill_slit_06_81Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_06_81.name = "Gill slit 6";
  if (endpoint_gill_slit_06_81) {
    mesh_gill_slit_06_81.position.copy(endpoint_gill_slit_06_81.midpoint);
    mesh_gill_slit_06_81.quaternion.copy(endpoint_gill_slit_06_81.quaternion);
  }
  mesh_gill_slit_06_81.castShadow = options.castShadow ?? true;
  mesh_gill_slit_06_81.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_06_81.userData.sculptComponent = {"id": "gill-slit-06", "name": "Gill slit 6", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-06-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.495], "localEnd": [1.48, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_06_81.add(mesh_gill_slit_06_81);
  meshes["gill-slit-06"] = mesh_gill_slit_06_81;
  colliders["gill-slit-06"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_07_82 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-07-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.495], "localEnd": [1.74, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_07_82 = makeAttachmentEndpoint(attachment_gill_slit_07_82);
  const node_gill_slit_07_82 = new THREE.Group();
  node_gill_slit_07_82.name = "Gill slit 7__pivot";
  if (endpoint_gill_slit_07_82) {
    node_gill_slit_07_82.position.copy(endpoint_gill_slit_07_82.start);
    node_gill_slit_07_82.rotation.set(0, 0, 0);
    node_gill_slit_07_82.scale.set(1, 1, 1);
  } else {
    node_gill_slit_07_82.position.set(1.74, 0.01, 0.495);
    node_gill_slit_07_82.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_gill_slit_07_82.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_07_82.userData.sculptComponent = {"id": "gill-slit-07", "name": "Gill slit 7", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-07-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.495], "localEnd": [1.74, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_07_82.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_07_82);
  nodes["gill-slit-07"] = node_gill_slit_07_82;
  const mesh_gill_slit_07_82Geometry = endpoint_gill_slit_07_82
    ? new THREE.CylinderGeometry(endpoint_gill_slit_07_82.endRadius, endpoint_gill_slit_07_82.baseRadius, endpoint_gill_slit_07_82.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_07_82 = new THREE.Mesh(
    mesh_gill_slit_07_82Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_07_82.name = "Gill slit 7";
  if (endpoint_gill_slit_07_82) {
    mesh_gill_slit_07_82.position.copy(endpoint_gill_slit_07_82.midpoint);
    mesh_gill_slit_07_82.quaternion.copy(endpoint_gill_slit_07_82.quaternion);
  }
  mesh_gill_slit_07_82.castShadow = options.castShadow ?? true;
  mesh_gill_slit_07_82.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_07_82.userData.sculptComponent = {"id": "gill-slit-07", "name": "Gill slit 7", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-07-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.495], "localEnd": [1.74, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_07_82.add(mesh_gill_slit_07_82);
  meshes["gill-slit-07"] = mesh_gill_slit_07_82;
  colliders["gill-slit-07"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_08_83 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-08-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.495], "localEnd": [2.0, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_08_83 = makeAttachmentEndpoint(attachment_gill_slit_08_83);
  const node_gill_slit_08_83 = new THREE.Group();
  node_gill_slit_08_83.name = "Gill slit 8__pivot";
  if (endpoint_gill_slit_08_83) {
    node_gill_slit_08_83.position.copy(endpoint_gill_slit_08_83.start);
    node_gill_slit_08_83.rotation.set(0, 0, 0);
    node_gill_slit_08_83.scale.set(1, 1, 1);
  } else {
    node_gill_slit_08_83.position.set(2.0, 0.01, 0.495);
    node_gill_slit_08_83.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_gill_slit_08_83.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_08_83.userData.sculptComponent = {"id": "gill-slit-08", "name": "Gill slit 8", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-08-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.495], "localEnd": [2.0, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_08_83.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_08_83);
  nodes["gill-slit-08"] = node_gill_slit_08_83;
  const mesh_gill_slit_08_83Geometry = endpoint_gill_slit_08_83
    ? new THREE.CylinderGeometry(endpoint_gill_slit_08_83.endRadius, endpoint_gill_slit_08_83.baseRadius, endpoint_gill_slit_08_83.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_08_83 = new THREE.Mesh(
    mesh_gill_slit_08_83Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_08_83.name = "Gill slit 8";
  if (endpoint_gill_slit_08_83) {
    mesh_gill_slit_08_83.position.copy(endpoint_gill_slit_08_83.midpoint);
    mesh_gill_slit_08_83.quaternion.copy(endpoint_gill_slit_08_83.quaternion);
  }
  mesh_gill_slit_08_83.castShadow = options.castShadow ?? true;
  mesh_gill_slit_08_83.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_08_83.userData.sculptComponent = {"id": "gill-slit-08", "name": "Gill slit 8", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-08-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.495], "localEnd": [2.0, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_08_83.add(mesh_gill_slit_08_83);
  meshes["gill-slit-08"] = mesh_gill_slit_08_83;
  colliders["gill-slit-08"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_09_84 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-09-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.495], "localEnd": [2.26, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_09_84 = makeAttachmentEndpoint(attachment_gill_slit_09_84);
  const node_gill_slit_09_84 = new THREE.Group();
  node_gill_slit_09_84.name = "Gill slit 9__pivot";
  if (endpoint_gill_slit_09_84) {
    node_gill_slit_09_84.position.copy(endpoint_gill_slit_09_84.start);
    node_gill_slit_09_84.rotation.set(0, 0, 0);
    node_gill_slit_09_84.scale.set(1, 1, 1);
  } else {
    node_gill_slit_09_84.position.set(2.2600000000000002, 0.01, 0.495);
    node_gill_slit_09_84.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_gill_slit_09_84.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_09_84.userData.sculptComponent = {"id": "gill-slit-09", "name": "Gill slit 9", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-09-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.495], "localEnd": [2.26, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_09_84.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_09_84);
  nodes["gill-slit-09"] = node_gill_slit_09_84;
  const mesh_gill_slit_09_84Geometry = endpoint_gill_slit_09_84
    ? new THREE.CylinderGeometry(endpoint_gill_slit_09_84.endRadius, endpoint_gill_slit_09_84.baseRadius, endpoint_gill_slit_09_84.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_09_84 = new THREE.Mesh(
    mesh_gill_slit_09_84Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_09_84.name = "Gill slit 9";
  if (endpoint_gill_slit_09_84) {
    mesh_gill_slit_09_84.position.copy(endpoint_gill_slit_09_84.midpoint);
    mesh_gill_slit_09_84.quaternion.copy(endpoint_gill_slit_09_84.quaternion);
  }
  mesh_gill_slit_09_84.castShadow = options.castShadow ?? true;
  mesh_gill_slit_09_84.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_09_84.userData.sculptComponent = {"id": "gill-slit-09", "name": "Gill slit 9", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-09-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.495], "localEnd": [2.26, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_09_84.add(mesh_gill_slit_09_84);
  meshes["gill-slit-09"] = mesh_gill_slit_09_84;
  colliders["gill-slit-09"] = {"type": "box", "fit": "tight"};

  const attachment_gill_slit_10_85 = {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-10-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.495], "localEnd": [2.52, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_gill_slit_10_85 = makeAttachmentEndpoint(attachment_gill_slit_10_85);
  const node_gill_slit_10_85 = new THREE.Group();
  node_gill_slit_10_85.name = "Gill slit 10__pivot";
  if (endpoint_gill_slit_10_85) {
    node_gill_slit_10_85.position.copy(endpoint_gill_slit_10_85.start);
    node_gill_slit_10_85.rotation.set(0, 0, 0);
    node_gill_slit_10_85.scale.set(1, 1, 1);
  } else {
    node_gill_slit_10_85.position.set(2.52, 0.01, 0.495);
    node_gill_slit_10_85.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_gill_slit_10_85.scale.set(0.07, 0.17, 0.78);
  }
  node_gill_slit_10_85.userData.sculptComponent = {"id": "gill-slit-10", "name": "Gill slit 10", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-10-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.495], "localEnd": [2.52, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_10_85.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_gill_slit_10_85);
  nodes["gill-slit-10"] = node_gill_slit_10_85;
  const mesh_gill_slit_10_85Geometry = endpoint_gill_slit_10_85
    ? new THREE.CylinderGeometry(endpoint_gill_slit_10_85.endRadius, endpoint_gill_slit_10_85.baseRadius, endpoint_gill_slit_10_85.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_gill_slit_10_85 = new THREE.Mesh(
    mesh_gill_slit_10_85Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gill_slit_10_85.name = "Gill slit 10";
  if (endpoint_gill_slit_10_85) {
    mesh_gill_slit_10_85.position.copy(endpoint_gill_slit_10_85.midpoint);
    mesh_gill_slit_10_85.quaternion.copy(endpoint_gill_slit_10_85.quaternion);
  }
  mesh_gill_slit_10_85.castShadow = options.castShadow ?? true;
  mesh_gill_slit_10_85.receiveShadow = options.receiveShadow ?? true;
  mesh_gill_slit_10_85.userData.sculptComponent = {"id": "gill-slit-10", "name": "Gill slit 10", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Slanted gill slit. The reference shows two mirrored banks of parallel slanted slits immediately behind the head - gills, not a radiator vane array.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/gill-slit-10-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.495], "localEnd": [2.52, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_gill_slit_10_85.add(mesh_gill_slit_10_85);
  meshes["gill-slit-10"] = mesh_gill_slit_10_85;
  colliders["gill-slit-10"] = {"type": "box", "fit": "tight"};

  const attachment_bay_blue_trim_86 = {"parentId": "root", "parentSocket": "stern-bay-housing/bay-blue-trim-mount", "structuralParent": "stern-bay-housing", "localStart": [1.63, 0.15, 1.075], "localEnd": [1.63, 0.15, 1.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_bay_blue_trim_86 = makeAttachmentEndpoint(attachment_bay_blue_trim_86);
  const node_bay_blue_trim_86 = new THREE.Group();
  node_bay_blue_trim_86.name = "Bay blue trim strip__pivot";
  if (endpoint_bay_blue_trim_86) {
    node_bay_blue_trim_86.position.copy(endpoint_bay_blue_trim_86.start);
    node_bay_blue_trim_86.rotation.set(0, 0, 0);
    node_bay_blue_trim_86.scale.set(1, 1, 1);
  } else {
    node_bay_blue_trim_86.position.set(1.63, 0.15, 1.075);
    node_bay_blue_trim_86.rotation.set(0.0, 0.0, 0.0);
    node_bay_blue_trim_86.scale.set(0.7, 0.06, 0.1);
  }
  node_bay_blue_trim_86.userData.sculptComponent = {"id": "bay-blue-trim", "name": "Bay blue trim strip", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.35, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight enamel trim along the upper bay edge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/bay-blue-trim-mount", "structuralParent": "stern-bay-housing", "localStart": [1.63, 0.15, 1.075], "localEnd": [1.63, 0.15, 1.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.7, "height": 0.06, "depth": 0.1, "units": "relative", "confidence": 0.75}, "transform": {"position": [1.63, 0.15, 1.075], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bay_blue_trim_86.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_bay_blue_trim_86);
  nodes["bay-blue-trim"] = node_bay_blue_trim_86;
  const mesh_bay_blue_trim_86Geometry = endpoint_bay_blue_trim_86
    ? new THREE.CylinderGeometry(endpoint_bay_blue_trim_86.endRadius, endpoint_bay_blue_trim_86.baseRadius, endpoint_bay_blue_trim_86.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_bay_blue_trim_86 = new THREE.Mesh(
    mesh_bay_blue_trim_86Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bay_blue_trim_86.name = "Bay blue trim strip";
  if (endpoint_bay_blue_trim_86) {
    mesh_bay_blue_trim_86.position.copy(endpoint_bay_blue_trim_86.midpoint);
    mesh_bay_blue_trim_86.quaternion.copy(endpoint_bay_blue_trim_86.quaternion);
  }
  mesh_bay_blue_trim_86.castShadow = options.castShadow ?? true;
  mesh_bay_blue_trim_86.receiveShadow = options.receiveShadow ?? true;
  mesh_bay_blue_trim_86.userData.sculptComponent = {"id": "bay-blue-trim", "name": "Bay blue trim strip", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.35, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight enamel trim along the upper bay edge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/bay-blue-trim-mount", "structuralParent": "stern-bay-housing", "localStart": [1.63, 0.15, 1.075], "localEnd": [1.63, 0.15, 1.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.7, "height": 0.06, "depth": 0.1, "units": "relative", "confidence": 0.75}, "transform": {"position": [1.63, 0.15, 1.075], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bay_blue_trim_86.add(mesh_bay_blue_trim_86);
  meshes["bay-blue-trim"] = mesh_bay_blue_trim_86;
  colliders["bay-blue-trim"] = {"type": "box", "fit": "tight"};

  const attachment_mouth_ring_red_87 = {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-ring-red-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.235], "localEnd": [0.0, -0.07, 0.235], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_mouth_ring_red_87 = makeAttachmentEndpoint(attachment_mouth_ring_red_87);
  const node_mouth_ring_red_87 = new THREE.Group();
  node_mouth_ring_red_87.name = "Mouth Ring Red__pivot";
  if (endpoint_mouth_ring_red_87) {
    node_mouth_ring_red_87.position.copy(endpoint_mouth_ring_red_87.start);
    node_mouth_ring_red_87.rotation.set(0, 0, 0);
    node_mouth_ring_red_87.scale.set(1, 1, 1);
  } else {
    node_mouth_ring_red_87.position.set(0.0, -0.07, 0.235);
    node_mouth_ring_red_87.rotation.set(0.0, 0.0, 0.0);
    node_mouth_ring_red_87.scale.set(1.0, 1.0, 1.0);
  }
  node_mouth_ring_red_87.userData.sculptComponent = {"id": "mouth-ring-red", "name": "Mouth Ring Red", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.32, 0.34], [2.92, -0.06], [2.32, -0.42]], "depth": 0.48}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-ring-red-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.235], "localEnd": [0.0, -0.07, 0.235], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.235], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_ring_red_87.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mouth_ring_red_87);
  nodes["mouth-ring-red"] = node_mouth_ring_red_87;
  const mesh_mouth_ring_red_87Geometry = endpoint_mouth_ring_red_87
    ? new THREE.CylinderGeometry(endpoint_mouth_ring_red_87.endRadius, endpoint_mouth_ring_red_87.baseRadius, endpoint_mouth_ring_red_87.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.32, 0.34], [2.92, -0.06], [2.32, -0.42]], "depth": 0.48});
  const mesh_mouth_ring_red_87 = new THREE.Mesh(
    mesh_mouth_ring_red_87Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_ring_red_87.name = "Mouth Ring Red";
  if (endpoint_mouth_ring_red_87) {
    mesh_mouth_ring_red_87.position.copy(endpoint_mouth_ring_red_87.midpoint);
    mesh_mouth_ring_red_87.quaternion.copy(endpoint_mouth_ring_red_87.quaternion);
  }
  mesh_mouth_ring_red_87.castShadow = options.castShadow ?? true;
  mesh_mouth_ring_red_87.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_ring_red_87.userData.sculptComponent = {"id": "mouth-ring-red", "name": "Mouth Ring Red", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.32, 0.34], [2.92, -0.06], [2.32, -0.42]], "depth": 0.48}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-ring-red-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.235], "localEnd": [0.0, -0.07, 0.235], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.235], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_ring_red_87.add(mesh_mouth_ring_red_87);
  meshes["mouth-ring-red"] = mesh_mouth_ring_red_87;
  colliders["mouth-ring-red"] = {"type": "box", "fit": "tight"};

  const attachment_mouth_ring_blue_88 = {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-ring-blue-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.397], "localEnd": [0.0, -0.07, 0.397], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_mouth_ring_blue_88 = makeAttachmentEndpoint(attachment_mouth_ring_blue_88);
  const node_mouth_ring_blue_88 = new THREE.Group();
  node_mouth_ring_blue_88.name = "Mouth Ring Blue__pivot";
  if (endpoint_mouth_ring_blue_88) {
    node_mouth_ring_blue_88.position.copy(endpoint_mouth_ring_blue_88.start);
    node_mouth_ring_blue_88.rotation.set(0, 0, 0);
    node_mouth_ring_blue_88.scale.set(1, 1, 1);
  } else {
    node_mouth_ring_blue_88.position.set(0.0, -0.07, 0.3974);
    node_mouth_ring_blue_88.rotation.set(0.0, 0.0, 0.0);
    node_mouth_ring_blue_88.scale.set(1.0, 1.0, 1.0);
  }
  node_mouth_ring_blue_88.userData.sculptComponent = {"id": "mouth-ring-blue", "name": "Mouth Ring Blue", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.372, 0.241], [2.816, -0.055], [2.372, -0.321]], "depth": 0.35519999999999996}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-ring-blue-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.397], "localEnd": [0.0, -0.07, 0.397], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.3974], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_ring_blue_88.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mouth_ring_blue_88);
  nodes["mouth-ring-blue"] = node_mouth_ring_blue_88;
  const mesh_mouth_ring_blue_88Geometry = endpoint_mouth_ring_blue_88
    ? new THREE.CylinderGeometry(endpoint_mouth_ring_blue_88.endRadius, endpoint_mouth_ring_blue_88.baseRadius, endpoint_mouth_ring_blue_88.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.372, 0.241], [2.816, -0.055], [2.372, -0.321]], "depth": 0.35519999999999996});
  const mesh_mouth_ring_blue_88 = new THREE.Mesh(
    mesh_mouth_ring_blue_88Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_ring_blue_88.name = "Mouth Ring Blue";
  if (endpoint_mouth_ring_blue_88) {
    mesh_mouth_ring_blue_88.position.copy(endpoint_mouth_ring_blue_88.midpoint);
    mesh_mouth_ring_blue_88.quaternion.copy(endpoint_mouth_ring_blue_88.quaternion);
  }
  mesh_mouth_ring_blue_88.castShadow = options.castShadow ?? true;
  mesh_mouth_ring_blue_88.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_ring_blue_88.userData.sculptComponent = {"id": "mouth-ring-blue", "name": "Mouth Ring Blue", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.372, 0.241], [2.816, -0.055], [2.372, -0.321]], "depth": 0.35519999999999996}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-ring-blue-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.397], "localEnd": [0.0, -0.07, 0.397], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.3974], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_ring_blue_88.add(mesh_mouth_ring_blue_88);
  meshes["mouth-ring-blue"] = mesh_mouth_ring_blue_88;
  colliders["mouth-ring-blue"] = {"type": "box", "fit": "tight"};

  const attachment_mouth_throat_89 = {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-throat-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.54], "localEnd": [0.0, -0.07, 0.54], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_mouth_throat_89 = makeAttachmentEndpoint(attachment_mouth_throat_89);
  const node_mouth_throat_89 = new THREE.Group();
  node_mouth_throat_89.name = "Mouth Throat__pivot";
  if (endpoint_mouth_throat_89) {
    node_mouth_throat_89.position.copy(endpoint_mouth_throat_89.start);
    node_mouth_throat_89.rotation.set(0, 0, 0);
    node_mouth_throat_89.scale.set(1, 1, 1);
  } else {
    node_mouth_throat_89.position.set(0.0, -0.07, 0.5402);
    node_mouth_throat_89.rotation.set(0.0, 0.0, 0.0);
    node_mouth_throat_89.scale.set(1.0, 1.0, 1.0);
  }
  node_mouth_throat_89.userData.sculptComponent = {"id": "mouth-throat", "name": "Mouth Throat", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.49999999999999994, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.416, 0.158], [2.728, -0.05], [2.416, -0.238]], "depth": 0.2496}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-throat-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.54], "localEnd": [0.0, -0.07, 0.54], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.5402], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_throat_89.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mouth_throat_89);
  nodes["mouth-throat"] = node_mouth_throat_89;
  const mesh_mouth_throat_89Geometry = endpoint_mouth_throat_89
    ? new THREE.CylinderGeometry(endpoint_mouth_throat_89.endRadius, endpoint_mouth_throat_89.baseRadius, endpoint_mouth_throat_89.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.416, 0.158], [2.728, -0.05], [2.416, -0.238]], "depth": 0.2496});
  const mesh_mouth_throat_89 = new THREE.Mesh(
    mesh_mouth_throat_89Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_throat_89.name = "Mouth Throat";
  if (endpoint_mouth_throat_89) {
    mesh_mouth_throat_89.position.copy(endpoint_mouth_throat_89.midpoint);
    mesh_mouth_throat_89.quaternion.copy(endpoint_mouth_throat_89.quaternion);
  }
  mesh_mouth_throat_89.castShadow = options.castShadow ?? true;
  mesh_mouth_throat_89.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_throat_89.userData.sculptComponent = {"id": "mouth-throat", "name": "Mouth Throat", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.49999999999999994, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.416, 0.158], [2.728, -0.05], [2.416, -0.238]], "depth": 0.2496}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-throat-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.54], "localEnd": [0.0, -0.07, 0.54], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.5402], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_throat_89.add(mesh_mouth_throat_89);
  meshes["mouth-throat"] = mesh_mouth_throat_89;
  colliders["mouth-throat"] = {"type": "box", "fit": "tight"};

  const attachment_mouth_core_90 = {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-core-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.683], "localEnd": [0.0, -0.07, 0.683], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_mouth_core_90 = makeAttachmentEndpoint(attachment_mouth_core_90);
  const node_mouth_core_90 = new THREE.Group();
  node_mouth_core_90.name = "Mouth Core__pivot";
  if (endpoint_mouth_core_90) {
    node_mouth_core_90.position.copy(endpoint_mouth_core_90.start);
    node_mouth_core_90.rotation.set(0, 0, 0);
    node_mouth_core_90.scale.set(1, 1, 1);
  } else {
    node_mouth_core_90.position.set(0.0, -0.07, 0.6826);
    node_mouth_core_90.rotation.set(0.0, 0.0, 0.0);
    node_mouth_core_90.scale.set(1.0, 1.0, 1.0);
  }
  node_mouth_core_90.userData.sculptComponent = {"id": "mouth-core", "name": "Mouth Core", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.3999999999999999, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.468, 0.059], [2.624, -0.045], [2.468, -0.139]], "depth": 0.1248}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-core-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.683], "localEnd": [0.0, -0.07, 0.683], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.6826], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_core_90.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mouth_core_90);
  nodes["mouth-core"] = node_mouth_core_90;
  const mesh_mouth_core_90Geometry = endpoint_mouth_core_90
    ? new THREE.CylinderGeometry(endpoint_mouth_core_90.endRadius, endpoint_mouth_core_90.baseRadius, endpoint_mouth_core_90.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.468, 0.059], [2.624, -0.045], [2.468, -0.139]], "depth": 0.1248});
  const mesh_mouth_core_90 = new THREE.Mesh(
    mesh_mouth_core_90Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_core_90.name = "Mouth Core";
  if (endpoint_mouth_core_90) {
    mesh_mouth_core_90.position.copy(endpoint_mouth_core_90.midpoint);
    mesh_mouth_core_90.quaternion.copy(endpoint_mouth_core_90.quaternion);
  }
  mesh_mouth_core_90.castShadow = options.castShadow ?? true;
  mesh_mouth_core_90.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_core_90.userData.sculptComponent = {"id": "mouth-core", "name": "Mouth Core", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.3999999999999999, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Concentric red->blue->orange->dark rings at the bill root: the mouth/eye cluster of the fish, not an exhaust nozzle. Nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.468, 0.059], [2.624, -0.045], [2.468, -0.139]], "depth": 0.1248}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/mouth-core-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.683], "localEnd": [0.0, -0.07, 0.683], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.6826], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mouth_core_90.add(mesh_mouth_core_90);
  meshes["mouth-core"] = mesh_mouth_core_90;
  colliders["mouth-core"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_1_91 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, -0.34], "localEnd": [-1.93, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_1_91 = makeAttachmentEndpoint(attachment_mast_base_vent_port_1_91);
  const node_mast_base_vent_port_1_91 = new THREE.Group();
  node_mast_base_vent_port_1_91.name = "Mast base vent port 1__pivot";
  if (endpoint_mast_base_vent_port_1_91) {
    node_mast_base_vent_port_1_91.position.copy(endpoint_mast_base_vent_port_1_91.start);
    node_mast_base_vent_port_1_91.rotation.set(0, 0, 0);
    node_mast_base_vent_port_1_91.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_1_91.position.set(-1.93, 0.2, -0.34);
    node_mast_base_vent_port_1_91.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_1_91.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_1_91.userData.sculptComponent = {"id": "mast-base-vent-port-1", "name": "Mast base vent port 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, -0.34], "localEnd": [-1.93, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_1_91.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_1_91);
  nodes["mast-base-vent-port-1"] = node_mast_base_vent_port_1_91;
  const mesh_mast_base_vent_port_1_91Geometry = endpoint_mast_base_vent_port_1_91
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_1_91.endRadius, endpoint_mast_base_vent_port_1_91.baseRadius, endpoint_mast_base_vent_port_1_91.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_1_91 = new THREE.Mesh(
    mesh_mast_base_vent_port_1_91Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_1_91.name = "Mast base vent port 1";
  if (endpoint_mast_base_vent_port_1_91) {
    mesh_mast_base_vent_port_1_91.position.copy(endpoint_mast_base_vent_port_1_91.midpoint);
    mesh_mast_base_vent_port_1_91.quaternion.copy(endpoint_mast_base_vent_port_1_91.quaternion);
  }
  mesh_mast_base_vent_port_1_91.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_1_91.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_1_91.userData.sculptComponent = {"id": "mast-base-vent-port-1", "name": "Mast base vent port 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, -0.34], "localEnd": [-1.93, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_1_91.add(mesh_mast_base_vent_port_1_91);
  meshes["mast-base-vent-port-1"] = mesh_mast_base_vent_port_1_91;
  colliders["mast-base-vent-port-1"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_2_92 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, -0.34], "localEnd": [-1.8, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_2_92 = makeAttachmentEndpoint(attachment_mast_base_vent_port_2_92);
  const node_mast_base_vent_port_2_92 = new THREE.Group();
  node_mast_base_vent_port_2_92.name = "Mast base vent port 2__pivot";
  if (endpoint_mast_base_vent_port_2_92) {
    node_mast_base_vent_port_2_92.position.copy(endpoint_mast_base_vent_port_2_92.start);
    node_mast_base_vent_port_2_92.rotation.set(0, 0, 0);
    node_mast_base_vent_port_2_92.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_2_92.position.set(-1.7999999999999998, 0.2, -0.34);
    node_mast_base_vent_port_2_92.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_2_92.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_2_92.userData.sculptComponent = {"id": "mast-base-vent-port-2", "name": "Mast base vent port 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, -0.34], "localEnd": [-1.8, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_2_92.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_2_92);
  nodes["mast-base-vent-port-2"] = node_mast_base_vent_port_2_92;
  const mesh_mast_base_vent_port_2_92Geometry = endpoint_mast_base_vent_port_2_92
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_2_92.endRadius, endpoint_mast_base_vent_port_2_92.baseRadius, endpoint_mast_base_vent_port_2_92.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_2_92 = new THREE.Mesh(
    mesh_mast_base_vent_port_2_92Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_2_92.name = "Mast base vent port 2";
  if (endpoint_mast_base_vent_port_2_92) {
    mesh_mast_base_vent_port_2_92.position.copy(endpoint_mast_base_vent_port_2_92.midpoint);
    mesh_mast_base_vent_port_2_92.quaternion.copy(endpoint_mast_base_vent_port_2_92.quaternion);
  }
  mesh_mast_base_vent_port_2_92.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_2_92.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_2_92.userData.sculptComponent = {"id": "mast-base-vent-port-2", "name": "Mast base vent port 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, -0.34], "localEnd": [-1.8, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_2_92.add(mesh_mast_base_vent_port_2_92);
  meshes["mast-base-vent-port-2"] = mesh_mast_base_vent_port_2_92;
  colliders["mast-base-vent-port-2"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_3_93 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, -0.34], "localEnd": [-1.67, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_3_93 = makeAttachmentEndpoint(attachment_mast_base_vent_port_3_93);
  const node_mast_base_vent_port_3_93 = new THREE.Group();
  node_mast_base_vent_port_3_93.name = "Mast base vent port 3__pivot";
  if (endpoint_mast_base_vent_port_3_93) {
    node_mast_base_vent_port_3_93.position.copy(endpoint_mast_base_vent_port_3_93.start);
    node_mast_base_vent_port_3_93.rotation.set(0, 0, 0);
    node_mast_base_vent_port_3_93.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_3_93.position.set(-1.67, 0.2, -0.34);
    node_mast_base_vent_port_3_93.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_3_93.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_3_93.userData.sculptComponent = {"id": "mast-base-vent-port-3", "name": "Mast base vent port 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, -0.34], "localEnd": [-1.67, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_3_93.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_3_93);
  nodes["mast-base-vent-port-3"] = node_mast_base_vent_port_3_93;
  const mesh_mast_base_vent_port_3_93Geometry = endpoint_mast_base_vent_port_3_93
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_3_93.endRadius, endpoint_mast_base_vent_port_3_93.baseRadius, endpoint_mast_base_vent_port_3_93.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_3_93 = new THREE.Mesh(
    mesh_mast_base_vent_port_3_93Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_3_93.name = "Mast base vent port 3";
  if (endpoint_mast_base_vent_port_3_93) {
    mesh_mast_base_vent_port_3_93.position.copy(endpoint_mast_base_vent_port_3_93.midpoint);
    mesh_mast_base_vent_port_3_93.quaternion.copy(endpoint_mast_base_vent_port_3_93.quaternion);
  }
  mesh_mast_base_vent_port_3_93.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_3_93.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_3_93.userData.sculptComponent = {"id": "mast-base-vent-port-3", "name": "Mast base vent port 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, -0.34], "localEnd": [-1.67, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_3_93.add(mesh_mast_base_vent_port_3_93);
  meshes["mast-base-vent-port-3"] = mesh_mast_base_vent_port_3_93;
  colliders["mast-base-vent-port-3"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_4_94 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, -0.34], "localEnd": [-1.54, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_4_94 = makeAttachmentEndpoint(attachment_mast_base_vent_port_4_94);
  const node_mast_base_vent_port_4_94 = new THREE.Group();
  node_mast_base_vent_port_4_94.name = "Mast base vent port 4__pivot";
  if (endpoint_mast_base_vent_port_4_94) {
    node_mast_base_vent_port_4_94.position.copy(endpoint_mast_base_vent_port_4_94.start);
    node_mast_base_vent_port_4_94.rotation.set(0, 0, 0);
    node_mast_base_vent_port_4_94.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_4_94.position.set(-1.54, 0.2, -0.34);
    node_mast_base_vent_port_4_94.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_4_94.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_4_94.userData.sculptComponent = {"id": "mast-base-vent-port-4", "name": "Mast base vent port 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, -0.34], "localEnd": [-1.54, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_4_94.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_4_94);
  nodes["mast-base-vent-port-4"] = node_mast_base_vent_port_4_94;
  const mesh_mast_base_vent_port_4_94Geometry = endpoint_mast_base_vent_port_4_94
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_4_94.endRadius, endpoint_mast_base_vent_port_4_94.baseRadius, endpoint_mast_base_vent_port_4_94.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_4_94 = new THREE.Mesh(
    mesh_mast_base_vent_port_4_94Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_4_94.name = "Mast base vent port 4";
  if (endpoint_mast_base_vent_port_4_94) {
    mesh_mast_base_vent_port_4_94.position.copy(endpoint_mast_base_vent_port_4_94.midpoint);
    mesh_mast_base_vent_port_4_94.quaternion.copy(endpoint_mast_base_vent_port_4_94.quaternion);
  }
  mesh_mast_base_vent_port_4_94.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_4_94.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_4_94.userData.sculptComponent = {"id": "mast-base-vent-port-4", "name": "Mast base vent port 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, -0.34], "localEnd": [-1.54, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_4_94.add(mesh_mast_base_vent_port_4_94);
  meshes["mast-base-vent-port-4"] = mesh_mast_base_vent_port_4_94;
  colliders["mast-base-vent-port-4"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_1_95 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, 0.34], "localEnd": [-1.93, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_1_95 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_1_95);
  const node_mast_base_vent_stbd_1_95 = new THREE.Group();
  node_mast_base_vent_stbd_1_95.name = "Mast base vent stbd 1__pivot";
  if (endpoint_mast_base_vent_stbd_1_95) {
    node_mast_base_vent_stbd_1_95.position.copy(endpoint_mast_base_vent_stbd_1_95.start);
    node_mast_base_vent_stbd_1_95.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_1_95.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_1_95.position.set(-1.93, 0.2, 0.34);
    node_mast_base_vent_stbd_1_95.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_1_95.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_1_95.userData.sculptComponent = {"id": "mast-base-vent-stbd-1", "name": "Mast base vent stbd 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, 0.34], "localEnd": [-1.93, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_1_95.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_1_95);
  nodes["mast-base-vent-stbd-1"] = node_mast_base_vent_stbd_1_95;
  const mesh_mast_base_vent_stbd_1_95Geometry = endpoint_mast_base_vent_stbd_1_95
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_1_95.endRadius, endpoint_mast_base_vent_stbd_1_95.baseRadius, endpoint_mast_base_vent_stbd_1_95.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_1_95 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_1_95Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_1_95.name = "Mast base vent stbd 1";
  if (endpoint_mast_base_vent_stbd_1_95) {
    mesh_mast_base_vent_stbd_1_95.position.copy(endpoint_mast_base_vent_stbd_1_95.midpoint);
    mesh_mast_base_vent_stbd_1_95.quaternion.copy(endpoint_mast_base_vent_stbd_1_95.quaternion);
  }
  mesh_mast_base_vent_stbd_1_95.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_1_95.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_1_95.userData.sculptComponent = {"id": "mast-base-vent-stbd-1", "name": "Mast base vent stbd 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, 0.34], "localEnd": [-1.93, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_1_95.add(mesh_mast_base_vent_stbd_1_95);
  meshes["mast-base-vent-stbd-1"] = mesh_mast_base_vent_stbd_1_95;
  colliders["mast-base-vent-stbd-1"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_2_96 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, 0.34], "localEnd": [-1.8, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_2_96 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_2_96);
  const node_mast_base_vent_stbd_2_96 = new THREE.Group();
  node_mast_base_vent_stbd_2_96.name = "Mast base vent stbd 2__pivot";
  if (endpoint_mast_base_vent_stbd_2_96) {
    node_mast_base_vent_stbd_2_96.position.copy(endpoint_mast_base_vent_stbd_2_96.start);
    node_mast_base_vent_stbd_2_96.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_2_96.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_2_96.position.set(-1.7999999999999998, 0.2, 0.34);
    node_mast_base_vent_stbd_2_96.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_2_96.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_2_96.userData.sculptComponent = {"id": "mast-base-vent-stbd-2", "name": "Mast base vent stbd 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, 0.34], "localEnd": [-1.8, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_2_96.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_2_96);
  nodes["mast-base-vent-stbd-2"] = node_mast_base_vent_stbd_2_96;
  const mesh_mast_base_vent_stbd_2_96Geometry = endpoint_mast_base_vent_stbd_2_96
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_2_96.endRadius, endpoint_mast_base_vent_stbd_2_96.baseRadius, endpoint_mast_base_vent_stbd_2_96.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_2_96 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_2_96Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_2_96.name = "Mast base vent stbd 2";
  if (endpoint_mast_base_vent_stbd_2_96) {
    mesh_mast_base_vent_stbd_2_96.position.copy(endpoint_mast_base_vent_stbd_2_96.midpoint);
    mesh_mast_base_vent_stbd_2_96.quaternion.copy(endpoint_mast_base_vent_stbd_2_96.quaternion);
  }
  mesh_mast_base_vent_stbd_2_96.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_2_96.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_2_96.userData.sculptComponent = {"id": "mast-base-vent-stbd-2", "name": "Mast base vent stbd 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, 0.34], "localEnd": [-1.8, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_2_96.add(mesh_mast_base_vent_stbd_2_96);
  meshes["mast-base-vent-stbd-2"] = mesh_mast_base_vent_stbd_2_96;
  colliders["mast-base-vent-stbd-2"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_3_97 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, 0.34], "localEnd": [-1.67, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_3_97 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_3_97);
  const node_mast_base_vent_stbd_3_97 = new THREE.Group();
  node_mast_base_vent_stbd_3_97.name = "Mast base vent stbd 3__pivot";
  if (endpoint_mast_base_vent_stbd_3_97) {
    node_mast_base_vent_stbd_3_97.position.copy(endpoint_mast_base_vent_stbd_3_97.start);
    node_mast_base_vent_stbd_3_97.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_3_97.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_3_97.position.set(-1.67, 0.2, 0.34);
    node_mast_base_vent_stbd_3_97.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_3_97.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_3_97.userData.sculptComponent = {"id": "mast-base-vent-stbd-3", "name": "Mast base vent stbd 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, 0.34], "localEnd": [-1.67, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_3_97.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_3_97);
  nodes["mast-base-vent-stbd-3"] = node_mast_base_vent_stbd_3_97;
  const mesh_mast_base_vent_stbd_3_97Geometry = endpoint_mast_base_vent_stbd_3_97
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_3_97.endRadius, endpoint_mast_base_vent_stbd_3_97.baseRadius, endpoint_mast_base_vent_stbd_3_97.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_3_97 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_3_97Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_3_97.name = "Mast base vent stbd 3";
  if (endpoint_mast_base_vent_stbd_3_97) {
    mesh_mast_base_vent_stbd_3_97.position.copy(endpoint_mast_base_vent_stbd_3_97.midpoint);
    mesh_mast_base_vent_stbd_3_97.quaternion.copy(endpoint_mast_base_vent_stbd_3_97.quaternion);
  }
  mesh_mast_base_vent_stbd_3_97.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_3_97.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_3_97.userData.sculptComponent = {"id": "mast-base-vent-stbd-3", "name": "Mast base vent stbd 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, 0.34], "localEnd": [-1.67, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_3_97.add(mesh_mast_base_vent_stbd_3_97);
  meshes["mast-base-vent-stbd-3"] = mesh_mast_base_vent_stbd_3_97;
  colliders["mast-base-vent-stbd-3"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_4_98 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, 0.34], "localEnd": [-1.54, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_4_98 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_4_98);
  const node_mast_base_vent_stbd_4_98 = new THREE.Group();
  node_mast_base_vent_stbd_4_98.name = "Mast base vent stbd 4__pivot";
  if (endpoint_mast_base_vent_stbd_4_98) {
    node_mast_base_vent_stbd_4_98.position.copy(endpoint_mast_base_vent_stbd_4_98.start);
    node_mast_base_vent_stbd_4_98.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_4_98.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_4_98.position.set(-1.54, 0.2, 0.34);
    node_mast_base_vent_stbd_4_98.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_4_98.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_4_98.userData.sculptComponent = {"id": "mast-base-vent-stbd-4", "name": "Mast base vent stbd 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, 0.34], "localEnd": [-1.54, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_4_98.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_4_98);
  nodes["mast-base-vent-stbd-4"] = node_mast_base_vent_stbd_4_98;
  const mesh_mast_base_vent_stbd_4_98Geometry = endpoint_mast_base_vent_stbd_4_98
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_4_98.endRadius, endpoint_mast_base_vent_stbd_4_98.baseRadius, endpoint_mast_base_vent_stbd_4_98.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_4_98 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_4_98Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_4_98.name = "Mast base vent stbd 4";
  if (endpoint_mast_base_vent_stbd_4_98) {
    mesh_mast_base_vent_stbd_4_98.position.copy(endpoint_mast_base_vent_stbd_4_98.midpoint);
    mesh_mast_base_vent_stbd_4_98.quaternion.copy(endpoint_mast_base_vent_stbd_4_98.quaternion);
  }
  mesh_mast_base_vent_stbd_4_98.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_4_98.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_4_98.userData.sculptComponent = {"id": "mast-base-vent-stbd-4", "name": "Mast base vent stbd 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, 0.34], "localEnd": [-1.54, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_4_98.add(mesh_mast_base_vent_stbd_4_98);
  meshes["mast-base-vent-stbd-4"] = mesh_mast_base_vent_stbd_4_98;
  colliders["mast-base-vent-stbd-4"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_diamond_hatch_99 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-diamond-hatch-mount", "structuralParent": "mast-base-housing", "localStart": [0, 0, 0.31], "localEnd": [0, 0, 0.31], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_diamond_hatch_99 = makeAttachmentEndpoint(attachment_mast_base_diamond_hatch_99);
  const node_mast_base_diamond_hatch_99 = new THREE.Group();
  node_mast_base_diamond_hatch_99.name = "Mast base diamond hatch__pivot";
  if (endpoint_mast_base_diamond_hatch_99) {
    node_mast_base_diamond_hatch_99.position.copy(endpoint_mast_base_diamond_hatch_99.start);
    node_mast_base_diamond_hatch_99.rotation.set(0, 0, 0);
    node_mast_base_diamond_hatch_99.scale.set(1, 1, 1);
  } else {
    node_mast_base_diamond_hatch_99.position.set(0.0, 0.0, 0.31);
    node_mast_base_diamond_hatch_99.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_diamond_hatch_99.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_base_diamond_hatch_99.userData.sculptComponent = {"id": "mast-base-diamond-hatch", "name": "Mast base diamond hatch", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.35, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat diamond hatch plate on the housing face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.61, 0.55], [-1.39, 0.37], [-1.61, 0.19], [-1.83, 0.37]], "depth": 0.04}}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-diamond-hatch-mount", "structuralParent": "mast-base-housing", "localStart": [0, 0, 0.31], "localEnd": [0, 0, 0.31], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.31], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d15"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_diamond_hatch_99.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_diamond_hatch_99);
  nodes["mast-base-diamond-hatch"] = node_mast_base_diamond_hatch_99;
  const mesh_mast_base_diamond_hatch_99Geometry = endpoint_mast_base_diamond_hatch_99
    ? new THREE.CylinderGeometry(endpoint_mast_base_diamond_hatch_99.endRadius, endpoint_mast_base_diamond_hatch_99.baseRadius, endpoint_mast_base_diamond_hatch_99.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.61, 0.55], [-1.39, 0.37], [-1.61, 0.19], [-1.83, 0.37]], "depth": 0.04});
  const mesh_mast_base_diamond_hatch_99 = new THREE.Mesh(
    mesh_mast_base_diamond_hatch_99Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_diamond_hatch_99.name = "Mast base diamond hatch";
  if (endpoint_mast_base_diamond_hatch_99) {
    mesh_mast_base_diamond_hatch_99.position.copy(endpoint_mast_base_diamond_hatch_99.midpoint);
    mesh_mast_base_diamond_hatch_99.quaternion.copy(endpoint_mast_base_diamond_hatch_99.quaternion);
  }
  mesh_mast_base_diamond_hatch_99.castShadow = options.castShadow ?? true;
  mesh_mast_base_diamond_hatch_99.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_diamond_hatch_99.userData.sculptComponent = {"id": "mast-base-diamond-hatch", "name": "Mast base diamond hatch", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.35, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat diamond hatch plate on the housing face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.61, 0.55], [-1.39, 0.37], [-1.61, 0.19], [-1.83, 0.37]], "depth": 0.04}}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-diamond-hatch-mount", "structuralParent": "mast-base-housing", "localStart": [0, 0, 0.31], "localEnd": [0, 0, 0.31], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.31], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d15"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_diamond_hatch_99.add(mesh_mast_base_diamond_hatch_99);
  meshes["mast-base-diamond-hatch"] = mesh_mast_base_diamond_hatch_99;
  colliders["mast-base-diamond-hatch"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_1_100 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-1-mount", "structuralParent": "root", "localStart": [-2.2, 0.5, 0.475], "localEnd": [-2.2, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_1_100 = makeAttachmentEndpoint(attachment_hull_antenna_nub_1_100);
  const node_hull_antenna_nub_1_100 = new THREE.Group();
  node_hull_antenna_nub_1_100.name = "Hull antenna nub 1__pivot";
  if (endpoint_hull_antenna_nub_1_100) {
    node_hull_antenna_nub_1_100.position.copy(endpoint_hull_antenna_nub_1_100.start);
    node_hull_antenna_nub_1_100.rotation.set(0, 0, 0);
    node_hull_antenna_nub_1_100.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_1_100.position.set(-2.2, 0.5, 0.475);
    node_hull_antenna_nub_1_100.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_1_100.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_1_100.userData.sculptComponent = {"id": "hull-antenna-nub-1", "name": "Hull antenna nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-1-mount", "structuralParent": "root", "localStart": [-2.2, 0.5, 0.475], "localEnd": [-2.2, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-2.2, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_1_100.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_1_100);
  nodes["hull-antenna-nub-1"] = node_hull_antenna_nub_1_100;
  const mesh_hull_antenna_nub_1_100Geometry = endpoint_hull_antenna_nub_1_100
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_1_100.endRadius, endpoint_hull_antenna_nub_1_100.baseRadius, endpoint_hull_antenna_nub_1_100.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_1_100 = new THREE.Mesh(
    mesh_hull_antenna_nub_1_100Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_1_100.name = "Hull antenna nub 1";
  if (endpoint_hull_antenna_nub_1_100) {
    mesh_hull_antenna_nub_1_100.position.copy(endpoint_hull_antenna_nub_1_100.midpoint);
    mesh_hull_antenna_nub_1_100.quaternion.copy(endpoint_hull_antenna_nub_1_100.quaternion);
  }
  mesh_hull_antenna_nub_1_100.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_1_100.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_1_100.userData.sculptComponent = {"id": "hull-antenna-nub-1", "name": "Hull antenna nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-1-mount", "structuralParent": "root", "localStart": [-2.2, 0.5, 0.475], "localEnd": [-2.2, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-2.2, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_1_100.add(mesh_hull_antenna_nub_1_100);
  meshes["hull-antenna-nub-1"] = mesh_hull_antenna_nub_1_100;
  colliders["hull-antenna-nub-1"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_2_101 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-2-mount", "structuralParent": "root", "localStart": [-1.25, 0.5, 0.475], "localEnd": [-1.25, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_2_101 = makeAttachmentEndpoint(attachment_hull_antenna_nub_2_101);
  const node_hull_antenna_nub_2_101 = new THREE.Group();
  node_hull_antenna_nub_2_101.name = "Hull antenna nub 2__pivot";
  if (endpoint_hull_antenna_nub_2_101) {
    node_hull_antenna_nub_2_101.position.copy(endpoint_hull_antenna_nub_2_101.start);
    node_hull_antenna_nub_2_101.rotation.set(0, 0, 0);
    node_hull_antenna_nub_2_101.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_2_101.position.set(-1.2500000000000002, 0.5, 0.475);
    node_hull_antenna_nub_2_101.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_2_101.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_2_101.userData.sculptComponent = {"id": "hull-antenna-nub-2", "name": "Hull antenna nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-2-mount", "structuralParent": "root", "localStart": [-1.25, 0.5, 0.475], "localEnd": [-1.25, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-1.2500000000000002, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_2_101.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_2_101);
  nodes["hull-antenna-nub-2"] = node_hull_antenna_nub_2_101;
  const mesh_hull_antenna_nub_2_101Geometry = endpoint_hull_antenna_nub_2_101
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_2_101.endRadius, endpoint_hull_antenna_nub_2_101.baseRadius, endpoint_hull_antenna_nub_2_101.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_2_101 = new THREE.Mesh(
    mesh_hull_antenna_nub_2_101Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_2_101.name = "Hull antenna nub 2";
  if (endpoint_hull_antenna_nub_2_101) {
    mesh_hull_antenna_nub_2_101.position.copy(endpoint_hull_antenna_nub_2_101.midpoint);
    mesh_hull_antenna_nub_2_101.quaternion.copy(endpoint_hull_antenna_nub_2_101.quaternion);
  }
  mesh_hull_antenna_nub_2_101.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_2_101.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_2_101.userData.sculptComponent = {"id": "hull-antenna-nub-2", "name": "Hull antenna nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-2-mount", "structuralParent": "root", "localStart": [-1.25, 0.5, 0.475], "localEnd": [-1.25, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-1.2500000000000002, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_2_101.add(mesh_hull_antenna_nub_2_101);
  meshes["hull-antenna-nub-2"] = mesh_hull_antenna_nub_2_101;
  colliders["hull-antenna-nub-2"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_3_102 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-3-mount", "structuralParent": "root", "localStart": [-0.3, 0.5, 0.475], "localEnd": [-0.3, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_3_102 = makeAttachmentEndpoint(attachment_hull_antenna_nub_3_102);
  const node_hull_antenna_nub_3_102 = new THREE.Group();
  node_hull_antenna_nub_3_102.name = "Hull antenna nub 3__pivot";
  if (endpoint_hull_antenna_nub_3_102) {
    node_hull_antenna_nub_3_102.position.copy(endpoint_hull_antenna_nub_3_102.start);
    node_hull_antenna_nub_3_102.rotation.set(0, 0, 0);
    node_hull_antenna_nub_3_102.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_3_102.position.set(-0.30000000000000027, 0.5, 0.475);
    node_hull_antenna_nub_3_102.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_3_102.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_3_102.userData.sculptComponent = {"id": "hull-antenna-nub-3", "name": "Hull antenna nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-3-mount", "structuralParent": "root", "localStart": [-0.3, 0.5, 0.475], "localEnd": [-0.3, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-0.30000000000000027, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_3_102.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_3_102);
  nodes["hull-antenna-nub-3"] = node_hull_antenna_nub_3_102;
  const mesh_hull_antenna_nub_3_102Geometry = endpoint_hull_antenna_nub_3_102
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_3_102.endRadius, endpoint_hull_antenna_nub_3_102.baseRadius, endpoint_hull_antenna_nub_3_102.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_3_102 = new THREE.Mesh(
    mesh_hull_antenna_nub_3_102Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_3_102.name = "Hull antenna nub 3";
  if (endpoint_hull_antenna_nub_3_102) {
    mesh_hull_antenna_nub_3_102.position.copy(endpoint_hull_antenna_nub_3_102.midpoint);
    mesh_hull_antenna_nub_3_102.quaternion.copy(endpoint_hull_antenna_nub_3_102.quaternion);
  }
  mesh_hull_antenna_nub_3_102.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_3_102.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_3_102.userData.sculptComponent = {"id": "hull-antenna-nub-3", "name": "Hull antenna nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-3-mount", "structuralParent": "root", "localStart": [-0.3, 0.5, 0.475], "localEnd": [-0.3, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-0.30000000000000027, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_3_102.add(mesh_hull_antenna_nub_3_102);
  meshes["hull-antenna-nub-3"] = mesh_hull_antenna_nub_3_102;
  colliders["hull-antenna-nub-3"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_4_103 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-4-mount", "structuralParent": "root", "localStart": [0.65, 0.5, 0.475], "localEnd": [0.65, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_4_103 = makeAttachmentEndpoint(attachment_hull_antenna_nub_4_103);
  const node_hull_antenna_nub_4_103 = new THREE.Group();
  node_hull_antenna_nub_4_103.name = "Hull antenna nub 4__pivot";
  if (endpoint_hull_antenna_nub_4_103) {
    node_hull_antenna_nub_4_103.position.copy(endpoint_hull_antenna_nub_4_103.start);
    node_hull_antenna_nub_4_103.rotation.set(0, 0, 0);
    node_hull_antenna_nub_4_103.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_4_103.position.set(0.6499999999999995, 0.5, 0.475);
    node_hull_antenna_nub_4_103.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_4_103.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_4_103.userData.sculptComponent = {"id": "hull-antenna-nub-4", "name": "Hull antenna nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-4-mount", "structuralParent": "root", "localStart": [0.65, 0.5, 0.475], "localEnd": [0.65, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [0.6499999999999995, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_4_103.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_4_103);
  nodes["hull-antenna-nub-4"] = node_hull_antenna_nub_4_103;
  const mesh_hull_antenna_nub_4_103Geometry = endpoint_hull_antenna_nub_4_103
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_4_103.endRadius, endpoint_hull_antenna_nub_4_103.baseRadius, endpoint_hull_antenna_nub_4_103.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_4_103 = new THREE.Mesh(
    mesh_hull_antenna_nub_4_103Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_4_103.name = "Hull antenna nub 4";
  if (endpoint_hull_antenna_nub_4_103) {
    mesh_hull_antenna_nub_4_103.position.copy(endpoint_hull_antenna_nub_4_103.midpoint);
    mesh_hull_antenna_nub_4_103.quaternion.copy(endpoint_hull_antenna_nub_4_103.quaternion);
  }
  mesh_hull_antenna_nub_4_103.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_4_103.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_4_103.userData.sculptComponent = {"id": "hull-antenna-nub-4", "name": "Hull antenna nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-4-mount", "structuralParent": "root", "localStart": [0.65, 0.5, 0.475], "localEnd": [0.65, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [0.6499999999999995, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_4_103.add(mesh_hull_antenna_nub_4_103);
  meshes["hull-antenna-nub-4"] = mesh_hull_antenna_nub_4_103;
  colliders["hull-antenna-nub-4"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_5_104 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-5-mount", "structuralParent": "root", "localStart": [1.6, 0.5, 0.475], "localEnd": [1.6, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_5_104 = makeAttachmentEndpoint(attachment_hull_antenna_nub_5_104);
  const node_hull_antenna_nub_5_104 = new THREE.Group();
  node_hull_antenna_nub_5_104.name = "Hull antenna nub 5__pivot";
  if (endpoint_hull_antenna_nub_5_104) {
    node_hull_antenna_nub_5_104.position.copy(endpoint_hull_antenna_nub_5_104.start);
    node_hull_antenna_nub_5_104.rotation.set(0, 0, 0);
    node_hull_antenna_nub_5_104.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_5_104.position.set(1.5999999999999996, 0.5, 0.475);
    node_hull_antenna_nub_5_104.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_5_104.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_5_104.userData.sculptComponent = {"id": "hull-antenna-nub-5", "name": "Hull antenna nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-5-mount", "structuralParent": "root", "localStart": [1.6, 0.5, 0.475], "localEnd": [1.6, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [1.5999999999999996, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_5_104.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_5_104);
  nodes["hull-antenna-nub-5"] = node_hull_antenna_nub_5_104;
  const mesh_hull_antenna_nub_5_104Geometry = endpoint_hull_antenna_nub_5_104
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_5_104.endRadius, endpoint_hull_antenna_nub_5_104.baseRadius, endpoint_hull_antenna_nub_5_104.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_5_104 = new THREE.Mesh(
    mesh_hull_antenna_nub_5_104Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_5_104.name = "Hull antenna nub 5";
  if (endpoint_hull_antenna_nub_5_104) {
    mesh_hull_antenna_nub_5_104.position.copy(endpoint_hull_antenna_nub_5_104.midpoint);
    mesh_hull_antenna_nub_5_104.quaternion.copy(endpoint_hull_antenna_nub_5_104.quaternion);
  }
  mesh_hull_antenna_nub_5_104.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_5_104.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_5_104.userData.sculptComponent = {"id": "hull-antenna-nub-5", "name": "Hull antenna nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-5-mount", "structuralParent": "root", "localStart": [1.6, 0.5, 0.475], "localEnd": [1.6, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [1.5999999999999996, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_5_104.add(mesh_hull_antenna_nub_5_104);
  meshes["hull-antenna-nub-5"] = mesh_hull_antenna_nub_5_104;
  colliders["hull-antenna-nub-5"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_6_105 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-6-mount", "structuralParent": "root", "localStart": [2.55, 0.5, 0.475], "localEnd": [2.55, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_6_105 = makeAttachmentEndpoint(attachment_hull_antenna_nub_6_105);
  const node_hull_antenna_nub_6_105 = new THREE.Group();
  node_hull_antenna_nub_6_105.name = "Hull antenna nub 6__pivot";
  if (endpoint_hull_antenna_nub_6_105) {
    node_hull_antenna_nub_6_105.position.copy(endpoint_hull_antenna_nub_6_105.start);
    node_hull_antenna_nub_6_105.rotation.set(0, 0, 0);
    node_hull_antenna_nub_6_105.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_6_105.position.set(2.55, 0.5, 0.475);
    node_hull_antenna_nub_6_105.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_6_105.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_6_105.userData.sculptComponent = {"id": "hull-antenna-nub-6", "name": "Hull antenna nub 6", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-6-mount", "structuralParent": "root", "localStart": [2.55, 0.5, 0.475], "localEnd": [2.55, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [2.55, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_6_105.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_6_105);
  nodes["hull-antenna-nub-6"] = node_hull_antenna_nub_6_105;
  const mesh_hull_antenna_nub_6_105Geometry = endpoint_hull_antenna_nub_6_105
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_6_105.endRadius, endpoint_hull_antenna_nub_6_105.baseRadius, endpoint_hull_antenna_nub_6_105.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_6_105 = new THREE.Mesh(
    mesh_hull_antenna_nub_6_105Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_6_105.name = "Hull antenna nub 6";
  if (endpoint_hull_antenna_nub_6_105) {
    mesh_hull_antenna_nub_6_105.position.copy(endpoint_hull_antenna_nub_6_105.midpoint);
    mesh_hull_antenna_nub_6_105.quaternion.copy(endpoint_hull_antenna_nub_6_105.quaternion);
  }
  mesh_hull_antenna_nub_6_105.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_6_105.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_6_105.userData.sculptComponent = {"id": "hull-antenna-nub-6", "name": "Hull antenna nub 6", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-6-mount", "structuralParent": "root", "localStart": [2.55, 0.5, 0.475], "localEnd": [2.55, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [2.55, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_6_105.add(mesh_hull_antenna_nub_6_105);
  meshes["hull-antenna-nub-6"] = mesh_hull_antenna_nub_6_105;
  colliders["hull-antenna-nub-6"] = {"type": "box", "fit": "tight"};

  const attachment_blue_bar_decal_106 = {"parentId": "root", "parentSocket": "root/blue-bar-decal-mount", "structuralParent": "root", "localStart": [0.48, 0.475, 0.675], "localEnd": [0.48, 0.475, 0.675], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_blue_bar_decal_106 = makeAttachmentEndpoint(attachment_blue_bar_decal_106);
  const node_blue_bar_decal_106 = new THREE.Group();
  node_blue_bar_decal_106.name = "Blue bar decal__pivot";
  if (endpoint_blue_bar_decal_106) {
    node_blue_bar_decal_106.position.copy(endpoint_blue_bar_decal_106.start);
    node_blue_bar_decal_106.rotation.set(0, 0, 0);
    node_blue_bar_decal_106.scale.set(1, 1, 1);
  } else {
    node_blue_bar_decal_106.position.set(0.48, 0.475, 0.675);
    node_blue_bar_decal_106.rotation.set(-1.5707963267948966, 0.0, 0.0);
    node_blue_bar_decal_106.scale.set(0.3, 0.14, 1.0);
  }
  node_blue_bar_decal_106.userData.sculptComponent = {"id": "blue-bar-decal", "name": "Blue bar decal", "level": "micro", "role": "decal", "logicalParent": "root", "importance": 0.3, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Flat painted decal panel; a plane card is correct - it has no relief.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/blue-bar-decal-mount", "structuralParent": "root", "localStart": [0.48, 0.475, 0.675], "localEnd": [0.48, 0.475, 0.675], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.14, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.48, 0.475, 0.675], "rotation": [-1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d08"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_blue_bar_decal_106.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_blue_bar_decal_106);
  nodes["blue-bar-decal"] = node_blue_bar_decal_106;
  const mesh_blue_bar_decal_106Geometry = endpoint_blue_bar_decal_106
    ? new THREE.CylinderGeometry(endpoint_blue_bar_decal_106.endRadius, endpoint_blue_bar_decal_106.baseRadius, endpoint_blue_bar_decal_106.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  const mesh_blue_bar_decal_106 = new THREE.Mesh(
    mesh_blue_bar_decal_106Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_blue_bar_decal_106.name = "Blue bar decal";
  if (endpoint_blue_bar_decal_106) {
    mesh_blue_bar_decal_106.position.copy(endpoint_blue_bar_decal_106.midpoint);
    mesh_blue_bar_decal_106.quaternion.copy(endpoint_blue_bar_decal_106.quaternion);
  }
  mesh_blue_bar_decal_106.castShadow = options.castShadow ?? true;
  mesh_blue_bar_decal_106.receiveShadow = options.receiveShadow ?? true;
  mesh_blue_bar_decal_106.userData.sculptComponent = {"id": "blue-bar-decal", "name": "Blue bar decal", "level": "micro", "role": "decal", "logicalParent": "root", "importance": 0.3, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Flat painted decal panel; a plane card is correct - it has no relief.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/blue-bar-decal-mount", "structuralParent": "root", "localStart": [0.48, 0.475, 0.675], "localEnd": [0.48, 0.475, 0.675], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.14, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.48, 0.475, 0.675], "rotation": [-1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d08"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_blue_bar_decal_106.add(mesh_blue_bar_decal_106);
  meshes["blue-bar-decal"] = mesh_blue_bar_decal_106;
  colliders["blue-bar-decal"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_1_107 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-1-mount", "structuralParent": "root", "localStart": [1.6, 0.06, 0.475], "localEnd": [1.6, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_1_107 = makeAttachmentEndpoint(attachment_tail_hardpoint_1_107);
  const node_tail_hardpoint_1_107 = new THREE.Group();
  node_tail_hardpoint_1_107.name = "Tail hardpoint nub 1__pivot";
  if (endpoint_tail_hardpoint_1_107) {
    node_tail_hardpoint_1_107.position.copy(endpoint_tail_hardpoint_1_107.start);
    node_tail_hardpoint_1_107.rotation.set(0, 0, 0);
    node_tail_hardpoint_1_107.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_1_107.position.set(1.6, 0.06, 0.475);
    node_tail_hardpoint_1_107.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_1_107.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_1_107.userData.sculptComponent = {"id": "tail-hardpoint-1", "name": "Tail hardpoint nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-1-mount", "structuralParent": "root", "localStart": [1.6, 0.06, 0.475], "localEnd": [1.6, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.6, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_1_107.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_1_107);
  nodes["tail-hardpoint-1"] = node_tail_hardpoint_1_107;
  const mesh_tail_hardpoint_1_107Geometry = endpoint_tail_hardpoint_1_107
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_1_107.endRadius, endpoint_tail_hardpoint_1_107.baseRadius, endpoint_tail_hardpoint_1_107.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_1_107 = new THREE.Mesh(
    mesh_tail_hardpoint_1_107Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_1_107.name = "Tail hardpoint nub 1";
  if (endpoint_tail_hardpoint_1_107) {
    mesh_tail_hardpoint_1_107.position.copy(endpoint_tail_hardpoint_1_107.midpoint);
    mesh_tail_hardpoint_1_107.quaternion.copy(endpoint_tail_hardpoint_1_107.quaternion);
  }
  mesh_tail_hardpoint_1_107.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_1_107.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_1_107.userData.sculptComponent = {"id": "tail-hardpoint-1", "name": "Tail hardpoint nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-1-mount", "structuralParent": "root", "localStart": [1.6, 0.06, 0.475], "localEnd": [1.6, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.6, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_1_107.add(mesh_tail_hardpoint_1_107);
  meshes["tail-hardpoint-1"] = mesh_tail_hardpoint_1_107;
  colliders["tail-hardpoint-1"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_2_108 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-2-mount", "structuralParent": "root", "localStart": [2.32, 0.06, 0.475], "localEnd": [2.32, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_2_108 = makeAttachmentEndpoint(attachment_tail_hardpoint_2_108);
  const node_tail_hardpoint_2_108 = new THREE.Group();
  node_tail_hardpoint_2_108.name = "Tail hardpoint nub 2__pivot";
  if (endpoint_tail_hardpoint_2_108) {
    node_tail_hardpoint_2_108.position.copy(endpoint_tail_hardpoint_2_108.start);
    node_tail_hardpoint_2_108.rotation.set(0, 0, 0);
    node_tail_hardpoint_2_108.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_2_108.position.set(2.3200000000000003, 0.06, 0.475);
    node_tail_hardpoint_2_108.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_2_108.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_2_108.userData.sculptComponent = {"id": "tail-hardpoint-2", "name": "Tail hardpoint nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-2-mount", "structuralParent": "root", "localStart": [2.32, 0.06, 0.475], "localEnd": [2.32, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.3200000000000003, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_2_108.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_2_108);
  nodes["tail-hardpoint-2"] = node_tail_hardpoint_2_108;
  const mesh_tail_hardpoint_2_108Geometry = endpoint_tail_hardpoint_2_108
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_2_108.endRadius, endpoint_tail_hardpoint_2_108.baseRadius, endpoint_tail_hardpoint_2_108.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_2_108 = new THREE.Mesh(
    mesh_tail_hardpoint_2_108Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_2_108.name = "Tail hardpoint nub 2";
  if (endpoint_tail_hardpoint_2_108) {
    mesh_tail_hardpoint_2_108.position.copy(endpoint_tail_hardpoint_2_108.midpoint);
    mesh_tail_hardpoint_2_108.quaternion.copy(endpoint_tail_hardpoint_2_108.quaternion);
  }
  mesh_tail_hardpoint_2_108.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_2_108.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_2_108.userData.sculptComponent = {"id": "tail-hardpoint-2", "name": "Tail hardpoint nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-2-mount", "structuralParent": "root", "localStart": [2.32, 0.06, 0.475], "localEnd": [2.32, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.3200000000000003, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_2_108.add(mesh_tail_hardpoint_2_108);
  meshes["tail-hardpoint-2"] = mesh_tail_hardpoint_2_108;
  colliders["tail-hardpoint-2"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_3_109 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-3-mount", "structuralParent": "root", "localStart": [3.04, 0.06, 0.475], "localEnd": [3.04, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_3_109 = makeAttachmentEndpoint(attachment_tail_hardpoint_3_109);
  const node_tail_hardpoint_3_109 = new THREE.Group();
  node_tail_hardpoint_3_109.name = "Tail hardpoint nub 3__pivot";
  if (endpoint_tail_hardpoint_3_109) {
    node_tail_hardpoint_3_109.position.copy(endpoint_tail_hardpoint_3_109.start);
    node_tail_hardpoint_3_109.rotation.set(0, 0, 0);
    node_tail_hardpoint_3_109.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_3_109.position.set(3.04, 0.06, 0.475);
    node_tail_hardpoint_3_109.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_3_109.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_3_109.userData.sculptComponent = {"id": "tail-hardpoint-3", "name": "Tail hardpoint nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-3-mount", "structuralParent": "root", "localStart": [3.04, 0.06, 0.475], "localEnd": [3.04, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.04, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_3_109.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_3_109);
  nodes["tail-hardpoint-3"] = node_tail_hardpoint_3_109;
  const mesh_tail_hardpoint_3_109Geometry = endpoint_tail_hardpoint_3_109
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_3_109.endRadius, endpoint_tail_hardpoint_3_109.baseRadius, endpoint_tail_hardpoint_3_109.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_3_109 = new THREE.Mesh(
    mesh_tail_hardpoint_3_109Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_3_109.name = "Tail hardpoint nub 3";
  if (endpoint_tail_hardpoint_3_109) {
    mesh_tail_hardpoint_3_109.position.copy(endpoint_tail_hardpoint_3_109.midpoint);
    mesh_tail_hardpoint_3_109.quaternion.copy(endpoint_tail_hardpoint_3_109.quaternion);
  }
  mesh_tail_hardpoint_3_109.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_3_109.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_3_109.userData.sculptComponent = {"id": "tail-hardpoint-3", "name": "Tail hardpoint nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-3-mount", "structuralParent": "root", "localStart": [3.04, 0.06, 0.475], "localEnd": [3.04, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.04, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_3_109.add(mesh_tail_hardpoint_3_109);
  meshes["tail-hardpoint-3"] = mesh_tail_hardpoint_3_109;
  colliders["tail-hardpoint-3"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_4_110 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-4-mount", "structuralParent": "root", "localStart": [3.76, 0.06, 0.475], "localEnd": [3.76, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_4_110 = makeAttachmentEndpoint(attachment_tail_hardpoint_4_110);
  const node_tail_hardpoint_4_110 = new THREE.Group();
  node_tail_hardpoint_4_110.name = "Tail hardpoint nub 4__pivot";
  if (endpoint_tail_hardpoint_4_110) {
    node_tail_hardpoint_4_110.position.copy(endpoint_tail_hardpoint_4_110.start);
    node_tail_hardpoint_4_110.rotation.set(0, 0, 0);
    node_tail_hardpoint_4_110.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_4_110.position.set(3.7600000000000002, 0.06, 0.475);
    node_tail_hardpoint_4_110.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_4_110.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_4_110.userData.sculptComponent = {"id": "tail-hardpoint-4", "name": "Tail hardpoint nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-4-mount", "structuralParent": "root", "localStart": [3.76, 0.06, 0.475], "localEnd": [3.76, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.7600000000000002, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_4_110.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_4_110);
  nodes["tail-hardpoint-4"] = node_tail_hardpoint_4_110;
  const mesh_tail_hardpoint_4_110Geometry = endpoint_tail_hardpoint_4_110
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_4_110.endRadius, endpoint_tail_hardpoint_4_110.baseRadius, endpoint_tail_hardpoint_4_110.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_4_110 = new THREE.Mesh(
    mesh_tail_hardpoint_4_110Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_4_110.name = "Tail hardpoint nub 4";
  if (endpoint_tail_hardpoint_4_110) {
    mesh_tail_hardpoint_4_110.position.copy(endpoint_tail_hardpoint_4_110.midpoint);
    mesh_tail_hardpoint_4_110.quaternion.copy(endpoint_tail_hardpoint_4_110.quaternion);
  }
  mesh_tail_hardpoint_4_110.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_4_110.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_4_110.userData.sculptComponent = {"id": "tail-hardpoint-4", "name": "Tail hardpoint nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-4-mount", "structuralParent": "root", "localStart": [3.76, 0.06, 0.475], "localEnd": [3.76, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.7600000000000002, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_4_110.add(mesh_tail_hardpoint_4_110);
  meshes["tail-hardpoint-4"] = mesh_tail_hardpoint_4_110;
  colliders["tail-hardpoint-4"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_5_111 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-5-mount", "structuralParent": "root", "localStart": [4.48, 0.06, 0.475], "localEnd": [4.48, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_5_111 = makeAttachmentEndpoint(attachment_tail_hardpoint_5_111);
  const node_tail_hardpoint_5_111 = new THREE.Group();
  node_tail_hardpoint_5_111.name = "Tail hardpoint nub 5__pivot";
  if (endpoint_tail_hardpoint_5_111) {
    node_tail_hardpoint_5_111.position.copy(endpoint_tail_hardpoint_5_111.start);
    node_tail_hardpoint_5_111.rotation.set(0, 0, 0);
    node_tail_hardpoint_5_111.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_5_111.position.set(4.48, 0.06, 0.475);
    node_tail_hardpoint_5_111.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_5_111.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_5_111.userData.sculptComponent = {"id": "tail-hardpoint-5", "name": "Tail hardpoint nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-5-mount", "structuralParent": "root", "localStart": [4.48, 0.06, 0.475], "localEnd": [4.48, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [4.48, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_5_111.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_5_111);
  nodes["tail-hardpoint-5"] = node_tail_hardpoint_5_111;
  const mesh_tail_hardpoint_5_111Geometry = endpoint_tail_hardpoint_5_111
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_5_111.endRadius, endpoint_tail_hardpoint_5_111.baseRadius, endpoint_tail_hardpoint_5_111.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_5_111 = new THREE.Mesh(
    mesh_tail_hardpoint_5_111Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_5_111.name = "Tail hardpoint nub 5";
  if (endpoint_tail_hardpoint_5_111) {
    mesh_tail_hardpoint_5_111.position.copy(endpoint_tail_hardpoint_5_111.midpoint);
    mesh_tail_hardpoint_5_111.quaternion.copy(endpoint_tail_hardpoint_5_111.quaternion);
  }
  mesh_tail_hardpoint_5_111.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_5_111.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_5_111.userData.sculptComponent = {"id": "tail-hardpoint-5", "name": "Tail hardpoint nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-5-mount", "structuralParent": "root", "localStart": [4.48, 0.06, 0.475], "localEnd": [4.48, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [4.48, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_5_111.add(mesh_tail_hardpoint_5_111);
  meshes["tail-hardpoint-5"] = mesh_tail_hardpoint_5_111;
  colliders["tail-hardpoint-5"] = {"type": "box", "fit": "tight"};

  // repetition system: transverse-armour-bands (InstancedMesh, linear-transverse, count=15, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.055, 1.0, 0.885];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 15);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 15; i++) {
      const ang = ((0.0) + (i * 360) / 15) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "transverse-armour-bands";
    parent.add(cluster);
  }

  // repetition system: gut-lobes (InstancedMesh, packed-lobes, count=12, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
    const mat = materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [1.0, 1.0, 1.0];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 12);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 12; i++) {
      const ang = ((0.0) + (i * 360) / 12) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "gut-lobes";
    parent.add(cluster);
  }

  // repetition system: viscera-bands (InstancedMesh, along-spine, count=4, level=micro)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.TorusGeometry(0.45, 0.08, 24, 96);
    const mat = materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.5, 0.5, 0.5];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "viscera-bands";
    parent.add(cluster);
  }

  // repetition system: gill-slits (InstancedMesh, mirrored-linear-banks, count=10, level=meso)
  {
    const parent = nodes["stern-bay-housing"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.07, 0.17, 0.78];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 10);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 10; i++) {
      const ang = ((0.0) + (i * 360) / 10) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "gill-slits";
    parent.add(cluster);
  }

  // repetition system: mast-base-vents (InstancedMesh, mirrored-linear-banks, count=8, level=micro)
  {
    const parent = nodes["mast-base-housing"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.09, 0.05, 0.16];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 8);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 8; i++) {
      const ang = ((0.0) + (i * 360) / 8) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "mast-base-vents";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMantaDeltaStarFreighterLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Manta Delta Star Freighter look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "observation": "Value steps are brightest on upward-facing deck surfaces and darkest on the lower flank, so the key is high and slightly forward of the port beam.", "direction": [-0.35, 0.86, 0.38], "intensity": 2.4, "color": "#fff3d8"}, {"id": "fill", "observation": "Shadow side retains a warm mid grey rather than going black.", "direction": [0.4, -0.2, -0.6], "intensity": 0.5, "color": "#6d7280"}, {"id": "ambient", "observation": "Black space field: no environment bounce; ambient must stay low.", "intensity": 0.18, "color": "#2a2f36"}, {"id": "tone-and-exposure", "observation": "The reference has no highlight rolloff - white regions are flat at #fcf7e1, not blown out. Use NoToneMapping (not ACES/filmic) with exposure 1.0 so the toon ramp steps stay exactly at the sampled hexes; ACES would desaturate the yellows and crush the cream to grey.", "toneMapping": "NoToneMapping", "exposure": 1.0}, {"id": "contact-shadow", "observation": "The reference conveys contact with ink contour and a hard dark band under the pod cluster and the mast base, not with soft AO. Use a single shadow-casting key with a tight PCF map for the pod/hull and mast/deck contact shadow; keep ambient occlusion low (cavityStrength 0.18) so it never competes with the drawn line. There is no ground plane - no ground shadow.", "contactShadow": true, "groundShadow": false, "aoStrength": 0.18}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMantaDeltaStarFreighterEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameMantaDeltaStarFreighterCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createMantaDeltaStarFreighterPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureMantaDeltaStarFreighterRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMantaDeltaStarFreighterInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
