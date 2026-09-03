/**
 * The hub's ground.
 *
 * Muse. is music-first, so the hub is no longer a photographed 3D world with
 * people standing in it — it is a calm, dark field of light the room selection
 * floats on. Two slow blooms (the signal crimson and a cool counter-tone) over
 * near-black, finished with grain and a vignette so the gradient never bands.
 *
 * Optionally tinted by whatever is playing: when a cover palette is passed the
 * blooms take its colours, so the hub quietly wears the current record the same
 * way the player does. Falls back to the app's own light when nothing is on.
 *
 * Deliberately cheap — no canvas, no WebGL, no per-frame work — because the hub
 * is a screen you pass through on the way to listening, not one to spend a GPU
 * holding still.
 */
export function MuseBackdrop({
  base = 'color-mix(in oklab, var(--color-signal) 34%, black)',
  accent = 'color-mix(in oklab, var(--color-glow-cool) 26%, black)',
}: {
  base?: string
  accent?: string
}) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-void">
      <div
        className="absolute -inset-[20%] blur-[110px] opacity-70"
        style={{
          background: `radial-gradient(40% 44% at 26% 22%, ${base}, transparent 70%)`,
          animation: 'music-drift 30s ease-in-out infinite',
        }}
      />
      <div
        className="absolute -inset-[20%] blur-[120px] opacity-60"
        style={{
          background: `radial-gradient(44% 40% at 74% 78%, ${accent}, transparent 72%)`,
          animation: 'music-drift 40s ease-in-out infinite reverse',
        }}
      />

      {/* The finish the rest of the app uses: grain to stop banding, a vignette
          to seat the light in the frame. */}
      <div className="grain absolute inset-0 opacity-[0.12] mix-blend-overlay" />
      <div className="absolute inset-0 bg-[radial-gradient(125%_95%_at_50%_45%,transparent_42%,rgba(0,0,0,0.78))]" />
    </div>
  )
}
