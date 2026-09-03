# Character roster

Drop characters in this folder and they appear in the hub's **Settings → Your
character** picker. Globbed at build time — no imports, no registration.

One character per basename. Two file types, and a character can have both:

| File | What it gives you |
| --- | --- |
| `arjun.glb` | A **rigged 3D character**. Breathes, turns toward the cursor, greets on hover. |
| `arjun.png` | A **flat cutout**. Breathes and leans, nothing more. |

`arjun.glb` + `arjun.png` together is the good setup: the cutout is what shows
while the model downloads, and it's the fallback if the model fails to parse.

## Rigged characters (`.glb`)

The pipeline this was built for is **Mixamo → Blender → glb**:

1. **mixamo.com** → pick or upload a character.
2. Add animations. **Breathing Idle** is the important one; **Waving** and
   **Looking Around** are used for the hover greeting.
3. Download the character **with skin** once (FBX Binary), then each extra
   animation **without skin**.
4. In Blender: import the skinned FBX, then import each animation FBX into the
   same file. They share Mixamo's skeleton, so each arrives as its own Action.
5. `File > Export > glTF 2.0 (.glb)` with **Animation** enabled and all actions
   included.

### Clip naming

Clips are matched on keywords, not exact names, because Mixamo labels every
download `mixamo.com`:

- **Idle** — any clip whose name contains `idle`, `breath`, or `stand`.
- **Greeting** — any clip containing `wave`, `greet`, `hello`, `look`, or
  `glance`. Played once on hover, then it crossfades back to idle.

Anything unmatched is ignored, and the first clip is used as the idle if nothing
matches. A `.glb` with **no clips at all** still works — it gets a small
procedural breath instead.

### What happens to your model

- **Auto-scaled to 1.75 units tall and stood on the floor**, centred on its own
  X/Z. Export scale and origin don't matter.
- Lit by the scene: a golden-hour key, a cool rim, and a contact shadow, tuned
  to sit in the nature backdrops rather than on top of them.
- Turned toward the cursor at the **root**, never at a bone — the animation
  mixer owns the bones and would overwrite anything set there.
- Cloned with `SkeletonUtils`, so the same character can stand in a room more
  than once without the two instances fighting over one skeleton.

### Export tips

- **Under ~2 MB each.** These download when someone opens the hub.
- Draco and meshopt compression both work; decoders load on demand.
- Embed textures in the `.glb`. External `.bin`/texture files are not picked up.
- **Y-up, facing +Z.** Whatever faces camera at rest is what you'll see.
- The first `.glb` in this folder pulls in ~350 KB gzipped of three.js + R3F.
  Nothing 3D is downloaded while the folder is `.glb`-free.

## Flat cutouts (`.png`)

- **Transparent background**, full body, head to feet.
- Trim tight to the character; the box is bottom-aligned so trailing whitespace
  under the feet makes them float.
- ~1000px tall is plenty.
- Generate them in a **consistent pose, camera height, and lighting** across the
  roster — that consistency is what lets a party of them share one backdrop
  believably. Arms slightly away from the torso if you ever want to cut them
  into parts later; hands in pockets fuses the arm silhouette to the body.

## Who gets which character

Your own choice is stored per browser and wins. Everyone else is derived from a
hash of their user id, so a room looks the same to everybody. When the `User`
model grows a `characterId` column, `characterFor()` in `src/lib/characters.ts`
is the one function to change.
