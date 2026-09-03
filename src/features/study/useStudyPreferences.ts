import { useCallback, useEffect, useMemo, useState } from 'react'

const BASE_KEY = 'syncroom.study.preferences'

/**
 * How this person likes the Study tab to look.
 *
 * Per account rather than per browser, for the same reason the hub's
 * preferences are: two people sharing a laptop should not keep resetting each
 * other's page. Local only — this is presentation, and nothing on the server
 * needs to know that somebody reads in light mode.
 */
function keyFor(userId?: string) {
  return userId ? `${BASE_KEY}.${userId}` : BASE_KEY
}

export const ACCENTS = ['crimson', 'amber', 'emerald', 'violet', 'blue'] as const
export type Accent = (typeof ACCENTS)[number]

export type ThemeChoice = 'system' | 'dark' | 'light'

export type StudyPreferences = {
  theme: ThemeChoice
  accent: Accent
  /** Bigger text for long reading, without touching the browser's own zoom. */
  roomy: boolean
}

const DEFAULTS: StudyPreferences = { theme: 'system', accent: 'crimson', roomy: false }

function read(userId?: string): StudyPreferences {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (!raw) return DEFAULTS
    /* Merged over the defaults rather than trusted whole — a stored blob from
       an older shape is missing keys this render is about to read. */
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<StudyPreferences>) }
  } catch {
    return DEFAULTS
  }
}

/** What the OS is asking for, watched so a mid-session switch is followed. */
function useSystemTheme() {
  const [dark, setDark] = useState(
    () => !window.matchMedia?.('(prefers-color-scheme: light)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!query) return
    const onChange = () => setDark(!query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return dark ? 'dark' : 'light'
}

export function useStudyPreferences(userId?: string) {
  const [state, setState] = useState<{ userId?: string; preferences: StudyPreferences }>(() => ({
    userId,
    preferences: read(userId),
  }))

  /* Re-read during render, not in an effect, so no frame is ever painted with
     the previous account's theme. */
  if (state.userId !== userId) setState({ userId, preferences: read(userId) })

  const preferences = state.preferences
  const system = useSystemTheme()

  useEffect(() => {
    if (state.userId !== userId) return
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(preferences))
    } catch {
      /* Private-mode quota. The session still works, it just forgets. */
    }
  }, [preferences, state.userId, userId])

  const update = useCallback((patch: Partial<StudyPreferences>) => {
    setState((current) => ({ ...current, preferences: { ...current.preferences, ...patch } }))
  }, [])

  /* 'system' is resolved here so everything downstream only ever sees a real
     theme — no component should have to know the choice was conditional. */
  const theme = preferences.theme === 'system' ? system : preferences.theme

  return useMemo(() => ({ preferences, theme, update }), [preferences, theme, update])
}
