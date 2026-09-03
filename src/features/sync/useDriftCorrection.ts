import { useEffect, useRef } from 'react'

/**
 * Holding everyone to the same moment.
 *
 * Shared by Watch and Listen rather than written twice. The two used to
 * correct very differently — the film to a fifth of a second, the music only
 * when it was already a second and a half out and only checked every five —
 * which is why a room could be watching in step and listening plainly apart.
 * A song is not more forgiving than a film; if anything two people humming
 * along notice sooner. Same engine, different tuning.
 *
 * The naive version — "seek anyone more than 300ms out" — fights buffering. A
 * stalled client is behind by definition, gets yanked forward, stalls again on
 * the fresh buffer, and seek-loops until the network catches up. So:
 *
 * - While the player reports buffering, do nothing at all.
 * - And for a while *after* it, too: the room's clock ran on while the player
 *   stalled, so a player that has just recovered is behind by definition, and
 *   reading that as fresh drift is what restarts the loop.
 * - Where the source allows any playback rate, absorb small drift by running
 *   fractionally fast or slow, which nobody can see. Seeking is the last
 *   resort, because a visible jump is worse than 400ms of being behind.
 * - Where it does not — YouTube only accepts its own rate list — every
 *   correction costs a rebuffer, so small drift is simply tolerated and the
 *   threshold for a jump is wider.
 *
 * Audio can be nudged for the same reason video can, which is not obvious and
 * was previously assumed otherwise: `preservesPitch` defaults to true on every
 * current engine, so a couple of percent of speed is time-stretched rather
 * than transposed. The song does not go sharp, it just arrives a hair sooner.
 * Two percent is used there rather than five — a tempo shift is easier to feel
 * than a frame shift, even when the pitch holds.
 */

/** What the loop needs of a player. Both handles satisfy this structurally. */
export type Correctable = {
  seek: (seconds: number) => void
  setRate: (rate: number) => void
  getPosition: () => number
  isBuffering: () => boolean
  isPaused: () => boolean
  supportsFineRate: boolean
}

/** Per-medium thresholds. Defaults are the video figures. */
export type DriftTuning = {
  hard?: number
  hardCoarse?: number
  soft?: number
  nudge?: number
}

/** Past this, jump. A gap this size is already obvious to everyone. */
const HARD_SECONDS = 1.2
/**
 * The same threshold for a source that cannot be nudged.
 *
 * Wider, because every correction on such a source is a seek and every seek
 * costs a rebuffer. Holding YouTube to 1.2s means paying for a stall to fix a
 * gap nobody would have noticed, over and over.
 */
const HARD_SECONDS_COARSE = 2.4
/** Below this, we are as in sync as playback timing can meaningfully be. */
const SOFT_SECONDS = 0.3
/** How hard to lean on the rate when catching up on a fine-rate source. */
const NUDGE = 0.05
/**
 * After a seek, leave the player alone this long.
 *
 * This is the whole fix for the loop the comment above describes from the
 * other side. Suppressing corrections *during* a buffer is not enough: the
 * room's clock keeps running while the player stalls, so the instant the
 * buffer clears the player is behind by however long it took, which is
 * immediately another correction, which is another buffer. The cooldown is
 * what turns that spiral into a single seek that gets a chance to settle.
 */
const SEEK_COOLDOWN_MS = 5000
/**
 * How far past the target to aim, on a source that rebuffers when it seeks.
 *
 * Seeking to where the room is *now* guarantees landing behind, because the
 * seek itself takes time. Aiming at where the room will be once the buffer
 * clears lands near-level instead. Seeded with a typical figure and then
 * measured, since it depends on the network and the video.
 */
const INITIAL_SEEK_COST = 0.8
/**
 * Clamp on the measured figure.
 *
 * Held well inside `HARD_SECONDS_COARSE` on purpose. The lead deliberately
 * overshoots, so if it were ever allowed to exceed the threshold it is
 * correcting against, landing would itself be a correctable gap — in the other
 * direction — and the loop this whole file exists to kill would come back
 * wearing the opposite sign.
 */
const MAX_SEEK_COST = 1.5

