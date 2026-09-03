import { useCallback, useEffect, useState } from 'react'

const BASE_KEY = 'syncroom.hub.preferences'

/**
 * Preferences are per account, not per browser.
 *
 * These were once kept under a single key, which meant the character and
 * backdrop belonged to the machine rather than the person: signing out and
 * signing in as someone else put you in their hub wearing their character,
 * and two people sharing a laptop overwrote each other every time they
 * switched. Scoping by user id is what makes "your character" actually yours.
 */
function keyFor(userId?: string) {
  return userId ? `${BASE_KEY}.${userId}` : BASE_KEY
}

/** Where the ground is in a scene, as a fraction of viewport height. */
export const DEFAULT_GROUND = 0.82

export type HubPreferences = {
  /** Chosen backdrop, by scene id. Falls back to the first scene found. */
  sceneId?: string
  /** Chosen character, by roster id. */
  characterId?: string
  /**
   * Per-scene ground line, keyed by scene id.
   *
   * Nothing can infer this: it's the height of the path, floor, or bank in a
   * photograph, and getting it wrong is what leaves a character hovering over
   * water. So it's a control rather than a guess.
   */
  ground?: Record<string, number>
}

export function groundFor(preferences: HubPreferences, sceneId?: string) {
  if (!sceneId) return DEFAULT_GROUND
  return preferences.ground?.[sceneId] ?? DEFAULT_GROUND
}

function read(userId?: string): HubPreferences {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (raw) return JSON.parse(raw) as HubPreferences

    /*
     * First sign-in since preferences became per-account: adopt whatever this
     * browser already had, so nobody's hub resets under them on the upgrade.
     * Claimed by the first account to look, and removed as it is taken — a
     * second person signing in afterwards gets the defaults rather than
     * inheriting a stranger's character.
     */
    if (userId) {
      const legacy = localStorage.getItem(BASE_KEY)
      if (legacy) {
        localStorage.setItem(keyFor(userId), legacy)
        localStorage.removeItem(BASE_KEY)
        return JSON.parse(legacy) as HubPreferences
      }
    }

    return {}
  } catch {
    /* A corrupt or blocked store must not take the hub down — the defaults are
       perfectly usable. */
    return {}
  }
}

/**
 * How this user has dressed their hub.
 *
 * Local for now, deliberately: backdrop and character are pure presentation and
 * nothing else needs to read them. When the User model grows `characterId` this
 * becomes the write-through cache in front of it rather than the source.
 */
export function usePreferences(userId?: string) {
  /*
   * The account these preferences were read for is held alongside them.
   *
   * `userId` is not known on the first render — the session is fetched — so
   * this has to be able to re-read when it arrives, and again if the account
   * changes. Keeping the two in one piece of state is what makes that safe:
   * were the id tracked separately, the render after a switch would pair the
   * previous person's preferences with the new person's key and the effect
   * below would write one into the other.
   */
  const [state, setState] = useState<{ userId?: string; preferences: HubPreferences }>(() => ({
    userId,
    preferences: read(userId),
  }))

  /* Re-read during render rather than in an effect, so no frame is ever shown
     with the wrong account's hub. */
  if (state.userId !== userId) {
    setState({ userId, preferences: read(userId) })
  }

  const preferences = state.preferences

  useEffect(() => {
    /* Skip the render that is already known to be stale — its re-run lands
       immediately after, with the pair back in step. */
    if (state.userId !== userId) return
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(preferences))
    } catch {
      // Private-mode quota. Nothing to recover — the session still works.
    }
  }, [preferences, state.userId, userId])

  const update = useCallback((patch: Partial<HubPreferences>) => {
    setState((current) => ({ ...current, preferences: { ...current.preferences, ...patch } }))
  }, [])

  return { preferences, update }
}
