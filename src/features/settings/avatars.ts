/**
 * Two ways to have a face: one of twelve illustrations, or your initial on one
 * of six colours.
 *
 * The illustrations are DiceBear's "Lorelei" set (by Lisa Wischofsky, CC0 —
 * public domain), saved into `public/avatars/` so they render with no network
 * and nothing about the user leaves the page. The stored avatar is always a
 * plain image reference the whole app can drop into an `<img>`: an
 * `/avatars/…svg` path for an illustration, a `data:` SVG for a colour initial,
 * or a `data:` photo for an upload.
 */

export const ILLUSTRATIONS = Array.from({ length: 12 }, (_, i) => {
  const id = String(i + 1).padStart(2, '0')
  return { id: `avatar-${id}`, src: `/avatars/avatar-${id}.svg` }
})

/** Six initial backgrounds, pulled towards Muse.'s own palette. */
export const AVATAR_COLORS = [
  { id: 'crimson', bg: '#fa233b', fg: '#ffffff' },
  { id: 'violet', bg: '#7c3aed', fg: '#ffffff' },
  { id: 'ocean', bg: '#2563eb', fg: '#ffffff' },
  { id: 'teal', bg: '#0d9488', fg: '#ffffff' },
  { id: 'amber', bg: '#d97706', fg: '#ffffff' },
  { id: 'slate', bg: '#475569', fg: '#ffffff' },
] as const

/** A colour-initial avatar as a self-contained SVG data URL. */
export function initialAvatar(bg: string, fg: string, initial: string): string {
  const letter = (initial || 'M').slice(0, 1).toUpperCase()
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>` +
    `<rect width='80' height='80' rx='40' fill='${bg}'/>` +
    `<text x='40' y='40' fill='${fg}' font-family='Archivo, Inter, system-ui, sans-serif' ` +
    `font-size='34' font-weight='700' text-anchor='middle' dominant-baseline='central'>${letter}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
