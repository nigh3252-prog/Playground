import test from 'node:test';
import assert from 'node:assert/strict';
import {PIECES, TRAY_OPEN, defaultLayout, nearestSlot, readLayout, slots} from '../vr/layout.mjs';

const [mike, warden, cannon] = PIECES.map(piece => piece.id);

test('VR layout preserves positions, facing, and tray state across storage round trips', () => {
  const layout = defaultLayout();
  layout.trayOpen = true;
  layout.pieces[mike] = {slot: 'shelf-1', yaw: Math.PI / 4};
  layout.pieces[warden] = {slot: 'shelf-2', yaw: -Math.PI / 2};
  assert.deepEqual(readLayout(JSON.stringify(layout)), layout);
});

test('bad or overlapping saved placements restore the starter tray', () => {
  const overlapping = defaultLayout();
  overlapping.pieces[warden].slot = overlapping.pieces[mike].slot;
  for (const raw of [null, '{', '{"pieces":{}}', JSON.stringify(overlapping)]) {
    assert.deepEqual(readLayout(raw), defaultLayout());
  }
});

test('miniatures snap only to reachable, unoccupied slots', () => {
  const layout = defaultLayout();
  layout.pieces[mike].slot = 'shelf-1';
  assert.equal(nearestSlot(layout, warden, slots['shelf-1'], TRAY_OPEN), null);
  assert.equal(nearestSlot(layout, warden, {...slots['shelf-2'], y: .27}, TRAY_OPEN), 'shelf-2');
  assert.equal(nearestSlot(layout, warden, {...slots['shelf-2'], y: .40}, TRAY_OPEN), null);

  const emptyTraySlot = {...slots['tray-1'], z: TRAY_OPEN};
  assert.equal(nearestSlot(layout, warden, emptyTraySlot, TRAY_OPEN), null);
  layout.trayOpen = true;
  assert.equal(nearestSlot(layout, warden, emptyTraySlot, TRAY_OPEN), 'tray-1');
  assert.equal(nearestSlot(layout, warden, {...slots['tray-3'], z: TRAY_OPEN}, TRAY_OPEN), null);
  assert.equal(nearestSlot(layout, cannon, {...slots['tray-3'], z: TRAY_OPEN}, TRAY_OPEN), 'tray-3');
});
