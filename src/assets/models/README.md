# Floating hero models

Drop `.glb` files in this folder and they replace the CSS objects in the hero
automatically. No code changes, no imports, no config — the folder is globbed at
build time, so a file appearing here is all it takes.

## Filenames

The basename decides which object it replaces. Six slots:

| File | Replaces | Represents |
| --- | --- | --- |
| `orb.glb` | **The hero centrepiece**, and the floating glass orb | The room itself |
| `vinyl.glb` | Spinning black record | Music |
| `play.glb` | Pulsing play disc | Watch Party |
| `code.glb` | Rotating `</>` bracket | Coding Arena |
| `dice.glb` | Tumbling die | Games |
| `chat.glb` | Speech-bubble shard | Chat |

Anything you don't provide keeps its CSS version, so you can migrate one object
at a time. An unrecognised filename is ignored.

## What happens to your model

Each model is **auto-centred and auto-scaled** to fit a unit cube, so it doesn't
matter what scale or origin it was exported at — a 0.01-unit model and a
500-unit model both land at the same on-screen size. Per-object size is set by
the CSS box in `FloatingObjects.tsx`, not by the model.

Lighting is provided by the scene (a key light, a soft fill, and a signal-green
rim). Your model's own materials are kept, so PBR metalness/roughness and
transmission all behave. Emissive materials work well here.

Idle rotation is applied per object and respects `prefers-reduced-motion`.

## Export tips

- **Keep them small.** These are decorative background objects at 80–224px.
  Aim for under ~500 KB each; the whole hero already loads ~1.4 MB of posters.
- **Draco and meshopt compression are both supported** out of the box — the
  decoders load from a CDN on demand.
- **Embed textures** in the `.glb` (that's the default for binary glTF).
  External `.bin`/texture files next to the model will not be picked up.
- **Y-up, facing +Z.** Models are only spun around Y, so whatever faces the
  camera at rest is what you'll see.
- Low poly is fine and preferred. At this size nobody counts triangles.

## Cost

Nothing 3D is downloaded while this folder holds no `.glb` files — three.js sits
in a lazily-imported chunk that's only fetched once a model actually exists. The
first model you add pulls in roughly 350 KB gzipped of three.js + R3F, so it's
worth adding all six or none rather than one.
