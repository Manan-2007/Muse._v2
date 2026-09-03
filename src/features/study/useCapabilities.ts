import { useCallback, useEffect, useRef, useState } from 'react'

import * as studyApi from '@/features/study/api'
import { ApiError } from '@/lib/api'

/**
 * What this server can do, asked in a way that survives a bad moment.
 *
 * Every generator in the Study tab is gated on this answer, which makes the
 * way it fails matter more than the answer itself. Asking once and treating a
 * failure as "no key configured" is the difference between a tab that is
 * briefly unavailable and a tab that is permanently, wrongly, switched off —
 * and the person it switches off for is never the one who could fix it.
 *
 * That case is not hypothetical. The server here runs on somebody's laptop
 * behind a tunnel: the host reaches it over loopback and never sees a blip,
 * while everybody else's request crosses a link that drops. One dropped
 * capabilities request and their whole Study tab reads "this server has no AI
 * key" — about a server that is sitting there fully configured.
 *
 * So: three states, never conflated. Not asked yet, asked and answered, or
 * could not ask. Only the middle one is allowed to say anything about keys.
 */

/** Attempts before giving the person a button instead of another wait. */
const MAX_ATTEMPTS = 3

/** Backoff between them. Short — a tab is open and waiting on this. */
const RETRY_DELAY_MS = 900

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type CapabilitiesState = {
  /** The answer, or null if there isn't one yet. Never a fabricated one. */
  caps: studyApi.Capabilities | null
  /** Why there is no answer, when the reason was the connection. */
  problem: string | null
  /** A request is in flight right now. */
  checking: boolean
  retry: () => void
}

export function useCapabilities(roomId: string): CapabilitiesState {
  const [caps, setCaps] = useState<studyApi.Capabilities | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  /* Guards a re-check firing on top of one already running — focus and
     `online` land together often enough to matter. */
  const inFlight = useRef(false)

  const check = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setChecking(true)

    let last: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const answer = await studyApi.capabilities(roomId)
        setCaps(answer)
        setProblem(null)
        setChecking(false)
        inFlight.current = false
        return
      } catch (cause) {
        last = cause
        /* A 401/403/404 is a real answer about this room, not a bad link, and
           it will be exactly as final on the third try. Only a connection
           that did not complete is worth going round again for. */
        const transient = cause instanceof ApiError ? cause.status === 0 || cause.status >= 500 : true
        if (!transient) break
        if (attempt < MAX_ATTEMPTS) await wait(RETRY_DELAY_MS * attempt)
      }
    }

    /* Leave `caps` as it was. If a previous check succeeded, a later blip
       should not take the tab away — the keys did not go anywhere. */
    setProblem(
      last instanceof ApiError && last.status !== 0
        ? last.message
        : 'Could not reach the study server to ask what it can do.',
    )
    setChecking(false)
    inFlight.current = false
  }, [roomId])

  useEffect(() => {
    setCaps(null)
    setProblem(null)
    void check()
  }, [check])

  /*
   * Ask again when the situation has plausibly changed.
   *
   * The usual shape of this failure is a tunnel that was down and came back,
   * or a laptop that was asleep. Both announce themselves — and neither is
   * worth making somebody hunt for a retry button over.
   *
   * Only while there is something to fix. Once the server has answered, its
   * keys do not change under us, and re-asking on every tab focus would be a
   * request per glance for an answer already held.
   */
  const unresolved = problem !== null || caps === null
  useEffect(() => {
    if (!unresolved) return
    const again = () => {
      if (document.visibilityState === 'hidden') return
      void check()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') again()
    }
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', again)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check, unresolved])

  return { caps, problem, checking, retry: () => void check() }
}

/**
 * Why a generator is switched off, in the words that are actually true.
 *
 * There are three reasons a button here can be dead and they call for three
 * different sentences: nobody has asked the server yet, the server could not
 * be asked, or the server was asked and said it has no key. Collapsing them
 * into the last one — which is what a single hard-coded string does — tells
 * somebody with a flaky connection to go configure a server that is already
 * configured, and gives them nothing to press.
 *
 * Returns null when the thing is allowed.
 */
export function gateReason(
  caps: studyApi.Capabilities | null,
  capsProblem: string | null | undefined,
  need: 'ai' | 'narration' | 'judge' | 'search',
): string | null {
  if (caps) {
    if (caps[need]) return null
    switch (need) {
      case 'ai':
        return 'This server has no AI key configured.'
      case 'narration':
        return 'Narration is not configured on this server.'
      case 'judge':
        return 'No code judge is configured on this server.'
      case 'search':
        return 'This server cannot search the library — no embedding model.'
    }
  }
  if (capsProblem) return `${capsProblem} Nothing is wrong with your setup — try again in a moment.`
  return 'Checking what this server can do…'
}
