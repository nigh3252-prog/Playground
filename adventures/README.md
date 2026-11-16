# Thirty Adventures

Thirty small action and adventure games, each built around a different core idea. Open `adventures/index.html` and pick one.

They are made for a phone in a Backbone-style controller (PlayStation callouts, standard Gamepad API), and also work with touch (left half of the screen is a stick, buttons appear on the right) and keyboard.

Every game has an ending. Finishing one marks it done on the launcher and records your best time.

| # | Game | What you do |
| --- | --- | --- |
| 1 | Lantern Deep | Explore a cave where lamp oil is your light and your safety |
| 2 | Grapple Canyon | Swing across five spans on a rope with real momentum |
| 3 | Tidebreaker | Sail under shifting wind and fire broadsides from the shoulder buttons |
| 4 | Clockwork Heist | Pure stealth: vision cones, noise, thrown coins, sleeper holds |
| 5 | Mole Mech | Dig for ore, sell it, upgrade, and reach the relic before fuel runs out |
| 6 | Rift Walker | First-person raycast labyrinth with three sigils and a gate |
| 7 | Frost Summit | Free climb on draining grip, choosing where your pitons go |
| 8 | Thornwood | Twelve-screen forest where a whip and an ember open new paths |
| 9 | Hollow Echo | Navigate by sonar while something hunts the sound |
| 10 | Dune Strider | Stick pressure is footstep volume, and the worm is listening |
| 11 | Borrowed Skins | Possess a rat, guard, bat and knight to pass what a spirit cannot |
| 12 | Flockward | Herd sheep by pressure, bark and whistle past ravines and wolves |
| 13 | Castaway Cove | Gather and craft by day, keep the fire lit at night, build a raft |
| 14 | Night Courier | Drift a car through a sleeping city against the clock |
| 15 | Lantern River | Raft a current you can only argue with, rescuing lanterns |
| 16 | Glyphcaster | Cast spells by tracing runes while time slows |
| 17 | Salvage Tug | Tow fragile crates on a cable in zero gravity |
| 18 | Runaway Express | Brawl along the roof of a train and duck the gantries |
| 19 | Thunder Lancer | Joust: spur on the beat, steady the lance, read their aim |
| 20 | Deepwood Archer | Archery with real drop and wind |
| 21 | Magnet Monk | Auto-runner that flips between floor and ceiling rails |
| 22 | Planet Hopper | Run around tiny worlds and jump between their gravity |
| 23 | Updraft | Glide between islands trading height for speed |
| 24 | Chrono Vault | Rewind to leave echoes of yourself that hold doors open |
| 25 | Rune Golem | Sliding puzzles, generated and proven solvable |
| 26 | Chimera Trail | Turn-based beast battles with timed hits, capture and fusion |
| 27 | Caravan of Salt | A choice-driven desert journey with crossbow skirmishes |
| 28 | Bumper Crypt | Pinball where the bumpers are monsters |
| 29 | Slingstar | Launch a probe and let gravity bend it through the ring |
| 30 | Spearbound | One spear: throw it, fight unarmed, call it home |

## Files

- `kit.js`: shared kit (input, synth audio and generated music, particles, camera, grid helpers, dialog, title / pause / ending screens).
- `index.html`: the launcher.
- one HTML file per game. No build step and no network requests.
