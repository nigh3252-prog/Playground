# Character 05 v3 generation prompts

Built-in image generation was given the original concept crop plus the tight
same-part context named below. Every request required transparent alpha, the
original ink-and-gouache treatment, preserved left/right asymmetry, and no
runtime mirroring.

## Torso

Input: `character-05-concept-crop.png` and `character-05-body-context-v3.png`.

> Isolate only Character 05's orange, cream, and olive barrel torso. Remove
> the limbs, chains, and weights; reconstruct only hidden boundary pixels.
> Preserve the original long three-quarter barrel, screen-left-facing oval
> aperture, orange rear cylinder, top plate, lower plate, and side mounting
> collars. Do not turn it into a frontal sphere.

## Viewer-left leg

Input: the full concept and `character-05-viewer-left-leg-context-v3.png`.

> Reconstruct only the original viewer-left side. Produce a short olive
> hip-to-knee thigh, a separate orange-and-olive knee-to-ankle shin, and a
> complete boot. Preserve the smaller far-side perspective and original plate
> placement; never mirror the viewer-right leg.

## Viewer-right leg

Input: the full concept and `character-05-viewer-right-leg-context-v3.png`.

> Reconstruct only the original viewer-right side. Produce a short olive
> hip-to-knee thigh, a separate shin with its prominent rectangular orange
> plate, and a complete broad boot. Preserve the larger near-side perspective;
> never mirror the viewer-left leg.

The component-sheet attempts were used for the shins and boots. Dedicated
short-thigh requests replaced the sheet's overlong thigh cells before atlas
assembly.
