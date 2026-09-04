/**
 * Light or dark, remembered.
 *
 * Muse. is dark by default — it is a player, and a dark stage suits a record —
 * but the app can wear a light coat too. The choice is one of three: force
 * light, force dark, or follow the device. It resolves to a concrete `light`/
 * `dark` on the root element, which the palette in index.css keys off, and it
 * is applied before React renders so there is no flash of the wrong theme.
 */

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'muse:theme'

export function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    /* Storage blocked — fall through to the default. */
  }
  return 'dark'
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* Not fatal — the theme still applies for this session. */
  }
  applyTheme(theme)
}

/** Apply the stored theme now, and keep 'system' in step with the OS after. */
export function initTheme() {
  applyTheme(getStoredTheme())
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (getStoredTheme() === 'system') applyTheme('system')
    })
}
