# Warden Armory

Open **armory/index.html** through a static HTTP server. From the repository root:

    python3 -m http.server 8000

Then visit http://localhost:8000/armory/. No application build, CDN or account is required. Modern browsers with WebGL 2 and import-map support are required; opening the HTML directly with file:// will not load its modules.

Choose a pack at the top, filter by era or search, and select a thumbnail. Drag to orbit, right-drag/two-finger drag to pan, scroll/pinch to zoom, and double-click/double-tap a surface to move the pivot. Fit resets the view. Inspection offers wireframe, individual mesh visibility, available animation clips and 90-degree orientation adjustments. The phone catalog can collapse to give the model more room.

Stars save favorites across all packs in this browser. The export dialog lets you add Warden notes, download a JSON backup, or download every favorite as a ZIP containing actual GLB files, the manifest, credits and handoff instructions. Import merges recognized catalog IDs and notes; it does not fetch model URLs from imported files. Export always includes the full favorites set, regardless of the current filter.

All bundled models are visual game/reference assets under CC0 1.0. The catalog records authors, original sources, license evidence, conversion notes, animation names, sizes and hashes. See [CREDITS.txt](CREDITS.txt), [sources.json](sources.json) and [asset-lock.json](asset-lock.json). Some source packs are curated selections; pack descriptions state the scope. The antique entry contains three firearms in one source scene. External discovery links in Help are not bundled assets and can have different licenses.

GLBs are self-contained. Textures from converted models are capped at 2048 pixels; source links retain access to originals. The viewer scales and orients models for inspection but exports the original bundled GLB bytes. The manifest records the display orientation separately. Warden Mech integration still needs project units, scale, attachment/grip/muzzle points and behavior; those fields are deliberately unconfigured.

## Validation and assets

- armory/tools/validate_assets.py checks every GLB, all embedded references, source records and SHA-256 hashes.
- armory/tools/browser_check.mjs uses Playwright Chromium to render every model and verify pack/era/search filters, desktop controls, phone layout, persistent cross-pack favorites, JSON import/export and ZIP CRC/model hashes.
- armory/review/ holds the latest generated desktop/phone screenshots and browser report. ZIP/JSON files produced during tests are CI artifacts, not personal selections.
- The asset builder downloads only explicit source URLs and disables Blender's embedded-script execution. Download hashes are recorded in asset-lock.json. Quaternius originals are converted from their OBJ/FBX files; historical models use their original FBX/OBJ/Blender source.
- The two generation workflows can write only to codex/warden-armory. They do not deploy or alter main. The validation workflow has read-only repository access.
- vercel.json disables automatic Vercel deployments specifically for codex/warden-armory, preserving the manual-preview preference.

Three.js r180 is vendored under its MIT license. Runtime browsing and exporting make no network requests beyond this site's own files; source links open only when chosen.
