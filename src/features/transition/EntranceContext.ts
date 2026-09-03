import { createContext, useContext } from 'react'

/**
 * `tunnel`  — the corridor is playing; the page behind it is mounted and
 *             already fetching, but nothing of it is visible yet.
 * `reveal`  — the corridor has handed off; page elements grow in.
 * `idle`    — normal navigation, no entrance to play.
 */
export type EntrancePhase = 'idle' | 'tunnel' | 'reveal'

export type EntranceState = {
  phase: EntrancePhase
  /** Fired the moment a login resolves — never on a cold page load. */
  play: () => void
}

export const EntranceContext = createContext<EntranceState>({
  phase: 'idle',
  play: () => {},
})

export function useEntrance() {
  return useContext(EntranceContext)
}
