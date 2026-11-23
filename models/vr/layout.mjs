export const STORAGE_KEY = 'playground.vr-reference-bench.layout.v1';

export const PIECES = [
  {id: 'animated-mech-mike', version: 'v2', label: 'Mike', color: 0x68a9aa},
  {id: 'warden', version: 'v1', label: 'Warden', color: 0xd2a46d},
  {id: 'keraunos-energy-cannon', version: 'v1', label: 'Keraunos', color: 0xa1a9c4},
];

export const TRAY_CLOSED = -.60;
export const TRAY_OPEN = -.32;
export const TRAY_HEIGHT = .013;
export const SHELF_HEIGHT = .204;
export const SHELF_DEPTH = -.60;
const slotXs = [-.205, 0, .205];

export const slots = Object.fromEntries(
  [['shelf', SHELF_HEIGHT, SHELF_DEPTH], ['tray', TRAY_HEIGHT, 0]].flatMap(([surface, y, z]) =>
    slotXs.map((x, index) => [
      `${surface}-${index + 1}`, {surface, x, y, z, label: `${surface === 'shelf' ? 'Shelf' : 'Tray'} ${index + 1}`},
    ]),
  ),
);

export function defaultLayout() {
  return {
    trayOpen: false,
    pieces: Object.fromEntries(PIECES.map(({id}, index) => [id, {slot: `tray-${index + 1}`, yaw: 0}])),
  };
}

export function readLayout(raw) {
  try {
    const layout = JSON.parse(raw);
    const used = new Set();
    for (const {id} of PIECES) {
      const piece = layout.pieces[id];
      if (!Object.hasOwn(slots, piece.slot) || used.has(piece.slot) || !Number.isFinite(piece.yaw)) {
        return defaultLayout();
      }
      used.add(piece.slot);
    }
    return {
      trayOpen: layout.trayOpen === true,
      pieces: Object.fromEntries(PIECES.map(({id}) => [id, layout.pieces[id]])),
    };
  } catch {
    return defaultLayout();
  }
}

export function slotAvailable(layout, id, slot) {
  return (slots[slot].surface === 'shelf' || layout.trayOpen) &&
    PIECES.every(piece => piece.id === id || layout.pieces[piece.id].slot !== slot);
}

export function nearestSlot(layout, id, point, trayDepth) {
  let nearest = null;
  let distance = .118;
  for (const [key, slot] of Object.entries(slots)) {
    if (!slotAvailable(layout, id, key)) continue;
    const z = slot.z + (slot.surface === 'tray' ? trayDepth : 0);
    const candidate = Math.hypot(point.x - slot.x, point.y - slot.y, point.z - z);
    if (candidate >= distance) continue;
    nearest = key;
    distance = candidate;
  }
  return nearest;
}
