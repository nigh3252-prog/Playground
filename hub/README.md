# Playground Hub — first slice

A persistent, mobile-friendly entry point for experiments without rewriting the games.

## Open
Serve the repository (e.g. `python3 -m http.server 8080`) and visit **/hub/**. The root index links to the Hub.

## Included
- Searchable, tagged catalogue of 12 existing root-level experiments (`catalog.json`).
- **Input-style recommendations**: Touchscreen, Backbone preferred, Touch + Backbone, or Controls unverified. Filter the catalog by Touchscreen or Backbone; hybrid experiments appear in both. The selected filter also scopes Surprise Me and persists across visits.
- A **Surprise Me** action that selects an eligible entry, preferring unplayed entries, and avoids repeating the current experiment when possible.
- Same-page iframe navigation. The Hub stays open while a new experiment loads. Tap the small top-left pill while playing to reveal Home, Surprise Me, Prev/Next, full screen, reactions and notes.
- Persistent feedback (✨ spark, 🔖 revisit, ➖ pass), timestamped notes/transcripts, per-session visible play time, visit counts, optional game-reported events and JSON export.
- Phone landscape/standalone PWA shell. Fullscreen is requested **once** from the Hub when supported; it cannot bypass browser restrictions. On iOS use Add to Home Screen.
- All data is stored **locally in this browser**, under `playground.hub.v1`. It does not sync across devices. Export it periodically or before clearing browser data.

## Add an experiment
Add an item to `hub/catalog.json` with a stable `id`, `title`, `path` (relative to `hub/index.html`), `kind`, `tags`, `summary` and `bestWith` (`touch`, `backbone`, `either`, or `unverified`). Use `unverified` when in doubt. `inputAssessment` records whether classification came from a source-code review; this is **not** a real-phone usability certification. `backbone` denotes recommended controller play, not necessarily that no touch support exists. Relative same-origin URLs are recommended: third-party previews can block embedding, may not allow fullscreen and cannot send trusted events. Mark items `archived:true` and/or `surprise:false` to keep them browseable but out of random rotation.

## Control classification
The initial 12 labels are based on reading input code and hints in the existing experiments:
- **Touchscreen:** visible virtual joysticks or direct touch/pointer-based UI.
- **Backbone preferred:** explicit Backbone/controller mappings and gameplay designed around physical buttons/sticks, even when fallback touch buttons exist.
- **Touch + Backbone:** explicit paths for both inputs without a clear recommendation.
- **Unverified:** absent or insufficient input evidence. A developer should not assume compatibility.

Each entry's controls and usability still need a phone/Backbone playtest. The Hub's own overlay is touch-friendly; full controller-only navigation in the Hub itself is not yet implemented.

## Optional events from an experiment
No modifications to existing games are required for host-level playtime and notes. A future game may report meaningful milestones:

```js
window.parent.postMessage({
  type: "playground:metric",
  name: "death",
  value: 1
}, location.origin);
```

The Hub only accepts events from its current same-origin iframe, with a bounded event name and simple value, and limits stored events per session. Events are informational; they never change the game's behavior.

## Caveats
- Some older pages assume they own the entire top-level window, and may not work fully inside an iframe. The player includes **Open separately** for those.
- A game that navigates `window.top` can escape the shell; isolation/adapter work is intentionally deferred.
- Sessions are playtime/visibility estimates, **not gameplay performance telemetry**. The host cannot universally identify wins, deaths, errors inside unrelated frames or whether a player is enjoying something.
- The first slice intentionally does **not** import Library HTMLs, merge the outstanding multi-game PRs or refactor legacy code. Later imports can be reviewed and tested in batches.

## Quick smoke test
Run `node hub/smoke.mjs` from the repo root to validate catalog paths and UI wiring. Then test on a real phone/Backbone; no claim of real-device verification is made here.
