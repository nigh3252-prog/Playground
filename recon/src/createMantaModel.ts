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
  node_root_0.name = "Hull spine__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, -0.475);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Hull spine", "level": "macro", "role": "body", "logicalParent": null, "importance": 1.0, "confidence": 0.82, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Continuous plated monocoque read as one lofted solid, not a box: the reference shows a single unbroken dorsal deck line from bow fairing to stern bay with no step.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.3, 0.09], [-2.6, 0.23], [-1.8, 0.29], [-0.8, 0.3], [0.3, 0.27], [1.4, 0.2], [2.5, 0.11], [3.3, 0.04], [3.3, -0.02], [2.5, -0.09], [1.4, -0.16], [0.3, -0.15], [-0.8, -0.1], [-1.8, -0.05], [-2.6, 0.0], [-3.3, 0.03]], "depth": 0.95}}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.82}, "transform": {"position": [0, 0, -0.475], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "deck-plate-ridges", "kind": "seam", "description": "raised chordwise plate ridges dividing the deck into 8 panels", "detailRefs": ["d05"]}, {"id": "spar-rivet-rows", "kind": "fastener", "description": "fastener dot rows along the flank rails", "detailRefs": ["d04"]}, {"id": "outline-shell", "kind": "contour", "description": "inverted-hull ink contour carried on the outer silhouette AND every interior part boundary, matching the reference's drawn line", "outlineWidth": 0.012, "outlineColor": "#1a1410", "detailRefs": ["d01"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object", "bow-zone"], "details": ["d02", "d03", "d05", "d18"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_root_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-3.3, 0.09], [-2.6, 0.23], [-1.8, 0.29], [-0.8, 0.3], [0.3, 0.27], [1.4, 0.2], [2.5, 0.11], [3.3, 0.04], [3.3, -0.02], [2.5, -0.09], [1.4, -0.16], [0.3, -0.15], [-0.8, -0.1], [-1.8, -0.05], [-2.6, 0.0], [-3.3, 0.03]], "depth": 0.95});
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Hull spine";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Hull spine", "level": "macro", "role": "body", "logicalParent": null, "importance": 1.0, "confidence": 0.82, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Continuous plated monocoque read as one lofted solid, not a box: the reference shows a single unbroken dorsal deck line from bow fairing to stern bay with no step.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.3, 0.09], [-2.6, 0.23], [-1.8, 0.29], [-0.8, 0.3], [0.3, 0.27], [1.4, 0.2], [2.5, 0.11], [3.3, 0.04], [3.3, -0.02], [2.5, -0.09], [1.4, -0.16], [0.3, -0.15], [-0.8, -0.1], [-1.8, -0.05], [-2.6, 0.0], [-3.3, 0.03]], "depth": 0.95}}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.82}, "transform": {"position": [0, 0, -0.475], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "deck-plate-ridges", "kind": "seam", "description": "raised chordwise plate ridges dividing the deck into 8 panels", "detailRefs": ["d05"]}, {"id": "spar-rivet-rows", "kind": "fastener", "description": "fastener dot rows along the flank rails", "detailRefs": ["d04"]}, {"id": "outline-shell", "kind": "contour", "description": "inverted-hull ink contour carried on the outer silhouette AND every interior part boundary, matching the reference's drawn line", "outlineWidth": 0.012, "outlineColor": "#1a1410", "detailRefs": ["d01"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object", "bow-zone"], "details": ["d02", "d03", "d05", "d18"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "fit": "tight"};

  const attachment_forward_wing_1 = {"parentId": "root", "parentSocket": "root/forward-wing-mount", "structuralParent": "root", "localStart": [0, 0.2, 0.475], "localEnd": [0, 0.2, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_forward_wing_1 = makeAttachmentEndpoint(attachment_forward_wing_1);
  const node_forward_wing_1 = new THREE.Group();
  node_forward_wing_1.name = "Forward-swept wing plate__pivot";
  if (endpoint_forward_wing_1) {
    node_forward_wing_1.position.copy(endpoint_forward_wing_1.start);
    node_forward_wing_1.rotation.set(0, 0, 0);
    node_forward_wing_1.scale.set(1, 1, 1);
  } else {
    node_forward_wing_1.position.set(0.0, 0.2, 0.475);
    node_forward_wing_1.rotation.set(-1.5707963267948966, 0.0, 0.0);
    node_forward_wing_1.scale.set(1.0, 1.0, 1.0);
  }
  node_forward_wing_1.userData.sculptComponent = {"id": "forward-wing", "name": "Forward-swept wing plate", "level": "macro", "role": "wing", "logicalParent": "root", "importance": 0.95, "confidence": 0.45, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin lofted sheet, not a solid: the reference shows a knife-thin leading edge and a single continuous top skin. PLANFORM IS INFERRED - the single elevation cannot show chord.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.6, 0.0], [-3.95, 0.899], [-4.3, 1.801], [-4.6, 2.7], [-2.6, 2.7], [-1.3, 1.85], [-0.2, 1.05], [0.7, 0.3], [0.7, 0.0], [0.7, -0.3], [-0.2, -1.05], [-1.3, -1.85], [-2.6, -2.7], [-4.6, -2.7], [-4.3, -1.801], [-3.95, -0.899]], "depth": 0.16}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/forward-wing-mount", "structuralParent": "root", "localStart": [0, 0.2, 0.475], "localEnd": [0, 0.2, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.45}, "transform": {"position": [0, 0.2, 0.475], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leading-edge-chamfer", "kind": "bevel", "description": "chamfered leading edge", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d09", "d04"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_forward_wing_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_forward_wing_1);
  nodes["forward-wing"] = node_forward_wing_1;
  const mesh_forward_wing_1Geometry = endpoint_forward_wing_1
    ? new THREE.CylinderGeometry(endpoint_forward_wing_1.endRadius, endpoint_forward_wing_1.baseRadius, endpoint_forward_wing_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-3.6, 0.0], [-3.95, 0.899], [-4.3, 1.801], [-4.6, 2.7], [-2.6, 2.7], [-1.3, 1.85], [-0.2, 1.05], [0.7, 0.3], [0.7, 0.0], [0.7, -0.3], [-0.2, -1.05], [-1.3, -1.85], [-2.6, -2.7], [-4.6, -2.7], [-4.3, -1.801], [-3.95, -0.899]], "depth": 0.16});
  const mesh_forward_wing_1 = new THREE.Mesh(
    mesh_forward_wing_1Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forward_wing_1.name = "Forward-swept wing plate";
  if (endpoint_forward_wing_1) {
    mesh_forward_wing_1.position.copy(endpoint_forward_wing_1.midpoint);
    mesh_forward_wing_1.quaternion.copy(endpoint_forward_wing_1.quaternion);
  }
  mesh_forward_wing_1.castShadow = options.castShadow ?? true;
  mesh_forward_wing_1.receiveShadow = options.receiveShadow ?? true;
  mesh_forward_wing_1.userData.sculptComponent = {"id": "forward-wing", "name": "Forward-swept wing plate", "level": "macro", "role": "wing", "logicalParent": "root", "importance": 0.95, "confidence": 0.45, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin lofted sheet, not a solid: the reference shows a knife-thin leading edge and a single continuous top skin. PLANFORM IS INFERRED - the single elevation cannot show chord.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-3.6, 0.0], [-3.95, 0.899], [-4.3, 1.801], [-4.6, 2.7], [-2.6, 2.7], [-1.3, 1.85], [-0.2, 1.05], [0.7, 0.3], [0.7, 0.0], [0.7, -0.3], [-0.2, -1.05], [-1.3, -1.85], [-2.6, -2.7], [-4.6, -2.7], [-4.3, -1.801], [-3.95, -0.899]], "depth": 0.16}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/forward-wing-mount", "structuralParent": "root", "localStart": [0, 0.2, 0.475], "localEnd": [0, 0.2, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.45}, "transform": {"position": [0, 0.2, 0.475], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leading-edge-chamfer", "kind": "bevel", "description": "chamfered leading edge", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d09", "d04"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_forward_wing_1.add(mesh_forward_wing_1);
  meshes["forward-wing"] = mesh_forward_wing_1;
  colliders["forward-wing"] = {"type": "box", "fit": "tight"};

  const attachment_aft_tail_blade_2 = {"parentId": "root", "parentSocket": "root/aft-tail-blade-mount", "structuralParent": "root", "localStart": [0, -0.015, 0.475], "localEnd": [0, -0.015, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_aft_tail_blade_2 = makeAttachmentEndpoint(attachment_aft_tail_blade_2);
  const node_aft_tail_blade_2 = new THREE.Group();
  node_aft_tail_blade_2.name = "Aft tail blade__pivot";
  if (endpoint_aft_tail_blade_2) {
    node_aft_tail_blade_2.position.copy(endpoint_aft_tail_blade_2.start);
    node_aft_tail_blade_2.rotation.set(0, 0, 0);
    node_aft_tail_blade_2.scale.set(1, 1, 1);
  } else {
    node_aft_tail_blade_2.position.set(0.0, -0.015, 0.475);
    node_aft_tail_blade_2.rotation.set(-1.5707963267948966, 0.0, 0.0);
    node_aft_tail_blade_2.scale.set(1.0, 1.0, 1.0);
  }
  node_aft_tail_blade_2.userData.sculptComponent = {"id": "aft-tail-blade", "name": "Aft tail blade", "level": "macro", "role": "wing", "logicalParent": "root", "importance": 0.9, "confidence": 0.45, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin lofted sheet converging to a needle tip; the taper is the stingray-tail identity cue.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[0.4, 0.45], [1.6, 1.3], [2.6, 1.18], [3.5, 0.88], [4.3, 0.5], [5.0, 0.04], [5.0, -0.04], [4.3, -0.5], [3.5, -0.88], [2.6, -1.18], [1.6, -1.3], [0.4, -0.45]], "depth": 0.13}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/aft-tail-blade-mount", "structuralParent": "root", "localStart": [0, -0.015, 0.475], "localEnd": [0, -0.015, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.45}, "transform": {"position": [0, -0.015, 0.475], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tail-needle-taper", "kind": "bevel", "description": "trailing taper converging to a needle point; chamfer collapses to zero at the tip", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d09"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_aft_tail_blade_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_aft_tail_blade_2);
  nodes["aft-tail-blade"] = node_aft_tail_blade_2;
  const mesh_aft_tail_blade_2Geometry = endpoint_aft_tail_blade_2
    ? new THREE.CylinderGeometry(endpoint_aft_tail_blade_2.endRadius, endpoint_aft_tail_blade_2.baseRadius, endpoint_aft_tail_blade_2.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.4, 0.45], [1.6, 1.3], [2.6, 1.18], [3.5, 0.88], [4.3, 0.5], [5.0, 0.04], [5.0, -0.04], [4.3, -0.5], [3.5, -0.88], [2.6, -1.18], [1.6, -1.3], [0.4, -0.45]], "depth": 0.13});
  const mesh_aft_tail_blade_2 = new THREE.Mesh(
    mesh_aft_tail_blade_2Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_aft_tail_blade_2.name = "Aft tail blade";
  if (endpoint_aft_tail_blade_2) {
    mesh_aft_tail_blade_2.position.copy(endpoint_aft_tail_blade_2.midpoint);
    mesh_aft_tail_blade_2.quaternion.copy(endpoint_aft_tail_blade_2.quaternion);
  }
  mesh_aft_tail_blade_2.castShadow = options.castShadow ?? true;
  mesh_aft_tail_blade_2.receiveShadow = options.receiveShadow ?? true;
  mesh_aft_tail_blade_2.userData.sculptComponent = {"id": "aft-tail-blade", "name": "Aft tail blade", "level": "macro", "role": "wing", "logicalParent": "root", "importance": 0.9, "confidence": 0.45, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin lofted sheet converging to a needle tip; the taper is the stingray-tail identity cue.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[0.4, 0.45], [1.6, 1.3], [2.6, 1.18], [3.5, 0.88], [4.3, 0.5], [5.0, 0.04], [5.0, -0.04], [4.3, -0.5], [3.5, -0.88], [2.6, -1.18], [1.6, -1.3], [0.4, -0.45]], "depth": 0.13}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/aft-tail-blade-mount", "structuralParent": "root", "localStart": [0, -0.015, 0.475], "localEnd": [0, -0.015, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.45}, "transform": {"position": [0, -0.015, 0.475], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tail-needle-taper", "kind": "bevel", "description": "trailing taper converging to a needle point; chamfer collapses to zero at the tip", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 2}, "detailRefs": ["d09"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d09"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_aft_tail_blade_2.add(mesh_aft_tail_blade_2);
  meshes["aft-tail-blade"] = mesh_aft_tail_blade_2;
  colliders["aft-tail-blade"] = {"type": "box", "fit": "tight"};

  const attachment_ventral_keel_fin_3 = {"parentId": "root", "parentSocket": "root/ventral-keel-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.335], "localEnd": [0, 0, 0.335], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_ventral_keel_fin_3 = makeAttachmentEndpoint(attachment_ventral_keel_fin_3);
  const node_ventral_keel_fin_3 = new THREE.Group();
  node_ventral_keel_fin_3.name = "Ventral keel fin__pivot";
  if (endpoint_ventral_keel_fin_3) {
    node_ventral_keel_fin_3.position.copy(endpoint_ventral_keel_fin_3.start);
    node_ventral_keel_fin_3.rotation.set(0, 0, 0);
    node_ventral_keel_fin_3.scale.set(1, 1, 1);
  } else {
    node_ventral_keel_fin_3.position.set(0.0, 0.0, 0.33499999999999996);
    node_ventral_keel_fin_3.rotation.set(0.0, 0.0, 0.0);
    node_ventral_keel_fin_3.scale.set(1.0, 1.0, 1.0);
  }
  node_ventral_keel_fin_3.userData.sculptComponent = {"id": "ventral-keel-fin", "name": "Ventral keel fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.7, "confidence": 0.7, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Planar keel blade hanging below the bow; reads as a sheet with thickness, not a solid wedge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-4.35, 0.12], [-3.3, 0.05], [-3.2, -0.35], [-3.86, -0.82], [-4.45, -0.35]], "depth": 0.28}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/ventral-keel-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.335], "localEnd": [0, 0, 0.335], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.33499999999999996], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_ventral_keel_fin_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_ventral_keel_fin_3);
  nodes["ventral-keel-fin"] = node_ventral_keel_fin_3;
  const mesh_ventral_keel_fin_3Geometry = endpoint_ventral_keel_fin_3
    ? new THREE.CylinderGeometry(endpoint_ventral_keel_fin_3.endRadius, endpoint_ventral_keel_fin_3.baseRadius, endpoint_ventral_keel_fin_3.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-4.35, 0.12], [-3.3, 0.05], [-3.2, -0.35], [-3.86, -0.82], [-4.45, -0.35]], "depth": 0.28});
  const mesh_ventral_keel_fin_3 = new THREE.Mesh(
    mesh_ventral_keel_fin_3Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ventral_keel_fin_3.name = "Ventral keel fin";
  if (endpoint_ventral_keel_fin_3) {
    mesh_ventral_keel_fin_3.position.copy(endpoint_ventral_keel_fin_3.midpoint);
    mesh_ventral_keel_fin_3.quaternion.copy(endpoint_ventral_keel_fin_3.quaternion);
  }
  mesh_ventral_keel_fin_3.castShadow = options.castShadow ?? true;
  mesh_ventral_keel_fin_3.receiveShadow = options.receiveShadow ?? true;
  mesh_ventral_keel_fin_3.userData.sculptComponent = {"id": "ventral-keel-fin", "name": "Ventral keel fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.7, "confidence": 0.7, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Planar keel blade hanging below the bow; reads as a sheet with thickness, not a solid wedge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-4.35, 0.12], [-3.3, 0.05], [-3.2, -0.35], [-3.86, -0.82], [-4.45, -0.35]], "depth": 0.28}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/ventral-keel-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.335], "localEnd": [0, 0, 0.335], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.33499999999999996], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_ventral_keel_fin_3.add(mesh_ventral_keel_fin_3);
  meshes["ventral-keel-fin"] = mesh_ventral_keel_fin_3;
  colliders["ventral-keel-fin"] = {"type": "box", "fit": "tight"};

  const attachment_dorsal_mast_fin_4 = {"parentId": "root", "parentSocket": "root/dorsal-mast-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_dorsal_mast_fin_4 = makeAttachmentEndpoint(attachment_dorsal_mast_fin_4);
  const node_dorsal_mast_fin_4 = new THREE.Group();
  node_dorsal_mast_fin_4.name = "Dorsal mast fin shell__pivot";
  if (endpoint_dorsal_mast_fin_4) {
    node_dorsal_mast_fin_4.position.copy(endpoint_dorsal_mast_fin_4.start);
    node_dorsal_mast_fin_4.rotation.set(0, 0, 0);
    node_dorsal_mast_fin_4.scale.set(1, 1, 1);
  } else {
    node_dorsal_mast_fin_4.position.set(0.0, 0.0, 0.365);
    node_dorsal_mast_fin_4.rotation.set(0.0, 0.0, 0.0);
    node_dorsal_mast_fin_4.scale.set(1.0, 1.0, 1.0);
  }
  node_dorsal_mast_fin_4.userData.sculptComponent = {"id": "dorsal-mast-fin", "name": "Dorsal mast fin shell", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.92, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Tapered blade shell, authored as a BACK PLATE plus separate leading- and trailing-edge spars. The reference's outer white skin wraps the two edges and leaves the middle of the face open, exposing the machinery bay; a single full-thickness blade enclosed and hid every internal part.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.58, 2.53], [-1.24, 0.88], [-1.03, 0.26]], "depth": 0.06}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/dorsal-mast-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "explicit", "offset": [-1.62, 0.38, 0.0]}, "transformChannels": {"translate": false, "rotate": true, "scale": false}, "sockets": [{"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "fit": "tight"}, "constraints": [{"axis": "z", "minDeg": -84.0, "maxDeg": 0.0, "note": "folds aft flat onto the deck"}], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-pivot-bosses", "kind": "fastener", "description": "twin gold hinge bosses on a lateral axis at the fin root", "count": 2, "distribution": "mirrored-pair", "headShape": "disc", "detailRefs": ["d12"]}, {"id": "mast-shell-notch", "kind": "seam", "description": "notch between the shell leaves exposing the inner machinery bay", "detailRefs": ["d13"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12", "d13"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_dorsal_mast_fin_4.userData.actionProfile = {"animationRole": "hinge", "pivot": {"mode": "explicit", "offset": [-1.62, 0.38, 0.0]}, "transformChannels": {"translate": false, "rotate": true, "scale": false}, "sockets": [{"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "fit": "tight"}, "constraints": [{"axis": "z", "minDeg": -84.0, "maxDeg": 0.0, "note": "folds aft flat onto the deck"}], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_dorsal_mast_fin_4);
  nodes["dorsal-mast-fin"] = node_dorsal_mast_fin_4;
  const mesh_dorsal_mast_fin_4Geometry = endpoint_dorsal_mast_fin_4
    ? new THREE.CylinderGeometry(endpoint_dorsal_mast_fin_4.endRadius, endpoint_dorsal_mast_fin_4.baseRadius, endpoint_dorsal_mast_fin_4.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.58, 2.53], [-1.24, 0.88], [-1.03, 0.26]], "depth": 0.06});
  const mesh_dorsal_mast_fin_4 = new THREE.Mesh(
    mesh_dorsal_mast_fin_4Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dorsal_mast_fin_4.name = "Dorsal mast fin shell";
  if (endpoint_dorsal_mast_fin_4) {
    mesh_dorsal_mast_fin_4.position.copy(endpoint_dorsal_mast_fin_4.midpoint);
    mesh_dorsal_mast_fin_4.quaternion.copy(endpoint_dorsal_mast_fin_4.quaternion);
  }
  mesh_dorsal_mast_fin_4.castShadow = options.castShadow ?? true;
  mesh_dorsal_mast_fin_4.receiveShadow = options.receiveShadow ?? true;
  mesh_dorsal_mast_fin_4.userData.sculptComponent = {"id": "dorsal-mast-fin", "name": "Dorsal mast fin shell", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.92, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Tapered blade shell, authored as a BACK PLATE plus separate leading- and trailing-edge spars. The reference's outer white skin wraps the two edges and leaves the middle of the face open, exposing the machinery bay; a single full-thickness blade enclosed and hid every internal part.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.58, 2.53], [-1.24, 0.88], [-1.03, 0.26]], "depth": 0.06}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/dorsal-mast-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "explicit", "offset": [-1.62, 0.38, 0.0]}, "transformChannels": {"translate": false, "rotate": true, "scale": false}, "sockets": [{"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "fit": "tight"}, "constraints": [{"axis": "z", "minDeg": -84.0, "maxDeg": 0.0, "note": "folds aft flat onto the deck"}], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-pivot-bosses", "kind": "fastener", "description": "twin gold hinge bosses on a lateral axis at the fin root", "count": 2, "distribution": "mirrored-pair", "headShape": "disc", "detailRefs": ["d12"]}, {"id": "mast-shell-notch", "kind": "seam", "description": "notch between the shell leaves exposing the inner machinery bay", "detailRefs": ["d13"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12", "d13"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_dorsal_mast_fin_4.add(mesh_dorsal_mast_fin_4);
  meshes["dorsal-mast-fin"] = mesh_dorsal_mast_fin_4;
  colliders["dorsal-mast-fin"] = {"type": "box", "fit": "tight"};
  const socket_dorsal_mast_fin_mast_hinge_0 = new THREE.Object3D();
  socket_dorsal_mast_fin_mast_hinge_0.name = "mast-hinge";
  socket_dorsal_mast_fin_mast_hinge_0.position.set(-1.62, 0.38, 0.0);
  socket_dorsal_mast_fin_mast_hinge_0.rotation.set(0.0, 0.0, 0.0);
  socket_dorsal_mast_fin_mast_hinge_0.userData.socket = {"id": "mast-hinge", "localPosition": [-1.62, 0.38, 0.0], "localRotation": [0, 0, 0]};
  node_dorsal_mast_fin_4.add(socket_dorsal_mast_fin_mast_hinge_0);
  sockets["dorsal-mast-fin:mast-hinge"] = socket_dorsal_mast_fin_mast_hinge_0;

  const attachment_mast_spar_leading_5 = {"parentId": "root", "parentSocket": "root/mast-spar-leading-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_spar_leading_5 = makeAttachmentEndpoint(attachment_mast_spar_leading_5);
  const node_mast_spar_leading_5 = new THREE.Group();
  node_mast_spar_leading_5.name = "Mast Spar Leading__pivot";
  if (endpoint_mast_spar_leading_5) {
    node_mast_spar_leading_5.position.copy(endpoint_mast_spar_leading_5.start);
    node_mast_spar_leading_5.rotation.set(0, 0, 0);
    node_mast_spar_leading_5.scale.set(1, 1, 1);
  } else {
    node_mast_spar_leading_5.position.set(0.0, 0.0, 0.365);
    node_mast_spar_leading_5.rotation.set(0.0, 0.0, 0.0);
    node_mast_spar_leading_5.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_spar_leading_5.userData.sculptComponent = {"id": "mast-spar-leading", "name": "Mast Spar Leading", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.66, 2.53], [-1.7, 0.88], [-1.93, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-leading-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_leading_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mast_spar_leading_5);
  nodes["mast-spar-leading"] = node_mast_spar_leading_5;
  const mesh_mast_spar_leading_5Geometry = endpoint_mast_spar_leading_5
    ? new THREE.CylinderGeometry(endpoint_mast_spar_leading_5.endRadius, endpoint_mast_spar_leading_5.baseRadius, endpoint_mast_spar_leading_5.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.66, 2.53], [-1.7, 0.88], [-1.93, 0.26]], "depth": 0.22});
  const mesh_mast_spar_leading_5 = new THREE.Mesh(
    mesh_mast_spar_leading_5Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_spar_leading_5.name = "Mast Spar Leading";
  if (endpoint_mast_spar_leading_5) {
    mesh_mast_spar_leading_5.position.copy(endpoint_mast_spar_leading_5.midpoint);
    mesh_mast_spar_leading_5.quaternion.copy(endpoint_mast_spar_leading_5.quaternion);
  }
  mesh_mast_spar_leading_5.castShadow = options.castShadow ?? true;
  mesh_mast_spar_leading_5.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_spar_leading_5.userData.sculptComponent = {"id": "mast-spar-leading", "name": "Mast Spar Leading", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.03, 0.26], [-1.78, 0.88], [-1.75, 2.53], [-1.66, 2.53], [-1.7, 0.88], [-1.93, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-leading-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_leading_5.add(mesh_mast_spar_leading_5);
  meshes["mast-spar-leading"] = mesh_mast_spar_leading_5;
  colliders["mast-spar-leading"] = {"type": "box", "fit": "tight"};

  const attachment_mast_spar_trailing_6 = {"parentId": "root", "parentSocket": "root/mast-spar-trailing-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_spar_trailing_6 = makeAttachmentEndpoint(attachment_mast_spar_trailing_6);
  const node_mast_spar_trailing_6 = new THREE.Group();
  node_mast_spar_trailing_6.name = "Mast Spar Trailing__pivot";
  if (endpoint_mast_spar_trailing_6) {
    node_mast_spar_trailing_6.position.copy(endpoint_mast_spar_trailing_6.start);
    node_mast_spar_trailing_6.rotation.set(0, 0, 0);
    node_mast_spar_trailing_6.scale.set(1, 1, 1);
  } else {
    node_mast_spar_trailing_6.position.set(0.0, 0.0, 0.365);
    node_mast_spar_trailing_6.rotation.set(0.0, 0.0, 0.0);
    node_mast_spar_trailing_6.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_spar_trailing_6.userData.sculptComponent = {"id": "mast-spar-trailing", "name": "Mast Spar Trailing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.4, 0.26], [-1.35, 0.88], [-1.51, 2.53], [-1.58, 2.53], [-1.42, 0.88], [-1.03, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-trailing-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_trailing_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mast_spar_trailing_6);
  nodes["mast-spar-trailing"] = node_mast_spar_trailing_6;
  const mesh_mast_spar_trailing_6Geometry = endpoint_mast_spar_trailing_6
    ? new THREE.CylinderGeometry(endpoint_mast_spar_trailing_6.endRadius, endpoint_mast_spar_trailing_6.baseRadius, endpoint_mast_spar_trailing_6.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.4, 0.26], [-1.35, 0.88], [-1.51, 2.53], [-1.58, 2.53], [-1.42, 0.88], [-1.03, 0.26]], "depth": 0.22});
  const mesh_mast_spar_trailing_6 = new THREE.Mesh(
    mesh_mast_spar_trailing_6Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_spar_trailing_6.name = "Mast Spar Trailing";
  if (endpoint_mast_spar_trailing_6) {
    mesh_mast_spar_trailing_6.position.copy(endpoint_mast_spar_trailing_6.midpoint);
    mesh_mast_spar_trailing_6.quaternion.copy(endpoint_mast_spar_trailing_6.quaternion);
  }
  mesh_mast_spar_trailing_6.castShadow = options.castShadow ?? true;
  mesh_mast_spar_trailing_6.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_spar_trailing_6.userData.sculptComponent = {"id": "mast-spar-trailing", "name": "Mast Spar Trailing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.78, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Edge spar of the mast shell; carries the outer skin around the open machinery face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.4, 0.26], [-1.35, 0.88], [-1.51, 2.53], [-1.58, 2.53], [-1.42, 0.88], [-1.03, 0.26]], "depth": 0.22}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-spar-trailing-mount", "structuralParent": "root", "localStart": [0, 0, 0.365], "localEnd": [0, 0, 0.365], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0.365], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_spar_trailing_6.add(mesh_mast_spar_trailing_6);
  meshes["mast-spar-trailing"] = mesh_mast_spar_trailing_6;
  colliders["mast-spar-trailing"] = {"type": "box", "fit": "tight"};

  const attachment_pod_cradle_7 = {"parentId": "root", "parentSocket": "root/pod-cradle-mount", "structuralParent": "root", "localStart": [-1.1, -0.3, 0.475], "localEnd": [-1.1, -0.3, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_cradle_7 = makeAttachmentEndpoint(attachment_pod_cradle_7);
  const node_pod_cradle_7 = new THREE.Group();
  node_pod_cradle_7.name = "Ventral pod cradle__pivot";
  if (endpoint_pod_cradle_7) {
    node_pod_cradle_7.position.copy(endpoint_pod_cradle_7.start);
    node_pod_cradle_7.rotation.set(0, 0, 0);
    node_pod_cradle_7.scale.set(1, 1, 1);
  } else {
    node_pod_cradle_7.position.set(-1.1, -0.3, 0.475);
    node_pod_cradle_7.rotation.set(0.0, 0.0, 0.0);
    node_pod_cradle_7.scale.set(3.65, 0.7, 0.92);
  }
  node_pod_cradle_7.userData.sculptComponent = {"id": "pod-cradle", "name": "Ventral pod cradle", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Boxed cradle shelf spanning Y +0.05..-0.65. The reference shows a dark structural mass ABOVE the pods with the pods bulging clear below it, so the cradle must not enclose them - at full envelope height it hid the entire pod cluster.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/pod-cradle-mount", "structuralParent": "root", "localStart": [-1.1, -0.3, 0.475], "localEnd": [-1.1, -0.3, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 3.65, "height": 0.7, "depth": 0.92, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.1, -0.3, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pod-banding-straps", "kind": "fastener", "description": "two steel banding straps per pod, 14 total, wrapping the capsule minor axis", "count": 14, "distribution": "per-parent-pair", "headShape": "band", "detailRefs": ["d07"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_cradle_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_cradle_7);
  nodes["pod-cradle"] = node_pod_cradle_7;
  const mesh_pod_cradle_7Geometry = endpoint_pod_cradle_7
    ? new THREE.CylinderGeometry(endpoint_pod_cradle_7.endRadius, endpoint_pod_cradle_7.baseRadius, endpoint_pod_cradle_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_pod_cradle_7 = new THREE.Mesh(
    mesh_pod_cradle_7Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_cradle_7.name = "Ventral pod cradle";
  if (endpoint_pod_cradle_7) {
    mesh_pod_cradle_7.position.copy(endpoint_pod_cradle_7.midpoint);
    mesh_pod_cradle_7.quaternion.copy(endpoint_pod_cradle_7.quaternion);
  }
  mesh_pod_cradle_7.castShadow = options.castShadow ?? true;
  mesh_pod_cradle_7.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_cradle_7.userData.sculptComponent = {"id": "pod-cradle", "name": "Ventral pod cradle", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Boxed cradle shelf spanning Y +0.05..-0.65. The reference shows a dark structural mass ABOVE the pods with the pods bulging clear below it, so the cradle must not enclose them - at full envelope height it hid the entire pod cluster.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/pod-cradle-mount", "structuralParent": "root", "localStart": [-1.1, -0.3, 0.475], "localEnd": [-1.1, -0.3, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 3.65, "height": 0.7, "depth": 0.92, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.1, -0.3, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pod-banding-straps", "kind": "fastener", "description": "two steel banding straps per pod, 14 total, wrapping the capsule minor axis", "count": 14, "distribution": "per-parent-pair", "headShape": "band", "detailRefs": ["d07"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_cradle_7.add(mesh_pod_cradle_7);
  meshes["pod-cradle"] = mesh_pod_cradle_7;
  colliders["pod-cradle"] = {"type": "box", "fit": "tight"};

  const attachment_stern_bay_housing_8 = {"parentId": "root", "parentSocket": "root/stern-bay-housing-mount", "structuralParent": "root", "localStart": [2.05, -0.09, -0.045], "localEnd": [2.05, -0.09, -0.045], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_stern_bay_housing_8 = makeAttachmentEndpoint(attachment_stern_bay_housing_8);
  const node_stern_bay_housing_8 = new THREE.Group();
  node_stern_bay_housing_8.name = "Stern drive bay housing__pivot";
  if (endpoint_stern_bay_housing_8) {
    node_stern_bay_housing_8.position.copy(endpoint_stern_bay_housing_8.start);
    node_stern_bay_housing_8.rotation.set(0, 0, 0);
    node_stern_bay_housing_8.scale.set(1, 1, 1);
  } else {
    node_stern_bay_housing_8.position.set(2.05, -0.09, -0.04500000000000004);
    node_stern_bay_housing_8.rotation.set(0.0, 0.0, 0.0);
    node_stern_bay_housing_8.scale.set(1.7, 0.58, 0.34);
  }
  node_stern_bay_housing_8.userData.sculptComponent = {"id": "stern-bay-housing", "name": "Stern drive bay housing", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.85, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back wall of the recessed bay. The reference bay is OPEN toward the viewer with the vane array and nozzle set into it; a full-depth solid box occluded both.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/stern-bay-housing-mount", "structuralParent": "root", "localStart": [2.05, -0.09, -0.045], "localEnd": [2.05, -0.09, -0.045], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.7, "height": 0.58, "depth": 0.34, "units": "relative", "confidence": 0.75}, "transform": {"position": [2.05, -0.09, -0.04500000000000004], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "radiator-vane-array", "kind": "linework", "description": "chevron louvre vane array, two mirrored banks of 5 slanted slats", "technique": "engraved-groove", "count": 10, "detailRefs": ["d10"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10", "d11"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_stern_bay_housing_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_stern_bay_housing_8);
  nodes["stern-bay-housing"] = node_stern_bay_housing_8;
  const mesh_stern_bay_housing_8Geometry = endpoint_stern_bay_housing_8
    ? new THREE.CylinderGeometry(endpoint_stern_bay_housing_8.endRadius, endpoint_stern_bay_housing_8.baseRadius, endpoint_stern_bay_housing_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_stern_bay_housing_8 = new THREE.Mesh(
    mesh_stern_bay_housing_8Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stern_bay_housing_8.name = "Stern drive bay housing";
  if (endpoint_stern_bay_housing_8) {
    mesh_stern_bay_housing_8.position.copy(endpoint_stern_bay_housing_8.midpoint);
    mesh_stern_bay_housing_8.quaternion.copy(endpoint_stern_bay_housing_8.quaternion);
  }
  mesh_stern_bay_housing_8.castShadow = options.castShadow ?? true;
  mesh_stern_bay_housing_8.receiveShadow = options.receiveShadow ?? true;
  mesh_stern_bay_housing_8.userData.sculptComponent = {"id": "stern-bay-housing", "name": "Stern drive bay housing", "level": "macro", "role": "structure", "logicalParent": "root", "importance": 0.85, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back wall of the recessed bay. The reference bay is OPEN toward the viewer with the vane array and nozzle set into it; a full-depth solid box occluded both.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/stern-bay-housing-mount", "structuralParent": "root", "localStart": [2.05, -0.09, -0.045], "localEnd": [2.05, -0.09, -0.045], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.7, "height": 0.58, "depth": 0.34, "units": "relative", "confidence": 0.75}, "transform": {"position": [2.05, -0.09, -0.04500000000000004], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "radiator-vane-array", "kind": "linework", "description": "chevron louvre vane array, two mirrored banks of 5 slanted slats", "technique": "engraved-groove", "count": 10, "detailRefs": ["d10"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10", "d11"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_stern_bay_housing_8.add(mesh_stern_bay_housing_8);
  meshes["stern-bay-housing"] = mesh_stern_bay_housing_8;
  colliders["stern-bay-housing"] = {"type": "box", "fit": "tight"};

  const attachment_canopy_blister_9 = {"parentId": "root", "parentSocket": "root/canopy-blister-mount", "structuralParent": "root", "localStart": [-1.85, 0.52, 0.635], "localEnd": [-1.85, 0.52, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_canopy_blister_9 = makeAttachmentEndpoint(attachment_canopy_blister_9);
  const node_canopy_blister_9 = new THREE.Group();
  node_canopy_blister_9.name = "Canopy / sensor blister__pivot";
  if (endpoint_canopy_blister_9) {
    node_canopy_blister_9.position.copy(endpoint_canopy_blister_9.start);
    node_canopy_blister_9.rotation.set(0, 0, 0);
    node_canopy_blister_9.scale.set(1, 1, 1);
  } else {
    node_canopy_blister_9.position.set(-1.85, 0.52, 0.635);
    node_canopy_blister_9.rotation.set(0.0, 0.0, 0.0);
    node_canopy_blister_9.scale.set(0.42, 0.26, 0.34);
  }
  node_canopy_blister_9.userData.sculptComponent = {"id": "canopy-blister", "name": "Canopy / sensor blister", "level": "meso", "role": "detail", "logicalParent": "root", "importance": 0.55, "confidence": 0.6, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Doubly-curved blister; a sphere section is the correct topology class, not a faceted box.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/canopy-blister-mount", "structuralParent": "root", "localStart": [-1.85, 0.52, 0.635], "localEnd": [-1.85, 0.52, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.42, "height": 0.26, "depth": 0.34, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.85, 0.52, 0.635], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "canopy-slash-highlight", "kind": "gloss", "description": "hard painted white slash on the glazing, drawn not simulated", "roughness": 0.08, "detailRefs": ["d01"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 42, 48, 1.0)", "secondaryAlbedo": "rgba(36, 42, 48, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.65, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(36, 42, 48, 1.0)"}, {"position": 1.0, "color": "rgba(36, 42, 48, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_canopy_blister_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_canopy_blister_9);
  nodes["canopy-blister"] = node_canopy_blister_9;
  const mesh_canopy_blister_9Geometry = endpoint_canopy_blister_9
    ? new THREE.CylinderGeometry(endpoint_canopy_blister_9.endRadius, endpoint_canopy_blister_9.baseRadius, endpoint_canopy_blister_9.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  const mesh_canopy_blister_9 = new THREE.Mesh(
    mesh_canopy_blister_9Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_canopy_blister_9.name = "Canopy / sensor blister";
  if (endpoint_canopy_blister_9) {
    mesh_canopy_blister_9.position.copy(endpoint_canopy_blister_9.midpoint);
    mesh_canopy_blister_9.quaternion.copy(endpoint_canopy_blister_9.quaternion);
  }
  mesh_canopy_blister_9.castShadow = options.castShadow ?? true;
  mesh_canopy_blister_9.receiveShadow = options.receiveShadow ?? true;
  mesh_canopy_blister_9.userData.sculptComponent = {"id": "canopy-blister", "name": "Canopy / sensor blister", "level": "meso", "role": "detail", "logicalParent": "root", "importance": 0.55, "confidence": 0.6, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Doubly-curved blister; a sphere section is the correct topology class, not a faceted box.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/canopy-blister-mount", "structuralParent": "root", "localStart": [-1.85, 0.52, 0.635], "localEnd": [-1.85, 0.52, 0.635], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.42, "height": 0.26, "depth": 0.34, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.85, 0.52, 0.635], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "canopy-slash-highlight", "kind": "gloss", "description": "hard painted white slash on the glazing, drawn not simulated", "roughness": 0.08, "detailRefs": ["d01"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 42, 48, 1.0)", "secondaryAlbedo": "rgba(36, 42, 48, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.65, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(36, 42, 48, 1.0)"}, {"position": 1.0, "color": "rgba(36, 42, 48, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_canopy_blister_9.add(mesh_canopy_blister_9);
  meshes["canopy-blister"] = mesh_canopy_blister_9;
  colliders["canopy-blister"] = {"type": "box", "fit": "tight"};

  const attachment_bow_fairing_10 = {"parentId": "root", "parentSocket": "root/bow-fairing-mount", "structuralParent": "root", "localStart": [-3.52, 0.1, 0.475], "localEnd": [-3.52, 0.1, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_bow_fairing_10 = makeAttachmentEndpoint(attachment_bow_fairing_10);
  const node_bow_fairing_10 = new THREE.Group();
  node_bow_fairing_10.name = "Bow nose fairing__pivot";
  if (endpoint_bow_fairing_10) {
    node_bow_fairing_10.position.copy(endpoint_bow_fairing_10.start);
    node_bow_fairing_10.rotation.set(0, 0, 0);
    node_bow_fairing_10.scale.set(1, 1, 1);
  } else {
    node_bow_fairing_10.position.set(-3.52, 0.1, 0.475);
    node_bow_fairing_10.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bow_fairing_10.scale.set(0.34, 0.55, 0.42);
  }
  node_bow_fairing_10.userData.sculptComponent = {"id": "bow-fairing", "name": "Bow nose fairing", "level": "meso", "role": "detail", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Tapered nose cap closing the hull spine forward.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/bow-fairing-mount", "structuralParent": "root", "localStart": [-3.52, 0.1, 0.475], "localEnd": [-3.52, 0.1, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.34, "height": 0.55, "depth": 0.42, "units": "relative", "confidence": 0.6}, "transform": {"position": [-3.52, 0.1, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bow_fairing_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_bow_fairing_10);
  nodes["bow-fairing"] = node_bow_fairing_10;
  const mesh_bow_fairing_10Geometry = endpoint_bow_fairing_10
    ? new THREE.CylinderGeometry(endpoint_bow_fairing_10.endRadius, endpoint_bow_fairing_10.baseRadius, endpoint_bow_fairing_10.length, 32, 12)
    : new THREE.ConeGeometry(0.5, 1, 48, 16);
  const mesh_bow_fairing_10 = new THREE.Mesh(
    mesh_bow_fairing_10Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bow_fairing_10.name = "Bow nose fairing";
  if (endpoint_bow_fairing_10) {
    mesh_bow_fairing_10.position.copy(endpoint_bow_fairing_10.midpoint);
    mesh_bow_fairing_10.quaternion.copy(endpoint_bow_fairing_10.quaternion);
  }
  mesh_bow_fairing_10.castShadow = options.castShadow ?? true;
  mesh_bow_fairing_10.receiveShadow = options.receiveShadow ?? true;
  mesh_bow_fairing_10.userData.sculptComponent = {"id": "bow-fairing", "name": "Bow nose fairing", "level": "meso", "role": "detail", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Tapered nose cap closing the hull spine forward.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/bow-fairing-mount", "structuralParent": "root", "localStart": [-3.52, 0.1, 0.475], "localEnd": [-3.52, 0.1, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.34, "height": 0.55, "depth": 0.42, "units": "relative", "confidence": 0.6}, "transform": {"position": [-3.52, 0.1, 0.475], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bow_fairing_10.add(mesh_bow_fairing_10);
  meshes["bow-fairing"] = mesh_bow_fairing_10;
  colliders["bow-fairing"] = {"type": "box", "fit": "tight"};

  const attachment_hull_flank_rail_stbd_11 = {"parentId": "root", "parentSocket": "root/hull-flank-rail-stbd-mount", "structuralParent": "root", "localStart": [-0.3, 0.14, 1.025], "localEnd": [-0.3, 0.14, 1.025], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_flank_rail_stbd_11 = makeAttachmentEndpoint(attachment_hull_flank_rail_stbd_11);
  const node_hull_flank_rail_stbd_11 = new THREE.Group();
  node_hull_flank_rail_stbd_11.name = "Hull flank rail (stbd)__pivot";
  if (endpoint_hull_flank_rail_stbd_11) {
    node_hull_flank_rail_stbd_11.position.copy(endpoint_hull_flank_rail_stbd_11.start);
    node_hull_flank_rail_stbd_11.rotation.set(0, 0, 0);
    node_hull_flank_rail_stbd_11.scale.set(1, 1, 1);
  } else {
    node_hull_flank_rail_stbd_11.position.set(-0.3, 0.14, 1.025);
    node_hull_flank_rail_stbd_11.rotation.set(0.0, 0.0, 0.0);
    node_hull_flank_rail_stbd_11.scale.set(5.6, 0.1, 0.09);
  }
  node_hull_flank_rail_stbd_11.userData.sculptComponent = {"id": "hull-flank-rail-stbd", "name": "Hull flank rail (stbd)", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight extruded rail catching the reference's continuous dark flank line.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-flank-rail-stbd-mount", "structuralParent": "root", "localStart": [-0.3, 0.14, 1.025], "localEnd": [-0.3, 0.14, 1.025], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 5.6, "height": 0.1, "depth": 0.09, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3, 0.14, 1.025], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_flank_rail_stbd_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_flank_rail_stbd_11);
  nodes["hull-flank-rail-stbd"] = node_hull_flank_rail_stbd_11;
  const mesh_hull_flank_rail_stbd_11Geometry = endpoint_hull_flank_rail_stbd_11
    ? new THREE.CylinderGeometry(endpoint_hull_flank_rail_stbd_11.endRadius, endpoint_hull_flank_rail_stbd_11.baseRadius, endpoint_hull_flank_rail_stbd_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_hull_flank_rail_stbd_11 = new THREE.Mesh(
    mesh_hull_flank_rail_stbd_11Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_flank_rail_stbd_11.name = "Hull flank rail (stbd)";
  if (endpoint_hull_flank_rail_stbd_11) {
    mesh_hull_flank_rail_stbd_11.position.copy(endpoint_hull_flank_rail_stbd_11.midpoint);
    mesh_hull_flank_rail_stbd_11.quaternion.copy(endpoint_hull_flank_rail_stbd_11.quaternion);
  }
  mesh_hull_flank_rail_stbd_11.castShadow = options.castShadow ?? true;
  mesh_hull_flank_rail_stbd_11.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_flank_rail_stbd_11.userData.sculptComponent = {"id": "hull-flank-rail-stbd", "name": "Hull flank rail (stbd)", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight extruded rail catching the reference's continuous dark flank line.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-flank-rail-stbd-mount", "structuralParent": "root", "localStart": [-0.3, 0.14, 1.025], "localEnd": [-0.3, 0.14, 1.025], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 5.6, "height": 0.1, "depth": 0.09, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3, 0.14, 1.025], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_flank_rail_stbd_11.add(mesh_hull_flank_rail_stbd_11);
  meshes["hull-flank-rail-stbd"] = mesh_hull_flank_rail_stbd_11;
  colliders["hull-flank-rail-stbd"] = {"type": "box", "fit": "tight"};

  const attachment_hull_flank_rail_port_12 = {"parentId": "root", "parentSocket": "root/hull-flank-rail-port-mount", "structuralParent": "root", "localStart": [-0.3, 0.14, -0.075], "localEnd": [-0.3, 0.14, -0.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_flank_rail_port_12 = makeAttachmentEndpoint(attachment_hull_flank_rail_port_12);
  const node_hull_flank_rail_port_12 = new THREE.Group();
  node_hull_flank_rail_port_12.name = "Hull flank rail (port)__pivot";
  if (endpoint_hull_flank_rail_port_12) {
    node_hull_flank_rail_port_12.position.copy(endpoint_hull_flank_rail_port_12.start);
    node_hull_flank_rail_port_12.rotation.set(0, 0, 0);
    node_hull_flank_rail_port_12.scale.set(1, 1, 1);
  } else {
    node_hull_flank_rail_port_12.position.set(-0.3, 0.14, -0.07500000000000007);
    node_hull_flank_rail_port_12.rotation.set(0.0, 0.0, 0.0);
    node_hull_flank_rail_port_12.scale.set(5.6, 0.1, 0.09);
  }
  node_hull_flank_rail_port_12.userData.sculptComponent = {"id": "hull-flank-rail-port", "name": "Hull flank rail (port)", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight extruded rail catching the reference's continuous dark flank line.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-flank-rail-port-mount", "structuralParent": "root", "localStart": [-0.3, 0.14, -0.075], "localEnd": [-0.3, 0.14, -0.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 5.6, "height": 0.1, "depth": 0.09, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3, 0.14, -0.07500000000000007], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_flank_rail_port_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_flank_rail_port_12);
  nodes["hull-flank-rail-port"] = node_hull_flank_rail_port_12;
  const mesh_hull_flank_rail_port_12Geometry = endpoint_hull_flank_rail_port_12
    ? new THREE.CylinderGeometry(endpoint_hull_flank_rail_port_12.endRadius, endpoint_hull_flank_rail_port_12.baseRadius, endpoint_hull_flank_rail_port_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_hull_flank_rail_port_12 = new THREE.Mesh(
    mesh_hull_flank_rail_port_12Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_flank_rail_port_12.name = "Hull flank rail (port)";
  if (endpoint_hull_flank_rail_port_12) {
    mesh_hull_flank_rail_port_12.position.copy(endpoint_hull_flank_rail_port_12.midpoint);
    mesh_hull_flank_rail_port_12.quaternion.copy(endpoint_hull_flank_rail_port_12.quaternion);
  }
  mesh_hull_flank_rail_port_12.castShadow = options.castShadow ?? true;
  mesh_hull_flank_rail_port_12.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_flank_rail_port_12.userData.sculptComponent = {"id": "hull-flank-rail-port", "name": "Hull flank rail (port)", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight extruded rail catching the reference's continuous dark flank line.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-flank-rail-port-mount", "structuralParent": "root", "localStart": [-0.3, 0.14, -0.075], "localEnd": [-0.3, 0.14, -0.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 5.6, "height": 0.1, "depth": 0.09, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3, 0.14, -0.07500000000000007], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_flank_rail_port_12.add(mesh_hull_flank_rail_port_12);
  meshes["hull-flank-rail-port"] = mesh_hull_flank_rail_port_12;
  colliders["hull-flank-rail-port"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_01_13 = {"parentId": "root", "parentSocket": "root/deck-plate-01-mount", "structuralParent": "root", "localStart": [-2.75, 0.406, 0.475], "localEnd": [-2.75, 0.406, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_01_13 = makeAttachmentEndpoint(attachment_deck_plate_01_13);
  const node_deck_plate_01_13 = new THREE.Group();
  node_deck_plate_01_13.name = "Dorsal deck plate 1__pivot";
  if (endpoint_deck_plate_01_13) {
    node_deck_plate_01_13.position.copy(endpoint_deck_plate_01_13.start);
    node_deck_plate_01_13.rotation.set(0, 0, 0);
    node_deck_plate_01_13.scale.set(1, 1, 1);
  } else {
    node_deck_plate_01_13.position.set(-2.75, 0.4055, 0.475);
    node_deck_plate_01_13.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_01_13.scale.set(0.66, 0.035, 0.7224999999999999);
  }
  node_deck_plate_01_13.userData.sculptComponent = {"id": "deck-plate-01", "name": "Dorsal deck plate 1", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-01-mount", "structuralParent": "root", "localStart": [-2.75, 0.406, 0.475], "localEnd": [-2.75, 0.406, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7224999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.75, 0.4055, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_01_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_01_13);
  nodes["deck-plate-01"] = node_deck_plate_01_13;
  const mesh_deck_plate_01_13Geometry = endpoint_deck_plate_01_13
    ? new THREE.CylinderGeometry(endpoint_deck_plate_01_13.endRadius, endpoint_deck_plate_01_13.baseRadius, endpoint_deck_plate_01_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_01_13 = new THREE.Mesh(
    mesh_deck_plate_01_13Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_01_13.name = "Dorsal deck plate 1";
  if (endpoint_deck_plate_01_13) {
    mesh_deck_plate_01_13.position.copy(endpoint_deck_plate_01_13.midpoint);
    mesh_deck_plate_01_13.quaternion.copy(endpoint_deck_plate_01_13.quaternion);
  }
  mesh_deck_plate_01_13.castShadow = options.castShadow ?? true;
  mesh_deck_plate_01_13.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_01_13.userData.sculptComponent = {"id": "deck-plate-01", "name": "Dorsal deck plate 1", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-01-mount", "structuralParent": "root", "localStart": [-2.75, 0.406, 0.475], "localEnd": [-2.75, 0.406, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7224999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.75, 0.4055, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_01_13.add(mesh_deck_plate_01_13);
  meshes["deck-plate-01"] = mesh_deck_plate_01_13;
  colliders["deck-plate-01"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_02_14 = {"parentId": "root", "parentSocket": "root/deck-plate-02-mount", "structuralParent": "root", "localStart": [-2.03, 0.418, 0.475], "localEnd": [-2.03, 0.418, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_02_14 = makeAttachmentEndpoint(attachment_deck_plate_02_14);
  const node_deck_plate_02_14 = new THREE.Group();
  node_deck_plate_02_14.name = "Dorsal deck plate 2__pivot";
  if (endpoint_deck_plate_02_14) {
    node_deck_plate_02_14.position.copy(endpoint_deck_plate_02_14.start);
    node_deck_plate_02_14.rotation.set(0, 0, 0);
    node_deck_plate_02_14.scale.set(1, 1, 1);
  } else {
    node_deck_plate_02_14.position.set(-2.0300000000000002, 0.41846, 0.475);
    node_deck_plate_02_14.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_02_14.scale.set(0.66, 0.035, 0.7585);
  }
  node_deck_plate_02_14.userData.sculptComponent = {"id": "deck-plate-02", "name": "Dorsal deck plate 2", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-02-mount", "structuralParent": "root", "localStart": [-2.03, 0.418, 0.475], "localEnd": [-2.03, 0.418, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7585, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.0300000000000002, 0.41846, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_02_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_02_14);
  nodes["deck-plate-02"] = node_deck_plate_02_14;
  const mesh_deck_plate_02_14Geometry = endpoint_deck_plate_02_14
    ? new THREE.CylinderGeometry(endpoint_deck_plate_02_14.endRadius, endpoint_deck_plate_02_14.baseRadius, endpoint_deck_plate_02_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_02_14 = new THREE.Mesh(
    mesh_deck_plate_02_14Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_02_14.name = "Dorsal deck plate 2";
  if (endpoint_deck_plate_02_14) {
    mesh_deck_plate_02_14.position.copy(endpoint_deck_plate_02_14.midpoint);
    mesh_deck_plate_02_14.quaternion.copy(endpoint_deck_plate_02_14.quaternion);
  }
  mesh_deck_plate_02_14.castShadow = options.castShadow ?? true;
  mesh_deck_plate_02_14.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_02_14.userData.sculptComponent = {"id": "deck-plate-02", "name": "Dorsal deck plate 2", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-02-mount", "structuralParent": "root", "localStart": [-2.03, 0.418, 0.475], "localEnd": [-2.03, 0.418, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7585, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.0300000000000002, 0.41846, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_02_14.add(mesh_deck_plate_02_14);
  meshes["deck-plate-02"] = mesh_deck_plate_02_14;
  colliders["deck-plate-02"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_03_15 = {"parentId": "root", "parentSocket": "root/deck-plate-03-mount", "structuralParent": "root", "localStart": [-1.31, 0.431, 0.475], "localEnd": [-1.31, 0.431, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_03_15 = makeAttachmentEndpoint(attachment_deck_plate_03_15);
  const node_deck_plate_03_15 = new THREE.Group();
  node_deck_plate_03_15.name = "Dorsal deck plate 3__pivot";
  if (endpoint_deck_plate_03_15) {
    node_deck_plate_03_15.position.copy(endpoint_deck_plate_03_15.start);
    node_deck_plate_03_15.rotation.set(0, 0, 0);
    node_deck_plate_03_15.scale.set(1, 1, 1);
  } else {
    node_deck_plate_03_15.position.set(-1.31, 0.43142, 0.475);
    node_deck_plate_03_15.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_03_15.scale.set(0.66, 0.035, 0.7945);
  }
  node_deck_plate_03_15.userData.sculptComponent = {"id": "deck-plate-03", "name": "Dorsal deck plate 3", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-03-mount", "structuralParent": "root", "localStart": [-1.31, 0.431, 0.475], "localEnd": [-1.31, 0.431, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7945, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.31, 0.43142, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_03_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_03_15);
  nodes["deck-plate-03"] = node_deck_plate_03_15;
  const mesh_deck_plate_03_15Geometry = endpoint_deck_plate_03_15
    ? new THREE.CylinderGeometry(endpoint_deck_plate_03_15.endRadius, endpoint_deck_plate_03_15.baseRadius, endpoint_deck_plate_03_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_03_15 = new THREE.Mesh(
    mesh_deck_plate_03_15Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_03_15.name = "Dorsal deck plate 3";
  if (endpoint_deck_plate_03_15) {
    mesh_deck_plate_03_15.position.copy(endpoint_deck_plate_03_15.midpoint);
    mesh_deck_plate_03_15.quaternion.copy(endpoint_deck_plate_03_15.quaternion);
  }
  mesh_deck_plate_03_15.castShadow = options.castShadow ?? true;
  mesh_deck_plate_03_15.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_03_15.userData.sculptComponent = {"id": "deck-plate-03", "name": "Dorsal deck plate 3", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-03-mount", "structuralParent": "root", "localStart": [-1.31, 0.431, 0.475], "localEnd": [-1.31, 0.431, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7945, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.31, 0.43142, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_03_15.add(mesh_deck_plate_03_15);
  meshes["deck-plate-03"] = mesh_deck_plate_03_15;
  colliders["deck-plate-03"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_04_16 = {"parentId": "root", "parentSocket": "root/deck-plate-04-mount", "structuralParent": "root", "localStart": [-0.59, 0.444, 0.475], "localEnd": [-0.59, 0.444, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_04_16 = makeAttachmentEndpoint(attachment_deck_plate_04_16);
  const node_deck_plate_04_16 = new THREE.Group();
  node_deck_plate_04_16.name = "Dorsal deck plate 4__pivot";
  if (endpoint_deck_plate_04_16) {
    node_deck_plate_04_16.position.copy(endpoint_deck_plate_04_16.start);
    node_deck_plate_04_16.rotation.set(0, 0, 0);
    node_deck_plate_04_16.scale.set(1, 1, 1);
  } else {
    node_deck_plate_04_16.position.set(-0.5899999999999999, 0.44438, 0.475);
    node_deck_plate_04_16.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_04_16.scale.set(0.66, 0.035, 0.8305);
  }
  node_deck_plate_04_16.userData.sculptComponent = {"id": "deck-plate-04", "name": "Dorsal deck plate 4", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-04-mount", "structuralParent": "root", "localStart": [-0.59, 0.444, 0.475], "localEnd": [-0.59, 0.444, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.8305, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.5899999999999999, 0.44438, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_04_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_04_16);
  nodes["deck-plate-04"] = node_deck_plate_04_16;
  const mesh_deck_plate_04_16Geometry = endpoint_deck_plate_04_16
    ? new THREE.CylinderGeometry(endpoint_deck_plate_04_16.endRadius, endpoint_deck_plate_04_16.baseRadius, endpoint_deck_plate_04_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_04_16 = new THREE.Mesh(
    mesh_deck_plate_04_16Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_04_16.name = "Dorsal deck plate 4";
  if (endpoint_deck_plate_04_16) {
    mesh_deck_plate_04_16.position.copy(endpoint_deck_plate_04_16.midpoint);
    mesh_deck_plate_04_16.quaternion.copy(endpoint_deck_plate_04_16.quaternion);
  }
  mesh_deck_plate_04_16.castShadow = options.castShadow ?? true;
  mesh_deck_plate_04_16.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_04_16.userData.sculptComponent = {"id": "deck-plate-04", "name": "Dorsal deck plate 4", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-04-mount", "structuralParent": "root", "localStart": [-0.59, 0.444, 0.475], "localEnd": [-0.59, 0.444, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.8305, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.5899999999999999, 0.44438, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_04_16.add(mesh_deck_plate_04_16);
  meshes["deck-plate-04"] = mesh_deck_plate_04_16;
  colliders["deck-plate-04"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_05_17 = {"parentId": "root", "parentSocket": "root/deck-plate-05-mount", "structuralParent": "root", "localStart": [0.13, 0.453, 0.475], "localEnd": [0.13, 0.453, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_05_17 = makeAttachmentEndpoint(attachment_deck_plate_05_17);
  const node_deck_plate_05_17 = new THREE.Group();
  node_deck_plate_05_17.name = "Dorsal deck plate 5__pivot";
  if (endpoint_deck_plate_05_17) {
    node_deck_plate_05_17.position.copy(endpoint_deck_plate_05_17.start);
    node_deck_plate_05_17.rotation.set(0, 0, 0);
    node_deck_plate_05_17.scale.set(1, 1, 1);
  } else {
    node_deck_plate_05_17.position.set(0.1299999999999999, 0.45266, 0.475);
    node_deck_plate_05_17.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_05_17.scale.set(0.66, 0.035, 0.8535);
  }
  node_deck_plate_05_17.userData.sculptComponent = {"id": "deck-plate-05", "name": "Dorsal deck plate 5", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-05-mount", "structuralParent": "root", "localStart": [0.13, 0.453, 0.475], "localEnd": [0.13, 0.453, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.8535, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.1299999999999999, 0.45266, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_05_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_05_17);
  nodes["deck-plate-05"] = node_deck_plate_05_17;
  const mesh_deck_plate_05_17Geometry = endpoint_deck_plate_05_17
    ? new THREE.CylinderGeometry(endpoint_deck_plate_05_17.endRadius, endpoint_deck_plate_05_17.baseRadius, endpoint_deck_plate_05_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_05_17 = new THREE.Mesh(
    mesh_deck_plate_05_17Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_05_17.name = "Dorsal deck plate 5";
  if (endpoint_deck_plate_05_17) {
    mesh_deck_plate_05_17.position.copy(endpoint_deck_plate_05_17.midpoint);
    mesh_deck_plate_05_17.quaternion.copy(endpoint_deck_plate_05_17.quaternion);
  }
  mesh_deck_plate_05_17.castShadow = options.castShadow ?? true;
  mesh_deck_plate_05_17.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_05_17.userData.sculptComponent = {"id": "deck-plate-05", "name": "Dorsal deck plate 5", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-05-mount", "structuralParent": "root", "localStart": [0.13, 0.453, 0.475], "localEnd": [0.13, 0.453, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.8535, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.1299999999999999, 0.45266, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_05_17.add(mesh_deck_plate_05_17);
  meshes["deck-plate-05"] = mesh_deck_plate_05_17;
  colliders["deck-plate-05"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_06_18 = {"parentId": "root", "parentSocket": "root/deck-plate-06-mount", "structuralParent": "root", "localStart": [0.85, 0.44, 0.475], "localEnd": [0.85, 0.44, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_06_18 = makeAttachmentEndpoint(attachment_deck_plate_06_18);
  const node_deck_plate_06_18 = new THREE.Group();
  node_deck_plate_06_18.name = "Dorsal deck plate 6__pivot";
  if (endpoint_deck_plate_06_18) {
    node_deck_plate_06_18.position.copy(endpoint_deck_plate_06_18.start);
    node_deck_plate_06_18.rotation.set(0, 0, 0);
    node_deck_plate_06_18.scale.set(1, 1, 1);
  } else {
    node_deck_plate_06_18.position.set(0.8499999999999996, 0.43970000000000004, 0.475);
    node_deck_plate_06_18.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_06_18.scale.set(0.66, 0.035, 0.8175);
  }
  node_deck_plate_06_18.userData.sculptComponent = {"id": "deck-plate-06", "name": "Dorsal deck plate 6", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-06-mount", "structuralParent": "root", "localStart": [0.85, 0.44, 0.475], "localEnd": [0.85, 0.44, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.8175, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.8499999999999996, 0.43970000000000004, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_06_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_06_18);
  nodes["deck-plate-06"] = node_deck_plate_06_18;
  const mesh_deck_plate_06_18Geometry = endpoint_deck_plate_06_18
    ? new THREE.CylinderGeometry(endpoint_deck_plate_06_18.endRadius, endpoint_deck_plate_06_18.baseRadius, endpoint_deck_plate_06_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_06_18 = new THREE.Mesh(
    mesh_deck_plate_06_18Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_06_18.name = "Dorsal deck plate 6";
  if (endpoint_deck_plate_06_18) {
    mesh_deck_plate_06_18.position.copy(endpoint_deck_plate_06_18.midpoint);
    mesh_deck_plate_06_18.quaternion.copy(endpoint_deck_plate_06_18.quaternion);
  }
  mesh_deck_plate_06_18.castShadow = options.castShadow ?? true;
  mesh_deck_plate_06_18.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_06_18.userData.sculptComponent = {"id": "deck-plate-06", "name": "Dorsal deck plate 6", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-06-mount", "structuralParent": "root", "localStart": [0.85, 0.44, 0.475], "localEnd": [0.85, 0.44, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.8175, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.8499999999999996, 0.43970000000000004, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_06_18.add(mesh_deck_plate_06_18);
  meshes["deck-plate-06"] = mesh_deck_plate_06_18;
  colliders["deck-plate-06"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_07_19 = {"parentId": "root", "parentSocket": "root/deck-plate-07-mount", "structuralParent": "root", "localStart": [1.57, 0.427, 0.475], "localEnd": [1.57, 0.427, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_07_19 = makeAttachmentEndpoint(attachment_deck_plate_07_19);
  const node_deck_plate_07_19 = new THREE.Group();
  node_deck_plate_07_19.name = "Dorsal deck plate 7__pivot";
  if (endpoint_deck_plate_07_19) {
    node_deck_plate_07_19.position.copy(endpoint_deck_plate_07_19.start);
    node_deck_plate_07_19.rotation.set(0, 0, 0);
    node_deck_plate_07_19.scale.set(1, 1, 1);
  } else {
    node_deck_plate_07_19.position.set(1.5700000000000003, 0.42674, 0.475);
    node_deck_plate_07_19.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_07_19.scale.set(0.66, 0.035, 0.7815);
  }
  node_deck_plate_07_19.userData.sculptComponent = {"id": "deck-plate-07", "name": "Dorsal deck plate 7", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-07-mount", "structuralParent": "root", "localStart": [1.57, 0.427, 0.475], "localEnd": [1.57, 0.427, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7815, "units": "relative", "confidence": 0.7}, "transform": {"position": [1.5700000000000003, 0.42674, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_07_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_07_19);
  nodes["deck-plate-07"] = node_deck_plate_07_19;
  const mesh_deck_plate_07_19Geometry = endpoint_deck_plate_07_19
    ? new THREE.CylinderGeometry(endpoint_deck_plate_07_19.endRadius, endpoint_deck_plate_07_19.baseRadius, endpoint_deck_plate_07_19.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_07_19 = new THREE.Mesh(
    mesh_deck_plate_07_19Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_07_19.name = "Dorsal deck plate 7";
  if (endpoint_deck_plate_07_19) {
    mesh_deck_plate_07_19.position.copy(endpoint_deck_plate_07_19.midpoint);
    mesh_deck_plate_07_19.quaternion.copy(endpoint_deck_plate_07_19.quaternion);
  }
  mesh_deck_plate_07_19.castShadow = options.castShadow ?? true;
  mesh_deck_plate_07_19.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_07_19.userData.sculptComponent = {"id": "deck-plate-07", "name": "Dorsal deck plate 7", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-07-mount", "structuralParent": "root", "localStart": [1.57, 0.427, 0.475], "localEnd": [1.57, 0.427, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7815, "units": "relative", "confidence": 0.7}, "transform": {"position": [1.5700000000000003, 0.42674, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_07_19.add(mesh_deck_plate_07_19);
  meshes["deck-plate-07"] = mesh_deck_plate_07_19;
  colliders["deck-plate-07"] = {"type": "box", "fit": "tight"};

  const attachment_deck_plate_08_20 = {"parentId": "root", "parentSocket": "root/deck-plate-08-mount", "structuralParent": "root", "localStart": [2.29, 0.414, 0.475], "localEnd": [2.29, 0.414, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_deck_plate_08_20 = makeAttachmentEndpoint(attachment_deck_plate_08_20);
  const node_deck_plate_08_20 = new THREE.Group();
  node_deck_plate_08_20.name = "Dorsal deck plate 8__pivot";
  if (endpoint_deck_plate_08_20) {
    node_deck_plate_08_20.position.copy(endpoint_deck_plate_08_20.start);
    node_deck_plate_08_20.rotation.set(0, 0, 0);
    node_deck_plate_08_20.scale.set(1, 1, 1);
  } else {
    node_deck_plate_08_20.position.set(2.29, 0.41378000000000004, 0.475);
    node_deck_plate_08_20.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_08_20.scale.set(0.66, 0.035, 0.7454999999999999);
  }
  node_deck_plate_08_20.userData.sculptComponent = {"id": "deck-plate-08", "name": "Dorsal deck plate 8", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-08-mount", "structuralParent": "root", "localStart": [2.29, 0.414, 0.475], "localEnd": [2.29, 0.414, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7454999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [2.29, 0.41378000000000004, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_08_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_deck_plate_08_20);
  nodes["deck-plate-08"] = node_deck_plate_08_20;
  const mesh_deck_plate_08_20Geometry = endpoint_deck_plate_08_20
    ? new THREE.CylinderGeometry(endpoint_deck_plate_08_20.endRadius, endpoint_deck_plate_08_20.baseRadius, endpoint_deck_plate_08_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_deck_plate_08_20 = new THREE.Mesh(
    mesh_deck_plate_08_20Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_08_20.name = "Dorsal deck plate 8";
  if (endpoint_deck_plate_08_20) {
    mesh_deck_plate_08_20.position.copy(endpoint_deck_plate_08_20.midpoint);
    mesh_deck_plate_08_20.quaternion.copy(endpoint_deck_plate_08_20.quaternion);
  }
  mesh_deck_plate_08_20.castShadow = options.castShadow ?? true;
  mesh_deck_plate_08_20.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_08_20.userData.sculptComponent = {"id": "deck-plate-08", "name": "Dorsal deck plate 8", "level": "meso", "role": "panel", "logicalParent": "root", "importance": 0.45, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate panel; the reference deck is divided by raised chordwise ridges.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/deck-plate-08-mount", "structuralParent": "root", "localStart": [2.29, 0.414, 0.475], "localEnd": [2.29, 0.414, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.66, "height": 0.035, "depth": 0.7454999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [2.29, 0.41378000000000004, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d05"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_deck_plate_08_20.add(mesh_deck_plate_08_20);
  meshes["deck-plate-08"] = mesh_deck_plate_08_20;
  colliders["deck-plate-08"] = {"type": "box", "fit": "tight"};

  const attachment_wing_leading_spar_21 = {"parentId": "forward-wing", "parentSocket": "forward-wing/wing-leading-spar-mount", "structuralParent": "forward-wing", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]};
  const endpoint_wing_leading_spar_21 = makeAttachmentEndpoint(attachment_wing_leading_spar_21);
  const node_wing_leading_spar_21 = new THREE.Group();
  node_wing_leading_spar_21.name = "Forward wing leading spar__pivot";
  if (endpoint_wing_leading_spar_21) {
    node_wing_leading_spar_21.position.copy(endpoint_wing_leading_spar_21.start);
    node_wing_leading_spar_21.rotation.set(0, 0, 0);
    node_wing_leading_spar_21.scale.set(1, 1, 1);
  } else {
    node_wing_leading_spar_21.position.set(0.0, 0.0, 0.0);
    node_wing_leading_spar_21.rotation.set(0.0, 0.0, 0.0);
    node_wing_leading_spar_21.scale.set(1.0, 1.0, 1.0);
  }
  node_wing_leading_spar_21.userData.sculptComponent = {"id": "wing-leading-spar", "name": "Forward wing leading spar", "level": "meso", "role": "structure", "logicalParent": "forward-wing", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight spar box along the leading edge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "forward-wing", "attachment": {"parentId": "forward-wing", "parentSocket": "forward-wing/wing-leading-spar-mount", "structuralParent": "forward-wing", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.09, "height": 0.09, "depth": 1.0, "units": "relative", "confidence": 0.55}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_wing_leading_spar_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["forward-wing"] ?? root).add(node_wing_leading_spar_21);
  nodes["wing-leading-spar"] = node_wing_leading_spar_21;
  const mesh_wing_leading_spar_21Geometry = endpoint_wing_leading_spar_21
    ? new THREE.CylinderGeometry(endpoint_wing_leading_spar_21.endRadius, endpoint_wing_leading_spar_21.baseRadius, endpoint_wing_leading_spar_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_wing_leading_spar_21 = new THREE.Mesh(
    mesh_wing_leading_spar_21Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_leading_spar_21.name = "Forward wing leading spar";
  if (endpoint_wing_leading_spar_21) {
    mesh_wing_leading_spar_21.position.copy(endpoint_wing_leading_spar_21.midpoint);
    mesh_wing_leading_spar_21.quaternion.copy(endpoint_wing_leading_spar_21.quaternion);
  }
  mesh_wing_leading_spar_21.castShadow = options.castShadow ?? true;
  mesh_wing_leading_spar_21.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_leading_spar_21.userData.sculptComponent = {"id": "wing-leading-spar", "name": "Forward wing leading spar", "level": "meso", "role": "structure", "logicalParent": "forward-wing", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight spar box along the leading edge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "forward-wing", "attachment": {"parentId": "forward-wing", "parentSocket": "forward-wing/wing-leading-spar-mount", "structuralParent": "forward-wing", "localStart": [0, 0, 0], "localEnd": [0, 0, 0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["bow-zone"]}, "dimensions": {"width": 0.09, "height": 0.09, "depth": 1.0, "units": "relative", "confidence": 0.55}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["bow-zone"], "details": ["d04"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_wing_leading_spar_21.add(mesh_wing_leading_spar_21);
  meshes["wing-leading-spar"] = mesh_wing_leading_spar_21;
  colliders["wing-leading-spar"] = {"type": "box", "fit": "tight"};

  const attachment_tail_spine_rail_22 = {"parentId": "root", "parentSocket": "root/tail-spine-rail-mount", "structuralParent": "root", "localStart": [2.9, 0.03, 0.475], "localEnd": [2.9, 0.03, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_spine_rail_22 = makeAttachmentEndpoint(attachment_tail_spine_rail_22);
  const node_tail_spine_rail_22 = new THREE.Group();
  node_tail_spine_rail_22.name = "Tail spine rail__pivot";
  if (endpoint_tail_spine_rail_22) {
    node_tail_spine_rail_22.position.copy(endpoint_tail_spine_rail_22.start);
    node_tail_spine_rail_22.rotation.set(0, 0, 0);
    node_tail_spine_rail_22.scale.set(1, 1, 1);
  } else {
    node_tail_spine_rail_22.position.set(2.9, 0.03, 0.475);
    node_tail_spine_rail_22.rotation.set(0.0, 0.0, 0.0);
    node_tail_spine_rail_22.scale.set(4.1, 0.07, 0.22);
  }
  node_tail_spine_rail_22.userData.sculptComponent = {"id": "tail-spine-rail", "name": "Tail spine rail", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Continuous dark rail along the tail blade centreline in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-spine-rail-mount", "structuralParent": "root", "localStart": [2.9, 0.03, 0.475], "localEnd": [2.9, 0.03, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.1, "height": 0.07, "depth": 0.22, "units": "relative", "confidence": 0.65}, "transform": {"position": [2.9, 0.03, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_spine_rail_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_spine_rail_22);
  nodes["tail-spine-rail"] = node_tail_spine_rail_22;
  const mesh_tail_spine_rail_22Geometry = endpoint_tail_spine_rail_22
    ? new THREE.CylinderGeometry(endpoint_tail_spine_rail_22.endRadius, endpoint_tail_spine_rail_22.baseRadius, endpoint_tail_spine_rail_22.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_spine_rail_22 = new THREE.Mesh(
    mesh_tail_spine_rail_22Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_spine_rail_22.name = "Tail spine rail";
  if (endpoint_tail_spine_rail_22) {
    mesh_tail_spine_rail_22.position.copy(endpoint_tail_spine_rail_22.midpoint);
    mesh_tail_spine_rail_22.quaternion.copy(endpoint_tail_spine_rail_22.quaternion);
  }
  mesh_tail_spine_rail_22.castShadow = options.castShadow ?? true;
  mesh_tail_spine_rail_22.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_spine_rail_22.userData.sculptComponent = {"id": "tail-spine-rail", "name": "Tail spine rail", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Continuous dark rail along the tail blade centreline in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-spine-rail-mount", "structuralParent": "root", "localStart": [2.9, 0.03, 0.475], "localEnd": [2.9, 0.03, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.1, "height": 0.07, "depth": 0.22, "units": "relative", "confidence": 0.65}, "transform": {"position": [2.9, 0.03, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_spine_rail_22.add(mesh_tail_spine_rail_22);
  meshes["tail-spine-rail"] = mesh_tail_spine_rail_22;
  colliders["tail-spine-rail"] = {"type": "box", "fit": "tight"};

  const attachment_mid_stabilizer_fin_23 = {"parentId": "root", "parentSocket": "root/mid-stabilizer-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.405], "localEnd": [0, 0, 0.405], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_mid_stabilizer_fin_23 = makeAttachmentEndpoint(attachment_mid_stabilizer_fin_23);
  const node_mid_stabilizer_fin_23 = new THREE.Group();
  node_mid_stabilizer_fin_23.name = "Mid stabiliser fin__pivot";
  if (endpoint_mid_stabilizer_fin_23) {
    node_mid_stabilizer_fin_23.position.copy(endpoint_mid_stabilizer_fin_23.start);
    node_mid_stabilizer_fin_23.rotation.set(0, 0, 0);
    node_mid_stabilizer_fin_23.scale.set(1, 1, 1);
  } else {
    node_mid_stabilizer_fin_23.position.set(0.0, 0.0, 0.40499999999999997);
    node_mid_stabilizer_fin_23.rotation.set(0.0, 0.0, 0.0);
    node_mid_stabilizer_fin_23.scale.set(1.0, 1.0, 1.0);
  }
  node_mid_stabilizer_fin_23.userData.sculptComponent = {"id": "mid-stabilizer-fin", "name": "Mid stabiliser fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Small tapered blade sheet echoing the mast fin. Macro rather than meso because it is a distinct silhouette landmark in the reference, not a sub-part of the tail.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[1.02, 0.24], [1.14, 0.99], [1.24, 0.99], [1.5, 0.26]], "depth": 0.14}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mid-stabilizer-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.405], "localEnd": [0, 0, 0.405], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.40499999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "midfin-blue-strip", "kind": "linework", "description": "blue leading-edge strip", "detailRefs": ["d08"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mid_stabilizer_fin_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mid_stabilizer_fin_23);
  nodes["mid-stabilizer-fin"] = node_mid_stabilizer_fin_23;
  const mesh_mid_stabilizer_fin_23Geometry = endpoint_mid_stabilizer_fin_23
    ? new THREE.CylinderGeometry(endpoint_mid_stabilizer_fin_23.endRadius, endpoint_mid_stabilizer_fin_23.baseRadius, endpoint_mid_stabilizer_fin_23.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.02, 0.24], [1.14, 0.99], [1.24, 0.99], [1.5, 0.26]], "depth": 0.14});
  const mesh_mid_stabilizer_fin_23 = new THREE.Mesh(
    mesh_mid_stabilizer_fin_23Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mid_stabilizer_fin_23.name = "Mid stabiliser fin";
  if (endpoint_mid_stabilizer_fin_23) {
    mesh_mid_stabilizer_fin_23.position.copy(endpoint_mid_stabilizer_fin_23.midpoint);
    mesh_mid_stabilizer_fin_23.quaternion.copy(endpoint_mid_stabilizer_fin_23.quaternion);
  }
  mesh_mid_stabilizer_fin_23.castShadow = options.castShadow ?? true;
  mesh_mid_stabilizer_fin_23.receiveShadow = options.receiveShadow ?? true;
  mesh_mid_stabilizer_fin_23.userData.sculptComponent = {"id": "mid-stabilizer-fin", "name": "Mid stabiliser fin", "level": "macro", "role": "fin", "logicalParent": "root", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Small tapered blade sheet echoing the mast fin. Macro rather than meso because it is a distinct silhouette landmark in the reference, not a sub-part of the tail.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[1.02, 0.24], [1.14, 0.99], [1.24, 0.99], [1.5, 0.26]], "depth": 0.14}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mid-stabilizer-fin-mount", "structuralParent": "root", "localStart": [0, 0, 0.405], "localEnd": [0, 0, 0.405], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.40499999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "midfin-blue-strip", "kind": "linework", "description": "blue leading-edge strip", "detailRefs": ["d08"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mid_stabilizer_fin_23.add(mesh_mid_stabilizer_fin_23);
  meshes["mid-stabilizer-fin"] = mesh_mid_stabilizer_fin_23;
  colliders["mid-stabilizer-fin"] = {"type": "box", "fit": "tight"};

  const attachment_mast_inner_machinery_24 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-inner-machinery-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.67, 1.05, 0.01], "localEnd": [-1.67, 1.05, 0.01], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_inner_machinery_24 = makeAttachmentEndpoint(attachment_mast_inner_machinery_24);
  const node_mast_inner_machinery_24 = new THREE.Group();
  node_mast_inner_machinery_24.name = "Mast inner machinery box__pivot";
  if (endpoint_mast_inner_machinery_24) {
    node_mast_inner_machinery_24.position.copy(endpoint_mast_inner_machinery_24.start);
    node_mast_inner_machinery_24.rotation.set(0, 0, 0);
    node_mast_inner_machinery_24.scale.set(1, 1, 1);
  } else {
    node_mast_inner_machinery_24.position.set(-1.67, 1.05, 0.01);
    node_mast_inner_machinery_24.rotation.set(0.0, 0.0, 0.0);
    node_mast_inner_machinery_24.scale.set(0.2, 0.85, 0.16);
  }
  node_mast_inner_machinery_24.userData.sculptComponent = {"id": "mast-inner-machinery", "name": "Mast inner machinery box", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.7, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Boxy exposed equipment stack visible between the shell leaves.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-inner-machinery-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.67, 1.05, 0.01], "localEnd": [-1.67, 1.05, 0.01], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.2, "height": 0.85, "depth": 0.16, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.67, 1.05, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_inner_machinery_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_inner_machinery_24);
  nodes["mast-inner-machinery"] = node_mast_inner_machinery_24;
  const mesh_mast_inner_machinery_24Geometry = endpoint_mast_inner_machinery_24
    ? new THREE.CylinderGeometry(endpoint_mast_inner_machinery_24.endRadius, endpoint_mast_inner_machinery_24.baseRadius, endpoint_mast_inner_machinery_24.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_inner_machinery_24 = new THREE.Mesh(
    mesh_mast_inner_machinery_24Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_inner_machinery_24.name = "Mast inner machinery box";
  if (endpoint_mast_inner_machinery_24) {
    mesh_mast_inner_machinery_24.position.copy(endpoint_mast_inner_machinery_24.midpoint);
    mesh_mast_inner_machinery_24.quaternion.copy(endpoint_mast_inner_machinery_24.quaternion);
  }
  mesh_mast_inner_machinery_24.castShadow = options.castShadow ?? true;
  mesh_mast_inner_machinery_24.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_inner_machinery_24.userData.sculptComponent = {"id": "mast-inner-machinery", "name": "Mast inner machinery box", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.7, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Boxy exposed equipment stack visible between the shell leaves.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-inner-machinery-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.67, 1.05, 0.01], "localEnd": [-1.67, 1.05, 0.01], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.2, "height": 0.85, "depth": 0.16, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.67, 1.05, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_inner_machinery_24.add(mesh_mast_inner_machinery_24);
  meshes["mast-inner-machinery"] = mesh_mast_inner_machinery_24;
  colliders["mast-inner-machinery"] = {"type": "box", "fit": "tight"};

  const attachment_mast_coolant_strip_25 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-coolant-strip-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.73, 1.72, 0.02], "localEnd": [-1.73, 1.72, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_coolant_strip_25 = makeAttachmentEndpoint(attachment_mast_coolant_strip_25);
  const node_mast_coolant_strip_25 = new THREE.Group();
  node_mast_coolant_strip_25.name = "Mast coolant strip__pivot";
  if (endpoint_mast_coolant_strip_25) {
    node_mast_coolant_strip_25.position.copy(endpoint_mast_coolant_strip_25.start);
    node_mast_coolant_strip_25.rotation.set(0, 0, 0);
    node_mast_coolant_strip_25.scale.set(1, 1, 1);
  } else {
    node_mast_coolant_strip_25.position.set(-1.73, 1.72, 0.02);
    node_mast_coolant_strip_25.rotation.set(0.0, 0.0, 0.0);
    node_mast_coolant_strip_25.scale.set(0.09, 0.62, 0.1);
  }
  node_mast_coolant_strip_25.userData.sculptComponent = {"id": "mast-coolant-strip", "name": "Mast coolant strip", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat teal strip inboard of the shell.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-coolant-strip-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.73, 1.72, 0.02], "localEnd": [-1.73, 1.72, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.62, "depth": 0.1, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.73, 1.72, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-teal", "materialLayers": ["accent-teal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 143, 122, 1.0)", "secondaryAlbedo": "rgba(31, 143, 122, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.5, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(31, 143, 122, 1.0)"}, {"position": 1.0, "color": "rgba(31, 143, 122, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_coolant_strip_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_coolant_strip_25);
  nodes["mast-coolant-strip"] = node_mast_coolant_strip_25;
  const mesh_mast_coolant_strip_25Geometry = endpoint_mast_coolant_strip_25
    ? new THREE.CylinderGeometry(endpoint_mast_coolant_strip_25.endRadius, endpoint_mast_coolant_strip_25.baseRadius, endpoint_mast_coolant_strip_25.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_coolant_strip_25 = new THREE.Mesh(
    mesh_mast_coolant_strip_25Geometry,
    materialMap["accent-teal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_coolant_strip_25.name = "Mast coolant strip";
  if (endpoint_mast_coolant_strip_25) {
    mesh_mast_coolant_strip_25.position.copy(endpoint_mast_coolant_strip_25.midpoint);
    mesh_mast_coolant_strip_25.quaternion.copy(endpoint_mast_coolant_strip_25.quaternion);
  }
  mesh_mast_coolant_strip_25.castShadow = options.castShadow ?? true;
  mesh_mast_coolant_strip_25.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_coolant_strip_25.userData.sculptComponent = {"id": "mast-coolant-strip", "name": "Mast coolant strip", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat teal strip inboard of the shell.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-coolant-strip-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.73, 1.72, 0.02], "localEnd": [-1.73, 1.72, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.62, "depth": 0.1, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.73, 1.72, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-teal", "materialLayers": ["accent-teal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 143, 122, 1.0)", "secondaryAlbedo": "rgba(31, 143, 122, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.5, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(31, 143, 122, 1.0)"}, {"position": 1.0, "color": "rgba(31, 143, 122, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_coolant_strip_25.add(mesh_mast_coolant_strip_25);
  meshes["mast-coolant-strip"] = mesh_mast_coolant_strip_25;
  colliders["mast-coolant-strip"] = {"type": "box", "fit": "tight"};

  const attachment_mast_terminal_block_26 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-terminal-block-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.61, 0.6, 0.02], "localEnd": [-1.61, 0.6, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_terminal_block_26 = makeAttachmentEndpoint(attachment_mast_terminal_block_26);
  const node_mast_terminal_block_26 = new THREE.Group();
  node_mast_terminal_block_26.name = "Mast terminal block__pivot";
  if (endpoint_mast_terminal_block_26) {
    node_mast_terminal_block_26.position.copy(endpoint_mast_terminal_block_26.start);
    node_mast_terminal_block_26.rotation.set(0, 0, 0);
    node_mast_terminal_block_26.scale.set(1, 1, 1);
  } else {
    node_mast_terminal_block_26.position.set(-1.61, 0.6, 0.02);
    node_mast_terminal_block_26.rotation.set(0.0, 0.0, 0.0);
    node_mast_terminal_block_26.scale.set(0.13, 0.16, 0.11);
  }
  node_mast_terminal_block_26.userData.sculptComponent = {"id": "mast-terminal-block", "name": "Mast terminal block", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.45, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small red equipment block at the machinery stack root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-terminal-block-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.61, 0.6, 0.02], "localEnd": [-1.61, 0.6, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.11, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.61, 0.6, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_terminal_block_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_terminal_block_26);
  nodes["mast-terminal-block"] = node_mast_terminal_block_26;
  const mesh_mast_terminal_block_26Geometry = endpoint_mast_terminal_block_26
    ? new THREE.CylinderGeometry(endpoint_mast_terminal_block_26.endRadius, endpoint_mast_terminal_block_26.baseRadius, endpoint_mast_terminal_block_26.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_terminal_block_26 = new THREE.Mesh(
    mesh_mast_terminal_block_26Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_terminal_block_26.name = "Mast terminal block";
  if (endpoint_mast_terminal_block_26) {
    mesh_mast_terminal_block_26.position.copy(endpoint_mast_terminal_block_26.midpoint);
    mesh_mast_terminal_block_26.quaternion.copy(endpoint_mast_terminal_block_26.quaternion);
  }
  mesh_mast_terminal_block_26.castShadow = options.castShadow ?? true;
  mesh_mast_terminal_block_26.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_terminal_block_26.userData.sculptComponent = {"id": "mast-terminal-block", "name": "Mast terminal block", "level": "meso", "role": "detail", "logicalParent": "dorsal-mast-fin", "importance": 0.45, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small red equipment block at the machinery stack root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-terminal-block-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.61, 0.6, 0.02], "localEnd": [-1.61, 0.6, 0.02], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.11, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.61, 0.6, 0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d13"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_terminal_block_26.add(mesh_mast_terminal_block_26);
  meshes["mast-terminal-block"] = mesh_mast_terminal_block_26;
  colliders["mast-terminal-block"] = {"type": "box", "fit": "tight"};

  const attachment_mast_pivot_boss_port_27 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-port-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, -0.17], "localEnd": [-1.62, 0.38, -0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_pivot_boss_port_27 = makeAttachmentEndpoint(attachment_mast_pivot_boss_port_27);
  const node_mast_pivot_boss_port_27 = new THREE.Group();
  node_mast_pivot_boss_port_27.name = "Mast pivot boss (port)__pivot";
  if (endpoint_mast_pivot_boss_port_27) {
    node_mast_pivot_boss_port_27.position.copy(endpoint_mast_pivot_boss_port_27.start);
    node_mast_pivot_boss_port_27.rotation.set(0, 0, 0);
    node_mast_pivot_boss_port_27.scale.set(1, 1, 1);
  } else {
    node_mast_pivot_boss_port_27.position.set(-1.62, 0.38, -0.17);
    node_mast_pivot_boss_port_27.rotation.set(1.5707963267948966, 0.0, 0.0);
    node_mast_pivot_boss_port_27.scale.set(0.28, 0.1, 0.28);
  }
  node_mast_pivot_boss_port_27.userData.sculptComponent = {"id": "mast-pivot-boss-port", "name": "Mast pivot boss (port)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-port-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, -0.17], "localEnd": [-1.62, 0.38, -0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, -0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_port_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_pivot_boss_port_27);
  nodes["mast-pivot-boss-port"] = node_mast_pivot_boss_port_27;
  const mesh_mast_pivot_boss_port_27Geometry = endpoint_mast_pivot_boss_port_27
    ? new THREE.CylinderGeometry(endpoint_mast_pivot_boss_port_27.endRadius, endpoint_mast_pivot_boss_port_27.baseRadius, endpoint_mast_pivot_boss_port_27.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_mast_pivot_boss_port_27 = new THREE.Mesh(
    mesh_mast_pivot_boss_port_27Geometry,
    materialMap["accent-gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_pivot_boss_port_27.name = "Mast pivot boss (port)";
  if (endpoint_mast_pivot_boss_port_27) {
    mesh_mast_pivot_boss_port_27.position.copy(endpoint_mast_pivot_boss_port_27.midpoint);
    mesh_mast_pivot_boss_port_27.quaternion.copy(endpoint_mast_pivot_boss_port_27.quaternion);
  }
  mesh_mast_pivot_boss_port_27.castShadow = options.castShadow ?? true;
  mesh_mast_pivot_boss_port_27.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_pivot_boss_port_27.userData.sculptComponent = {"id": "mast-pivot-boss-port", "name": "Mast pivot boss (port)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-port-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, -0.17], "localEnd": [-1.62, 0.38, -0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, -0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_port_27.add(mesh_mast_pivot_boss_port_27);
  meshes["mast-pivot-boss-port"] = mesh_mast_pivot_boss_port_27;
  colliders["mast-pivot-boss-port"] = {"type": "box", "fit": "tight"};

  const attachment_mast_pivot_boss_stbd_28 = {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-stbd-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, 0.17], "localEnd": [-1.62, 0.38, 0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_pivot_boss_stbd_28 = makeAttachmentEndpoint(attachment_mast_pivot_boss_stbd_28);
  const node_mast_pivot_boss_stbd_28 = new THREE.Group();
  node_mast_pivot_boss_stbd_28.name = "Mast pivot boss (stbd)__pivot";
  if (endpoint_mast_pivot_boss_stbd_28) {
    node_mast_pivot_boss_stbd_28.position.copy(endpoint_mast_pivot_boss_stbd_28.start);
    node_mast_pivot_boss_stbd_28.rotation.set(0, 0, 0);
    node_mast_pivot_boss_stbd_28.scale.set(1, 1, 1);
  } else {
    node_mast_pivot_boss_stbd_28.position.set(-1.62, 0.38, 0.17);
    node_mast_pivot_boss_stbd_28.rotation.set(1.5707963267948966, 0.0, 0.0);
    node_mast_pivot_boss_stbd_28.scale.set(0.28, 0.1, 0.28);
  }
  node_mast_pivot_boss_stbd_28.userData.sculptComponent = {"id": "mast-pivot-boss-stbd", "name": "Mast pivot boss (stbd)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-stbd-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, 0.17], "localEnd": [-1.62, 0.38, 0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, 0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_stbd_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["dorsal-mast-fin"] ?? root).add(node_mast_pivot_boss_stbd_28);
  nodes["mast-pivot-boss-stbd"] = node_mast_pivot_boss_stbd_28;
  const mesh_mast_pivot_boss_stbd_28Geometry = endpoint_mast_pivot_boss_stbd_28
    ? new THREE.CylinderGeometry(endpoint_mast_pivot_boss_stbd_28.endRadius, endpoint_mast_pivot_boss_stbd_28.baseRadius, endpoint_mast_pivot_boss_stbd_28.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_mast_pivot_boss_stbd_28 = new THREE.Mesh(
    mesh_mast_pivot_boss_stbd_28Geometry,
    materialMap["accent-gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_pivot_boss_stbd_28.name = "Mast pivot boss (stbd)";
  if (endpoint_mast_pivot_boss_stbd_28) {
    mesh_mast_pivot_boss_stbd_28.position.copy(endpoint_mast_pivot_boss_stbd_28.midpoint);
    mesh_mast_pivot_boss_stbd_28.quaternion.copy(endpoint_mast_pivot_boss_stbd_28.quaternion);
  }
  mesh_mast_pivot_boss_stbd_28.castShadow = options.castShadow ?? true;
  mesh_mast_pivot_boss_stbd_28.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_pivot_boss_stbd_28.userData.sculptComponent = {"id": "mast-pivot-boss-stbd", "name": "Mast pivot boss (stbd)", "level": "meso", "role": "joint", "logicalParent": "dorsal-mast-fin", "importance": 0.75, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "dorsal-mast-fin", "attachment": {"parentId": "dorsal-mast-fin", "parentSocket": "dorsal-mast-fin/mast-pivot-boss-stbd-mount", "structuralParent": "dorsal-mast-fin", "localStart": [-1.62, 0.38, 0.17], "localEnd": [-1.62, 0.38, 0.17], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.62, 0.38, 0.17], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-gold", "materialLayers": ["accent-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d12"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 114, 4, 1.0)", "secondaryAlbedo": "rgba(199, 154, 18, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(148, 114, 4, 1.0)"}, {"position": 1.0, "color": "rgba(199, 154, 18, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_pivot_boss_stbd_28.add(mesh_mast_pivot_boss_stbd_28);
  meshes["mast-pivot-boss-stbd"] = mesh_mast_pivot_boss_stbd_28;
  colliders["mast-pivot-boss-stbd"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_housing_29 = {"parentId": "root", "parentSocket": "root/mast-base-housing-mount", "structuralParent": "root", "localStart": [0, 0, 0.175], "localEnd": [0, 0, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_housing_29 = makeAttachmentEndpoint(attachment_mast_base_housing_29);
  const node_mast_base_housing_29 = new THREE.Group();
  node_mast_base_housing_29.name = "Mast base housing__pivot";
  if (endpoint_mast_base_housing_29) {
    node_mast_base_housing_29.position.copy(endpoint_mast_base_housing_29.start);
    node_mast_base_housing_29.rotation.set(0, 0, 0);
    node_mast_base_housing_29.scale.set(1, 1, 1);
  } else {
    node_mast_base_housing_29.position.set(0.0, 0.0, 0.175);
    node_mast_base_housing_29.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_housing_29.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_base_housing_29.userData.sculptComponent = {"id": "mast-base-housing", "name": "Mast base housing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Faceted pyramidal housing; planar facets with hard creases, so an extruded polygon is correct.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.15, 0.28], [-1.85, 0.9], [-1.17, 0.9], [-1.01, 0.28], [-1.15, 0.1], [-2.05, 0.1]], "depth": 0.6}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-base-housing-mount", "structuralParent": "root", "localStart": [0, 0, 0.175], "localEnd": [0, 0, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.175], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-base-vents", "kind": "linework", "description": "two banks of 4 yellow louvre slats flanking the base housing", "technique": "engraved-groove", "count": 8, "detailRefs": ["d14"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14", "d15"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_housing_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_mast_base_housing_29);
  nodes["mast-base-housing"] = node_mast_base_housing_29;
  const mesh_mast_base_housing_29Geometry = endpoint_mast_base_housing_29
    ? new THREE.CylinderGeometry(endpoint_mast_base_housing_29.endRadius, endpoint_mast_base_housing_29.baseRadius, endpoint_mast_base_housing_29.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.15, 0.28], [-1.85, 0.9], [-1.17, 0.9], [-1.01, 0.28], [-1.15, 0.1], [-2.05, 0.1]], "depth": 0.6});
  const mesh_mast_base_housing_29 = new THREE.Mesh(
    mesh_mast_base_housing_29Geometry,
    materialMap["hull-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_housing_29.name = "Mast base housing";
  if (endpoint_mast_base_housing_29) {
    mesh_mast_base_housing_29.position.copy(endpoint_mast_base_housing_29.midpoint);
    mesh_mast_base_housing_29.quaternion.copy(endpoint_mast_base_housing_29.quaternion);
  }
  mesh_mast_base_housing_29.castShadow = options.castShadow ?? true;
  mesh_mast_base_housing_29.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_housing_29.userData.sculptComponent = {"id": "mast-base-housing", "name": "Mast base housing", "level": "meso", "role": "structure", "logicalParent": "root", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Faceted pyramidal housing; planar facets with hard creases, so an extruded polygon is correct.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-2.15, 0.28], [-1.85, 0.9], [-1.17, 0.9], [-1.01, 0.28], [-1.15, 0.1], [-2.05, 0.1]], "depth": 0.6}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/mast-base-housing-mount", "structuralParent": "root", "localStart": [0, 0, 0.175], "localEnd": [0, 0, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0.175], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-grey", "materialLayers": ["hull-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mast-base-vents", "kind": "linework", "description": "two banks of 4 yellow louvre slats flanking the base housing", "technique": "engraved-groove", "count": 8, "detailRefs": ["d14"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14", "d15"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 119, 109, 1.0)", "secondaryAlbedo": "rgba(154, 146, 136, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.68, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(126, 119, 109, 1.0)"}, {"position": 1.0, "color": "rgba(154, 146, 136, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["bow-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_housing_29.add(mesh_mast_base_housing_29);
  meshes["mast-base-housing"] = mesh_mast_base_housing_29;
  colliders["mast-base-housing"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_01_30 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-01-mount", "structuralParent": "pod-cradle", "localStart": [-2.4, -0.85, 0.815], "localEnd": [-2.4, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_01_30 = makeAttachmentEndpoint(attachment_bladder_pod_01_30);
  const node_bladder_pod_01_30 = new THREE.Group();
  node_bladder_pod_01_30.name = "Bladder pod 1__pivot";
  if (endpoint_bladder_pod_01_30) {
    node_bladder_pod_01_30.position.copy(endpoint_bladder_pod_01_30.start);
    node_bladder_pod_01_30.rotation.set(0, 0, 0);
    node_bladder_pod_01_30.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_01_30.position.set(-2.4, -0.85, 0.815);
    node_bladder_pod_01_30.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_01_30.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_01_30.userData.sculptComponent = {"id": "bladder-pod-01", "name": "Bladder pod 1", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-01-mount", "structuralParent": "pod-cradle", "localStart": [-2.4, -0.85, 0.815], "localEnd": [-2.4, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-2.4, -0.85, 0.815], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-01", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_01_30.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-01", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_01_30);
  nodes["bladder-pod-01"] = node_bladder_pod_01_30;
  const mesh_bladder_pod_01_30Geometry = endpoint_bladder_pod_01_30
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_01_30.endRadius, endpoint_bladder_pod_01_30.baseRadius, endpoint_bladder_pod_01_30.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_01_30 = new THREE.Mesh(
    mesh_bladder_pod_01_30Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_01_30.name = "Bladder pod 1";
  if (endpoint_bladder_pod_01_30) {
    mesh_bladder_pod_01_30.position.copy(endpoint_bladder_pod_01_30.midpoint);
    mesh_bladder_pod_01_30.quaternion.copy(endpoint_bladder_pod_01_30.quaternion);
  }
  mesh_bladder_pod_01_30.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_01_30.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_01_30.userData.sculptComponent = {"id": "bladder-pod-01", "name": "Bladder pod 1", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-01-mount", "structuralParent": "pod-cradle", "localStart": [-2.4, -0.85, 0.815], "localEnd": [-2.4, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-2.4, -0.85, 0.815], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-01", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_01_30.add(mesh_bladder_pod_01_30);
  meshes["bladder-pod-01"] = mesh_bladder_pod_01_30;
  colliders["bladder-pod-01"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_01_pod_mount_01_0 = new THREE.Object3D();
  socket_bladder_pod_01_pod_mount_01_0.name = "pod-mount-01";
  socket_bladder_pod_01_pod_mount_01_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_01_pod_mount_01_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_01_pod_mount_01_0.userData.socket = {"id": "pod-mount-01", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_01_30.add(socket_bladder_pod_01_pod_mount_01_0);
  sockets["bladder-pod-01:pod-mount-01"] = socket_bladder_pod_01_pod_mount_01_0;

  const attachment_pod_strap_01a_31 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-01a-mount", "structuralParent": "pod-cradle", "localStart": [-2.68, -0.85, 0.815], "localEnd": [-2.68, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_01a_31 = makeAttachmentEndpoint(attachment_pod_strap_01a_31);
  const node_pod_strap_01a_31 = new THREE.Group();
  node_pod_strap_01a_31.name = "Pod strap 1a__pivot";
  if (endpoint_pod_strap_01a_31) {
    node_pod_strap_01a_31.position.copy(endpoint_pod_strap_01a_31.start);
    node_pod_strap_01a_31.rotation.set(0, 0, 0);
    node_pod_strap_01a_31.scale.set(1, 1, 1);
  } else {
    node_pod_strap_01a_31.position.set(-2.6799999999999997, -0.85, 0.815);
    node_pod_strap_01a_31.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_01a_31.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_01a_31.userData.sculptComponent = {"id": "pod-strap-01a", "name": "Pod strap 1a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-01a-mount", "structuralParent": "pod-cradle", "localStart": [-2.68, -0.85, 0.815], "localEnd": [-2.68, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.6799999999999997, -0.85, 0.815], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_01a_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_01a_31);
  nodes["pod-strap-01a"] = node_pod_strap_01a_31;
  const mesh_pod_strap_01a_31Geometry = endpoint_pod_strap_01a_31
    ? new THREE.CylinderGeometry(endpoint_pod_strap_01a_31.endRadius, endpoint_pod_strap_01a_31.baseRadius, endpoint_pod_strap_01a_31.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_01a_31 = new THREE.Mesh(
    mesh_pod_strap_01a_31Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_01a_31.name = "Pod strap 1a";
  if (endpoint_pod_strap_01a_31) {
    mesh_pod_strap_01a_31.position.copy(endpoint_pod_strap_01a_31.midpoint);
    mesh_pod_strap_01a_31.quaternion.copy(endpoint_pod_strap_01a_31.quaternion);
  }
  mesh_pod_strap_01a_31.castShadow = options.castShadow ?? true;
  mesh_pod_strap_01a_31.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_01a_31.userData.sculptComponent = {"id": "pod-strap-01a", "name": "Pod strap 1a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-01a-mount", "structuralParent": "pod-cradle", "localStart": [-2.68, -0.85, 0.815], "localEnd": [-2.68, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.6799999999999997, -0.85, 0.815], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_01a_31.add(mesh_pod_strap_01a_31);
  meshes["pod-strap-01a"] = mesh_pod_strap_01a_31;
  colliders["pod-strap-01a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_01b_32 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-01b-mount", "structuralParent": "pod-cradle", "localStart": [-2.12, -0.85, 0.815], "localEnd": [-2.12, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_01b_32 = makeAttachmentEndpoint(attachment_pod_strap_01b_32);
  const node_pod_strap_01b_32 = new THREE.Group();
  node_pod_strap_01b_32.name = "Pod strap 1b__pivot";
  if (endpoint_pod_strap_01b_32) {
    node_pod_strap_01b_32.position.copy(endpoint_pod_strap_01b_32.start);
    node_pod_strap_01b_32.rotation.set(0, 0, 0);
    node_pod_strap_01b_32.scale.set(1, 1, 1);
  } else {
    node_pod_strap_01b_32.position.set(-2.12, -0.85, 0.815);
    node_pod_strap_01b_32.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_01b_32.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_01b_32.userData.sculptComponent = {"id": "pod-strap-01b", "name": "Pod strap 1b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-01b-mount", "structuralParent": "pod-cradle", "localStart": [-2.12, -0.85, 0.815], "localEnd": [-2.12, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.12, -0.85, 0.815], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_01b_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_01b_32);
  nodes["pod-strap-01b"] = node_pod_strap_01b_32;
  const mesh_pod_strap_01b_32Geometry = endpoint_pod_strap_01b_32
    ? new THREE.CylinderGeometry(endpoint_pod_strap_01b_32.endRadius, endpoint_pod_strap_01b_32.baseRadius, endpoint_pod_strap_01b_32.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_01b_32 = new THREE.Mesh(
    mesh_pod_strap_01b_32Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_01b_32.name = "Pod strap 1b";
  if (endpoint_pod_strap_01b_32) {
    mesh_pod_strap_01b_32.position.copy(endpoint_pod_strap_01b_32.midpoint);
    mesh_pod_strap_01b_32.quaternion.copy(endpoint_pod_strap_01b_32.quaternion);
  }
  mesh_pod_strap_01b_32.castShadow = options.castShadow ?? true;
  mesh_pod_strap_01b_32.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_01b_32.userData.sculptComponent = {"id": "pod-strap-01b", "name": "Pod strap 1b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-01b-mount", "structuralParent": "pod-cradle", "localStart": [-2.12, -0.85, 0.815], "localEnd": [-2.12, -0.85, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.12, -0.85, 0.815], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_01b_32.add(mesh_pod_strap_01b_32);
  meshes["pod-strap-01b"] = mesh_pod_strap_01b_32;
  colliders["pod-strap-01b"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_02_33 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-02-mount", "structuralParent": "pod-cradle", "localStart": [-1.55, -0.89, 0.785], "localEnd": [-1.55, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_02_33 = makeAttachmentEndpoint(attachment_bladder_pod_02_33);
  const node_bladder_pod_02_33 = new THREE.Group();
  node_bladder_pod_02_33.name = "Bladder pod 2__pivot";
  if (endpoint_bladder_pod_02_33) {
    node_bladder_pod_02_33.position.copy(endpoint_bladder_pod_02_33.start);
    node_bladder_pod_02_33.rotation.set(0, 0, 0);
    node_bladder_pod_02_33.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_02_33.position.set(-1.55, -0.89, 0.7849999999999999);
    node_bladder_pod_02_33.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_02_33.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_02_33.userData.sculptComponent = {"id": "bladder-pod-02", "name": "Bladder pod 2", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-02-mount", "structuralParent": "pod-cradle", "localStart": [-1.55, -0.89, 0.785], "localEnd": [-1.55, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.55, -0.89, 0.7849999999999999], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-02", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_02_33.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-02", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_02_33);
  nodes["bladder-pod-02"] = node_bladder_pod_02_33;
  const mesh_bladder_pod_02_33Geometry = endpoint_bladder_pod_02_33
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_02_33.endRadius, endpoint_bladder_pod_02_33.baseRadius, endpoint_bladder_pod_02_33.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_02_33 = new THREE.Mesh(
    mesh_bladder_pod_02_33Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_02_33.name = "Bladder pod 2";
  if (endpoint_bladder_pod_02_33) {
    mesh_bladder_pod_02_33.position.copy(endpoint_bladder_pod_02_33.midpoint);
    mesh_bladder_pod_02_33.quaternion.copy(endpoint_bladder_pod_02_33.quaternion);
  }
  mesh_bladder_pod_02_33.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_02_33.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_02_33.userData.sculptComponent = {"id": "bladder-pod-02", "name": "Bladder pod 2", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-02-mount", "structuralParent": "pod-cradle", "localStart": [-1.55, -0.89, 0.785], "localEnd": [-1.55, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.55, -0.89, 0.7849999999999999], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-02", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_02_33.add(mesh_bladder_pod_02_33);
  meshes["bladder-pod-02"] = mesh_bladder_pod_02_33;
  colliders["bladder-pod-02"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_02_pod_mount_02_0 = new THREE.Object3D();
  socket_bladder_pod_02_pod_mount_02_0.name = "pod-mount-02";
  socket_bladder_pod_02_pod_mount_02_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_02_pod_mount_02_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_02_pod_mount_02_0.userData.socket = {"id": "pod-mount-02", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_02_33.add(socket_bladder_pod_02_pod_mount_02_0);
  sockets["bladder-pod-02:pod-mount-02"] = socket_bladder_pod_02_pod_mount_02_0;

  const attachment_pod_strap_02a_34 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-02a-mount", "structuralParent": "pod-cradle", "localStart": [-1.83, -0.89, 0.785], "localEnd": [-1.83, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_02a_34 = makeAttachmentEndpoint(attachment_pod_strap_02a_34);
  const node_pod_strap_02a_34 = new THREE.Group();
  node_pod_strap_02a_34.name = "Pod strap 2a__pivot";
  if (endpoint_pod_strap_02a_34) {
    node_pod_strap_02a_34.position.copy(endpoint_pod_strap_02a_34.start);
    node_pod_strap_02a_34.rotation.set(0, 0, 0);
    node_pod_strap_02a_34.scale.set(1, 1, 1);
  } else {
    node_pod_strap_02a_34.position.set(-1.83, -0.89, 0.7849999999999999);
    node_pod_strap_02a_34.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_02a_34.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_02a_34.userData.sculptComponent = {"id": "pod-strap-02a", "name": "Pod strap 2a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-02a-mount", "structuralParent": "pod-cradle", "localStart": [-1.83, -0.89, 0.785], "localEnd": [-1.83, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.83, -0.89, 0.7849999999999999], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_02a_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_02a_34);
  nodes["pod-strap-02a"] = node_pod_strap_02a_34;
  const mesh_pod_strap_02a_34Geometry = endpoint_pod_strap_02a_34
    ? new THREE.CylinderGeometry(endpoint_pod_strap_02a_34.endRadius, endpoint_pod_strap_02a_34.baseRadius, endpoint_pod_strap_02a_34.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_02a_34 = new THREE.Mesh(
    mesh_pod_strap_02a_34Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_02a_34.name = "Pod strap 2a";
  if (endpoint_pod_strap_02a_34) {
    mesh_pod_strap_02a_34.position.copy(endpoint_pod_strap_02a_34.midpoint);
    mesh_pod_strap_02a_34.quaternion.copy(endpoint_pod_strap_02a_34.quaternion);
  }
  mesh_pod_strap_02a_34.castShadow = options.castShadow ?? true;
  mesh_pod_strap_02a_34.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_02a_34.userData.sculptComponent = {"id": "pod-strap-02a", "name": "Pod strap 2a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-02a-mount", "structuralParent": "pod-cradle", "localStart": [-1.83, -0.89, 0.785], "localEnd": [-1.83, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.83, -0.89, 0.7849999999999999], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_02a_34.add(mesh_pod_strap_02a_34);
  meshes["pod-strap-02a"] = mesh_pod_strap_02a_34;
  colliders["pod-strap-02a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_02b_35 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-02b-mount", "structuralParent": "pod-cradle", "localStart": [-1.27, -0.89, 0.785], "localEnd": [-1.27, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_02b_35 = makeAttachmentEndpoint(attachment_pod_strap_02b_35);
  const node_pod_strap_02b_35 = new THREE.Group();
  node_pod_strap_02b_35.name = "Pod strap 2b__pivot";
  if (endpoint_pod_strap_02b_35) {
    node_pod_strap_02b_35.position.copy(endpoint_pod_strap_02b_35.start);
    node_pod_strap_02b_35.rotation.set(0, 0, 0);
    node_pod_strap_02b_35.scale.set(1, 1, 1);
  } else {
    node_pod_strap_02b_35.position.set(-1.27, -0.89, 0.7849999999999999);
    node_pod_strap_02b_35.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_02b_35.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_02b_35.userData.sculptComponent = {"id": "pod-strap-02b", "name": "Pod strap 2b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-02b-mount", "structuralParent": "pod-cradle", "localStart": [-1.27, -0.89, 0.785], "localEnd": [-1.27, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.27, -0.89, 0.7849999999999999], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_02b_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_02b_35);
  nodes["pod-strap-02b"] = node_pod_strap_02b_35;
  const mesh_pod_strap_02b_35Geometry = endpoint_pod_strap_02b_35
    ? new THREE.CylinderGeometry(endpoint_pod_strap_02b_35.endRadius, endpoint_pod_strap_02b_35.baseRadius, endpoint_pod_strap_02b_35.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_02b_35 = new THREE.Mesh(
    mesh_pod_strap_02b_35Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_02b_35.name = "Pod strap 2b";
  if (endpoint_pod_strap_02b_35) {
    mesh_pod_strap_02b_35.position.copy(endpoint_pod_strap_02b_35.midpoint);
    mesh_pod_strap_02b_35.quaternion.copy(endpoint_pod_strap_02b_35.quaternion);
  }
  mesh_pod_strap_02b_35.castShadow = options.castShadow ?? true;
  mesh_pod_strap_02b_35.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_02b_35.userData.sculptComponent = {"id": "pod-strap-02b", "name": "Pod strap 2b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-02b-mount", "structuralParent": "pod-cradle", "localStart": [-1.27, -0.89, 0.785], "localEnd": [-1.27, -0.89, 0.785], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.27, -0.89, 0.7849999999999999], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_02b_35.add(mesh_pod_strap_02b_35);
  meshes["pod-strap-02b"] = mesh_pod_strap_02b_35;
  colliders["pod-strap-02b"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_03_36 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-03-mount", "structuralParent": "pod-cradle", "localStart": [-0.68, -0.87, 0.755], "localEnd": [-0.68, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_03_36 = makeAttachmentEndpoint(attachment_bladder_pod_03_36);
  const node_bladder_pod_03_36 = new THREE.Group();
  node_bladder_pod_03_36.name = "Bladder pod 3__pivot";
  if (endpoint_bladder_pod_03_36) {
    node_bladder_pod_03_36.position.copy(endpoint_bladder_pod_03_36.start);
    node_bladder_pod_03_36.rotation.set(0, 0, 0);
    node_bladder_pod_03_36.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_03_36.position.set(-0.68, -0.87, 0.755);
    node_bladder_pod_03_36.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_03_36.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_03_36.userData.sculptComponent = {"id": "bladder-pod-03", "name": "Bladder pod 3", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-03-mount", "structuralParent": "pod-cradle", "localStart": [-0.68, -0.87, 0.755], "localEnd": [-0.68, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.68, -0.87, 0.755], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-03", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_03_36.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-03", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_03_36);
  nodes["bladder-pod-03"] = node_bladder_pod_03_36;
  const mesh_bladder_pod_03_36Geometry = endpoint_bladder_pod_03_36
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_03_36.endRadius, endpoint_bladder_pod_03_36.baseRadius, endpoint_bladder_pod_03_36.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_03_36 = new THREE.Mesh(
    mesh_bladder_pod_03_36Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_03_36.name = "Bladder pod 3";
  if (endpoint_bladder_pod_03_36) {
    mesh_bladder_pod_03_36.position.copy(endpoint_bladder_pod_03_36.midpoint);
    mesh_bladder_pod_03_36.quaternion.copy(endpoint_bladder_pod_03_36.quaternion);
  }
  mesh_bladder_pod_03_36.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_03_36.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_03_36.userData.sculptComponent = {"id": "bladder-pod-03", "name": "Bladder pod 3", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-03-mount", "structuralParent": "pod-cradle", "localStart": [-0.68, -0.87, 0.755], "localEnd": [-0.68, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.68, -0.87, 0.755], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-03", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_03_36.add(mesh_bladder_pod_03_36);
  meshes["bladder-pod-03"] = mesh_bladder_pod_03_36;
  colliders["bladder-pod-03"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_03_pod_mount_03_0 = new THREE.Object3D();
  socket_bladder_pod_03_pod_mount_03_0.name = "pod-mount-03";
  socket_bladder_pod_03_pod_mount_03_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_03_pod_mount_03_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_03_pod_mount_03_0.userData.socket = {"id": "pod-mount-03", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_03_36.add(socket_bladder_pod_03_pod_mount_03_0);
  sockets["bladder-pod-03:pod-mount-03"] = socket_bladder_pod_03_pod_mount_03_0;

  const attachment_pod_strap_03a_37 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-03a-mount", "structuralParent": "pod-cradle", "localStart": [-0.96, -0.87, 0.755], "localEnd": [-0.96, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_03a_37 = makeAttachmentEndpoint(attachment_pod_strap_03a_37);
  const node_pod_strap_03a_37 = new THREE.Group();
  node_pod_strap_03a_37.name = "Pod strap 3a__pivot";
  if (endpoint_pod_strap_03a_37) {
    node_pod_strap_03a_37.position.copy(endpoint_pod_strap_03a_37.start);
    node_pod_strap_03a_37.rotation.set(0, 0, 0);
    node_pod_strap_03a_37.scale.set(1, 1, 1);
  } else {
    node_pod_strap_03a_37.position.set(-0.9600000000000001, -0.87, 0.755);
    node_pod_strap_03a_37.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_03a_37.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_03a_37.userData.sculptComponent = {"id": "pod-strap-03a", "name": "Pod strap 3a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-03a-mount", "structuralParent": "pod-cradle", "localStart": [-0.96, -0.87, 0.755], "localEnd": [-0.96, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.9600000000000001, -0.87, 0.755], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_03a_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_03a_37);
  nodes["pod-strap-03a"] = node_pod_strap_03a_37;
  const mesh_pod_strap_03a_37Geometry = endpoint_pod_strap_03a_37
    ? new THREE.CylinderGeometry(endpoint_pod_strap_03a_37.endRadius, endpoint_pod_strap_03a_37.baseRadius, endpoint_pod_strap_03a_37.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_03a_37 = new THREE.Mesh(
    mesh_pod_strap_03a_37Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_03a_37.name = "Pod strap 3a";
  if (endpoint_pod_strap_03a_37) {
    mesh_pod_strap_03a_37.position.copy(endpoint_pod_strap_03a_37.midpoint);
    mesh_pod_strap_03a_37.quaternion.copy(endpoint_pod_strap_03a_37.quaternion);
  }
  mesh_pod_strap_03a_37.castShadow = options.castShadow ?? true;
  mesh_pod_strap_03a_37.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_03a_37.userData.sculptComponent = {"id": "pod-strap-03a", "name": "Pod strap 3a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-03a-mount", "structuralParent": "pod-cradle", "localStart": [-0.96, -0.87, 0.755], "localEnd": [-0.96, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.9600000000000001, -0.87, 0.755], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_03a_37.add(mesh_pod_strap_03a_37);
  meshes["pod-strap-03a"] = mesh_pod_strap_03a_37;
  colliders["pod-strap-03a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_03b_38 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-03b-mount", "structuralParent": "pod-cradle", "localStart": [-0.4, -0.87, 0.755], "localEnd": [-0.4, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_03b_38 = makeAttachmentEndpoint(attachment_pod_strap_03b_38);
  const node_pod_strap_03b_38 = new THREE.Group();
  node_pod_strap_03b_38.name = "Pod strap 3b__pivot";
  if (endpoint_pod_strap_03b_38) {
    node_pod_strap_03b_38.position.copy(endpoint_pod_strap_03b_38.start);
    node_pod_strap_03b_38.rotation.set(0, 0, 0);
    node_pod_strap_03b_38.scale.set(1, 1, 1);
  } else {
    node_pod_strap_03b_38.position.set(-0.4, -0.87, 0.755);
    node_pod_strap_03b_38.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_03b_38.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_03b_38.userData.sculptComponent = {"id": "pod-strap-03b", "name": "Pod strap 3b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-03b-mount", "structuralParent": "pod-cradle", "localStart": [-0.4, -0.87, 0.755], "localEnd": [-0.4, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4, -0.87, 0.755], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_03b_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_03b_38);
  nodes["pod-strap-03b"] = node_pod_strap_03b_38;
  const mesh_pod_strap_03b_38Geometry = endpoint_pod_strap_03b_38
    ? new THREE.CylinderGeometry(endpoint_pod_strap_03b_38.endRadius, endpoint_pod_strap_03b_38.baseRadius, endpoint_pod_strap_03b_38.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_03b_38 = new THREE.Mesh(
    mesh_pod_strap_03b_38Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_03b_38.name = "Pod strap 3b";
  if (endpoint_pod_strap_03b_38) {
    mesh_pod_strap_03b_38.position.copy(endpoint_pod_strap_03b_38.midpoint);
    mesh_pod_strap_03b_38.quaternion.copy(endpoint_pod_strap_03b_38.quaternion);
  }
  mesh_pod_strap_03b_38.castShadow = options.castShadow ?? true;
  mesh_pod_strap_03b_38.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_03b_38.userData.sculptComponent = {"id": "pod-strap-03b", "name": "Pod strap 3b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-03b-mount", "structuralParent": "pod-cradle", "localStart": [-0.4, -0.87, 0.755], "localEnd": [-0.4, -0.87, 0.755], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4, -0.87, 0.755], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_03b_38.add(mesh_pod_strap_03b_38);
  meshes["pod-strap-03b"] = mesh_pod_strap_03b_38;
  colliders["pod-strap-03b"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_04_39 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-04-mount", "structuralParent": "pod-cradle", "localStart": [0.15, -0.79, 0.725], "localEnd": [0.15, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_04_39 = makeAttachmentEndpoint(attachment_bladder_pod_04_39);
  const node_bladder_pod_04_39 = new THREE.Group();
  node_bladder_pod_04_39.name = "Bladder pod 4__pivot";
  if (endpoint_bladder_pod_04_39) {
    node_bladder_pod_04_39.position.copy(endpoint_bladder_pod_04_39.start);
    node_bladder_pod_04_39.rotation.set(0, 0, 0);
    node_bladder_pod_04_39.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_04_39.position.set(0.15, -0.79, 0.725);
    node_bladder_pod_04_39.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_04_39.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_04_39.userData.sculptComponent = {"id": "bladder-pod-04", "name": "Bladder pod 4", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-04-mount", "structuralParent": "pod-cradle", "localStart": [0.15, -0.79, 0.725], "localEnd": [0.15, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.15, -0.79, 0.725], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-04", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_04_39.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-04", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_04_39);
  nodes["bladder-pod-04"] = node_bladder_pod_04_39;
  const mesh_bladder_pod_04_39Geometry = endpoint_bladder_pod_04_39
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_04_39.endRadius, endpoint_bladder_pod_04_39.baseRadius, endpoint_bladder_pod_04_39.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_04_39 = new THREE.Mesh(
    mesh_bladder_pod_04_39Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_04_39.name = "Bladder pod 4";
  if (endpoint_bladder_pod_04_39) {
    mesh_bladder_pod_04_39.position.copy(endpoint_bladder_pod_04_39.midpoint);
    mesh_bladder_pod_04_39.quaternion.copy(endpoint_bladder_pod_04_39.quaternion);
  }
  mesh_bladder_pod_04_39.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_04_39.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_04_39.userData.sculptComponent = {"id": "bladder-pod-04", "name": "Bladder pod 4", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-04-mount", "structuralParent": "pod-cradle", "localStart": [0.15, -0.79, 0.725], "localEnd": [0.15, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.15, -0.79, 0.725], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-04", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_04_39.add(mesh_bladder_pod_04_39);
  meshes["bladder-pod-04"] = mesh_bladder_pod_04_39;
  colliders["bladder-pod-04"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_04_pod_mount_04_0 = new THREE.Object3D();
  socket_bladder_pod_04_pod_mount_04_0.name = "pod-mount-04";
  socket_bladder_pod_04_pod_mount_04_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_04_pod_mount_04_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_04_pod_mount_04_0.userData.socket = {"id": "pod-mount-04", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_04_39.add(socket_bladder_pod_04_pod_mount_04_0);
  sockets["bladder-pod-04:pod-mount-04"] = socket_bladder_pod_04_pod_mount_04_0;

  const attachment_pod_strap_04a_40 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-04a-mount", "structuralParent": "pod-cradle", "localStart": [-0.13, -0.79, 0.725], "localEnd": [-0.13, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_04a_40 = makeAttachmentEndpoint(attachment_pod_strap_04a_40);
  const node_pod_strap_04a_40 = new THREE.Group();
  node_pod_strap_04a_40.name = "Pod strap 4a__pivot";
  if (endpoint_pod_strap_04a_40) {
    node_pod_strap_04a_40.position.copy(endpoint_pod_strap_04a_40.start);
    node_pod_strap_04a_40.rotation.set(0, 0, 0);
    node_pod_strap_04a_40.scale.set(1, 1, 1);
  } else {
    node_pod_strap_04a_40.position.set(-0.13000000000000003, -0.79, 0.725);
    node_pod_strap_04a_40.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_04a_40.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_04a_40.userData.sculptComponent = {"id": "pod-strap-04a", "name": "Pod strap 4a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-04a-mount", "structuralParent": "pod-cradle", "localStart": [-0.13, -0.79, 0.725], "localEnd": [-0.13, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.13000000000000003, -0.79, 0.725], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_04a_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_04a_40);
  nodes["pod-strap-04a"] = node_pod_strap_04a_40;
  const mesh_pod_strap_04a_40Geometry = endpoint_pod_strap_04a_40
    ? new THREE.CylinderGeometry(endpoint_pod_strap_04a_40.endRadius, endpoint_pod_strap_04a_40.baseRadius, endpoint_pod_strap_04a_40.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_04a_40 = new THREE.Mesh(
    mesh_pod_strap_04a_40Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_04a_40.name = "Pod strap 4a";
  if (endpoint_pod_strap_04a_40) {
    mesh_pod_strap_04a_40.position.copy(endpoint_pod_strap_04a_40.midpoint);
    mesh_pod_strap_04a_40.quaternion.copy(endpoint_pod_strap_04a_40.quaternion);
  }
  mesh_pod_strap_04a_40.castShadow = options.castShadow ?? true;
  mesh_pod_strap_04a_40.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_04a_40.userData.sculptComponent = {"id": "pod-strap-04a", "name": "Pod strap 4a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-04a-mount", "structuralParent": "pod-cradle", "localStart": [-0.13, -0.79, 0.725], "localEnd": [-0.13, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.13000000000000003, -0.79, 0.725], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_04a_40.add(mesh_pod_strap_04a_40);
  meshes["pod-strap-04a"] = mesh_pod_strap_04a_40;
  colliders["pod-strap-04a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_04b_41 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-04b-mount", "structuralParent": "pod-cradle", "localStart": [0.43, -0.79, 0.725], "localEnd": [0.43, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_04b_41 = makeAttachmentEndpoint(attachment_pod_strap_04b_41);
  const node_pod_strap_04b_41 = new THREE.Group();
  node_pod_strap_04b_41.name = "Pod strap 4b__pivot";
  if (endpoint_pod_strap_04b_41) {
    node_pod_strap_04b_41.position.copy(endpoint_pod_strap_04b_41.start);
    node_pod_strap_04b_41.rotation.set(0, 0, 0);
    node_pod_strap_04b_41.scale.set(1, 1, 1);
  } else {
    node_pod_strap_04b_41.position.set(0.43000000000000005, -0.79, 0.725);
    node_pod_strap_04b_41.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_04b_41.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_04b_41.userData.sculptComponent = {"id": "pod-strap-04b", "name": "Pod strap 4b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-04b-mount", "structuralParent": "pod-cradle", "localStart": [0.43, -0.79, 0.725], "localEnd": [0.43, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.43000000000000005, -0.79, 0.725], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_04b_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_04b_41);
  nodes["pod-strap-04b"] = node_pod_strap_04b_41;
  const mesh_pod_strap_04b_41Geometry = endpoint_pod_strap_04b_41
    ? new THREE.CylinderGeometry(endpoint_pod_strap_04b_41.endRadius, endpoint_pod_strap_04b_41.baseRadius, endpoint_pod_strap_04b_41.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_04b_41 = new THREE.Mesh(
    mesh_pod_strap_04b_41Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_04b_41.name = "Pod strap 4b";
  if (endpoint_pod_strap_04b_41) {
    mesh_pod_strap_04b_41.position.copy(endpoint_pod_strap_04b_41.midpoint);
    mesh_pod_strap_04b_41.quaternion.copy(endpoint_pod_strap_04b_41.quaternion);
  }
  mesh_pod_strap_04b_41.castShadow = options.castShadow ?? true;
  mesh_pod_strap_04b_41.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_04b_41.userData.sculptComponent = {"id": "pod-strap-04b", "name": "Pod strap 4b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-04b-mount", "structuralParent": "pod-cradle", "localStart": [0.43, -0.79, 0.725], "localEnd": [0.43, -0.79, 0.725], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.43000000000000005, -0.79, 0.725], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_04b_41.add(mesh_pod_strap_04b_41);
  meshes["pod-strap-04b"] = mesh_pod_strap_04b_41;
  colliders["pod-strap-04b"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_05_42 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-05-mount", "structuralParent": "pod-cradle", "localStart": [-2.0, -0.72, 0.195], "localEnd": [-2.0, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_05_42 = makeAttachmentEndpoint(attachment_bladder_pod_05_42);
  const node_bladder_pod_05_42 = new THREE.Group();
  node_bladder_pod_05_42.name = "Bladder pod 5__pivot";
  if (endpoint_bladder_pod_05_42) {
    node_bladder_pod_05_42.position.copy(endpoint_bladder_pod_05_42.start);
    node_bladder_pod_05_42.rotation.set(0, 0, 0);
    node_bladder_pod_05_42.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_05_42.position.set(-2.0, -0.72, 0.19499999999999995);
    node_bladder_pod_05_42.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_05_42.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_05_42.userData.sculptComponent = {"id": "bladder-pod-05", "name": "Bladder pod 5", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-05-mount", "structuralParent": "pod-cradle", "localStart": [-2.0, -0.72, 0.195], "localEnd": [-2.0, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-2.0, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-05", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_05_42.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-05", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_05_42);
  nodes["bladder-pod-05"] = node_bladder_pod_05_42;
  const mesh_bladder_pod_05_42Geometry = endpoint_bladder_pod_05_42
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_05_42.endRadius, endpoint_bladder_pod_05_42.baseRadius, endpoint_bladder_pod_05_42.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_05_42 = new THREE.Mesh(
    mesh_bladder_pod_05_42Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_05_42.name = "Bladder pod 5";
  if (endpoint_bladder_pod_05_42) {
    mesh_bladder_pod_05_42.position.copy(endpoint_bladder_pod_05_42.midpoint);
    mesh_bladder_pod_05_42.quaternion.copy(endpoint_bladder_pod_05_42.quaternion);
  }
  mesh_bladder_pod_05_42.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_05_42.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_05_42.userData.sculptComponent = {"id": "bladder-pod-05", "name": "Bladder pod 5", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-05-mount", "structuralParent": "pod-cradle", "localStart": [-2.0, -0.72, 0.195], "localEnd": [-2.0, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-2.0, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-05", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_05_42.add(mesh_bladder_pod_05_42);
  meshes["bladder-pod-05"] = mesh_bladder_pod_05_42;
  colliders["bladder-pod-05"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_05_pod_mount_05_0 = new THREE.Object3D();
  socket_bladder_pod_05_pod_mount_05_0.name = "pod-mount-05";
  socket_bladder_pod_05_pod_mount_05_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_05_pod_mount_05_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_05_pod_mount_05_0.userData.socket = {"id": "pod-mount-05", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_05_42.add(socket_bladder_pod_05_pod_mount_05_0);
  sockets["bladder-pod-05:pod-mount-05"] = socket_bladder_pod_05_pod_mount_05_0;

  const attachment_pod_strap_05a_43 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-05a-mount", "structuralParent": "pod-cradle", "localStart": [-2.28, -0.72, 0.195], "localEnd": [-2.28, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_05a_43 = makeAttachmentEndpoint(attachment_pod_strap_05a_43);
  const node_pod_strap_05a_43 = new THREE.Group();
  node_pod_strap_05a_43.name = "Pod strap 5a__pivot";
  if (endpoint_pod_strap_05a_43) {
    node_pod_strap_05a_43.position.copy(endpoint_pod_strap_05a_43.start);
    node_pod_strap_05a_43.rotation.set(0, 0, 0);
    node_pod_strap_05a_43.scale.set(1, 1, 1);
  } else {
    node_pod_strap_05a_43.position.set(-2.2800000000000002, -0.72, 0.19499999999999995);
    node_pod_strap_05a_43.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_05a_43.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_05a_43.userData.sculptComponent = {"id": "pod-strap-05a", "name": "Pod strap 5a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-05a-mount", "structuralParent": "pod-cradle", "localStart": [-2.28, -0.72, 0.195], "localEnd": [-2.28, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.2800000000000002, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_05a_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_05a_43);
  nodes["pod-strap-05a"] = node_pod_strap_05a_43;
  const mesh_pod_strap_05a_43Geometry = endpoint_pod_strap_05a_43
    ? new THREE.CylinderGeometry(endpoint_pod_strap_05a_43.endRadius, endpoint_pod_strap_05a_43.baseRadius, endpoint_pod_strap_05a_43.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_05a_43 = new THREE.Mesh(
    mesh_pod_strap_05a_43Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_05a_43.name = "Pod strap 5a";
  if (endpoint_pod_strap_05a_43) {
    mesh_pod_strap_05a_43.position.copy(endpoint_pod_strap_05a_43.midpoint);
    mesh_pod_strap_05a_43.quaternion.copy(endpoint_pod_strap_05a_43.quaternion);
  }
  mesh_pod_strap_05a_43.castShadow = options.castShadow ?? true;
  mesh_pod_strap_05a_43.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_05a_43.userData.sculptComponent = {"id": "pod-strap-05a", "name": "Pod strap 5a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-05a-mount", "structuralParent": "pod-cradle", "localStart": [-2.28, -0.72, 0.195], "localEnd": [-2.28, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-2.2800000000000002, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_05a_43.add(mesh_pod_strap_05a_43);
  meshes["pod-strap-05a"] = mesh_pod_strap_05a_43;
  colliders["pod-strap-05a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_05b_44 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-05b-mount", "structuralParent": "pod-cradle", "localStart": [-1.72, -0.72, 0.195], "localEnd": [-1.72, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_05b_44 = makeAttachmentEndpoint(attachment_pod_strap_05b_44);
  const node_pod_strap_05b_44 = new THREE.Group();
  node_pod_strap_05b_44.name = "Pod strap 5b__pivot";
  if (endpoint_pod_strap_05b_44) {
    node_pod_strap_05b_44.position.copy(endpoint_pod_strap_05b_44.start);
    node_pod_strap_05b_44.rotation.set(0, 0, 0);
    node_pod_strap_05b_44.scale.set(1, 1, 1);
  } else {
    node_pod_strap_05b_44.position.set(-1.72, -0.72, 0.19499999999999995);
    node_pod_strap_05b_44.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_05b_44.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_05b_44.userData.sculptComponent = {"id": "pod-strap-05b", "name": "Pod strap 5b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-05b-mount", "structuralParent": "pod-cradle", "localStart": [-1.72, -0.72, 0.195], "localEnd": [-1.72, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.72, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_05b_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_05b_44);
  nodes["pod-strap-05b"] = node_pod_strap_05b_44;
  const mesh_pod_strap_05b_44Geometry = endpoint_pod_strap_05b_44
    ? new THREE.CylinderGeometry(endpoint_pod_strap_05b_44.endRadius, endpoint_pod_strap_05b_44.baseRadius, endpoint_pod_strap_05b_44.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_05b_44 = new THREE.Mesh(
    mesh_pod_strap_05b_44Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_05b_44.name = "Pod strap 5b";
  if (endpoint_pod_strap_05b_44) {
    mesh_pod_strap_05b_44.position.copy(endpoint_pod_strap_05b_44.midpoint);
    mesh_pod_strap_05b_44.quaternion.copy(endpoint_pod_strap_05b_44.quaternion);
  }
  mesh_pod_strap_05b_44.castShadow = options.castShadow ?? true;
  mesh_pod_strap_05b_44.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_05b_44.userData.sculptComponent = {"id": "pod-strap-05b", "name": "Pod strap 5b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-05b-mount", "structuralParent": "pod-cradle", "localStart": [-1.72, -0.72, 0.195], "localEnd": [-1.72, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.72, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_05b_44.add(mesh_pod_strap_05b_44);
  meshes["pod-strap-05b"] = mesh_pod_strap_05b_44;
  colliders["pod-strap-05b"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_06_45 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-06-mount", "structuralParent": "pod-cradle", "localStart": [-1.13, -0.76, 0.175], "localEnd": [-1.13, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_06_45 = makeAttachmentEndpoint(attachment_bladder_pod_06_45);
  const node_bladder_pod_06_45 = new THREE.Group();
  node_bladder_pod_06_45.name = "Bladder pod 6__pivot";
  if (endpoint_bladder_pod_06_45) {
    node_bladder_pod_06_45.position.copy(endpoint_bladder_pod_06_45.start);
    node_bladder_pod_06_45.rotation.set(0, 0, 0);
    node_bladder_pod_06_45.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_06_45.position.set(-1.13, -0.76, 0.175);
    node_bladder_pod_06_45.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_06_45.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_06_45.userData.sculptComponent = {"id": "bladder-pod-06", "name": "Bladder pod 6", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-06-mount", "structuralParent": "pod-cradle", "localStart": [-1.13, -0.76, 0.175], "localEnd": [-1.13, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.13, -0.76, 0.175], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-06", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_06_45.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-06", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_06_45);
  nodes["bladder-pod-06"] = node_bladder_pod_06_45;
  const mesh_bladder_pod_06_45Geometry = endpoint_bladder_pod_06_45
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_06_45.endRadius, endpoint_bladder_pod_06_45.baseRadius, endpoint_bladder_pod_06_45.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_06_45 = new THREE.Mesh(
    mesh_bladder_pod_06_45Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_06_45.name = "Bladder pod 6";
  if (endpoint_bladder_pod_06_45) {
    mesh_bladder_pod_06_45.position.copy(endpoint_bladder_pod_06_45.midpoint);
    mesh_bladder_pod_06_45.quaternion.copy(endpoint_bladder_pod_06_45.quaternion);
  }
  mesh_bladder_pod_06_45.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_06_45.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_06_45.userData.sculptComponent = {"id": "bladder-pod-06", "name": "Bladder pod 6", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-06-mount", "structuralParent": "pod-cradle", "localStart": [-1.13, -0.76, 0.175], "localEnd": [-1.13, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-1.13, -0.76, 0.175], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-06", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_06_45.add(mesh_bladder_pod_06_45);
  meshes["bladder-pod-06"] = mesh_bladder_pod_06_45;
  colliders["bladder-pod-06"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_06_pod_mount_06_0 = new THREE.Object3D();
  socket_bladder_pod_06_pod_mount_06_0.name = "pod-mount-06";
  socket_bladder_pod_06_pod_mount_06_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_06_pod_mount_06_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_06_pod_mount_06_0.userData.socket = {"id": "pod-mount-06", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_06_45.add(socket_bladder_pod_06_pod_mount_06_0);
  sockets["bladder-pod-06:pod-mount-06"] = socket_bladder_pod_06_pod_mount_06_0;

  const attachment_pod_strap_06a_46 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-06a-mount", "structuralParent": "pod-cradle", "localStart": [-1.41, -0.76, 0.175], "localEnd": [-1.41, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_06a_46 = makeAttachmentEndpoint(attachment_pod_strap_06a_46);
  const node_pod_strap_06a_46 = new THREE.Group();
  node_pod_strap_06a_46.name = "Pod strap 6a__pivot";
  if (endpoint_pod_strap_06a_46) {
    node_pod_strap_06a_46.position.copy(endpoint_pod_strap_06a_46.start);
    node_pod_strap_06a_46.rotation.set(0, 0, 0);
    node_pod_strap_06a_46.scale.set(1, 1, 1);
  } else {
    node_pod_strap_06a_46.position.set(-1.41, -0.76, 0.175);
    node_pod_strap_06a_46.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_06a_46.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_06a_46.userData.sculptComponent = {"id": "pod-strap-06a", "name": "Pod strap 6a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-06a-mount", "structuralParent": "pod-cradle", "localStart": [-1.41, -0.76, 0.175], "localEnd": [-1.41, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.41, -0.76, 0.175], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_06a_46.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_06a_46);
  nodes["pod-strap-06a"] = node_pod_strap_06a_46;
  const mesh_pod_strap_06a_46Geometry = endpoint_pod_strap_06a_46
    ? new THREE.CylinderGeometry(endpoint_pod_strap_06a_46.endRadius, endpoint_pod_strap_06a_46.baseRadius, endpoint_pod_strap_06a_46.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_06a_46 = new THREE.Mesh(
    mesh_pod_strap_06a_46Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_06a_46.name = "Pod strap 6a";
  if (endpoint_pod_strap_06a_46) {
    mesh_pod_strap_06a_46.position.copy(endpoint_pod_strap_06a_46.midpoint);
    mesh_pod_strap_06a_46.quaternion.copy(endpoint_pod_strap_06a_46.quaternion);
  }
  mesh_pod_strap_06a_46.castShadow = options.castShadow ?? true;
  mesh_pod_strap_06a_46.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_06a_46.userData.sculptComponent = {"id": "pod-strap-06a", "name": "Pod strap 6a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-06a-mount", "structuralParent": "pod-cradle", "localStart": [-1.41, -0.76, 0.175], "localEnd": [-1.41, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-1.41, -0.76, 0.175], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_06a_46.add(mesh_pod_strap_06a_46);
  meshes["pod-strap-06a"] = mesh_pod_strap_06a_46;
  colliders["pod-strap-06a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_06b_47 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-06b-mount", "structuralParent": "pod-cradle", "localStart": [-0.85, -0.76, 0.175], "localEnd": [-0.85, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_06b_47 = makeAttachmentEndpoint(attachment_pod_strap_06b_47);
  const node_pod_strap_06b_47 = new THREE.Group();
  node_pod_strap_06b_47.name = "Pod strap 6b__pivot";
  if (endpoint_pod_strap_06b_47) {
    node_pod_strap_06b_47.position.copy(endpoint_pod_strap_06b_47.start);
    node_pod_strap_06b_47.rotation.set(0, 0, 0);
    node_pod_strap_06b_47.scale.set(1, 1, 1);
  } else {
    node_pod_strap_06b_47.position.set(-0.8499999999999999, -0.76, 0.175);
    node_pod_strap_06b_47.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_06b_47.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_06b_47.userData.sculptComponent = {"id": "pod-strap-06b", "name": "Pod strap 6b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-06b-mount", "structuralParent": "pod-cradle", "localStart": [-0.85, -0.76, 0.175], "localEnd": [-0.85, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.8499999999999999, -0.76, 0.175], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_06b_47.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_06b_47);
  nodes["pod-strap-06b"] = node_pod_strap_06b_47;
  const mesh_pod_strap_06b_47Geometry = endpoint_pod_strap_06b_47
    ? new THREE.CylinderGeometry(endpoint_pod_strap_06b_47.endRadius, endpoint_pod_strap_06b_47.baseRadius, endpoint_pod_strap_06b_47.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_06b_47 = new THREE.Mesh(
    mesh_pod_strap_06b_47Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_06b_47.name = "Pod strap 6b";
  if (endpoint_pod_strap_06b_47) {
    mesh_pod_strap_06b_47.position.copy(endpoint_pod_strap_06b_47.midpoint);
    mesh_pod_strap_06b_47.quaternion.copy(endpoint_pod_strap_06b_47.quaternion);
  }
  mesh_pod_strap_06b_47.castShadow = options.castShadow ?? true;
  mesh_pod_strap_06b_47.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_06b_47.userData.sculptComponent = {"id": "pod-strap-06b", "name": "Pod strap 6b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-06b-mount", "structuralParent": "pod-cradle", "localStart": [-0.85, -0.76, 0.175], "localEnd": [-0.85, -0.76, 0.175], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.8499999999999999, -0.76, 0.175], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_06b_47.add(mesh_pod_strap_06b_47);
  meshes["pod-strap-06b"] = mesh_pod_strap_06b_47;
  colliders["pod-strap-06b"] = {"type": "box", "fit": "tight"};

  const attachment_bladder_pod_07_48 = {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-07-mount", "structuralParent": "pod-cradle", "localStart": [-0.28, -0.72, 0.195], "localEnd": [-0.28, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_bladder_pod_07_48 = makeAttachmentEndpoint(attachment_bladder_pod_07_48);
  const node_bladder_pod_07_48 = new THREE.Group();
  node_bladder_pod_07_48.name = "Bladder pod 7__pivot";
  if (endpoint_bladder_pod_07_48) {
    node_bladder_pod_07_48.position.copy(endpoint_bladder_pod_07_48.start);
    node_bladder_pod_07_48.rotation.set(0, 0, 0);
    node_bladder_pod_07_48.scale.set(1, 1, 1);
  } else {
    node_bladder_pod_07_48.position.set(-0.28, -0.72, 0.19499999999999995);
    node_bladder_pod_07_48.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_bladder_pod_07_48.scale.set(0.86, 0.8, 0.86);
  }
  node_bladder_pod_07_48.userData.sculptComponent = {"id": "bladder-pod-07", "name": "Bladder pod 7", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-07-mount", "structuralParent": "pod-cradle", "localStart": [-0.28, -0.72, 0.195], "localEnd": [-0.28, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.28, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-07", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_07_48.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-07", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}};
  (nodes["root"] ?? root).add(node_bladder_pod_07_48);
  nodes["bladder-pod-07"] = node_bladder_pod_07_48;
  const mesh_bladder_pod_07_48Geometry = endpoint_bladder_pod_07_48
    ? new THREE.CylinderGeometry(endpoint_bladder_pod_07_48.endRadius, endpoint_bladder_pod_07_48.baseRadius, endpoint_bladder_pod_07_48.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_bladder_pod_07_48 = new THREE.Mesh(
    mesh_bladder_pod_07_48Geometry,
    materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bladder_pod_07_48.name = "Bladder pod 7";
  if (endpoint_bladder_pod_07_48) {
    mesh_bladder_pod_07_48.position.copy(endpoint_bladder_pod_07_48.midpoint);
    mesh_bladder_pod_07_48.quaternion.copy(endpoint_bladder_pod_07_48.quaternion);
  }
  mesh_bladder_pod_07_48.castShadow = options.castShadow ?? true;
  mesh_bladder_pod_07_48.receiveShadow = options.receiveShadow ?? true;
  mesh_bladder_pod_07_48.userData.sculptComponent = {"id": "bladder-pod-07", "name": "Bladder pod 7", "level": "meso", "role": "payload", "logicalParent": "pod-cradle", "importance": 0.85, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous organic bulge - a capsule, NOT a cylinder. The soft inflated read against the hard hull is the single strongest identity cue in the reference.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/bladder-pod-07-mount", "structuralParent": "pod-cradle", "localStart": [-0.28, -0.72, 0.195], "localEnd": [-0.28, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.86, "height": 0.8, "depth": 0.86, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.28, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [{"id": "pod-mount-07", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "capsule", "fit": "tight"}, "constraints": [], "destruction": {"breakable": true, "group": "payload-pods"}}, "material": "pod-yellow", "materialLayers": ["pod-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d06", "d07"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 183, 8, 1.0)", "secondaryAlbedo": "rgba(174, 129, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(233, 183, 8, 1.0)"}, {"position": 1.0, "color": "rgba(174, 129, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["belly-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bladder_pod_07_48.add(mesh_bladder_pod_07_48);
  meshes["bladder-pod-07"] = mesh_bladder_pod_07_48;
  colliders["bladder-pod-07"] = {"type": "capsule", "fit": "tight"};
  const socket_bladder_pod_07_pod_mount_07_0 = new THREE.Object3D();
  socket_bladder_pod_07_pod_mount_07_0.name = "pod-mount-07";
  socket_bladder_pod_07_pod_mount_07_0.position.set(0.0, 0.3, 0.0);
  socket_bladder_pod_07_pod_mount_07_0.rotation.set(0.0, 0.0, 0.0);
  socket_bladder_pod_07_pod_mount_07_0.userData.socket = {"id": "pod-mount-07", "localPosition": [0, 0.3, 0], "localRotation": [0, 0, 0]};
  node_bladder_pod_07_48.add(socket_bladder_pod_07_pod_mount_07_0);
  sockets["bladder-pod-07:pod-mount-07"] = socket_bladder_pod_07_pod_mount_07_0;

  const attachment_pod_strap_07a_49 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-07a-mount", "structuralParent": "pod-cradle", "localStart": [-0.56, -0.72, 0.195], "localEnd": [-0.56, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_07a_49 = makeAttachmentEndpoint(attachment_pod_strap_07a_49);
  const node_pod_strap_07a_49 = new THREE.Group();
  node_pod_strap_07a_49.name = "Pod strap 7a__pivot";
  if (endpoint_pod_strap_07a_49) {
    node_pod_strap_07a_49.position.copy(endpoint_pod_strap_07a_49.start);
    node_pod_strap_07a_49.rotation.set(0, 0, 0);
    node_pod_strap_07a_49.scale.set(1, 1, 1);
  } else {
    node_pod_strap_07a_49.position.set(-0.56, -0.72, 0.19499999999999995);
    node_pod_strap_07a_49.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_07a_49.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_07a_49.userData.sculptComponent = {"id": "pod-strap-07a", "name": "Pod strap 7a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-07a-mount", "structuralParent": "pod-cradle", "localStart": [-0.56, -0.72, 0.195], "localEnd": [-0.56, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.56, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_07a_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_07a_49);
  nodes["pod-strap-07a"] = node_pod_strap_07a_49;
  const mesh_pod_strap_07a_49Geometry = endpoint_pod_strap_07a_49
    ? new THREE.CylinderGeometry(endpoint_pod_strap_07a_49.endRadius, endpoint_pod_strap_07a_49.baseRadius, endpoint_pod_strap_07a_49.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_07a_49 = new THREE.Mesh(
    mesh_pod_strap_07a_49Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_07a_49.name = "Pod strap 7a";
  if (endpoint_pod_strap_07a_49) {
    mesh_pod_strap_07a_49.position.copy(endpoint_pod_strap_07a_49.midpoint);
    mesh_pod_strap_07a_49.quaternion.copy(endpoint_pod_strap_07a_49.quaternion);
  }
  mesh_pod_strap_07a_49.castShadow = options.castShadow ?? true;
  mesh_pod_strap_07a_49.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_07a_49.userData.sculptComponent = {"id": "pod-strap-07a", "name": "Pod strap 7a", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-07a-mount", "structuralParent": "pod-cradle", "localStart": [-0.56, -0.72, 0.195], "localEnd": [-0.56, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.56, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_07a_49.add(mesh_pod_strap_07a_49);
  meshes["pod-strap-07a"] = mesh_pod_strap_07a_49;
  colliders["pod-strap-07a"] = {"type": "box", "fit": "tight"};

  const attachment_pod_strap_07b_50 = {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-07b-mount", "structuralParent": "pod-cradle", "localStart": [0.0, -0.72, 0.195], "localEnd": [0.0, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_pod_strap_07b_50 = makeAttachmentEndpoint(attachment_pod_strap_07b_50);
  const node_pod_strap_07b_50 = new THREE.Group();
  node_pod_strap_07b_50.name = "Pod strap 7b__pivot";
  if (endpoint_pod_strap_07b_50) {
    node_pod_strap_07b_50.position.copy(endpoint_pod_strap_07b_50.start);
    node_pod_strap_07b_50.rotation.set(0, 0, 0);
    node_pod_strap_07b_50.scale.set(1, 1, 1);
  } else {
    node_pod_strap_07b_50.position.set(0.0, -0.72, 0.19499999999999995);
    node_pod_strap_07b_50.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_pod_strap_07b_50.scale.set(0.68, 0.68, 0.68);
  }
  node_pod_strap_07b_50.userData.sculptComponent = {"id": "pod-strap-07b", "name": "Pod strap 7b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-07b-mount", "structuralParent": "pod-cradle", "localStart": [0.0, -0.72, 0.195], "localEnd": [0.0, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.0, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_07b_50.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_pod_strap_07b_50);
  nodes["pod-strap-07b"] = node_pod_strap_07b_50;
  const mesh_pod_strap_07b_50Geometry = endpoint_pod_strap_07b_50
    ? new THREE.CylinderGeometry(endpoint_pod_strap_07b_50.endRadius, endpoint_pod_strap_07b_50.baseRadius, endpoint_pod_strap_07b_50.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  const mesh_pod_strap_07b_50 = new THREE.Mesh(
    mesh_pod_strap_07b_50Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pod_strap_07b_50.name = "Pod strap 7b";
  if (endpoint_pod_strap_07b_50) {
    mesh_pod_strap_07b_50.position.copy(endpoint_pod_strap_07b_50.midpoint);
    mesh_pod_strap_07b_50.quaternion.copy(endpoint_pod_strap_07b_50.quaternion);
  }
  mesh_pod_strap_07b_50.castShadow = options.castShadow ?? true;
  mesh_pod_strap_07b_50.receiveShadow = options.receiveShadow ?? true;
  mesh_pod_strap_07b_50.userData.sculptComponent = {"id": "pod-strap-07b", "name": "Pod strap 7b", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.72, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring strap wrapping the pod - a torus is the exact topology.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "torusTubeRatio": 0.16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/pod-strap-07b-mount", "structuralParent": "pod-cradle", "localStart": [0.0, -0.72, 0.195], "localEnd": [0.0, -0.72, 0.195], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.68, "height": 0.68, "depth": 0.68, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.0, -0.72, 0.19499999999999995], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d07"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_pod_strap_07b_50.add(mesh_pod_strap_07b_50);
  meshes["pod-strap-07b"] = mesh_pod_strap_07b_50;
  colliders["pod-strap-07b"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_spine_51 = {"parentId": "root", "parentSocket": "pod-cradle/manifold-spine-mount", "structuralParent": "pod-cradle", "localStart": [-1.05, -0.12, 0.425], "localEnd": [-1.05, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_spine_51 = makeAttachmentEndpoint(attachment_manifold_spine_51);
  const node_manifold_spine_51 = new THREE.Group();
  node_manifold_spine_51.name = "Plumbing manifold spine__pivot";
  if (endpoint_manifold_spine_51) {
    node_manifold_spine_51.position.copy(endpoint_manifold_spine_51.start);
    node_manifold_spine_51.rotation.set(0, 0, 0);
    node_manifold_spine_51.scale.set(1, 1, 1);
  } else {
    node_manifold_spine_51.position.set(-1.05, -0.12, 0.425);
    node_manifold_spine_51.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_spine_51.scale.set(0.17, 3.1, 0.17);
  }
  node_manifold_spine_51.userData.sculptComponent = {"id": "manifold-spine", "name": "Plumbing manifold spine", "level": "meso", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight pipe run above the pods.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-spine-mount", "structuralParent": "pod-cradle", "localStart": [-1.05, -0.12, 0.425], "localEnd": [-1.05, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.17, "height": 3.1, "depth": 0.17, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.05, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "manifold-collar-bands", "kind": "ridge", "description": "raised collar bands and coloured pipe segments along the manifold run", "detailRefs": ["d16"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_spine_51.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_spine_51);
  nodes["manifold-spine"] = node_manifold_spine_51;
  const mesh_manifold_spine_51Geometry = endpoint_manifold_spine_51
    ? new THREE.CylinderGeometry(endpoint_manifold_spine_51.endRadius, endpoint_manifold_spine_51.baseRadius, endpoint_manifold_spine_51.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_spine_51 = new THREE.Mesh(
    mesh_manifold_spine_51Geometry,
    materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_spine_51.name = "Plumbing manifold spine";
  if (endpoint_manifold_spine_51) {
    mesh_manifold_spine_51.position.copy(endpoint_manifold_spine_51.midpoint);
    mesh_manifold_spine_51.quaternion.copy(endpoint_manifold_spine_51.quaternion);
  }
  mesh_manifold_spine_51.castShadow = options.castShadow ?? true;
  mesh_manifold_spine_51.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_spine_51.userData.sculptComponent = {"id": "manifold-spine", "name": "Plumbing manifold spine", "level": "meso", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight pipe run above the pods.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-spine-mount", "structuralParent": "pod-cradle", "localStart": [-1.05, -0.12, 0.425], "localEnd": [-1.05, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.17, "height": 3.1, "depth": 0.17, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.05, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "hull-cream", "materialLayers": ["hull-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "manifold-collar-bands", "kind": "ridge", "description": "raised collar bands and coloured pipe segments along the manifold run", "detailRefs": ["d16"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(248, 244, 217, 1.0)", "secondaryAlbedo": "rgba(252, 247, 225, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(248, 244, 217, 1.0)"}, {"position": 1.0, "color": "rgba(252, 247, 225, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["full-object"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_spine_51.add(mesh_manifold_spine_51);
  meshes["manifold-spine"] = mesh_manifold_spine_51;
  colliders["manifold-spine"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_seg_red_52 = {"parentId": "root", "parentSocket": "pod-cradle/manifold-seg-red-mount", "structuralParent": "pod-cradle", "localStart": [-0.95, -0.12, 0.425], "localEnd": [-0.95, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_seg_red_52 = makeAttachmentEndpoint(attachment_manifold_seg_red_52);
  const node_manifold_seg_red_52 = new THREE.Group();
  node_manifold_seg_red_52.name = "Manifold Seg Red__pivot";
  if (endpoint_manifold_seg_red_52) {
    node_manifold_seg_red_52.position.copy(endpoint_manifold_seg_red_52.start);
    node_manifold_seg_red_52.rotation.set(0, 0, 0);
    node_manifold_seg_red_52.scale.set(1, 1, 1);
  } else {
    node_manifold_seg_red_52.position.set(-0.95, -0.12, 0.425);
    node_manifold_seg_red_52.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_seg_red_52.scale.set(0.2, 0.62, 0.2);
  }
  node_manifold_seg_red_52.userData.sculptComponent = {"id": "manifold-seg-red", "name": "Manifold Seg Red", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-seg-red-mount", "structuralParent": "pod-cradle", "localStart": [-0.95, -0.12, 0.425], "localEnd": [-0.95, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.95, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_red_52.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_seg_red_52);
  nodes["manifold-seg-red"] = node_manifold_seg_red_52;
  const mesh_manifold_seg_red_52Geometry = endpoint_manifold_seg_red_52
    ? new THREE.CylinderGeometry(endpoint_manifold_seg_red_52.endRadius, endpoint_manifold_seg_red_52.baseRadius, endpoint_manifold_seg_red_52.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_seg_red_52 = new THREE.Mesh(
    mesh_manifold_seg_red_52Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_seg_red_52.name = "Manifold Seg Red";
  if (endpoint_manifold_seg_red_52) {
    mesh_manifold_seg_red_52.position.copy(endpoint_manifold_seg_red_52.midpoint);
    mesh_manifold_seg_red_52.quaternion.copy(endpoint_manifold_seg_red_52.quaternion);
  }
  mesh_manifold_seg_red_52.castShadow = options.castShadow ?? true;
  mesh_manifold_seg_red_52.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_seg_red_52.userData.sculptComponent = {"id": "manifold-seg-red", "name": "Manifold Seg Red", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-seg-red-mount", "structuralParent": "pod-cradle", "localStart": [-0.95, -0.12, 0.425], "localEnd": [-0.95, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.95, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_red_52.add(mesh_manifold_seg_red_52);
  meshes["manifold-seg-red"] = mesh_manifold_seg_red_52;
  colliders["manifold-seg-red"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_seg_blue_53 = {"parentId": "root", "parentSocket": "pod-cradle/manifold-seg-blue-mount", "structuralParent": "pod-cradle", "localStart": [0.62, -0.12, 0.425], "localEnd": [0.62, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_seg_blue_53 = makeAttachmentEndpoint(attachment_manifold_seg_blue_53);
  const node_manifold_seg_blue_53 = new THREE.Group();
  node_manifold_seg_blue_53.name = "Manifold Seg Blue__pivot";
  if (endpoint_manifold_seg_blue_53) {
    node_manifold_seg_blue_53.position.copy(endpoint_manifold_seg_blue_53.start);
    node_manifold_seg_blue_53.rotation.set(0, 0, 0);
    node_manifold_seg_blue_53.scale.set(1, 1, 1);
  } else {
    node_manifold_seg_blue_53.position.set(0.62, -0.12, 0.425);
    node_manifold_seg_blue_53.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_seg_blue_53.scale.set(0.2, 0.62, 0.2);
  }
  node_manifold_seg_blue_53.userData.sculptComponent = {"id": "manifold-seg-blue", "name": "Manifold Seg Blue", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-seg-blue-mount", "structuralParent": "pod-cradle", "localStart": [0.62, -0.12, 0.425], "localEnd": [0.62, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.62, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_blue_53.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_seg_blue_53);
  nodes["manifold-seg-blue"] = node_manifold_seg_blue_53;
  const mesh_manifold_seg_blue_53Geometry = endpoint_manifold_seg_blue_53
    ? new THREE.CylinderGeometry(endpoint_manifold_seg_blue_53.endRadius, endpoint_manifold_seg_blue_53.baseRadius, endpoint_manifold_seg_blue_53.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_seg_blue_53 = new THREE.Mesh(
    mesh_manifold_seg_blue_53Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_seg_blue_53.name = "Manifold Seg Blue";
  if (endpoint_manifold_seg_blue_53) {
    mesh_manifold_seg_blue_53.position.copy(endpoint_manifold_seg_blue_53.midpoint);
    mesh_manifold_seg_blue_53.quaternion.copy(endpoint_manifold_seg_blue_53.quaternion);
  }
  mesh_manifold_seg_blue_53.castShadow = options.castShadow ?? true;
  mesh_manifold_seg_blue_53.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_seg_blue_53.userData.sculptComponent = {"id": "manifold-seg-blue", "name": "Manifold Seg Blue", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-seg-blue-mount", "structuralParent": "pod-cradle", "localStart": [0.62, -0.12, 0.425], "localEnd": [0.62, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.62, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.62, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_seg_blue_53.add(mesh_manifold_seg_blue_53);
  meshes["manifold-seg-blue"] = mesh_manifold_seg_blue_53;
  colliders["manifold-seg-blue"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_collar_a_54 = {"parentId": "root", "parentSocket": "pod-cradle/manifold-collar-a-mount", "structuralParent": "pod-cradle", "localStart": [-0.3, -0.12, 0.425], "localEnd": [-0.3, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_collar_a_54 = makeAttachmentEndpoint(attachment_manifold_collar_a_54);
  const node_manifold_collar_a_54 = new THREE.Group();
  node_manifold_collar_a_54.name = "Manifold Collar A__pivot";
  if (endpoint_manifold_collar_a_54) {
    node_manifold_collar_a_54.position.copy(endpoint_manifold_collar_a_54.start);
    node_manifold_collar_a_54.rotation.set(0, 0, 0);
    node_manifold_collar_a_54.scale.set(1, 1, 1);
  } else {
    node_manifold_collar_a_54.position.set(-0.3, -0.12, 0.425);
    node_manifold_collar_a_54.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_collar_a_54.scale.set(0.2, 0.16, 0.2);
  }
  node_manifold_collar_a_54.userData.sculptComponent = {"id": "manifold-collar-a", "name": "Manifold Collar A", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-collar-a-mount", "structuralParent": "pod-cradle", "localStart": [-0.3, -0.12, 0.425], "localEnd": [-0.3, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.3, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_a_54.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_collar_a_54);
  nodes["manifold-collar-a"] = node_manifold_collar_a_54;
  const mesh_manifold_collar_a_54Geometry = endpoint_manifold_collar_a_54
    ? new THREE.CylinderGeometry(endpoint_manifold_collar_a_54.endRadius, endpoint_manifold_collar_a_54.baseRadius, endpoint_manifold_collar_a_54.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_collar_a_54 = new THREE.Mesh(
    mesh_manifold_collar_a_54Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_collar_a_54.name = "Manifold Collar A";
  if (endpoint_manifold_collar_a_54) {
    mesh_manifold_collar_a_54.position.copy(endpoint_manifold_collar_a_54.midpoint);
    mesh_manifold_collar_a_54.quaternion.copy(endpoint_manifold_collar_a_54.quaternion);
  }
  mesh_manifold_collar_a_54.castShadow = options.castShadow ?? true;
  mesh_manifold_collar_a_54.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_collar_a_54.userData.sculptComponent = {"id": "manifold-collar-a", "name": "Manifold Collar A", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-collar-a-mount", "structuralParent": "pod-cradle", "localStart": [-0.3, -0.12, 0.425], "localEnd": [-0.3, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.3, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_a_54.add(mesh_manifold_collar_a_54);
  meshes["manifold-collar-a"] = mesh_manifold_collar_a_54;
  colliders["manifold-collar-a"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_collar_b_55 = {"parentId": "root", "parentSocket": "pod-cradle/manifold-collar-b-mount", "structuralParent": "pod-cradle", "localStart": [0.2, -0.12, 0.425], "localEnd": [0.2, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_collar_b_55 = makeAttachmentEndpoint(attachment_manifold_collar_b_55);
  const node_manifold_collar_b_55 = new THREE.Group();
  node_manifold_collar_b_55.name = "Manifold Collar B__pivot";
  if (endpoint_manifold_collar_b_55) {
    node_manifold_collar_b_55.position.copy(endpoint_manifold_collar_b_55.start);
    node_manifold_collar_b_55.rotation.set(0, 0, 0);
    node_manifold_collar_b_55.scale.set(1, 1, 1);
  } else {
    node_manifold_collar_b_55.position.set(0.2, -0.12, 0.425);
    node_manifold_collar_b_55.rotation.set(0.0, 0.0, 1.5707963267948966);
    node_manifold_collar_b_55.scale.set(0.2, 0.16, 0.2);
  }
  node_manifold_collar_b_55.userData.sculptComponent = {"id": "manifold-collar-b", "name": "Manifold Collar B", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-collar-b-mount", "structuralParent": "pod-cradle", "localStart": [0.2, -0.12, 0.425], "localEnd": [0.2, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.2, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_b_55.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_collar_b_55);
  nodes["manifold-collar-b"] = node_manifold_collar_b_55;
  const mesh_manifold_collar_b_55Geometry = endpoint_manifold_collar_b_55
    ? new THREE.CylinderGeometry(endpoint_manifold_collar_b_55.endRadius, endpoint_manifold_collar_b_55.baseRadius, endpoint_manifold_collar_b_55.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_collar_b_55 = new THREE.Mesh(
    mesh_manifold_collar_b_55Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_collar_b_55.name = "Manifold Collar B";
  if (endpoint_manifold_collar_b_55) {
    mesh_manifold_collar_b_55.position.copy(endpoint_manifold_collar_b_55.midpoint);
    mesh_manifold_collar_b_55.quaternion.copy(endpoint_manifold_collar_b_55.quaternion);
  }
  mesh_manifold_collar_b_55.castShadow = options.castShadow ?? true;
  mesh_manifold_collar_b_55.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_collar_b_55.userData.sculptComponent = {"id": "manifold-collar-b", "name": "Manifold Collar B", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Banded collar / coloured pipe segment on the manifold run.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-collar-b-mount", "structuralParent": "pod-cradle", "localStart": [0.2, -0.12, 0.425], "localEnd": [0.2, -0.12, 0.425], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.2, "height": 0.16, "depth": 0.2, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.2, -0.12, 0.425], "rotation": [0, 0, 1.5707963267948966]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d16"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_collar_b_55.add(mesh_manifold_collar_b_55);
  meshes["manifold-collar-b"] = mesh_manifold_collar_b_55;
  colliders["manifold-collar-b"] = {"type": "box", "fit": "tight"};

  const attachment_manifold_round_port_56 = {"parentId": "root", "parentSocket": "pod-cradle/manifold-round-port-mount", "structuralParent": "pod-cradle", "localStart": [-0.48, -0.38, 1.025], "localEnd": [-0.48, -0.38, 1.025], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]};
  const endpoint_manifold_round_port_56 = makeAttachmentEndpoint(attachment_manifold_round_port_56);
  const node_manifold_round_port_56 = new THREE.Group();
  node_manifold_round_port_56.name = "Manifold round port__pivot";
  if (endpoint_manifold_round_port_56) {
    node_manifold_round_port_56.position.copy(endpoint_manifold_round_port_56.start);
    node_manifold_round_port_56.rotation.set(0, 0, 0);
    node_manifold_round_port_56.scale.set(1, 1, 1);
  } else {
    node_manifold_round_port_56.position.set(-0.48, -0.38, 1.025);
    node_manifold_round_port_56.rotation.set(1.5707963267948966, 0.0, 0.0);
    node_manifold_round_port_56.scale.set(0.4, 0.14, 0.4);
  }
  node_manifold_round_port_56.userData.sculptComponent = {"id": "manifold-round-port", "name": "Manifold round port", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Circular port with a red interior and blue rim.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-round-port-mount", "structuralParent": "pod-cradle", "localStart": [-0.48, -0.38, 1.025], "localEnd": [-0.48, -0.38, 1.025], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.4, "height": 0.14, "depth": 0.4, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.48, -0.38, 1.025], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d17"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_round_port_56.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_manifold_round_port_56);
  nodes["manifold-round-port"] = node_manifold_round_port_56;
  const mesh_manifold_round_port_56Geometry = endpoint_manifold_round_port_56
    ? new THREE.CylinderGeometry(endpoint_manifold_round_port_56.endRadius, endpoint_manifold_round_port_56.baseRadius, endpoint_manifold_round_port_56.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_manifold_round_port_56 = new THREE.Mesh(
    mesh_manifold_round_port_56Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_manifold_round_port_56.name = "Manifold round port";
  if (endpoint_manifold_round_port_56) {
    mesh_manifold_round_port_56.position.copy(endpoint_manifold_round_port_56.midpoint);
    mesh_manifold_round_port_56.quaternion.copy(endpoint_manifold_round_port_56.quaternion);
  }
  mesh_manifold_round_port_56.castShadow = options.castShadow ?? true;
  mesh_manifold_round_port_56.receiveShadow = options.receiveShadow ?? true;
  mesh_manifold_round_port_56.userData.sculptComponent = {"id": "manifold-round-port", "name": "Manifold round port", "level": "micro", "role": "detail", "logicalParent": "pod-cradle", "importance": 0.4, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Circular port with a red interior and blue rim.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "pod-cradle/manifold-round-port-mount", "structuralParent": "pod-cradle", "localStart": [-0.48, -0.38, 1.025], "localEnd": [-0.48, -0.38, 1.025], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["belly-zone"]}, "dimensions": {"width": 0.4, "height": 0.14, "depth": 0.4, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.48, -0.38, 1.025], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["belly-zone"], "details": ["d17"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_manifold_round_port_56.add(mesh_manifold_round_port_56);
  meshes["manifold-round-port"] = mesh_manifold_round_port_56;
  colliders["manifold-round-port"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_01_57 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-01-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.815], "localEnd": [1.48, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_01_57 = makeAttachmentEndpoint(attachment_radiator_vane_01_57);
  const node_radiator_vane_01_57 = new THREE.Group();
  node_radiator_vane_01_57.name = "Radiator vane 1__pivot";
  if (endpoint_radiator_vane_01_57) {
    node_radiator_vane_01_57.position.copy(endpoint_radiator_vane_01_57.start);
    node_radiator_vane_01_57.rotation.set(0, 0, 0);
    node_radiator_vane_01_57.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_01_57.position.set(1.48, 0.01, 0.815);
    node_radiator_vane_01_57.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_radiator_vane_01_57.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_01_57.userData.sculptComponent = {"id": "radiator-vane-01", "name": "Radiator vane 1", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-01-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.815], "localEnd": [1.48, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_01_57.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_01_57);
  nodes["radiator-vane-01"] = node_radiator_vane_01_57;
  const mesh_radiator_vane_01_57Geometry = endpoint_radiator_vane_01_57
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_01_57.endRadius, endpoint_radiator_vane_01_57.baseRadius, endpoint_radiator_vane_01_57.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_01_57 = new THREE.Mesh(
    mesh_radiator_vane_01_57Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_01_57.name = "Radiator vane 1";
  if (endpoint_radiator_vane_01_57) {
    mesh_radiator_vane_01_57.position.copy(endpoint_radiator_vane_01_57.midpoint);
    mesh_radiator_vane_01_57.quaternion.copy(endpoint_radiator_vane_01_57.quaternion);
  }
  mesh_radiator_vane_01_57.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_01_57.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_01_57.userData.sculptComponent = {"id": "radiator-vane-01", "name": "Radiator vane 1", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-01-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.815], "localEnd": [1.48, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_01_57.add(mesh_radiator_vane_01_57);
  meshes["radiator-vane-01"] = mesh_radiator_vane_01_57;
  colliders["radiator-vane-01"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_02_58 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-02-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.815], "localEnd": [1.74, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_02_58 = makeAttachmentEndpoint(attachment_radiator_vane_02_58);
  const node_radiator_vane_02_58 = new THREE.Group();
  node_radiator_vane_02_58.name = "Radiator vane 2__pivot";
  if (endpoint_radiator_vane_02_58) {
    node_radiator_vane_02_58.position.copy(endpoint_radiator_vane_02_58.start);
    node_radiator_vane_02_58.rotation.set(0, 0, 0);
    node_radiator_vane_02_58.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_02_58.position.set(1.74, 0.01, 0.815);
    node_radiator_vane_02_58.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_radiator_vane_02_58.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_02_58.userData.sculptComponent = {"id": "radiator-vane-02", "name": "Radiator vane 2", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-02-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.815], "localEnd": [1.74, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_02_58.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_02_58);
  nodes["radiator-vane-02"] = node_radiator_vane_02_58;
  const mesh_radiator_vane_02_58Geometry = endpoint_radiator_vane_02_58
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_02_58.endRadius, endpoint_radiator_vane_02_58.baseRadius, endpoint_radiator_vane_02_58.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_02_58 = new THREE.Mesh(
    mesh_radiator_vane_02_58Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_02_58.name = "Radiator vane 2";
  if (endpoint_radiator_vane_02_58) {
    mesh_radiator_vane_02_58.position.copy(endpoint_radiator_vane_02_58.midpoint);
    mesh_radiator_vane_02_58.quaternion.copy(endpoint_radiator_vane_02_58.quaternion);
  }
  mesh_radiator_vane_02_58.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_02_58.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_02_58.userData.sculptComponent = {"id": "radiator-vane-02", "name": "Radiator vane 2", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-02-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.815], "localEnd": [1.74, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_02_58.add(mesh_radiator_vane_02_58);
  meshes["radiator-vane-02"] = mesh_radiator_vane_02_58;
  colliders["radiator-vane-02"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_03_59 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-03-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.815], "localEnd": [2.0, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_03_59 = makeAttachmentEndpoint(attachment_radiator_vane_03_59);
  const node_radiator_vane_03_59 = new THREE.Group();
  node_radiator_vane_03_59.name = "Radiator vane 3__pivot";
  if (endpoint_radiator_vane_03_59) {
    node_radiator_vane_03_59.position.copy(endpoint_radiator_vane_03_59.start);
    node_radiator_vane_03_59.rotation.set(0, 0, 0);
    node_radiator_vane_03_59.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_03_59.position.set(2.0, 0.01, 0.815);
    node_radiator_vane_03_59.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_radiator_vane_03_59.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_03_59.userData.sculptComponent = {"id": "radiator-vane-03", "name": "Radiator vane 3", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-03-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.815], "localEnd": [2.0, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_03_59.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_03_59);
  nodes["radiator-vane-03"] = node_radiator_vane_03_59;
  const mesh_radiator_vane_03_59Geometry = endpoint_radiator_vane_03_59
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_03_59.endRadius, endpoint_radiator_vane_03_59.baseRadius, endpoint_radiator_vane_03_59.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_03_59 = new THREE.Mesh(
    mesh_radiator_vane_03_59Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_03_59.name = "Radiator vane 3";
  if (endpoint_radiator_vane_03_59) {
    mesh_radiator_vane_03_59.position.copy(endpoint_radiator_vane_03_59.midpoint);
    mesh_radiator_vane_03_59.quaternion.copy(endpoint_radiator_vane_03_59.quaternion);
  }
  mesh_radiator_vane_03_59.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_03_59.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_03_59.userData.sculptComponent = {"id": "radiator-vane-03", "name": "Radiator vane 3", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-03-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.815], "localEnd": [2.0, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_03_59.add(mesh_radiator_vane_03_59);
  meshes["radiator-vane-03"] = mesh_radiator_vane_03_59;
  colliders["radiator-vane-03"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_04_60 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-04-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.815], "localEnd": [2.26, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_04_60 = makeAttachmentEndpoint(attachment_radiator_vane_04_60);
  const node_radiator_vane_04_60 = new THREE.Group();
  node_radiator_vane_04_60.name = "Radiator vane 4__pivot";
  if (endpoint_radiator_vane_04_60) {
    node_radiator_vane_04_60.position.copy(endpoint_radiator_vane_04_60.start);
    node_radiator_vane_04_60.rotation.set(0, 0, 0);
    node_radiator_vane_04_60.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_04_60.position.set(2.2600000000000002, 0.01, 0.815);
    node_radiator_vane_04_60.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_radiator_vane_04_60.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_04_60.userData.sculptComponent = {"id": "radiator-vane-04", "name": "Radiator vane 4", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-04-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.815], "localEnd": [2.26, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_04_60.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_04_60);
  nodes["radiator-vane-04"] = node_radiator_vane_04_60;
  const mesh_radiator_vane_04_60Geometry = endpoint_radiator_vane_04_60
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_04_60.endRadius, endpoint_radiator_vane_04_60.baseRadius, endpoint_radiator_vane_04_60.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_04_60 = new THREE.Mesh(
    mesh_radiator_vane_04_60Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_04_60.name = "Radiator vane 4";
  if (endpoint_radiator_vane_04_60) {
    mesh_radiator_vane_04_60.position.copy(endpoint_radiator_vane_04_60.midpoint);
    mesh_radiator_vane_04_60.quaternion.copy(endpoint_radiator_vane_04_60.quaternion);
  }
  mesh_radiator_vane_04_60.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_04_60.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_04_60.userData.sculptComponent = {"id": "radiator-vane-04", "name": "Radiator vane 4", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-04-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.815], "localEnd": [2.26, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_04_60.add(mesh_radiator_vane_04_60);
  meshes["radiator-vane-04"] = mesh_radiator_vane_04_60;
  colliders["radiator-vane-04"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_05_61 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-05-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.815], "localEnd": [2.52, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_05_61 = makeAttachmentEndpoint(attachment_radiator_vane_05_61);
  const node_radiator_vane_05_61 = new THREE.Group();
  node_radiator_vane_05_61.name = "Radiator vane 5__pivot";
  if (endpoint_radiator_vane_05_61) {
    node_radiator_vane_05_61.position.copy(endpoint_radiator_vane_05_61.start);
    node_radiator_vane_05_61.rotation.set(0, 0, 0);
    node_radiator_vane_05_61.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_05_61.position.set(2.52, 0.01, 0.815);
    node_radiator_vane_05_61.rotation.set(0.0, 0.4537856055185257, 0.0);
    node_radiator_vane_05_61.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_05_61.userData.sculptComponent = {"id": "radiator-vane-05", "name": "Radiator vane 5", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-05-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.815], "localEnd": [2.52, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_05_61.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_05_61);
  nodes["radiator-vane-05"] = node_radiator_vane_05_61;
  const mesh_radiator_vane_05_61Geometry = endpoint_radiator_vane_05_61
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_05_61.endRadius, endpoint_radiator_vane_05_61.baseRadius, endpoint_radiator_vane_05_61.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_05_61 = new THREE.Mesh(
    mesh_radiator_vane_05_61Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_05_61.name = "Radiator vane 5";
  if (endpoint_radiator_vane_05_61) {
    mesh_radiator_vane_05_61.position.copy(endpoint_radiator_vane_05_61.midpoint);
    mesh_radiator_vane_05_61.quaternion.copy(endpoint_radiator_vane_05_61.quaternion);
  }
  mesh_radiator_vane_05_61.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_05_61.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_05_61.userData.sculptComponent = {"id": "radiator-vane-05", "name": "Radiator vane 5", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-05-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.815], "localEnd": [2.52, 0.01, 0.815], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.815], "rotation": [0, 0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_05_61.add(mesh_radiator_vane_05_61);
  meshes["radiator-vane-05"] = mesh_radiator_vane_05_61;
  colliders["radiator-vane-05"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_06_62 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-06-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.495], "localEnd": [1.48, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_06_62 = makeAttachmentEndpoint(attachment_radiator_vane_06_62);
  const node_radiator_vane_06_62 = new THREE.Group();
  node_radiator_vane_06_62.name = "Radiator vane 6__pivot";
  if (endpoint_radiator_vane_06_62) {
    node_radiator_vane_06_62.position.copy(endpoint_radiator_vane_06_62.start);
    node_radiator_vane_06_62.rotation.set(0, 0, 0);
    node_radiator_vane_06_62.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_06_62.position.set(1.48, 0.01, 0.495);
    node_radiator_vane_06_62.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_radiator_vane_06_62.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_06_62.userData.sculptComponent = {"id": "radiator-vane-06", "name": "Radiator vane 6", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-06-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.495], "localEnd": [1.48, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_06_62.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_06_62);
  nodes["radiator-vane-06"] = node_radiator_vane_06_62;
  const mesh_radiator_vane_06_62Geometry = endpoint_radiator_vane_06_62
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_06_62.endRadius, endpoint_radiator_vane_06_62.baseRadius, endpoint_radiator_vane_06_62.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_06_62 = new THREE.Mesh(
    mesh_radiator_vane_06_62Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_06_62.name = "Radiator vane 6";
  if (endpoint_radiator_vane_06_62) {
    mesh_radiator_vane_06_62.position.copy(endpoint_radiator_vane_06_62.midpoint);
    mesh_radiator_vane_06_62.quaternion.copy(endpoint_radiator_vane_06_62.quaternion);
  }
  mesh_radiator_vane_06_62.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_06_62.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_06_62.userData.sculptComponent = {"id": "radiator-vane-06", "name": "Radiator vane 6", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-06-mount", "structuralParent": "stern-bay-housing", "localStart": [1.48, 0.01, 0.495], "localEnd": [1.48, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.48, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_06_62.add(mesh_radiator_vane_06_62);
  meshes["radiator-vane-06"] = mesh_radiator_vane_06_62;
  colliders["radiator-vane-06"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_07_63 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-07-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.495], "localEnd": [1.74, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_07_63 = makeAttachmentEndpoint(attachment_radiator_vane_07_63);
  const node_radiator_vane_07_63 = new THREE.Group();
  node_radiator_vane_07_63.name = "Radiator vane 7__pivot";
  if (endpoint_radiator_vane_07_63) {
    node_radiator_vane_07_63.position.copy(endpoint_radiator_vane_07_63.start);
    node_radiator_vane_07_63.rotation.set(0, 0, 0);
    node_radiator_vane_07_63.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_07_63.position.set(1.74, 0.01, 0.495);
    node_radiator_vane_07_63.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_radiator_vane_07_63.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_07_63.userData.sculptComponent = {"id": "radiator-vane-07", "name": "Radiator vane 7", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-07-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.495], "localEnd": [1.74, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_07_63.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_07_63);
  nodes["radiator-vane-07"] = node_radiator_vane_07_63;
  const mesh_radiator_vane_07_63Geometry = endpoint_radiator_vane_07_63
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_07_63.endRadius, endpoint_radiator_vane_07_63.baseRadius, endpoint_radiator_vane_07_63.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_07_63 = new THREE.Mesh(
    mesh_radiator_vane_07_63Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_07_63.name = "Radiator vane 7";
  if (endpoint_radiator_vane_07_63) {
    mesh_radiator_vane_07_63.position.copy(endpoint_radiator_vane_07_63.midpoint);
    mesh_radiator_vane_07_63.quaternion.copy(endpoint_radiator_vane_07_63.quaternion);
  }
  mesh_radiator_vane_07_63.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_07_63.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_07_63.userData.sculptComponent = {"id": "radiator-vane-07", "name": "Radiator vane 7", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-07-mount", "structuralParent": "stern-bay-housing", "localStart": [1.74, 0.01, 0.495], "localEnd": [1.74, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.74, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_07_63.add(mesh_radiator_vane_07_63);
  meshes["radiator-vane-07"] = mesh_radiator_vane_07_63;
  colliders["radiator-vane-07"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_08_64 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-08-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.495], "localEnd": [2.0, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_08_64 = makeAttachmentEndpoint(attachment_radiator_vane_08_64);
  const node_radiator_vane_08_64 = new THREE.Group();
  node_radiator_vane_08_64.name = "Radiator vane 8__pivot";
  if (endpoint_radiator_vane_08_64) {
    node_radiator_vane_08_64.position.copy(endpoint_radiator_vane_08_64.start);
    node_radiator_vane_08_64.rotation.set(0, 0, 0);
    node_radiator_vane_08_64.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_08_64.position.set(2.0, 0.01, 0.495);
    node_radiator_vane_08_64.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_radiator_vane_08_64.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_08_64.userData.sculptComponent = {"id": "radiator-vane-08", "name": "Radiator vane 8", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-08-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.495], "localEnd": [2.0, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_08_64.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_08_64);
  nodes["radiator-vane-08"] = node_radiator_vane_08_64;
  const mesh_radiator_vane_08_64Geometry = endpoint_radiator_vane_08_64
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_08_64.endRadius, endpoint_radiator_vane_08_64.baseRadius, endpoint_radiator_vane_08_64.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_08_64 = new THREE.Mesh(
    mesh_radiator_vane_08_64Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_08_64.name = "Radiator vane 8";
  if (endpoint_radiator_vane_08_64) {
    mesh_radiator_vane_08_64.position.copy(endpoint_radiator_vane_08_64.midpoint);
    mesh_radiator_vane_08_64.quaternion.copy(endpoint_radiator_vane_08_64.quaternion);
  }
  mesh_radiator_vane_08_64.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_08_64.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_08_64.userData.sculptComponent = {"id": "radiator-vane-08", "name": "Radiator vane 8", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-08-mount", "structuralParent": "stern-bay-housing", "localStart": [2.0, 0.01, 0.495], "localEnd": [2.0, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.0, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_08_64.add(mesh_radiator_vane_08_64);
  meshes["radiator-vane-08"] = mesh_radiator_vane_08_64;
  colliders["radiator-vane-08"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_09_65 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-09-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.495], "localEnd": [2.26, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_09_65 = makeAttachmentEndpoint(attachment_radiator_vane_09_65);
  const node_radiator_vane_09_65 = new THREE.Group();
  node_radiator_vane_09_65.name = "Radiator vane 9__pivot";
  if (endpoint_radiator_vane_09_65) {
    node_radiator_vane_09_65.position.copy(endpoint_radiator_vane_09_65.start);
    node_radiator_vane_09_65.rotation.set(0, 0, 0);
    node_radiator_vane_09_65.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_09_65.position.set(2.2600000000000002, 0.01, 0.495);
    node_radiator_vane_09_65.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_radiator_vane_09_65.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_09_65.userData.sculptComponent = {"id": "radiator-vane-09", "name": "Radiator vane 9", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-09-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.495], "localEnd": [2.26, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_09_65.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_09_65);
  nodes["radiator-vane-09"] = node_radiator_vane_09_65;
  const mesh_radiator_vane_09_65Geometry = endpoint_radiator_vane_09_65
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_09_65.endRadius, endpoint_radiator_vane_09_65.baseRadius, endpoint_radiator_vane_09_65.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_09_65 = new THREE.Mesh(
    mesh_radiator_vane_09_65Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_09_65.name = "Radiator vane 9";
  if (endpoint_radiator_vane_09_65) {
    mesh_radiator_vane_09_65.position.copy(endpoint_radiator_vane_09_65.midpoint);
    mesh_radiator_vane_09_65.quaternion.copy(endpoint_radiator_vane_09_65.quaternion);
  }
  mesh_radiator_vane_09_65.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_09_65.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_09_65.userData.sculptComponent = {"id": "radiator-vane-09", "name": "Radiator vane 9", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-09-mount", "structuralParent": "stern-bay-housing", "localStart": [2.26, 0.01, 0.495], "localEnd": [2.26, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.2600000000000002, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_09_65.add(mesh_radiator_vane_09_65);
  meshes["radiator-vane-09"] = mesh_radiator_vane_09_65;
  colliders["radiator-vane-09"] = {"type": "box", "fit": "tight"};

  const attachment_radiator_vane_10_66 = {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-10-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.495], "localEnd": [2.52, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_radiator_vane_10_66 = makeAttachmentEndpoint(attachment_radiator_vane_10_66);
  const node_radiator_vane_10_66 = new THREE.Group();
  node_radiator_vane_10_66.name = "Radiator vane 10__pivot";
  if (endpoint_radiator_vane_10_66) {
    node_radiator_vane_10_66.position.copy(endpoint_radiator_vane_10_66.start);
    node_radiator_vane_10_66.rotation.set(0, 0, 0);
    node_radiator_vane_10_66.scale.set(1, 1, 1);
  } else {
    node_radiator_vane_10_66.position.set(2.52, 0.01, 0.495);
    node_radiator_vane_10_66.rotation.set(0.0, -0.4537856055185257, 0.0);
    node_radiator_vane_10_66.scale.set(0.07, 0.17, 0.78);
  }
  node_radiator_vane_10_66.userData.sculptComponent = {"id": "radiator-vane-10", "name": "Radiator vane 10", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-10-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.495], "localEnd": [2.52, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_10_66.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_radiator_vane_10_66);
  nodes["radiator-vane-10"] = node_radiator_vane_10_66;
  const mesh_radiator_vane_10_66Geometry = endpoint_radiator_vane_10_66
    ? new THREE.CylinderGeometry(endpoint_radiator_vane_10_66.endRadius, endpoint_radiator_vane_10_66.baseRadius, endpoint_radiator_vane_10_66.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_radiator_vane_10_66 = new THREE.Mesh(
    mesh_radiator_vane_10_66Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_vane_10_66.name = "Radiator vane 10";
  if (endpoint_radiator_vane_10_66) {
    mesh_radiator_vane_10_66.position.copy(endpoint_radiator_vane_10_66.midpoint);
    mesh_radiator_vane_10_66.quaternion.copy(endpoint_radiator_vane_10_66.quaternion);
  }
  mesh_radiator_vane_10_66.castShadow = options.castShadow ?? true;
  mesh_radiator_vane_10_66.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_vane_10_66.userData.sculptComponent = {"id": "radiator-vane-10", "name": "Radiator vane 10", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.55, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Planar louvre slat; the chevron is two mirrored banks of slanted slats.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/radiator-vane-10-mount", "structuralParent": "stern-bay-housing", "localStart": [2.52, 0.01, 0.495], "localEnd": [2.52, 0.01, 0.495], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.07, "height": 0.17, "depth": 0.78, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.52, 0.01, 0.495], "rotation": [0, -0.4537856055185257, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d10"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_radiator_vane_10_66.add(mesh_radiator_vane_10_66);
  meshes["radiator-vane-10"] = mesh_radiator_vane_10_66;
  colliders["radiator-vane-10"] = {"type": "box", "fit": "tight"};

  const attachment_bay_blue_trim_67 = {"parentId": "root", "parentSocket": "stern-bay-housing/bay-blue-trim-mount", "structuralParent": "stern-bay-housing", "localStart": [1.63, 0.15, 1.075], "localEnd": [1.63, 0.15, 1.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_bay_blue_trim_67 = makeAttachmentEndpoint(attachment_bay_blue_trim_67);
  const node_bay_blue_trim_67 = new THREE.Group();
  node_bay_blue_trim_67.name = "Bay blue trim strip__pivot";
  if (endpoint_bay_blue_trim_67) {
    node_bay_blue_trim_67.position.copy(endpoint_bay_blue_trim_67.start);
    node_bay_blue_trim_67.rotation.set(0, 0, 0);
    node_bay_blue_trim_67.scale.set(1, 1, 1);
  } else {
    node_bay_blue_trim_67.position.set(1.63, 0.15, 1.075);
    node_bay_blue_trim_67.rotation.set(0.0, 0.0, 0.0);
    node_bay_blue_trim_67.scale.set(0.7, 0.06, 0.1);
  }
  node_bay_blue_trim_67.userData.sculptComponent = {"id": "bay-blue-trim", "name": "Bay blue trim strip", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.35, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight enamel trim along the upper bay edge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/bay-blue-trim-mount", "structuralParent": "stern-bay-housing", "localStart": [1.63, 0.15, 1.075], "localEnd": [1.63, 0.15, 1.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.7, "height": 0.06, "depth": 0.1, "units": "relative", "confidence": 0.75}, "transform": {"position": [1.63, 0.15, 1.075], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bay_blue_trim_67.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_bay_blue_trim_67);
  nodes["bay-blue-trim"] = node_bay_blue_trim_67;
  const mesh_bay_blue_trim_67Geometry = endpoint_bay_blue_trim_67
    ? new THREE.CylinderGeometry(endpoint_bay_blue_trim_67.endRadius, endpoint_bay_blue_trim_67.baseRadius, endpoint_bay_blue_trim_67.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_bay_blue_trim_67 = new THREE.Mesh(
    mesh_bay_blue_trim_67Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bay_blue_trim_67.name = "Bay blue trim strip";
  if (endpoint_bay_blue_trim_67) {
    mesh_bay_blue_trim_67.position.copy(endpoint_bay_blue_trim_67.midpoint);
    mesh_bay_blue_trim_67.quaternion.copy(endpoint_bay_blue_trim_67.quaternion);
  }
  mesh_bay_blue_trim_67.castShadow = options.castShadow ?? true;
  mesh_bay_blue_trim_67.receiveShadow = options.receiveShadow ?? true;
  mesh_bay_blue_trim_67.userData.sculptComponent = {"id": "bay-blue-trim", "name": "Bay blue trim strip", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.35, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Straight enamel trim along the upper bay edge.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/bay-blue-trim-mount", "structuralParent": "stern-bay-housing", "localStart": [1.63, 0.15, 1.075], "localEnd": [1.63, 0.15, 1.075], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 0.7, "height": 0.06, "depth": 0.1, "units": "relative", "confidence": 0.75}, "transform": {"position": [1.63, 0.15, 1.075], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_bay_blue_trim_67.add(mesh_bay_blue_trim_67);
  meshes["bay-blue-trim"] = mesh_bay_blue_trim_67;
  colliders["bay-blue-trim"] = {"type": "box", "fit": "tight"};

  const attachment_nozzle_ring_red_68 = {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-ring-red-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.235], "localEnd": [0.0, -0.07, 0.235], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_nozzle_ring_red_68 = makeAttachmentEndpoint(attachment_nozzle_ring_red_68);
  const node_nozzle_ring_red_68 = new THREE.Group();
  node_nozzle_ring_red_68.name = "Nozzle Ring Red__pivot";
  if (endpoint_nozzle_ring_red_68) {
    node_nozzle_ring_red_68.position.copy(endpoint_nozzle_ring_red_68.start);
    node_nozzle_ring_red_68.rotation.set(0, 0, 0);
    node_nozzle_ring_red_68.scale.set(1, 1, 1);
  } else {
    node_nozzle_ring_red_68.position.set(0.0, -0.07, 0.235);
    node_nozzle_ring_red_68.rotation.set(0.0, 0.0, 0.0);
    node_nozzle_ring_red_68.scale.set(1.0, 1.0, 1.0);
  }
  node_nozzle_ring_red_68.userData.sculptComponent = {"id": "nozzle-ring-red", "name": "Nozzle Ring Red", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.32, 0.34], [2.92, -0.06], [2.32, -0.42]], "depth": 0.48}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-ring-red-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.235], "localEnd": [0.0, -0.07, 0.235], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.235], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_ring_red_68.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_nozzle_ring_red_68);
  nodes["nozzle-ring-red"] = node_nozzle_ring_red_68;
  const mesh_nozzle_ring_red_68Geometry = endpoint_nozzle_ring_red_68
    ? new THREE.CylinderGeometry(endpoint_nozzle_ring_red_68.endRadius, endpoint_nozzle_ring_red_68.baseRadius, endpoint_nozzle_ring_red_68.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.32, 0.34], [2.92, -0.06], [2.32, -0.42]], "depth": 0.48});
  const mesh_nozzle_ring_red_68 = new THREE.Mesh(
    mesh_nozzle_ring_red_68Geometry,
    materialMap["accent-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nozzle_ring_red_68.name = "Nozzle Ring Red";
  if (endpoint_nozzle_ring_red_68) {
    mesh_nozzle_ring_red_68.position.copy(endpoint_nozzle_ring_red_68.midpoint);
    mesh_nozzle_ring_red_68.quaternion.copy(endpoint_nozzle_ring_red_68.quaternion);
  }
  mesh_nozzle_ring_red_68.castShadow = options.castShadow ?? true;
  mesh_nozzle_ring_red_68.receiveShadow = options.receiveShadow ?? true;
  mesh_nozzle_ring_red_68.userData.sculptComponent = {"id": "nozzle-ring-red", "name": "Nozzle Ring Red", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.32, 0.34], [2.92, -0.06], [2.32, -0.42]], "depth": 0.48}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-ring-red-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.235], "localEnd": [0.0, -0.07, 0.235], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.235], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-red", "materialLayers": ["accent-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 24, 9, 1.0)", "secondaryAlbedo": "rgba(180, 44, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(151, 24, 9, 1.0)"}, {"position": 1.0, "color": "rgba(180, 44, 44, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_ring_red_68.add(mesh_nozzle_ring_red_68);
  meshes["nozzle-ring-red"] = mesh_nozzle_ring_red_68;
  colliders["nozzle-ring-red"] = {"type": "box", "fit": "tight"};

  const attachment_nozzle_ring_blue_69 = {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-ring-blue-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.397], "localEnd": [0.0, -0.07, 0.397], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_nozzle_ring_blue_69 = makeAttachmentEndpoint(attachment_nozzle_ring_blue_69);
  const node_nozzle_ring_blue_69 = new THREE.Group();
  node_nozzle_ring_blue_69.name = "Nozzle Ring Blue__pivot";
  if (endpoint_nozzle_ring_blue_69) {
    node_nozzle_ring_blue_69.position.copy(endpoint_nozzle_ring_blue_69.start);
    node_nozzle_ring_blue_69.rotation.set(0, 0, 0);
    node_nozzle_ring_blue_69.scale.set(1, 1, 1);
  } else {
    node_nozzle_ring_blue_69.position.set(0.0, -0.07, 0.3974);
    node_nozzle_ring_blue_69.rotation.set(0.0, 0.0, 0.0);
    node_nozzle_ring_blue_69.scale.set(1.0, 1.0, 1.0);
  }
  node_nozzle_ring_blue_69.userData.sculptComponent = {"id": "nozzle-ring-blue", "name": "Nozzle Ring Blue", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.372, 0.241], [2.816, -0.055], [2.372, -0.321]], "depth": 0.35519999999999996}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-ring-blue-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.397], "localEnd": [0.0, -0.07, 0.397], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.3974], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_ring_blue_69.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_nozzle_ring_blue_69);
  nodes["nozzle-ring-blue"] = node_nozzle_ring_blue_69;
  const mesh_nozzle_ring_blue_69Geometry = endpoint_nozzle_ring_blue_69
    ? new THREE.CylinderGeometry(endpoint_nozzle_ring_blue_69.endRadius, endpoint_nozzle_ring_blue_69.baseRadius, endpoint_nozzle_ring_blue_69.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.372, 0.241], [2.816, -0.055], [2.372, -0.321]], "depth": 0.35519999999999996});
  const mesh_nozzle_ring_blue_69 = new THREE.Mesh(
    mesh_nozzle_ring_blue_69Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nozzle_ring_blue_69.name = "Nozzle Ring Blue";
  if (endpoint_nozzle_ring_blue_69) {
    mesh_nozzle_ring_blue_69.position.copy(endpoint_nozzle_ring_blue_69.midpoint);
    mesh_nozzle_ring_blue_69.quaternion.copy(endpoint_nozzle_ring_blue_69.quaternion);
  }
  mesh_nozzle_ring_blue_69.castShadow = options.castShadow ?? true;
  mesh_nozzle_ring_blue_69.receiveShadow = options.receiveShadow ?? true;
  mesh_nozzle_ring_blue_69.userData.sculptComponent = {"id": "nozzle-ring-blue", "name": "Nozzle Ring Blue", "level": "meso", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.372, 0.241], [2.816, -0.055], [2.372, -0.321]], "depth": 0.35519999999999996}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-ring-blue-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.397], "localEnd": [0.0, -0.07, 0.397], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.3974], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_ring_blue_69.add(mesh_nozzle_ring_blue_69);
  meshes["nozzle-ring-blue"] = mesh_nozzle_ring_blue_69;
  colliders["nozzle-ring-blue"] = {"type": "box", "fit": "tight"};

  const attachment_nozzle_throat_orange_70 = {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-throat-orange-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.54], "localEnd": [0.0, -0.07, 0.54], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_nozzle_throat_orange_70 = makeAttachmentEndpoint(attachment_nozzle_throat_orange_70);
  const node_nozzle_throat_orange_70 = new THREE.Group();
  node_nozzle_throat_orange_70.name = "Nozzle Throat Orange__pivot";
  if (endpoint_nozzle_throat_orange_70) {
    node_nozzle_throat_orange_70.position.copy(endpoint_nozzle_throat_orange_70.start);
    node_nozzle_throat_orange_70.rotation.set(0, 0, 0);
    node_nozzle_throat_orange_70.scale.set(1, 1, 1);
  } else {
    node_nozzle_throat_orange_70.position.set(0.0, -0.07, 0.5402);
    node_nozzle_throat_orange_70.rotation.set(0.0, 0.0, 0.0);
    node_nozzle_throat_orange_70.scale.set(1.0, 1.0, 1.0);
  }
  node_nozzle_throat_orange_70.userData.sculptComponent = {"id": "nozzle-throat-orange", "name": "Nozzle Throat Orange", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.49999999999999994, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.416, 0.158], [2.728, -0.05], [2.416, -0.238]], "depth": 0.2496}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-throat-orange-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.54], "localEnd": [0.0, -0.07, 0.54], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.5402], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_throat_orange_70.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_nozzle_throat_orange_70);
  nodes["nozzle-throat-orange"] = node_nozzle_throat_orange_70;
  const mesh_nozzle_throat_orange_70Geometry = endpoint_nozzle_throat_orange_70
    ? new THREE.CylinderGeometry(endpoint_nozzle_throat_orange_70.endRadius, endpoint_nozzle_throat_orange_70.baseRadius, endpoint_nozzle_throat_orange_70.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.416, 0.158], [2.728, -0.05], [2.416, -0.238]], "depth": 0.2496});
  const mesh_nozzle_throat_orange_70 = new THREE.Mesh(
    mesh_nozzle_throat_orange_70Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nozzle_throat_orange_70.name = "Nozzle Throat Orange";
  if (endpoint_nozzle_throat_orange_70) {
    mesh_nozzle_throat_orange_70.position.copy(endpoint_nozzle_throat_orange_70.midpoint);
    mesh_nozzle_throat_orange_70.quaternion.copy(endpoint_nozzle_throat_orange_70.quaternion);
  }
  mesh_nozzle_throat_orange_70.castShadow = options.castShadow ?? true;
  mesh_nozzle_throat_orange_70.receiveShadow = options.receiveShadow ?? true;
  mesh_nozzle_throat_orange_70.userData.sculptComponent = {"id": "nozzle-throat-orange", "name": "Nozzle Throat Orange", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.49999999999999994, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.416, 0.158], [2.728, -0.05], [2.416, -0.238]], "depth": 0.2496}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-throat-orange-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.54], "localEnd": [0.0, -0.07, 0.54], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.5402], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_throat_orange_70.add(mesh_nozzle_throat_orange_70);
  meshes["nozzle-throat-orange"] = mesh_nozzle_throat_orange_70;
  colliders["nozzle-throat-orange"] = {"type": "box", "fit": "tight"};

  const attachment_nozzle_core_71 = {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-core-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.683], "localEnd": [0.0, -0.07, 0.683], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]};
  const endpoint_nozzle_core_71 = makeAttachmentEndpoint(attachment_nozzle_core_71);
  const node_nozzle_core_71 = new THREE.Group();
  node_nozzle_core_71.name = "Nozzle Core__pivot";
  if (endpoint_nozzle_core_71) {
    node_nozzle_core_71.position.copy(endpoint_nozzle_core_71.start);
    node_nozzle_core_71.rotation.set(0, 0, 0);
    node_nozzle_core_71.scale.set(1, 1, 1);
  } else {
    node_nozzle_core_71.position.set(0.0, -0.07, 0.6826);
    node_nozzle_core_71.rotation.set(0.0, 0.0, 0.0);
    node_nozzle_core_71.scale.set(1.0, 1.0, 1.0);
  }
  node_nozzle_core_71.userData.sculptComponent = {"id": "nozzle-core", "name": "Nozzle Core", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.3999999999999999, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.468, 0.059], [2.624, -0.045], [2.468, -0.139]], "depth": 0.1248}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-core-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.683], "localEnd": [0.0, -0.07, 0.683], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.6826], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_core_71.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_nozzle_core_71);
  nodes["nozzle-core"] = node_nozzle_core_71;
  const mesh_nozzle_core_71Geometry = endpoint_nozzle_core_71
    ? new THREE.CylinderGeometry(endpoint_nozzle_core_71.endRadius, endpoint_nozzle_core_71.baseRadius, endpoint_nozzle_core_71.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.468, 0.059], [2.624, -0.045], [2.468, -0.139]], "depth": 0.1248});
  const mesh_nozzle_core_71 = new THREE.Mesh(
    mesh_nozzle_core_71Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nozzle_core_71.name = "Nozzle Core";
  if (endpoint_nozzle_core_71) {
    mesh_nozzle_core_71.position.copy(endpoint_nozzle_core_71.midpoint);
    mesh_nozzle_core_71.quaternion.copy(endpoint_nozzle_core_71.quaternion);
  }
  mesh_nozzle_core_71.castShadow = options.castShadow ?? true;
  mesh_nozzle_core_71.receiveShadow = options.receiveShadow ?? true;
  mesh_nozzle_core_71.userData.sculptComponent = {"id": "nozzle-core", "name": "Nozzle Core", "level": "micro", "role": "detail", "logicalParent": "stern-bay-housing", "importance": 0.3999999999999999, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; modelled as nested prisms of decreasing section so the banding survives off-axis views.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[2.468, 0.059], [2.624, -0.045], [2.468, -0.139]], "depth": 0.1248}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stern-bay-housing/nozzle-core-mount", "structuralParent": "stern-bay-housing", "localStart": [0.0, -0.07, 0.683], "localEnd": [0.0, -0.07, 0.683], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["stern-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.07, 0.6826], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["stern-zone"], "details": ["d11"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_nozzle_core_71.add(mesh_nozzle_core_71);
  meshes["nozzle-core"] = mesh_nozzle_core_71;
  colliders["nozzle-core"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_1_72 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, -0.34], "localEnd": [-1.93, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_1_72 = makeAttachmentEndpoint(attachment_mast_base_vent_port_1_72);
  const node_mast_base_vent_port_1_72 = new THREE.Group();
  node_mast_base_vent_port_1_72.name = "Mast base vent port 1__pivot";
  if (endpoint_mast_base_vent_port_1_72) {
    node_mast_base_vent_port_1_72.position.copy(endpoint_mast_base_vent_port_1_72.start);
    node_mast_base_vent_port_1_72.rotation.set(0, 0, 0);
    node_mast_base_vent_port_1_72.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_1_72.position.set(-1.93, 0.2, -0.34);
    node_mast_base_vent_port_1_72.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_1_72.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_1_72.userData.sculptComponent = {"id": "mast-base-vent-port-1", "name": "Mast base vent port 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, -0.34], "localEnd": [-1.93, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_1_72.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_1_72);
  nodes["mast-base-vent-port-1"] = node_mast_base_vent_port_1_72;
  const mesh_mast_base_vent_port_1_72Geometry = endpoint_mast_base_vent_port_1_72
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_1_72.endRadius, endpoint_mast_base_vent_port_1_72.baseRadius, endpoint_mast_base_vent_port_1_72.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_1_72 = new THREE.Mesh(
    mesh_mast_base_vent_port_1_72Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_1_72.name = "Mast base vent port 1";
  if (endpoint_mast_base_vent_port_1_72) {
    mesh_mast_base_vent_port_1_72.position.copy(endpoint_mast_base_vent_port_1_72.midpoint);
    mesh_mast_base_vent_port_1_72.quaternion.copy(endpoint_mast_base_vent_port_1_72.quaternion);
  }
  mesh_mast_base_vent_port_1_72.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_1_72.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_1_72.userData.sculptComponent = {"id": "mast-base-vent-port-1", "name": "Mast base vent port 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, -0.34], "localEnd": [-1.93, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_1_72.add(mesh_mast_base_vent_port_1_72);
  meshes["mast-base-vent-port-1"] = mesh_mast_base_vent_port_1_72;
  colliders["mast-base-vent-port-1"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_2_73 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, -0.34], "localEnd": [-1.8, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_2_73 = makeAttachmentEndpoint(attachment_mast_base_vent_port_2_73);
  const node_mast_base_vent_port_2_73 = new THREE.Group();
  node_mast_base_vent_port_2_73.name = "Mast base vent port 2__pivot";
  if (endpoint_mast_base_vent_port_2_73) {
    node_mast_base_vent_port_2_73.position.copy(endpoint_mast_base_vent_port_2_73.start);
    node_mast_base_vent_port_2_73.rotation.set(0, 0, 0);
    node_mast_base_vent_port_2_73.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_2_73.position.set(-1.7999999999999998, 0.2, -0.34);
    node_mast_base_vent_port_2_73.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_2_73.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_2_73.userData.sculptComponent = {"id": "mast-base-vent-port-2", "name": "Mast base vent port 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, -0.34], "localEnd": [-1.8, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_2_73.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_2_73);
  nodes["mast-base-vent-port-2"] = node_mast_base_vent_port_2_73;
  const mesh_mast_base_vent_port_2_73Geometry = endpoint_mast_base_vent_port_2_73
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_2_73.endRadius, endpoint_mast_base_vent_port_2_73.baseRadius, endpoint_mast_base_vent_port_2_73.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_2_73 = new THREE.Mesh(
    mesh_mast_base_vent_port_2_73Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_2_73.name = "Mast base vent port 2";
  if (endpoint_mast_base_vent_port_2_73) {
    mesh_mast_base_vent_port_2_73.position.copy(endpoint_mast_base_vent_port_2_73.midpoint);
    mesh_mast_base_vent_port_2_73.quaternion.copy(endpoint_mast_base_vent_port_2_73.quaternion);
  }
  mesh_mast_base_vent_port_2_73.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_2_73.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_2_73.userData.sculptComponent = {"id": "mast-base-vent-port-2", "name": "Mast base vent port 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, -0.34], "localEnd": [-1.8, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_2_73.add(mesh_mast_base_vent_port_2_73);
  meshes["mast-base-vent-port-2"] = mesh_mast_base_vent_port_2_73;
  colliders["mast-base-vent-port-2"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_3_74 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, -0.34], "localEnd": [-1.67, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_3_74 = makeAttachmentEndpoint(attachment_mast_base_vent_port_3_74);
  const node_mast_base_vent_port_3_74 = new THREE.Group();
  node_mast_base_vent_port_3_74.name = "Mast base vent port 3__pivot";
  if (endpoint_mast_base_vent_port_3_74) {
    node_mast_base_vent_port_3_74.position.copy(endpoint_mast_base_vent_port_3_74.start);
    node_mast_base_vent_port_3_74.rotation.set(0, 0, 0);
    node_mast_base_vent_port_3_74.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_3_74.position.set(-1.67, 0.2, -0.34);
    node_mast_base_vent_port_3_74.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_3_74.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_3_74.userData.sculptComponent = {"id": "mast-base-vent-port-3", "name": "Mast base vent port 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, -0.34], "localEnd": [-1.67, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_3_74.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_3_74);
  nodes["mast-base-vent-port-3"] = node_mast_base_vent_port_3_74;
  const mesh_mast_base_vent_port_3_74Geometry = endpoint_mast_base_vent_port_3_74
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_3_74.endRadius, endpoint_mast_base_vent_port_3_74.baseRadius, endpoint_mast_base_vent_port_3_74.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_3_74 = new THREE.Mesh(
    mesh_mast_base_vent_port_3_74Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_3_74.name = "Mast base vent port 3";
  if (endpoint_mast_base_vent_port_3_74) {
    mesh_mast_base_vent_port_3_74.position.copy(endpoint_mast_base_vent_port_3_74.midpoint);
    mesh_mast_base_vent_port_3_74.quaternion.copy(endpoint_mast_base_vent_port_3_74.quaternion);
  }
  mesh_mast_base_vent_port_3_74.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_3_74.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_3_74.userData.sculptComponent = {"id": "mast-base-vent-port-3", "name": "Mast base vent port 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, -0.34], "localEnd": [-1.67, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_3_74.add(mesh_mast_base_vent_port_3_74);
  meshes["mast-base-vent-port-3"] = mesh_mast_base_vent_port_3_74;
  colliders["mast-base-vent-port-3"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_port_4_75 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, -0.34], "localEnd": [-1.54, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_port_4_75 = makeAttachmentEndpoint(attachment_mast_base_vent_port_4_75);
  const node_mast_base_vent_port_4_75 = new THREE.Group();
  node_mast_base_vent_port_4_75.name = "Mast base vent port 4__pivot";
  if (endpoint_mast_base_vent_port_4_75) {
    node_mast_base_vent_port_4_75.position.copy(endpoint_mast_base_vent_port_4_75.start);
    node_mast_base_vent_port_4_75.rotation.set(0, 0, 0);
    node_mast_base_vent_port_4_75.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_port_4_75.position.set(-1.54, 0.2, -0.34);
    node_mast_base_vent_port_4_75.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_port_4_75.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_port_4_75.userData.sculptComponent = {"id": "mast-base-vent-port-4", "name": "Mast base vent port 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, -0.34], "localEnd": [-1.54, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_4_75.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_port_4_75);
  nodes["mast-base-vent-port-4"] = node_mast_base_vent_port_4_75;
  const mesh_mast_base_vent_port_4_75Geometry = endpoint_mast_base_vent_port_4_75
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_port_4_75.endRadius, endpoint_mast_base_vent_port_4_75.baseRadius, endpoint_mast_base_vent_port_4_75.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_port_4_75 = new THREE.Mesh(
    mesh_mast_base_vent_port_4_75Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_port_4_75.name = "Mast base vent port 4";
  if (endpoint_mast_base_vent_port_4_75) {
    mesh_mast_base_vent_port_4_75.position.copy(endpoint_mast_base_vent_port_4_75.midpoint);
    mesh_mast_base_vent_port_4_75.quaternion.copy(endpoint_mast_base_vent_port_4_75.quaternion);
  }
  mesh_mast_base_vent_port_4_75.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_port_4_75.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_port_4_75.userData.sculptComponent = {"id": "mast-base-vent-port-4", "name": "Mast base vent port 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-port-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, -0.34], "localEnd": [-1.54, 0.2, -0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, -0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_port_4_75.add(mesh_mast_base_vent_port_4_75);
  meshes["mast-base-vent-port-4"] = mesh_mast_base_vent_port_4_75;
  colliders["mast-base-vent-port-4"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_1_76 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, 0.34], "localEnd": [-1.93, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_1_76 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_1_76);
  const node_mast_base_vent_stbd_1_76 = new THREE.Group();
  node_mast_base_vent_stbd_1_76.name = "Mast base vent stbd 1__pivot";
  if (endpoint_mast_base_vent_stbd_1_76) {
    node_mast_base_vent_stbd_1_76.position.copy(endpoint_mast_base_vent_stbd_1_76.start);
    node_mast_base_vent_stbd_1_76.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_1_76.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_1_76.position.set(-1.93, 0.2, 0.34);
    node_mast_base_vent_stbd_1_76.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_1_76.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_1_76.userData.sculptComponent = {"id": "mast-base-vent-stbd-1", "name": "Mast base vent stbd 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, 0.34], "localEnd": [-1.93, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_1_76.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_1_76);
  nodes["mast-base-vent-stbd-1"] = node_mast_base_vent_stbd_1_76;
  const mesh_mast_base_vent_stbd_1_76Geometry = endpoint_mast_base_vent_stbd_1_76
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_1_76.endRadius, endpoint_mast_base_vent_stbd_1_76.baseRadius, endpoint_mast_base_vent_stbd_1_76.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_1_76 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_1_76Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_1_76.name = "Mast base vent stbd 1";
  if (endpoint_mast_base_vent_stbd_1_76) {
    mesh_mast_base_vent_stbd_1_76.position.copy(endpoint_mast_base_vent_stbd_1_76.midpoint);
    mesh_mast_base_vent_stbd_1_76.quaternion.copy(endpoint_mast_base_vent_stbd_1_76.quaternion);
  }
  mesh_mast_base_vent_stbd_1_76.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_1_76.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_1_76.userData.sculptComponent = {"id": "mast-base-vent-stbd-1", "name": "Mast base vent stbd 1", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-1-mount", "structuralParent": "mast-base-housing", "localStart": [-1.93, 0.2, 0.34], "localEnd": [-1.93, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.93, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_1_76.add(mesh_mast_base_vent_stbd_1_76);
  meshes["mast-base-vent-stbd-1"] = mesh_mast_base_vent_stbd_1_76;
  colliders["mast-base-vent-stbd-1"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_2_77 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, 0.34], "localEnd": [-1.8, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_2_77 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_2_77);
  const node_mast_base_vent_stbd_2_77 = new THREE.Group();
  node_mast_base_vent_stbd_2_77.name = "Mast base vent stbd 2__pivot";
  if (endpoint_mast_base_vent_stbd_2_77) {
    node_mast_base_vent_stbd_2_77.position.copy(endpoint_mast_base_vent_stbd_2_77.start);
    node_mast_base_vent_stbd_2_77.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_2_77.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_2_77.position.set(-1.7999999999999998, 0.2, 0.34);
    node_mast_base_vent_stbd_2_77.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_2_77.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_2_77.userData.sculptComponent = {"id": "mast-base-vent-stbd-2", "name": "Mast base vent stbd 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, 0.34], "localEnd": [-1.8, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_2_77.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_2_77);
  nodes["mast-base-vent-stbd-2"] = node_mast_base_vent_stbd_2_77;
  const mesh_mast_base_vent_stbd_2_77Geometry = endpoint_mast_base_vent_stbd_2_77
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_2_77.endRadius, endpoint_mast_base_vent_stbd_2_77.baseRadius, endpoint_mast_base_vent_stbd_2_77.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_2_77 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_2_77Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_2_77.name = "Mast base vent stbd 2";
  if (endpoint_mast_base_vent_stbd_2_77) {
    mesh_mast_base_vent_stbd_2_77.position.copy(endpoint_mast_base_vent_stbd_2_77.midpoint);
    mesh_mast_base_vent_stbd_2_77.quaternion.copy(endpoint_mast_base_vent_stbd_2_77.quaternion);
  }
  mesh_mast_base_vent_stbd_2_77.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_2_77.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_2_77.userData.sculptComponent = {"id": "mast-base-vent-stbd-2", "name": "Mast base vent stbd 2", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-2-mount", "structuralParent": "mast-base-housing", "localStart": [-1.8, 0.2, 0.34], "localEnd": [-1.8, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.7999999999999998, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_2_77.add(mesh_mast_base_vent_stbd_2_77);
  meshes["mast-base-vent-stbd-2"] = mesh_mast_base_vent_stbd_2_77;
  colliders["mast-base-vent-stbd-2"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_3_78 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, 0.34], "localEnd": [-1.67, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_3_78 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_3_78);
  const node_mast_base_vent_stbd_3_78 = new THREE.Group();
  node_mast_base_vent_stbd_3_78.name = "Mast base vent stbd 3__pivot";
  if (endpoint_mast_base_vent_stbd_3_78) {
    node_mast_base_vent_stbd_3_78.position.copy(endpoint_mast_base_vent_stbd_3_78.start);
    node_mast_base_vent_stbd_3_78.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_3_78.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_3_78.position.set(-1.67, 0.2, 0.34);
    node_mast_base_vent_stbd_3_78.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_3_78.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_3_78.userData.sculptComponent = {"id": "mast-base-vent-stbd-3", "name": "Mast base vent stbd 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, 0.34], "localEnd": [-1.67, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_3_78.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_3_78);
  nodes["mast-base-vent-stbd-3"] = node_mast_base_vent_stbd_3_78;
  const mesh_mast_base_vent_stbd_3_78Geometry = endpoint_mast_base_vent_stbd_3_78
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_3_78.endRadius, endpoint_mast_base_vent_stbd_3_78.baseRadius, endpoint_mast_base_vent_stbd_3_78.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_3_78 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_3_78Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_3_78.name = "Mast base vent stbd 3";
  if (endpoint_mast_base_vent_stbd_3_78) {
    mesh_mast_base_vent_stbd_3_78.position.copy(endpoint_mast_base_vent_stbd_3_78.midpoint);
    mesh_mast_base_vent_stbd_3_78.quaternion.copy(endpoint_mast_base_vent_stbd_3_78.quaternion);
  }
  mesh_mast_base_vent_stbd_3_78.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_3_78.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_3_78.userData.sculptComponent = {"id": "mast-base-vent-stbd-3", "name": "Mast base vent stbd 3", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-3-mount", "structuralParent": "mast-base-housing", "localStart": [-1.67, 0.2, 0.34], "localEnd": [-1.67, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.67, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_3_78.add(mesh_mast_base_vent_stbd_3_78);
  meshes["mast-base-vent-stbd-3"] = mesh_mast_base_vent_stbd_3_78;
  colliders["mast-base-vent-stbd-3"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_vent_stbd_4_79 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, 0.34], "localEnd": [-1.54, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_vent_stbd_4_79 = makeAttachmentEndpoint(attachment_mast_base_vent_stbd_4_79);
  const node_mast_base_vent_stbd_4_79 = new THREE.Group();
  node_mast_base_vent_stbd_4_79.name = "Mast base vent stbd 4__pivot";
  if (endpoint_mast_base_vent_stbd_4_79) {
    node_mast_base_vent_stbd_4_79.position.copy(endpoint_mast_base_vent_stbd_4_79.start);
    node_mast_base_vent_stbd_4_79.rotation.set(0, 0, 0);
    node_mast_base_vent_stbd_4_79.scale.set(1, 1, 1);
  } else {
    node_mast_base_vent_stbd_4_79.position.set(-1.54, 0.2, 0.34);
    node_mast_base_vent_stbd_4_79.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_vent_stbd_4_79.scale.set(0.09, 0.05, 0.16);
  }
  node_mast_base_vent_stbd_4_79.userData.sculptComponent = {"id": "mast-base-vent-stbd-4", "name": "Mast base vent stbd 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, 0.34], "localEnd": [-1.54, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_4_79.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_vent_stbd_4_79);
  nodes["mast-base-vent-stbd-4"] = node_mast_base_vent_stbd_4_79;
  const mesh_mast_base_vent_stbd_4_79Geometry = endpoint_mast_base_vent_stbd_4_79
    ? new THREE.CylinderGeometry(endpoint_mast_base_vent_stbd_4_79.endRadius, endpoint_mast_base_vent_stbd_4_79.baseRadius, endpoint_mast_base_vent_stbd_4_79.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mast_base_vent_stbd_4_79 = new THREE.Mesh(
    mesh_mast_base_vent_stbd_4_79Geometry,
    materialMap["vane-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_vent_stbd_4_79.name = "Mast base vent stbd 4";
  if (endpoint_mast_base_vent_stbd_4_79) {
    mesh_mast_base_vent_stbd_4_79.position.copy(endpoint_mast_base_vent_stbd_4_79.midpoint);
    mesh_mast_base_vent_stbd_4_79.quaternion.copy(endpoint_mast_base_vent_stbd_4_79.quaternion);
  }
  mesh_mast_base_vent_stbd_4_79.castShadow = options.castShadow ?? true;
  mesh_mast_base_vent_stbd_4_79.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_vent_stbd_4_79.userData.sculptComponent = {"id": "mast-base-vent-stbd-4", "name": "Mast base vent stbd 4", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.3, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Louvre slat in the base vent bank.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-vent-stbd-4-mount", "structuralParent": "mast-base-housing", "localStart": [-1.54, 0.2, 0.34], "localEnd": [-1.54, 0.2, 0.34], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 0.09, "height": 0.05, "depth": 0.16, "units": "relative", "confidence": 0.65}, "transform": {"position": [-1.54, 0.2, 0.34], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "vane-yellow", "materialLayers": ["vane-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d14"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 179, 1, 1.0)", "secondaryAlbedo": "rgba(168, 140, 0, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.62, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(214, 179, 1, 1.0)"}, {"position": 1.0, "color": "rgba(168, 140, 0, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_vent_stbd_4_79.add(mesh_mast_base_vent_stbd_4_79);
  meshes["mast-base-vent-stbd-4"] = mesh_mast_base_vent_stbd_4_79;
  colliders["mast-base-vent-stbd-4"] = {"type": "box", "fit": "tight"};

  const attachment_mast_base_diamond_hatch_80 = {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-diamond-hatch-mount", "structuralParent": "mast-base-housing", "localStart": [0, 0, 0.31], "localEnd": [0, 0, 0.31], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]};
  const endpoint_mast_base_diamond_hatch_80 = makeAttachmentEndpoint(attachment_mast_base_diamond_hatch_80);
  const node_mast_base_diamond_hatch_80 = new THREE.Group();
  node_mast_base_diamond_hatch_80.name = "Mast base diamond hatch__pivot";
  if (endpoint_mast_base_diamond_hatch_80) {
    node_mast_base_diamond_hatch_80.position.copy(endpoint_mast_base_diamond_hatch_80.start);
    node_mast_base_diamond_hatch_80.rotation.set(0, 0, 0);
    node_mast_base_diamond_hatch_80.scale.set(1, 1, 1);
  } else {
    node_mast_base_diamond_hatch_80.position.set(0.0, 0.0, 0.31);
    node_mast_base_diamond_hatch_80.rotation.set(0.0, 0.0, 0.0);
    node_mast_base_diamond_hatch_80.scale.set(1.0, 1.0, 1.0);
  }
  node_mast_base_diamond_hatch_80.userData.sculptComponent = {"id": "mast-base-diamond-hatch", "name": "Mast base diamond hatch", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.35, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat diamond hatch plate on the housing face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.61, 0.55], [-1.39, 0.37], [-1.61, 0.19], [-1.83, 0.37]], "depth": 0.04}}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-diamond-hatch-mount", "structuralParent": "mast-base-housing", "localStart": [0, 0, 0.31], "localEnd": [0, 0, 0.31], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.31], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d15"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_diamond_hatch_80.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["mast-base-housing"] ?? root).add(node_mast_base_diamond_hatch_80);
  nodes["mast-base-diamond-hatch"] = node_mast_base_diamond_hatch_80;
  const mesh_mast_base_diamond_hatch_80Geometry = endpoint_mast_base_diamond_hatch_80
    ? new THREE.CylinderGeometry(endpoint_mast_base_diamond_hatch_80.endRadius, endpoint_mast_base_diamond_hatch_80.baseRadius, endpoint_mast_base_diamond_hatch_80.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.61, 0.55], [-1.39, 0.37], [-1.61, 0.19], [-1.83, 0.37]], "depth": 0.04});
  const mesh_mast_base_diamond_hatch_80 = new THREE.Mesh(
    mesh_mast_base_diamond_hatch_80Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mast_base_diamond_hatch_80.name = "Mast base diamond hatch";
  if (endpoint_mast_base_diamond_hatch_80) {
    mesh_mast_base_diamond_hatch_80.position.copy(endpoint_mast_base_diamond_hatch_80.midpoint);
    mesh_mast_base_diamond_hatch_80.quaternion.copy(endpoint_mast_base_diamond_hatch_80.quaternion);
  }
  mesh_mast_base_diamond_hatch_80.castShadow = options.castShadow ?? true;
  mesh_mast_base_diamond_hatch_80.receiveShadow = options.receiveShadow ?? true;
  mesh_mast_base_diamond_hatch_80.userData.sculptComponent = {"id": "mast-base-diamond-hatch", "name": "Mast base diamond hatch", "level": "micro", "role": "detail", "logicalParent": "mast-base-housing", "importance": 0.35, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat diamond hatch plate on the housing face.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)", "profile2D": {"points": [[-1.61, 0.55], [-1.39, 0.37], [-1.61, 0.19], [-1.83, 0.37]], "depth": 0.04}}, "parent": "mast-base-housing", "attachment": {"parentId": "mast-base-housing", "parentSocket": "mast-base-housing/mast-base-diamond-hatch-mount", "structuralParent": "mast-base-housing", "localStart": [0, 0, 0.31], "localEnd": [0, 0, 0.31], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["mast-zone"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0.31], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["mast-zone"], "details": ["d15"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_mast_base_diamond_hatch_80.add(mesh_mast_base_diamond_hatch_80);
  meshes["mast-base-diamond-hatch"] = mesh_mast_base_diamond_hatch_80;
  colliders["mast-base-diamond-hatch"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_1_81 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-1-mount", "structuralParent": "root", "localStart": [-2.2, 0.5, 0.475], "localEnd": [-2.2, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_1_81 = makeAttachmentEndpoint(attachment_hull_antenna_nub_1_81);
  const node_hull_antenna_nub_1_81 = new THREE.Group();
  node_hull_antenna_nub_1_81.name = "Hull antenna nub 1__pivot";
  if (endpoint_hull_antenna_nub_1_81) {
    node_hull_antenna_nub_1_81.position.copy(endpoint_hull_antenna_nub_1_81.start);
    node_hull_antenna_nub_1_81.rotation.set(0, 0, 0);
    node_hull_antenna_nub_1_81.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_1_81.position.set(-2.2, 0.5, 0.475);
    node_hull_antenna_nub_1_81.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_1_81.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_1_81.userData.sculptComponent = {"id": "hull-antenna-nub-1", "name": "Hull antenna nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-1-mount", "structuralParent": "root", "localStart": [-2.2, 0.5, 0.475], "localEnd": [-2.2, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-2.2, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_1_81.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_1_81);
  nodes["hull-antenna-nub-1"] = node_hull_antenna_nub_1_81;
  const mesh_hull_antenna_nub_1_81Geometry = endpoint_hull_antenna_nub_1_81
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_1_81.endRadius, endpoint_hull_antenna_nub_1_81.baseRadius, endpoint_hull_antenna_nub_1_81.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_1_81 = new THREE.Mesh(
    mesh_hull_antenna_nub_1_81Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_1_81.name = "Hull antenna nub 1";
  if (endpoint_hull_antenna_nub_1_81) {
    mesh_hull_antenna_nub_1_81.position.copy(endpoint_hull_antenna_nub_1_81.midpoint);
    mesh_hull_antenna_nub_1_81.quaternion.copy(endpoint_hull_antenna_nub_1_81.quaternion);
  }
  mesh_hull_antenna_nub_1_81.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_1_81.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_1_81.userData.sculptComponent = {"id": "hull-antenna-nub-1", "name": "Hull antenna nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-1-mount", "structuralParent": "root", "localStart": [-2.2, 0.5, 0.475], "localEnd": [-2.2, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-2.2, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_1_81.add(mesh_hull_antenna_nub_1_81);
  meshes["hull-antenna-nub-1"] = mesh_hull_antenna_nub_1_81;
  colliders["hull-antenna-nub-1"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_2_82 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-2-mount", "structuralParent": "root", "localStart": [-1.25, 0.5, 0.475], "localEnd": [-1.25, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_2_82 = makeAttachmentEndpoint(attachment_hull_antenna_nub_2_82);
  const node_hull_antenna_nub_2_82 = new THREE.Group();
  node_hull_antenna_nub_2_82.name = "Hull antenna nub 2__pivot";
  if (endpoint_hull_antenna_nub_2_82) {
    node_hull_antenna_nub_2_82.position.copy(endpoint_hull_antenna_nub_2_82.start);
    node_hull_antenna_nub_2_82.rotation.set(0, 0, 0);
    node_hull_antenna_nub_2_82.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_2_82.position.set(-1.2500000000000002, 0.5, 0.475);
    node_hull_antenna_nub_2_82.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_2_82.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_2_82.userData.sculptComponent = {"id": "hull-antenna-nub-2", "name": "Hull antenna nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-2-mount", "structuralParent": "root", "localStart": [-1.25, 0.5, 0.475], "localEnd": [-1.25, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-1.2500000000000002, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_2_82.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_2_82);
  nodes["hull-antenna-nub-2"] = node_hull_antenna_nub_2_82;
  const mesh_hull_antenna_nub_2_82Geometry = endpoint_hull_antenna_nub_2_82
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_2_82.endRadius, endpoint_hull_antenna_nub_2_82.baseRadius, endpoint_hull_antenna_nub_2_82.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_2_82 = new THREE.Mesh(
    mesh_hull_antenna_nub_2_82Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_2_82.name = "Hull antenna nub 2";
  if (endpoint_hull_antenna_nub_2_82) {
    mesh_hull_antenna_nub_2_82.position.copy(endpoint_hull_antenna_nub_2_82.midpoint);
    mesh_hull_antenna_nub_2_82.quaternion.copy(endpoint_hull_antenna_nub_2_82.quaternion);
  }
  mesh_hull_antenna_nub_2_82.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_2_82.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_2_82.userData.sculptComponent = {"id": "hull-antenna-nub-2", "name": "Hull antenna nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-2-mount", "structuralParent": "root", "localStart": [-1.25, 0.5, 0.475], "localEnd": [-1.25, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-1.2500000000000002, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_2_82.add(mesh_hull_antenna_nub_2_82);
  meshes["hull-antenna-nub-2"] = mesh_hull_antenna_nub_2_82;
  colliders["hull-antenna-nub-2"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_3_83 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-3-mount", "structuralParent": "root", "localStart": [-0.3, 0.5, 0.475], "localEnd": [-0.3, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_3_83 = makeAttachmentEndpoint(attachment_hull_antenna_nub_3_83);
  const node_hull_antenna_nub_3_83 = new THREE.Group();
  node_hull_antenna_nub_3_83.name = "Hull antenna nub 3__pivot";
  if (endpoint_hull_antenna_nub_3_83) {
    node_hull_antenna_nub_3_83.position.copy(endpoint_hull_antenna_nub_3_83.start);
    node_hull_antenna_nub_3_83.rotation.set(0, 0, 0);
    node_hull_antenna_nub_3_83.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_3_83.position.set(-0.30000000000000027, 0.5, 0.475);
    node_hull_antenna_nub_3_83.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_3_83.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_3_83.userData.sculptComponent = {"id": "hull-antenna-nub-3", "name": "Hull antenna nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-3-mount", "structuralParent": "root", "localStart": [-0.3, 0.5, 0.475], "localEnd": [-0.3, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-0.30000000000000027, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_3_83.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_3_83);
  nodes["hull-antenna-nub-3"] = node_hull_antenna_nub_3_83;
  const mesh_hull_antenna_nub_3_83Geometry = endpoint_hull_antenna_nub_3_83
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_3_83.endRadius, endpoint_hull_antenna_nub_3_83.baseRadius, endpoint_hull_antenna_nub_3_83.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_3_83 = new THREE.Mesh(
    mesh_hull_antenna_nub_3_83Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_3_83.name = "Hull antenna nub 3";
  if (endpoint_hull_antenna_nub_3_83) {
    mesh_hull_antenna_nub_3_83.position.copy(endpoint_hull_antenna_nub_3_83.midpoint);
    mesh_hull_antenna_nub_3_83.quaternion.copy(endpoint_hull_antenna_nub_3_83.quaternion);
  }
  mesh_hull_antenna_nub_3_83.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_3_83.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_3_83.userData.sculptComponent = {"id": "hull-antenna-nub-3", "name": "Hull antenna nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-3-mount", "structuralParent": "root", "localStart": [-0.3, 0.5, 0.475], "localEnd": [-0.3, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [-0.30000000000000027, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_3_83.add(mesh_hull_antenna_nub_3_83);
  meshes["hull-antenna-nub-3"] = mesh_hull_antenna_nub_3_83;
  colliders["hull-antenna-nub-3"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_4_84 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-4-mount", "structuralParent": "root", "localStart": [0.65, 0.5, 0.475], "localEnd": [0.65, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_4_84 = makeAttachmentEndpoint(attachment_hull_antenna_nub_4_84);
  const node_hull_antenna_nub_4_84 = new THREE.Group();
  node_hull_antenna_nub_4_84.name = "Hull antenna nub 4__pivot";
  if (endpoint_hull_antenna_nub_4_84) {
    node_hull_antenna_nub_4_84.position.copy(endpoint_hull_antenna_nub_4_84.start);
    node_hull_antenna_nub_4_84.rotation.set(0, 0, 0);
    node_hull_antenna_nub_4_84.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_4_84.position.set(0.6499999999999995, 0.5, 0.475);
    node_hull_antenna_nub_4_84.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_4_84.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_4_84.userData.sculptComponent = {"id": "hull-antenna-nub-4", "name": "Hull antenna nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-4-mount", "structuralParent": "root", "localStart": [0.65, 0.5, 0.475], "localEnd": [0.65, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [0.6499999999999995, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_4_84.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_4_84);
  nodes["hull-antenna-nub-4"] = node_hull_antenna_nub_4_84;
  const mesh_hull_antenna_nub_4_84Geometry = endpoint_hull_antenna_nub_4_84
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_4_84.endRadius, endpoint_hull_antenna_nub_4_84.baseRadius, endpoint_hull_antenna_nub_4_84.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_4_84 = new THREE.Mesh(
    mesh_hull_antenna_nub_4_84Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_4_84.name = "Hull antenna nub 4";
  if (endpoint_hull_antenna_nub_4_84) {
    mesh_hull_antenna_nub_4_84.position.copy(endpoint_hull_antenna_nub_4_84.midpoint);
    mesh_hull_antenna_nub_4_84.quaternion.copy(endpoint_hull_antenna_nub_4_84.quaternion);
  }
  mesh_hull_antenna_nub_4_84.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_4_84.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_4_84.userData.sculptComponent = {"id": "hull-antenna-nub-4", "name": "Hull antenna nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-4-mount", "structuralParent": "root", "localStart": [0.65, 0.5, 0.475], "localEnd": [0.65, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [0.6499999999999995, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_4_84.add(mesh_hull_antenna_nub_4_84);
  meshes["hull-antenna-nub-4"] = mesh_hull_antenna_nub_4_84;
  colliders["hull-antenna-nub-4"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_5_85 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-5-mount", "structuralParent": "root", "localStart": [1.6, 0.5, 0.475], "localEnd": [1.6, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_5_85 = makeAttachmentEndpoint(attachment_hull_antenna_nub_5_85);
  const node_hull_antenna_nub_5_85 = new THREE.Group();
  node_hull_antenna_nub_5_85.name = "Hull antenna nub 5__pivot";
  if (endpoint_hull_antenna_nub_5_85) {
    node_hull_antenna_nub_5_85.position.copy(endpoint_hull_antenna_nub_5_85.start);
    node_hull_antenna_nub_5_85.rotation.set(0, 0, 0);
    node_hull_antenna_nub_5_85.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_5_85.position.set(1.5999999999999996, 0.5, 0.475);
    node_hull_antenna_nub_5_85.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_5_85.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_5_85.userData.sculptComponent = {"id": "hull-antenna-nub-5", "name": "Hull antenna nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-5-mount", "structuralParent": "root", "localStart": [1.6, 0.5, 0.475], "localEnd": [1.6, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [1.5999999999999996, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_5_85.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_5_85);
  nodes["hull-antenna-nub-5"] = node_hull_antenna_nub_5_85;
  const mesh_hull_antenna_nub_5_85Geometry = endpoint_hull_antenna_nub_5_85
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_5_85.endRadius, endpoint_hull_antenna_nub_5_85.baseRadius, endpoint_hull_antenna_nub_5_85.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_5_85 = new THREE.Mesh(
    mesh_hull_antenna_nub_5_85Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_5_85.name = "Hull antenna nub 5";
  if (endpoint_hull_antenna_nub_5_85) {
    mesh_hull_antenna_nub_5_85.position.copy(endpoint_hull_antenna_nub_5_85.midpoint);
    mesh_hull_antenna_nub_5_85.quaternion.copy(endpoint_hull_antenna_nub_5_85.quaternion);
  }
  mesh_hull_antenna_nub_5_85.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_5_85.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_5_85.userData.sculptComponent = {"id": "hull-antenna-nub-5", "name": "Hull antenna nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-5-mount", "structuralParent": "root", "localStart": [1.6, 0.5, 0.475], "localEnd": [1.6, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [1.5999999999999996, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_5_85.add(mesh_hull_antenna_nub_5_85);
  meshes["hull-antenna-nub-5"] = mesh_hull_antenna_nub_5_85;
  colliders["hull-antenna-nub-5"] = {"type": "box", "fit": "tight"};

  const attachment_hull_antenna_nub_6_86 = {"parentId": "root", "parentSocket": "root/hull-antenna-nub-6-mount", "structuralParent": "root", "localStart": [2.55, 0.5, 0.475], "localEnd": [2.55, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_hull_antenna_nub_6_86 = makeAttachmentEndpoint(attachment_hull_antenna_nub_6_86);
  const node_hull_antenna_nub_6_86 = new THREE.Group();
  node_hull_antenna_nub_6_86.name = "Hull antenna nub 6__pivot";
  if (endpoint_hull_antenna_nub_6_86) {
    node_hull_antenna_nub_6_86.position.copy(endpoint_hull_antenna_nub_6_86.start);
    node_hull_antenna_nub_6_86.rotation.set(0, 0, 0);
    node_hull_antenna_nub_6_86.scale.set(1, 1, 1);
  } else {
    node_hull_antenna_nub_6_86.position.set(2.55, 0.5, 0.475);
    node_hull_antenna_nub_6_86.rotation.set(0.0, 0.0, 0.0);
    node_hull_antenna_nub_6_86.scale.set(0.05, 0.1, 0.05);
  }
  node_hull_antenna_nub_6_86.userData.sculptComponent = {"id": "hull-antenna-nub-6", "name": "Hull antenna nub 6", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-6-mount", "structuralParent": "root", "localStart": [2.55, 0.5, 0.475], "localEnd": [2.55, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [2.55, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_6_86.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_hull_antenna_nub_6_86);
  nodes["hull-antenna-nub-6"] = node_hull_antenna_nub_6_86;
  const mesh_hull_antenna_nub_6_86Geometry = endpoint_hull_antenna_nub_6_86
    ? new THREE.CylinderGeometry(endpoint_hull_antenna_nub_6_86.endRadius, endpoint_hull_antenna_nub_6_86.baseRadius, endpoint_hull_antenna_nub_6_86.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hull_antenna_nub_6_86 = new THREE.Mesh(
    mesh_hull_antenna_nub_6_86Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hull_antenna_nub_6_86.name = "Hull antenna nub 6";
  if (endpoint_hull_antenna_nub_6_86) {
    mesh_hull_antenna_nub_6_86.position.copy(endpoint_hull_antenna_nub_6_86.midpoint);
    mesh_hull_antenna_nub_6_86.quaternion.copy(endpoint_hull_antenna_nub_6_86.quaternion);
  }
  mesh_hull_antenna_nub_6_86.castShadow = options.castShadow ?? true;
  mesh_hull_antenna_nub_6_86.receiveShadow = options.receiveShadow ?? true;
  mesh_hull_antenna_nub_6_86.userData.sculptComponent = {"id": "hull-antenna-nub-6", "name": "Hull antenna nub 6", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.55, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small stub antenna on the dorsal deck.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/hull-antenna-nub-6-mount", "structuralParent": "root", "localStart": [2.55, 0.5, 0.475], "localEnd": [2.55, 0.5, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.1, "depth": 0.05, "units": "relative", "confidence": 0.55}, "transform": {"position": [2.55, 0.5, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_hull_antenna_nub_6_86.add(mesh_hull_antenna_nub_6_86);
  meshes["hull-antenna-nub-6"] = mesh_hull_antenna_nub_6_86;
  colliders["hull-antenna-nub-6"] = {"type": "box", "fit": "tight"};

  const attachment_blue_bar_decal_87 = {"parentId": "root", "parentSocket": "root/blue-bar-decal-mount", "structuralParent": "root", "localStart": [0.48, 0.475, 0.675], "localEnd": [0.48, 0.475, 0.675], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_blue_bar_decal_87 = makeAttachmentEndpoint(attachment_blue_bar_decal_87);
  const node_blue_bar_decal_87 = new THREE.Group();
  node_blue_bar_decal_87.name = "Blue bar decal__pivot";
  if (endpoint_blue_bar_decal_87) {
    node_blue_bar_decal_87.position.copy(endpoint_blue_bar_decal_87.start);
    node_blue_bar_decal_87.rotation.set(0, 0, 0);
    node_blue_bar_decal_87.scale.set(1, 1, 1);
  } else {
    node_blue_bar_decal_87.position.set(0.48, 0.475, 0.675);
    node_blue_bar_decal_87.rotation.set(-1.5707963267948966, 0.0, 0.0);
    node_blue_bar_decal_87.scale.set(0.3, 0.14, 1.0);
  }
  node_blue_bar_decal_87.userData.sculptComponent = {"id": "blue-bar-decal", "name": "Blue bar decal", "level": "micro", "role": "decal", "logicalParent": "root", "importance": 0.3, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Flat painted decal panel; a plane card is correct - it has no relief.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/blue-bar-decal-mount", "structuralParent": "root", "localStart": [0.48, 0.475, 0.675], "localEnd": [0.48, 0.475, 0.675], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.14, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.48, 0.475, 0.675], "rotation": [-1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d08"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_blue_bar_decal_87.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_blue_bar_decal_87);
  nodes["blue-bar-decal"] = node_blue_bar_decal_87;
  const mesh_blue_bar_decal_87Geometry = endpoint_blue_bar_decal_87
    ? new THREE.CylinderGeometry(endpoint_blue_bar_decal_87.endRadius, endpoint_blue_bar_decal_87.baseRadius, endpoint_blue_bar_decal_87.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  const mesh_blue_bar_decal_87 = new THREE.Mesh(
    mesh_blue_bar_decal_87Geometry,
    materialMap["accent-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_blue_bar_decal_87.name = "Blue bar decal";
  if (endpoint_blue_bar_decal_87) {
    mesh_blue_bar_decal_87.position.copy(endpoint_blue_bar_decal_87.midpoint);
    mesh_blue_bar_decal_87.quaternion.copy(endpoint_blue_bar_decal_87.quaternion);
  }
  mesh_blue_bar_decal_87.castShadow = options.castShadow ?? true;
  mesh_blue_bar_decal_87.receiveShadow = options.receiveShadow ?? true;
  mesh_blue_bar_decal_87.userData.sculptComponent = {"id": "blue-bar-decal", "name": "Blue bar decal", "level": "micro", "role": "decal", "logicalParent": "root", "importance": 0.3, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Flat painted decal panel; a plane card is correct - it has no relief.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/blue-bar-decal-mount", "structuralParent": "root", "localStart": [0.48, 0.475, 0.675], "localEnd": [0.48, 0.475, 0.675], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.14, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.48, 0.475, 0.675], "rotation": [-1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "accent-blue", "materialLayers": ["accent-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": ["d08"], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 83, 180, 1.0)", "secondaryAlbedo": "rgba(71, 96, 222, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.55, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(49, 83, 180, 1.0)"}, {"position": 1.0, "color": "rgba(71, 96, 222, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["stern-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_blue_bar_decal_87.add(mesh_blue_bar_decal_87);
  meshes["blue-bar-decal"] = mesh_blue_bar_decal_87;
  colliders["blue-bar-decal"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_1_88 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-1-mount", "structuralParent": "root", "localStart": [1.6, 0.06, 0.475], "localEnd": [1.6, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_1_88 = makeAttachmentEndpoint(attachment_tail_hardpoint_1_88);
  const node_tail_hardpoint_1_88 = new THREE.Group();
  node_tail_hardpoint_1_88.name = "Tail hardpoint nub 1__pivot";
  if (endpoint_tail_hardpoint_1_88) {
    node_tail_hardpoint_1_88.position.copy(endpoint_tail_hardpoint_1_88.start);
    node_tail_hardpoint_1_88.rotation.set(0, 0, 0);
    node_tail_hardpoint_1_88.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_1_88.position.set(1.6, 0.06, 0.475);
    node_tail_hardpoint_1_88.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_1_88.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_1_88.userData.sculptComponent = {"id": "tail-hardpoint-1", "name": "Tail hardpoint nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-1-mount", "structuralParent": "root", "localStart": [1.6, 0.06, 0.475], "localEnd": [1.6, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.6, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_1_88.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_1_88);
  nodes["tail-hardpoint-1"] = node_tail_hardpoint_1_88;
  const mesh_tail_hardpoint_1_88Geometry = endpoint_tail_hardpoint_1_88
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_1_88.endRadius, endpoint_tail_hardpoint_1_88.baseRadius, endpoint_tail_hardpoint_1_88.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_1_88 = new THREE.Mesh(
    mesh_tail_hardpoint_1_88Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_1_88.name = "Tail hardpoint nub 1";
  if (endpoint_tail_hardpoint_1_88) {
    mesh_tail_hardpoint_1_88.position.copy(endpoint_tail_hardpoint_1_88.midpoint);
    mesh_tail_hardpoint_1_88.quaternion.copy(endpoint_tail_hardpoint_1_88.quaternion);
  }
  mesh_tail_hardpoint_1_88.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_1_88.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_1_88.userData.sculptComponent = {"id": "tail-hardpoint-1", "name": "Tail hardpoint nub 1", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-1-mount", "structuralParent": "root", "localStart": [1.6, 0.06, 0.475], "localEnd": [1.6, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.6, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_1_88.add(mesh_tail_hardpoint_1_88);
  meshes["tail-hardpoint-1"] = mesh_tail_hardpoint_1_88;
  colliders["tail-hardpoint-1"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_2_89 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-2-mount", "structuralParent": "root", "localStart": [2.32, 0.06, 0.475], "localEnd": [2.32, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_2_89 = makeAttachmentEndpoint(attachment_tail_hardpoint_2_89);
  const node_tail_hardpoint_2_89 = new THREE.Group();
  node_tail_hardpoint_2_89.name = "Tail hardpoint nub 2__pivot";
  if (endpoint_tail_hardpoint_2_89) {
    node_tail_hardpoint_2_89.position.copy(endpoint_tail_hardpoint_2_89.start);
    node_tail_hardpoint_2_89.rotation.set(0, 0, 0);
    node_tail_hardpoint_2_89.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_2_89.position.set(2.3200000000000003, 0.06, 0.475);
    node_tail_hardpoint_2_89.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_2_89.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_2_89.userData.sculptComponent = {"id": "tail-hardpoint-2", "name": "Tail hardpoint nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-2-mount", "structuralParent": "root", "localStart": [2.32, 0.06, 0.475], "localEnd": [2.32, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.3200000000000003, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_2_89.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_2_89);
  nodes["tail-hardpoint-2"] = node_tail_hardpoint_2_89;
  const mesh_tail_hardpoint_2_89Geometry = endpoint_tail_hardpoint_2_89
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_2_89.endRadius, endpoint_tail_hardpoint_2_89.baseRadius, endpoint_tail_hardpoint_2_89.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_2_89 = new THREE.Mesh(
    mesh_tail_hardpoint_2_89Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_2_89.name = "Tail hardpoint nub 2";
  if (endpoint_tail_hardpoint_2_89) {
    mesh_tail_hardpoint_2_89.position.copy(endpoint_tail_hardpoint_2_89.midpoint);
    mesh_tail_hardpoint_2_89.quaternion.copy(endpoint_tail_hardpoint_2_89.quaternion);
  }
  mesh_tail_hardpoint_2_89.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_2_89.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_2_89.userData.sculptComponent = {"id": "tail-hardpoint-2", "name": "Tail hardpoint nub 2", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-2-mount", "structuralParent": "root", "localStart": [2.32, 0.06, 0.475], "localEnd": [2.32, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.3200000000000003, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_2_89.add(mesh_tail_hardpoint_2_89);
  meshes["tail-hardpoint-2"] = mesh_tail_hardpoint_2_89;
  colliders["tail-hardpoint-2"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_3_90 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-3-mount", "structuralParent": "root", "localStart": [3.04, 0.06, 0.475], "localEnd": [3.04, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_3_90 = makeAttachmentEndpoint(attachment_tail_hardpoint_3_90);
  const node_tail_hardpoint_3_90 = new THREE.Group();
  node_tail_hardpoint_3_90.name = "Tail hardpoint nub 3__pivot";
  if (endpoint_tail_hardpoint_3_90) {
    node_tail_hardpoint_3_90.position.copy(endpoint_tail_hardpoint_3_90.start);
    node_tail_hardpoint_3_90.rotation.set(0, 0, 0);
    node_tail_hardpoint_3_90.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_3_90.position.set(3.04, 0.06, 0.475);
    node_tail_hardpoint_3_90.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_3_90.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_3_90.userData.sculptComponent = {"id": "tail-hardpoint-3", "name": "Tail hardpoint nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-3-mount", "structuralParent": "root", "localStart": [3.04, 0.06, 0.475], "localEnd": [3.04, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.04, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_3_90.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_3_90);
  nodes["tail-hardpoint-3"] = node_tail_hardpoint_3_90;
  const mesh_tail_hardpoint_3_90Geometry = endpoint_tail_hardpoint_3_90
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_3_90.endRadius, endpoint_tail_hardpoint_3_90.baseRadius, endpoint_tail_hardpoint_3_90.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_3_90 = new THREE.Mesh(
    mesh_tail_hardpoint_3_90Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_3_90.name = "Tail hardpoint nub 3";
  if (endpoint_tail_hardpoint_3_90) {
    mesh_tail_hardpoint_3_90.position.copy(endpoint_tail_hardpoint_3_90.midpoint);
    mesh_tail_hardpoint_3_90.quaternion.copy(endpoint_tail_hardpoint_3_90.quaternion);
  }
  mesh_tail_hardpoint_3_90.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_3_90.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_3_90.userData.sculptComponent = {"id": "tail-hardpoint-3", "name": "Tail hardpoint nub 3", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-3-mount", "structuralParent": "root", "localStart": [3.04, 0.06, 0.475], "localEnd": [3.04, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.04, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_3_90.add(mesh_tail_hardpoint_3_90);
  meshes["tail-hardpoint-3"] = mesh_tail_hardpoint_3_90;
  colliders["tail-hardpoint-3"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_4_91 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-4-mount", "structuralParent": "root", "localStart": [3.76, 0.06, 0.475], "localEnd": [3.76, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_4_91 = makeAttachmentEndpoint(attachment_tail_hardpoint_4_91);
  const node_tail_hardpoint_4_91 = new THREE.Group();
  node_tail_hardpoint_4_91.name = "Tail hardpoint nub 4__pivot";
  if (endpoint_tail_hardpoint_4_91) {
    node_tail_hardpoint_4_91.position.copy(endpoint_tail_hardpoint_4_91.start);
    node_tail_hardpoint_4_91.rotation.set(0, 0, 0);
    node_tail_hardpoint_4_91.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_4_91.position.set(3.7600000000000002, 0.06, 0.475);
    node_tail_hardpoint_4_91.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_4_91.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_4_91.userData.sculptComponent = {"id": "tail-hardpoint-4", "name": "Tail hardpoint nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-4-mount", "structuralParent": "root", "localStart": [3.76, 0.06, 0.475], "localEnd": [3.76, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.7600000000000002, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_4_91.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_4_91);
  nodes["tail-hardpoint-4"] = node_tail_hardpoint_4_91;
  const mesh_tail_hardpoint_4_91Geometry = endpoint_tail_hardpoint_4_91
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_4_91.endRadius, endpoint_tail_hardpoint_4_91.baseRadius, endpoint_tail_hardpoint_4_91.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_4_91 = new THREE.Mesh(
    mesh_tail_hardpoint_4_91Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_4_91.name = "Tail hardpoint nub 4";
  if (endpoint_tail_hardpoint_4_91) {
    mesh_tail_hardpoint_4_91.position.copy(endpoint_tail_hardpoint_4_91.midpoint);
    mesh_tail_hardpoint_4_91.quaternion.copy(endpoint_tail_hardpoint_4_91.quaternion);
  }
  mesh_tail_hardpoint_4_91.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_4_91.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_4_91.userData.sculptComponent = {"id": "tail-hardpoint-4", "name": "Tail hardpoint nub 4", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-4-mount", "structuralParent": "root", "localStart": [3.76, 0.06, 0.475], "localEnd": [3.76, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [3.7600000000000002, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_4_91.add(mesh_tail_hardpoint_4_91);
  meshes["tail-hardpoint-4"] = mesh_tail_hardpoint_4_91;
  colliders["tail-hardpoint-4"] = {"type": "box", "fit": "tight"};

  const attachment_tail_hardpoint_5_92 = {"parentId": "root", "parentSocket": "root/tail-hardpoint-5-mount", "structuralParent": "root", "localStart": [4.48, 0.06, 0.475], "localEnd": [4.48, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]};
  const endpoint_tail_hardpoint_5_92 = makeAttachmentEndpoint(attachment_tail_hardpoint_5_92);
  const node_tail_hardpoint_5_92 = new THREE.Group();
  node_tail_hardpoint_5_92.name = "Tail hardpoint nub 5__pivot";
  if (endpoint_tail_hardpoint_5_92) {
    node_tail_hardpoint_5_92.position.copy(endpoint_tail_hardpoint_5_92.start);
    node_tail_hardpoint_5_92.rotation.set(0, 0, 0);
    node_tail_hardpoint_5_92.scale.set(1, 1, 1);
  } else {
    node_tail_hardpoint_5_92.position.set(4.48, 0.06, 0.475);
    node_tail_hardpoint_5_92.rotation.set(0.0, 0.0, 0.0);
    node_tail_hardpoint_5_92.scale.set(0.16, 0.05, 0.14);
  }
  node_tail_hardpoint_5_92.userData.sculptComponent = {"id": "tail-hardpoint-5", "name": "Tail hardpoint nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-5-mount", "structuralParent": "root", "localStart": [4.48, 0.06, 0.475], "localEnd": [4.48, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [4.48, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_5_92.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}};
  (nodes["root"] ?? root).add(node_tail_hardpoint_5_92);
  nodes["tail-hardpoint-5"] = node_tail_hardpoint_5_92;
  const mesh_tail_hardpoint_5_92Geometry = endpoint_tail_hardpoint_5_92
    ? new THREE.CylinderGeometry(endpoint_tail_hardpoint_5_92.endRadius, endpoint_tail_hardpoint_5_92.baseRadius, endpoint_tail_hardpoint_5_92.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_tail_hardpoint_5_92 = new THREE.Mesh(
    mesh_tail_hardpoint_5_92Geometry,
    materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_hardpoint_5_92.name = "Tail hardpoint nub 5";
  if (endpoint_tail_hardpoint_5_92) {
    mesh_tail_hardpoint_5_92.position.copy(endpoint_tail_hardpoint_5_92.midpoint);
    mesh_tail_hardpoint_5_92.quaternion.copy(endpoint_tail_hardpoint_5_92.quaternion);
  }
  mesh_tail_hardpoint_5_92.castShadow = options.castShadow ?? true;
  mesh_tail_hardpoint_5_92.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_hardpoint_5_92.userData.sculptComponent = {"id": "tail-hardpoint-5", "name": "Tail hardpoint nub 5", "level": "micro", "role": "detail", "logicalParent": "root", "importance": 0.2, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small raised fitting along the tail spine.", "geometryDescriptor": {"topologyIntent": "hard-surface faceted shell, flat-shaded for cel response", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root/tail-hardpoint-5-mount", "structuralParent": "root", "localStart": [4.48, 0.06, 0.475], "localEnd": [4.48, 0.06, 0.475], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.004, "contactGeometry": "face-region (zero-length span: not a strut)", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [4.48, 0.06, 0.475], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0, 0, 0]}, "transformChannels": {"translate": true, "rotate": true, "scale": false}, "sockets": [], "collider": {"type": "box", "fit": "tight"}, "constraints": [], "destruction": {"breakable": false}}, "material": "machine-grey", "materialLayers": ["machine-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams", "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "surface", "colorMaterialRecipe": {"dominantAlbedo": "rgba(83, 90, 96, 1.0)", "secondaryAlbedo": "rgba(109, 117, 124, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(83, 90, 96, 1.0)"}, {"position": 1.0, "color": "rgba(109, 117, 124, 1.0)"}], "note": "Quantised by the toon ramp into discrete steps; not a continuous blend."}, "evidenceRefs": ["mast-zone"], "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR."}};
  node_tail_hardpoint_5_92.add(mesh_tail_hardpoint_5_92);
  meshes["tail-hardpoint-5"] = mesh_tail_hardpoint_5_92;
  colliders["tail-hardpoint-5"] = {"type": "box", "fit": "tight"};

  // repetition system: dorsal-deck-plates (InstancedMesh, linear, count=8, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hull-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.66, 0.035, 0.86];
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
    cluster.name = "dorsal-deck-plates";
    parent.add(cluster);
  }

  // repetition system: bladder-pods (InstancedMesh, staggered-rows, count=7, level=meso)
  {
    const parent = nodes["pod-cradle"] ?? root;
    const geo = new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
    const mat = materialMap["pod-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.86, 0.8, 0.86];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 7);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 7; i++) {
      const ang = ((0.0) + (i * 360) / 7) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "bladder-pods";
    parent.add(cluster);
  }

  // repetition system: pod-banding-straps (InstancedMesh, per-parent-pair, count=14, level=micro)
  {
    const parent = nodes["pod-cradle"] ?? root;
    const geo = new THREE.TorusGeometry(0.45, 0.08, 24, 96);
    const mat = materialMap["machine-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.68, 0.68, 0.68];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 14);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 14; i++) {
      const ang = ((0.0) + (i * 360) / 14) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "pod-banding-straps";
    parent.add(cluster);
  }

  // repetition system: radiator-vanes (InstancedMesh, mirrored-linear-banks, count=10, level=meso)
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
    cluster.name = "radiator-vanes";
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
