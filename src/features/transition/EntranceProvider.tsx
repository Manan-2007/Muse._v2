import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
  EntranceContext,
  type EntrancePhase,
  type EntranceState,
} from '@/features/transition/EntranceContext'
import { TunnelTransition } from '@/features/transition/TunnelTransition'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * Owns the login entrance.
 *
 * The corridor plays over the top of the destination, which is already mounted
 * and fetching underneath — so the animation is spending time the app needed
 * anyway rather than adding a loading screen on top of a load.
 */
export function EntranceProvider({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState<EntrancePhase>('idle')

  const play = useCallback(() => {
    // Reduced motion gets the destination directly — no flight, no flashing.
    setPhase(reduced ? 'idle' : 'tunnel')
  }, [reduced])

  const value = useMemo<EntranceState>(() => ({ phase, play }), [phase, play])

  return (
    <EntranceContext.Provider value={value}>
      {children}
      {phase === 'tunnel' && <TunnelTransition onDone={() => setPhase('reveal')} />}
    </EntranceContext.Provider>
  )
}
