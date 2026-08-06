import * as THREE from 'three';

/**
 * Cel/ink render system for the Manta Delta Star Freighter.
 *
 * The reference is a digital ink-and-flat-fill illustration, not a photograph: hard near-black
 * contours bound the outer silhouette AND every interior part boundary, and colour regions are
 * flat with 2-3 discrete value steps and no continuous specular falloff. The spec records this
 * in every material's shaderModel ("MeshToonMaterial with a 3-step gradient ramp + inverted-hull
 * ink outline") and in the cel-render-style feature-review target.
 *
 * The stock code generator emits MeshPhysicalMaterial, which cannot produce that medium at any
 * parameter setting. This module is the refine-code half of that decision: it swaps in toon
 * materials built from the palette the spec sampled off the reference, and adds the ink pass.
 */

/** Palette sampled from the reference with ink-line rejection (see recon/ colour probe). */
export const PALETTE: Record<string, { base: string; shade: string; deep: string }> = {
  'hull-cream':   { base: '#f8f4d9', shade: '#d8d3b4', deep: '#a8a488' },
  'hull-grey':    { base: '#7e776d', shade: '#5f594f', deep: '#403b34' },
  'pod-yellow':   { base: '#e9b708', shade: '#ae8100', deep: '#6d5100' },
  'vane-yellow':  { base: '#d6b301', shade: '#a88c00', deep: '#6a5800' },
  'machine-grey': { base: '#535a60', shade: '#3b4147', deep: '#252a2e' },
  'accent-blue':  { base: '#3153b4', shade: '#223a80', deep: '#152350' },
  'accent-red':   { base: '#971809', shade: '#6d1106', deep: '#420a04' },
  'accent-gold':  { base: '#947204', shade: '#6b5203', deep: '#413102' },
  'accent-teal':  { base: '#1f8f7a', shade: '#166658', deep: '#0d3d34' },
  'glass-dark':   { base: '#242a30', shade: '#171c20', deep: '#0b0e10' },
};

const INK = 0x1a1410; // near-black contour, sampled from the reference's line colour

/**
 * 3-stop gradient map. MeshToonMaterial reads this as a lookup on N.L, so a texture with three
 * hard steps and NearestFilter gives exactly the reference's quantised value bands instead of a
 * smooth ramp. Filtering must be Nearest or the steps blur back into a gradient.
 */
