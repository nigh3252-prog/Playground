# Backbone Arcade

Ten browser games built for a **Backbone One (PlayStation Edition)** controller on a phone.
They use the standard Gamepad API, so any controller with the standard layout also works.
Every prompt uses PlayStation symbols (✕ ○ □ △, L1/R1, L2/R2, Create, Options).

Open `backbone/index.html` and pick a game with the d-pad, then press ✕.

## Showcase

| Game | Genre | What's special |
| --- | --- | --- |
| **Void Lancer** | Twin-stick shooter | A spring-mass neon grid that warps under explosions, 6 enemy types, a Warden mini-boss every 5 waves, a multiplier that powers up your weapon, and a procedural bassline. |
| **Neon Drift** | 3D racer (three.js + bloom) | Endless synthwave highway. R2/L2 are **analog** throttle and brake. Drift with □ to charge nitro, get near-miss bonuses in traffic, beat the clock to each checkpoint. Synthesized engine and tyre audio. |
| **Pulse** | Rhythm | A 4-lane highway laid out like the face buttons (or the d-pad). Three tracks are **composed in code** (drums, bass, pads, arps, lead), and the charts are built from the music itself. Normal/Hard, holds, chords, grades, audio-offset calibration. |
| **Emberfall** | Precision platformer | 8 generated stages that are **completable by construction**: coyote time, jump buffering, 8-way dash, wall slide and jump, crystals, springs, crumbling floors, one-way ledges, dynamic lighting and parallax. |
| **Skyrift** | 3D flight (three.js) | An endless procedural sunset canyon with flat-shaded terrain, rock spires, rings to chain for time, a double-score low-flying bonus, barrel rolls and contrails. |

## Classics

**Serpent** (snake with smooth movement and a boost), **Breakline** (brick breaker with an analog paddle and power-ups),
**Puck Rush** (air hockey against a CPU that gets harder as you win), **Echo** (memory game on the face buttons),
**Stacker** (one-button isometric tower).

## Controls everywhere

- ✕ start / confirm · ○ back to the arcade · Options pause (Resume ✕, Restart △, Arcade ○)
- Create: sound on/off · L3 + R3: haptics on/off
- On a desktop you can test with the keyboard: WASD/arrows, Space/Z = ✕, X = ○, C = □, V = △, Q/E = L1/R1, F/R = L2/R2, Enter = Options.

## Playing on your phone

1. Host the repo over **HTTPS** (for example GitHub Pages). The Gamepad API only works in a secure context.
2. Open `…/backbone/` in Safari (iOS) or Chrome (Android) with the phone in the Backbone.
3. Press any controller button so the browser detects it. A green dot means it's connected.
4. **Tap the screen once** so the browser allows sound. Browsers don't count a controller press as permission to play audio.
5. For true fullscreen, use **Share → Add to Home Screen** and launch from the icon.

Haptics: the Backbone One has no rumble motors. On Android the phone itself vibrates for big moments (after your first tap).
iOS Safari has no vibration API, so you won't feel haptics there.

## Files

- `bb.js`: shared kit with the gamepad layer, PS glyphs (SVG and canvas), synth audio, the title/pause/game-over shell and saved best scores
- `index.html`: the controller-navigable launcher
- one self-contained HTML file per game. The two 3D games load three.js 0.180 from jsDelivr.
