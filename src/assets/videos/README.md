# Device screen videos

Drop video files here and the device mockups on the landing page play them
instead of the still fallback. Nothing to import or register — the folder is
globbed at build time.

## Filenames

The basename decides which device gets it:

| File | Device |
| --- | --- |
| `phone.*` | Phone |
| `tablet.*` | Tablet |
| `laptop.*` | Laptop |
| `imac.*` | Desktop |

Supported extensions: `.mp4`, `.webm`, `.mov`.

Any device without a file falls back automatically — first to the title's
official YouTube trailer (fetched by `npm run posters`, or pinned by hand in
`src/data/screens.ts`), then to a TMDB backdrop still, then to a plain gradient.
So the section always shows real footage without you doing anything.

## What to use

Videos are muted, autoplaying and looping, so treat them as motion texture
rather than content:

- **Short.** 6–12 seconds, seamless loop.
- **Small.** Under ~2 MB each. These are decoration and they load on the
  landing page — `.webm` (VP9) gets you the best size at this scale.
- **Right shape.** 16:9 works everywhere — screens cover-fit and overscan
  slightly, so avoid footage with important detail at the very edges.
- **Quiet.** Autoplay only works muted; there is no unmute control by design.
- **Not someone else's film.** These render at full brightness inside a device
  frame, which reads as a claim about what you can watch. Use your own footage,
  something licensed, or abstract motion.