function toonRamp(): THREE.DataTexture {
  // Step values are set from the reference's own value ratios, not picked by eye: the hull's
  // shadow flank (#7e776d) sits at ~0.55 of its lit face (#f8f4d9), and a pod's shade (#ae8100)
  // at ~0.74 of its lit crown (#e9b708). A darker floor (the usual 0.35) crushed the whole
  // ventral pod cluster to black, which the reference never does.
  const steps = new Uint8Array([150, 205, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Panel-line + weathering-stain texture, generated on a canvas with a deterministic seed so the
 * build is reproducible. Covers detailInventory d02 (panel-line network), d03 (yellow staining)
 * and d18 (speckle scatter), all of which the spec binds to hull-cream's localOverrides.
 */
function hullDetailTexture(base: string): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  let seed = 20260806;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // d03 - irregular yellow discolour patches
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 52;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(216,192,99,0.30)');
    grd.addColorStop(1, 'rgba(216,192,99,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // d02 - panel-line network
  g.strokeStyle = 'rgba(58,52,40,0.55)';
  g.lineWidth = 1.6;
  for (let i = 0; i < 11; i++) {
    const x = (i + 0.5) * (S / 11) + (rnd() - 0.5) * 8;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 14, S); g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const y = (i + 0.5) * (S / 5) + (rnd() - 0.5) * 10;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (rnd() - 0.5) * 10); g.stroke();
  }
  // d18 - speckle/dirt scatter
  g.fillStyle = 'rgba(42,37,28,0.5)';
  for (let i = 0; i < 220; i++) {
    const w = 1 + rnd() * 2.5;
    g.fillRect(rnd() * S, rnd() * S, w, w * (0.5 + rnd()));
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(3, 3);
  return tex;
}

export interface CelOptions {
  /** Silhouette weight of the inverted-hull pass, in world units. */
  outlineWidth?: number;
  /** Draw interior part-boundary lines (EdgesGeometry), not just the outer silhouette. */
  interiorLines?: boolean;
}

/**
 * Convert an already-built model group in place: toon materials from the sampled palette, an
 * inverted-hull silhouette, and edge lines on interior part boundaries.
 */
export function applyCelShading(model: THREE.Group, options: CelOptions = {}): void {
  const outlineWidth = options.outlineWidth ?? 0.011;
  const interiorLines = options.interiorLines ?? true;
  const ramp = toonRamp();
  const cache = new Map<string, THREE.MeshToonMaterial>();

  const materialFor = (id: string): THREE.MeshToonMaterial => {
    const hit = cache.get(id);
    if (hit) return hit;
    const entry = PALETTE[id] ?? PALETTE['hull-cream'];
    const mapped = id === 'hull-cream' || id === 'hull-grey';
    const mat = new THREE.MeshToonMaterial({
      // three multiplies map x color. The detail canvas is already painted in the base hue, so
      // tinting on top of it squares the colour and pushed the cream to a dull olive.
      color: new THREE.Color(mapped ? '#ffffff' : entry.base),
      gradientMap: ramp,
    });
    // Only the hull skins carry the drawn panel-line/stain layer; fittings and accents in the
    // reference are clean flat fills.
    if (mapped) mat.map = hullDetailTexture(entry.base);
    cache.set(id, mat);
    return mat;
  };

  const inkLine = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.92 });
  const inkHull = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

  const targets: THREE.Mesh[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as any).isMesh || (m as any).isInstancedMesh) targets.push(m);
  });

  for (const mesh of targets) {
    const component = mesh.userData.sculptComponent ?? mesh.parent?.userData?.sculptComponent;
    const id = (component?.material as string) ?? 'hull-cream';
    mesh.material = materialFor(id);

    // Inverted hull: a back-face copy pushed out along vertex normals reads as a drawn contour
    // that survives from every angle, unlike a screen-space edge filter.
    if (!(mesh as any).isInstancedMesh) {
      const shell = new THREE.Mesh(mesh.geometry, inkHull);
      shell.name = `${mesh.name}__ink`;
      const bbox = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!);
      const size = new THREE.Vector3(); bbox.getSize(size);
      // Scale about the geometry's own centre so thin plates gain an even rim rather than
      // sliding off their parent.
      const centre = new THREE.Vector3(); bbox.getCenter(centre);
      const s = new THREE.Vector3(
        1 + (outlineWidth * 2) / Math.max(size.x, 1e-3),
        1 + (outlineWidth * 2) / Math.max(size.y, 1e-3),
        1 + (outlineWidth * 2) / Math.max(size.z, 1e-3),
      );
      shell.scale.copy(s);
      shell.position.copy(centre).multiplyScalar(1).sub(centre.clone().multiply(s));
      shell.userData.isInk = true;
      shell.userData.explodeWithParent = true;
      mesh.add(shell);
    }

    if (interiorLines) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 24), inkLine);
      edges.name = `${mesh.name}__edges`;
      edges.userData.isInk = true;
      edges.userData.explodeWithParent = true;
      mesh.add(edges);
    }
  }
}

/** Lighting solved from the reference: see spec.lightingFromPhoto. */
export function createCelLights(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cel lights';
  // Key high and slightly forward of the port beam - value steps are brightest on upward-facing
  // deck surfaces and darkest on the lower flank.
  const key = new THREE.DirectionalLight(0xfff3d8, 2.1);
  key.position.set(-3.5, 8.6, 3.8);
  // No cast shadows. The reference conveys contact with ink contour and flat value steps, never
  // with a projected shadow - enabling them dropped everything under the hull into black.
  key.castShadow = false;
  g.add(key);
  // Fill keeps the shadow side at a warm mid grey rather than black.
  const fill = new THREE.DirectionalLight(0xbfc6d0, 0.9);
  fill.position.set(4, -1.5, -6);
  g.add(fill);
  // Bounce from below so the slung pods keep their saturated yellow, as drawn.
  const under = new THREE.DirectionalLight(0xfff0cf, 0.85);
  under.position.set(0.5, -6, 4);
  g.add(under);
  // Black space field: no environment bounce, so ambient stays low.
  g.add(new THREE.AmbientLight(0x8d93a0, 0.55));
  return g;
}
