/** `Movie Night` → `movie-night-x7f2`. Suffixed so room names can repeat. */
export function slugify(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'room'

  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}
