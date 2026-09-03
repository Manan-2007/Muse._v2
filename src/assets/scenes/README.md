# Hub backdrops

Drop artwork in this folder and it appears in the hub's **Settings → Backdrop**
picker. The folder is globbed at build time, so a file landing here is all it
takes — no imports, no registration.

## Filenames decide the depth planes

A *scene* is a set of files that share a name. The suffix says which plane the
file is:

| File | Plane | Moves |
| --- | --- | --- |
| `lake-far.png` | Sky, mountains, horizon | least |
| `lake-mid.png` | Trees, buildings, the far bank | more |
| `lake-near.png` | Grass, a dock post, a foreground branch | most |

Those three together are one scene called **Lake** with real parallax.

A single `lake.png` with no suffix is also a valid scene — it just gets one
plane, so the tilt is a flat drift rather than depth. Start here if you only
have flat images; adding `-mid` and `-near` later upgrades it with no code
change.

### Requirements per plane

- **`far`** should be fully opaque and cover the frame.
- **`mid`** and **`near`** need **transparency** (PNG/WebP with alpha) — they are
  cut-outs layered over `far`. A fully opaque `mid` hides everything behind it.
- Keep the same pixel dimensions across a scene's planes so they line up.
- 2560×1440 or larger, landscape. Planes are overscanned up to 18% so a shifted
  layer never exposes an edge, which means the outer ~10% gets cropped — keep
  anything important away from the very edge.

## Video scenes

A `lake.mp4` / `lake.webm` becomes the scene's motion version and is used
*instead of* the still planes when the user hasn't asked for reduced motion.

- Make the loop seamless — first frame should match last.
- Keep it compressed. This plays for the entire session behind live UI; a heavy
  file is the easiest way to make the rest of the hub stutter.
- Ship the stills too if you can. Reduced-motion users get the layered version,
  and it covers the gap before the video's first frame decodes.

## Naming

Basename becomes the label: `golden-lake-far.png` → scene id `golden-lake`,
labelled "Golden lake". Use `-` or `_` between words; case doesn't matter.
