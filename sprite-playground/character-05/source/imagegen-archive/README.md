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

## Visual index

Click any thumbnail to open its full-resolution source file.

<table>
  <tr>
    <td><a href="01-neutral-reference-v1.png"><img src="01-neutral-reference-v1.png" width="320" alt="Neutral reference v1"></a><br><strong>01 · Neutral reference</strong><br>Selected reference</td>
    <td><a href="02-completion-atlas-v1.png"><img src="02-completion-atlas-v1.png" width="320" alt="Completion atlas v1"></a><br><strong>02 · Completion atlas</strong><br>Selected base</td>
  </tr>
  <tr>
    <td><a href="03-viewer-left-shoulder-v2.png"><img src="03-viewer-left-shoulder-v2.png" width="320" alt="Viewer-left shoulder v2"></a><br><strong>03 · Viewer-left shoulder</strong><br>Selected</td>
    <td><a href="04-viewer-right-shoulder-v2.png"><img src="04-viewer-right-shoulder-v2.png" width="320" alt="Viewer-right shoulder v2"></a><br><strong>04 · Viewer-right shoulder</strong><br>Selected</td>
  </tr>
  <tr>
    <td><a href="05-torso-v3-rejected-dark-background.png"><img src="05-torso-v3-rejected-dark-background.png" width="320" alt="Rejected torso v3"></a><br><strong>05 · Torso</strong><br>Rejected dark-background attempt</td>
    <td><a href="06-viewer-left-leg-sheet-v3.png"><img src="06-viewer-left-leg-sheet-v3.png" width="320" alt="Viewer-left leg sheet v3"></a><br><strong>06 · Viewer-left leg sheet</strong><br>Partially selected</td>
  </tr>
  <tr>
    <td><a href="07-viewer-right-leg-sheet-v3.png"><img src="07-viewer-right-leg-sheet-v3.png" width="320" alt="Viewer-right leg sheet v3"></a><br><strong>07 · Viewer-right leg sheet</strong><br>Partially selected</td>
    <td><a href="08-torso-v3-selected.png"><img src="08-torso-v3-selected.png" width="320" alt="Selected torso v3"></a><br><strong>08 · Torso</strong><br>Selected</td>
  </tr>
  <tr>
    <td><a href="09-viewer-left-shin-v3-rejected-dark-background-01.png"><img src="09-viewer-left-shin-v3-rejected-dark-background-01.png" width="320" alt="Rejected viewer-left shin v3 first attempt"></a><br><strong>09 · Viewer-left shin</strong><br>Rejected dark-background attempt</td>
    <td><a href="10-viewer-right-shin-v3-selected.png"><img src="10-viewer-right-shin-v3-selected.png" width="320" alt="Selected viewer-right shin v3"></a><br><strong>10 · Viewer-right shin</strong><br>Selected in v3; superseded in v4</td>
  </tr>
  <tr>
    <td><a href="11-viewer-left-shin-v3-rejected-dark-background-02.png"><img src="11-viewer-left-shin-v3-rejected-dark-background-02.png" width="320" alt="Rejected viewer-left shin v3 second attempt"></a><br><strong>11 · Viewer-left shin</strong><br>Rejected second dark-background attempt</td>
    <td><a href="12-viewer-left-thigh-v3-selected.png"><img src="12-viewer-left-thigh-v3-selected.png" width="320" alt="Selected viewer-left thigh v3"></a><br><strong>12 · Viewer-left thigh</strong><br>Selected</td>
  </tr>
  <tr>
    <td><a href="13-viewer-right-thigh-v3-superseded-orange-plate.png"><img src="13-viewer-right-thigh-v3-superseded-orange-plate.png" width="320" alt="Superseded viewer-right thigh v3"></a><br><strong>13 · Viewer-right thigh</strong><br>Superseded orange-plate variant</td>
    <td><a href="14-viewer-right-thigh-v3-selected.png"><img src="14-viewer-right-thigh-v3-selected.png" width="320" alt="Selected viewer-right thigh v3"></a><br><strong>14 · Viewer-right thigh</strong><br>Selected</td>
  </tr>
</table>

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
