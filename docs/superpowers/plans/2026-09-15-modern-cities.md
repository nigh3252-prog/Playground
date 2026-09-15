# Modern populations and city detail implementation

Goal: advance the existing parent world to modern population density, use contextual names, and let the user inspect actual cities at neighborhood scale.

Spec: `docs/superpowers/specs/2026-09-15-modern-cities-design.md`.

Global constraints: preserve regional physical geography and independent benchmark predictions; keep early history available; use deterministic parent-coordinate generation; account for urban/rural and district populations without duplication; keep land routes and city development off water; retain compact phone controls; update PR #29 without merging.

1. Modern history and naming: implement the wrapper and later urbanization model, update contextual early place naming, and test meaningful physical/accounting/replay invariants. Own `modern-history.mjs`, `place-names.mjs`, `human-history.mjs`, and their focused tests.
2. City generation and drawing: independently implement on-demand terrain-aware neighborhoods/roads and a 2D city view with pointer gestures. Own `city-model.mjs`, `city-view.mjs`, and focused city tests. Use the additive history contract from the spec.
3. Integration: add era controls, city chooser/open/return flow, compact city information, physical urban footprints, URL replay, worker/fallback parity and exports. Own the existing HTML/app/history controls/presentation/CSS and worker.
4. Verify and review: run focused and full tests/build, assess several city sizes/terrain settings, obtain independent code review, resolve findings, and publish to PR #29. Verify its actual Vercel preview and record limitations in the handoff/PR.

Parallel model work uses disjoint file ownership and agreed interfaces; integration and publication stay sequential. The latest user request authorizes implementation of these connected changes.
