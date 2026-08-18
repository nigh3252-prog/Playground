# Bell Knight — source art

The pieces the `bell-knight-walkabout.html` toy is built from. That file embeds
them as base64, so these copies exist to keep the originals editable and to stop
them living only in a chat attachment.

`assembled-reference.png` is the authored "this is how it fits together" image.
Solving each part's scale and offset against it is where the rig numbers came
from, so keep it — it is the only ground truth for the layout.

## Rig notes worth not relearning

* The pieces are **not drawn at a common scale**. The generator emitted each at
  whatever size it liked, so every part carries its own display width in the
  rig. Normalising them wrecks the proportions.
* The bell's mouth cavity is **painted into `torso.png` as opaque dark pixels**.
  Nothing behind it can show through, so the legs must be drawn *over* the bell
  and reach roughly 100 units up inside the cavity. Hung off the bottom of the
  bell instead they read as hiding behind it.
* No mirroring. The knight is asymmetric — flail on one arm, slab shield on the
  other — so flipping the sprite to turn him around swaps his weapons between
  hands. He stays presented to the camera and leans into his heading.

## shoulder-left / shoulder-right

Purpose-drawn replacements for the pauldrons that were borrowed from the 16-cell
paper-doll atlas. Each is **a shoulder plate and the upper-arm ball as one
piece**, not a flat cap:

* the gold banded axle on the inboard edge mates to the bell, and is the
  rotation point
* the grey ball on the stub below-outboard is where the rest of the arm continues

`shoulder-left.png` has its axle on the right, so it is the viewer's-left
shoulder — the flail side.

Not wired in yet: the current `flailArm.png` / `shieldArm.png` each already
contain their own shoulder and upper arm, so dropping these in buries them.
They need arm art that starts at the elbow.