export function useDriftCorrection({
  handle,
  playing,
  rate = 1,
  seq = 0,
  targetPosition,
  enabled,
  tuning,
}: {
  handle: Correctable | null
  /** Whether the room says it is running. Not whether this player is. */
  playing: boolean
  /** The room's playback rate, for sources that have one. Audio has none. */
  rate?: number
  /** Bumped by any deliberate control, so the loop stands down after one. */
  seq?: number
  targetPosition: () => number
  enabled: boolean
  tuning?: DriftTuning
}) {
  const hard = tuning?.hard ?? HARD_SECONDS
  const hardCoarse = tuning?.hardCoarse ?? HARD_SECONDS_COARSE
  const soft = tuning?.soft ?? SOFT_SECONDS
  const nudge = tuning?.nudge ?? NUDGE

  const nudged = useRef(false)
  /** Corrections are suppressed until this moment. See `SEEK_COOLDOWN_MS`. */
  const settleUntil = useRef(0)
  /** Running estimate of what a seek costs this source, in seconds. */
  const seekCost = useRef(INITIAL_SEEK_COST)
  /** When the last corrective seek was issued, while it is still recovering. */
  const seekedAt = useRef<number | null>(null)

  /*
   * Held in a ref rather than read from the closure.
   *
   * `targetPosition` is rebuilt whenever the snapshot object changes, and the
   * snapshot is rebuilt for things that have nothing to do with playback —
   * somebody walking into the room re-creates it with a new viewer list. With
   * that identity in the dependency array the interval below was torn down and
   * restarted on every one of those, so the timer could be reset forever and
   * the correction it was counting towards never ran.
   */
  const positionOf = useRef(targetPosition)
  positionOf.current = targetPosition

  /*
   * A control event just moved playback deliberately — a play, a seek, a rate
   * change. The player is about to re-buffer around the new position, and
   * reading that as drift would spend a second correction on top of the one
   * the room asked for. Give it the same settling time a correction gets.
   */
  useEffect(() => {
    settleUntil.current = performance.now() + SEEK_COOLDOWN_MS
  }, [seq])

  useEffect(() => {
    if (!handle || !enabled || !playing) return

    const restoreRate = () => {
      if (!nudged.current) return
      handle.setRate(rate)
      nudged.current = false
    }

    /* Coarse sources pay a rebuffer per correction, so they aim ahead of the
       room by roughly what that rebuffer will cost them. */
    const coarse = !handle.supportsFineRate
    const correct = () => {
      const lead = coarse ? seekCost.current : 0
      handle.seek(positionOf.current() + lead)
      settleUntil.current = performance.now() + SEEK_COOLDOWN_MS
      seekedAt.current = performance.now()
      restoreRate()
    }

    const tick = () => {
      /*
       * The player is stopped even though the room says it is running.
       *
       * They can disagree: fullscreen on a phone hands the video to the OS
       * player and its pause button never reaches this app, autoplay can be
       * refused, a headphone click can stop it. While that is true, every
       * correction seeks a stopped video — which does not catch anything up,
       * it just paints the frame at the new position, so a paused film appears
       * to creep forward a frame at a time.
       *
       * Standing down here rather than trying to fix it: whatever put the
       * player and the room out of step is the thing that should resolve it.
       */
      if (handle.isPaused()) {
        restoreRate()
        return
      }

      if (handle.isBuffering()) {
        /* Not drift — just slow. Stand the rate back up so a nudge does not
           ride out through the stall, and wait. */
        restoreRate()
        return
      }

      /*
       * Playing again after a correction: learn what that correction actually
       * cost, so the next one aims better. Eased rather than replaced, because
       * a single slow fetch is not the new normal.
       */
      if (seekedAt.current !== null) {
        const cost = (performance.now() - seekedAt.current) / 1000
        seekCost.current = Math.min(
          MAX_SEEK_COST,
          seekCost.current * 0.7 + Math.max(0, cost) * 0.3,
        )
        seekedAt.current = null
      }

      /* Still settling from the last correction. Measuring drift here reads
         the recovery as a fresh problem and starts the loop over. */
      if (performance.now() < settleUntil.current) return

      const drift = positionOf.current() - handle.getPosition()
      const size = Math.abs(drift)

      if (size >= (coarse ? hardCoarse : hard)) {
        correct()
        return
      }

      /*
       * Small drift is only worth chasing on a source that can absorb it by
       * running fractionally fast. Seeking a coarse source to close a gap of
       * a few hundred milliseconds spends a rebuffer of roughly a second to
       * fix something smaller than the fix — it makes both the sync and the
       * viewing worse. Below the coarse threshold, it is left alone.
       */
      if (size >= soft && handle.supportsFineRate) {
        /* Behind → speed up a touch; ahead → ease off. Imperceptible, and it
           converges without a single visible jump. */
        handle.setRate(rate * (drift > 0 ? 1 + nudge : 1 - nudge))
        nudged.current = true
        return
      }

      restoreRate()
    }

    const timer = setInterval(tick, 1000)
    return () => {
      clearInterval(timer)
      if (nudged.current) {
        handle.setRate(rate)
        nudged.current = false
      }
    }
  }, [handle, enabled, playing, rate, hard, hardCoarse, soft, nudge])
}
