# Character 05 image-generation archive

This folder preserves all fourteen raw image-generation outputs made for Iron
Haul during the v1-v3 paper-doll work. Files are exact byte-for-byte copies of
the original outputs; rejected and superseded attempts are intentionally kept
for future reuse.

`manifest.json` records each output's original `exec-*` filename, dimensions,
SHA-256 checksum, selection status, and relationship to the current rig.

Side names use the image/viewer perspective. Viewer-left is the character part
drawn on the left side of the source image; viewer-right is the part drawn on
the right. The shoulder files are independently generated, not mirrored.

| File | Pass | Status | Current relationship |
| --- | --- | --- | --- |
| `01-neutral-reference-v1.png` | v1 | selected reference | Source for the clean reference and rough crops |
| `02-completion-atlas-v1.png` | v1 | selected base | Source for fists, weights, and retained whole lower-leg art |
| `03-viewer-left-shoulder-v2.png` | v2 | selected | Current viewer-left shoulder |
| `04-viewer-right-shoulder-v2.png` | v2 | selected | Current viewer-right shoulder |
| `05-torso-v3-rejected-dark-background.png` | v3 | rejected | Preserved dark-background torso attempt |
| `06-viewer-left-leg-sheet-v3.png` | v3 | partially selected | Current left foot derives from its boot; other cells were superseded |
| `07-viewer-right-leg-sheet-v3.png` | v3 | partially selected | Current right foot derives from its boot; other cells were superseded |
| `08-torso-v3-selected.png` | v3 | selected | Current body sprite |
| `09-viewer-left-shin-v3-rejected-dark-background-01.png` | v3 | rejected | Preserved dark-background shin attempt |
| `10-viewer-right-shin-v3-selected.png` | v3 | superseded in v4 | Used in the v3 rig; retained for future rebuilding |
| `11-viewer-left-shin-v3-rejected-dark-background-02.png` | v3 | rejected | Preserved second dark-background shin attempt |
| `12-viewer-left-thigh-v3-selected.png` | v3 | selected | Current viewer-left thigh |
| `13-viewer-right-thigh-v3-superseded-orange-plate.png` | v3 | superseded | Preserved earlier thigh variant |
| `14-viewer-right-thigh-v3-selected.png` | v3 | selected | Current viewer-right thigh |

The source concept, crop contexts, joint map, build scripts, and recorded v3
prompts remain one directory above this archive.
