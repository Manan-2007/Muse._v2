import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react'

import { Mermaid } from '@/features/study/Mermaid'
import { useTutor } from '@/features/study/tutorContext'
import type * as studyApi from '@/features/study/api'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { apiUrl } from '@/lib/config'
import { cn } from '@/lib/utils'

/**
 * The lesson, playing.
 *
 * There is no video file here and never was one. Each beat carries its own
 * narration clip and its own visual, and this plays the clip while rendering
 * the visual — so a diagram is drawn by the same code that draws the notes,
 * and is exactly as correct as the data behind it. A generated video would
 * have to be watched all the way through to find the wrong label; this cannot
 * produce one.
 *
 * Timing needs nothing clever for the same reason. A beat is one idea with one
 * visual state, so the clip's own length is how long that state is on screen —
 * no word-level alignment, no drift to correct.
 */

const EASE = [0.16, 1, 0.3, 1] as const

/** Written once so no build step has to survive escaping it. */
const NEWLINE = String.fromCharCode(10)

export function ExplainerPlayer({
  beats,
  title,
  onExit,
}: {
  beats: studyApi.Beat[]
  /** Named so a question about a beat carries which lesson it came from. */
  title: string
  onExit?: () => void
}) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [rate, setRate] = useState(1)
  /* Seconds elapsed inside the current beat, for the progress bar only. */
  const [elapsed, setElapsed] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const preloadRef = useRef<HTMLAudioElement | null>(null)
  const reduced = usePrefersReducedMotion()
  const tutor = useTutor()

  const beat = beats[index]
  const total = beats.length

  /** Whole-lesson length, for the readout. */
  const runtime = useMemo(
    () => beats.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0),
    [beats],
  )

  /** How far through the whole lesson we are, counting completed beats. */
  const before = useMemo(
    () => beats.slice(0, index).reduce((sum, entry) => sum + (entry.seconds ?? 0), 0),
    [beats, index],
  )

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next))
      setIndex(clamped)
      setElapsed(0)
      setReady(false)
    },
    [total],
  )

  /* Load the beat's clip, and start it if we were already playing. Switching
     src mid-play is what makes the lesson continuous rather than a set of
     clips somebody has to click through. */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !beat?.audio) return

    audio.src = apiUrl(beat.audio)
    audio.playbackRate = rate
    audio.load()

    const onReady = () => {
      setReady(true)
      if (playing) void audio.play().catch(() => setPlaying(false))
    }
    audio.addEventListener('canplay', onReady, { once: true })
    return () => audio.removeEventListener('canplay', onReady)
    // `playing` deliberately omitted: this effect is about which beat is
    // loaded, and re-running it on pause would restart the clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat?.audio])

  /* The next clip, fetched while this one plays, so the join is silent. */
  useEffect(() => {
    const next = beats[index + 1]
    if (!next?.audio || !preloadRef.current) return
    preloadRef.current.src = apiUrl(next.audio)
    preloadRef.current.load()
  }, [beats, index])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setElapsed(audio.currentTime)
    const onEnd = () => {
      if (index < total - 1) go(index + 1)
      else setPlaying(false)
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnd)
    }
  }, [index, total, go])

  /* Applied to the element rather than kept only in state, so a rate chosen
     mid-sentence takes effect on that sentence. */
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate, index])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }, [playing])

  /* Space to play, arrows to move. The shortcuts every player has, and the
     ones somebody revising will reach for without being told. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === ' ') {
        event.preventDefault()
        toggle()
      } else if (event.key === 'ArrowRight') go(index + 1)
      else if (event.key === 'ArrowLeft') go(index - 1)
      else if (event.key === 'Escape' && onExit) onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, go, index, onExit])

  if (!beat) return null

  const beatLength = beat.seconds ?? 0
  const played = before + Math.min(elapsed, beatLength)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <audio ref={audioRef} preload="auto" className="hidden" />
      <audio ref={preloadRef} preload="auto" className="hidden" />

      {/* The stage.
          
          Deliberately reads as a screen rather than a card: darker than the
          page around it, edge to edge, with the content given the room to be
          the whole picture. A lesson framed as a small panel in a large page
          looks like a widget; the same content filling the frame looks like
          something you watch. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.1rem] bg-[var(--study-stage)] ring-1 ring-inset ring-[var(--study-line)]">
        {/*
          * Cross-faded, not wait-for-exit.
          *
          * `mode="wait"` holds the incoming beat until the outgoing one has
          * finished animating away, which makes the *content* depend on an
          * *animation* completing. Browsers throttle requestAnimationFrame to
          * nothing in a background tab, so a lesson left playing in another
          * window would freeze on whichever slide it was leaving and never
          * show the next one, while the narration carried on without it.
          * Overlapping the two costs nothing — both are absolutely
          * positioned — and the beat always arrives.
          */}
        <AnimatePresence initial={false}>
          <motion.div
            /* Keyed by the group where there is one, so a building visual is
               not torn down and rebuilt between beats — that is the whole
               difference between a diagram being drawn and a slideshow. */
            key={beat.group ?? `beat-${index}`}
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -8 }}
            transition={{ duration: reduced ? 0.12 : 0.35, ease: EASE }}
            className="absolute inset-0 grid place-items-center px-5 pb-24 pt-6 md:px-10 md:pb-28 md:pt-8"
          >
            <Stage visual={beat.show} seconds={beat.seconds ?? 0} beatKey={index} />
          </motion.div>
        </AnimatePresence>

        {/* The line being spoken.
            
            Subtitles, in the shape everything else uses them: a plate sized to
            the words rather than a gradient washing over the bottom third of
            the picture. The gradient was covering content and reading as an
            unfinished edge; a contained plate sits over it without eating it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4 md:pb-6">
          <p className="max-w-3xl rounded-[0.7rem] bg-[var(--study-caption)] px-4 py-2.5 text-center text-[0.95rem] leading-relaxed text-[var(--study-text)] backdrop-blur-md md:text-[1rem]">
            {beat.say}
          </p>
        </div>
      </div>

      <div className="mt-3 shrink-0">
        {/* One segment per beat: where you are, how much is left, and a way
            into any of it. A single bar would hide the structure the lesson
            actually has. */}
        <div className="flex gap-1">
          {beats.map((entry, at) => (
            <button
              key={at}
              type="button"
              onClick={() => go(at)}
              aria-label={`Beat ${at + 1}`}
              style={{ flexGrow: Math.max(0.4, entry.seconds ?? 1) }}
              className="group/seg relative h-1.5 rounded-full bg-[var(--study-card-strong)] outline-none"
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full bg-[var(--study-accent)] transition-[width] duration-200',
                  at < index ? 'w-full' : at > index ? 'w-0' : '',
                )}
                style={
                  at === index
                    ? { width: `${beatLength ? Math.min(100, (elapsed / beatLength) * 100) : 0}%` }
                    : undefined
                }
              />
              <span className="absolute -inset-y-2 inset-x-0" />
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--study-accent)] text-[var(--study-on-accent)] outline-none transition-opacity hover:opacity-90"
          >
            {!ready && playing ? (
              <Loader2 aria-hidden className="size-5 animate-spin" />
            ) : playing ? (
              <Pause aria-hidden className="size-5" />
            ) : (
              <Play aria-hidden className="size-5 translate-x-[1px]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous"
            className="study-btn size-9 px-0"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index >= total - 1}
            aria-label="Next"
            className="study-btn size-9 px-0"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              go(0)
              setPlaying(false)
              audioRef.current?.pause()
            }}
            aria-label="Start again"
            className="study-btn size-9 px-0"
          >
            <RotateCcw aria-hidden className="size-4" />
          </button>

          {/* Asks about the beat on screen, not the lesson in general — the
              question somebody actually has is about the thing confusing them
              right now, and pausing to retype it is how they lose the thread. */}
          {tutor && (
            <button
              type="button"
              onClick={() => {
                audioRef.current?.pause()
                setPlaying(false)
                tutor.ask({
                  mode: 'explain',
                  focus: {
                    kind: 'note',
                    title: `${title} — ${clock(before)}`,
                    body: describe(beat, index, total, title),
                  },
                })
              }}
              disabled={!tutor.available}
              title={tutor.available ? undefined : (tutor.reason ?? undefined)}
              className="study-btn h-9"
            >
              <Sparkles aria-hidden className="size-3.5" />
              <span className="hidden sm:inline">Ask about this</span>
            </button>
          )}

          {/* Half speed is for a dense derivation; one and a half is for
              revisiting something already understood. Both get used. */}
          <select
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
            aria-label="Playback speed"
            className="study-field h-9 shrink-0 px-2 text-[0.76rem]"
          >
            {[0.75, 0.9, 1, 1.15, 1.35, 1.6, 2].map((option) => (
              <option
                key={option}
                value={option}
                style={{ background: 'var(--study-bg)', color: 'var(--study-text)' }}
              >
                {option}×
              </option>
            ))}
          </select>

          <span className="ml-auto shrink-0 font-mono text-[0.74rem] tabular-nums text-[var(--study-faint)]">
            {clock(played)} / {clock(runtime)}
            <span className="ml-2.5">
              {index + 1}/{total}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The beat, written out for the tutor.
 *
 * Both halves go over: what was said and what was on screen. A question about
 * "this" usually means the picture, and a transcript alone would leave the
 * tutor answering about the wrong half of the beat.
 */
function describe(beat: studyApi.Beat, index: number, total: number, title: string) {
  const v = beat.show
  const shown =
    v.kind === 'title'
      ? `Title card: ${v.text}${v.subtitle ? ` — ${v.subtitle}` : ''}`
      : v.kind === 'bullets'
        ? `Points on screen:\n${v.items.slice(0, v.reveal ?? v.items.length).map((i) => `- ${i}`).join('\n')}`
        : v.kind === 'steps'
          ? `A walkthrough, currently on step ${(v.active ?? 0) + 1}:\n${v.items.map((item, at) => `${at + 1}. ${item}${at === (v.active ?? 0) ? '   <- on screen now' : ''}`).join('\n')}`
          : v.kind === 'diagram'
            ? `A diagram, as Mermaid:\n${v.mermaid}`
            : v.kind === 'code'
              ? `Code on screen (${v.language})${v.highlight?.length ? `, with line${v.highlight.length > 1 ? 's' : ''} ${v.highlight.join(', ')} highlighted` : ''}:\n\n${v.code}`
              : v.kind === 'compare'
                ? `A comparison — ${v.left.title}: ${v.left.points.join('; ')} / ${v.right.title}: ${v.right.points.join('; ')}`
                : `A callout: ${v.text}`

  return `From the lesson "${title}", part ${index + 1} of ${total}.\n\nThe narration said:\n"${beat.say}"\n\n${shown}`
}

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** One visual. Every branch renders data — none of it is generated imagery. */
function Stage({
  visual,
  seconds,
  beatKey,
}: {
  visual: studyApi.Visual
  seconds: number
  beatKey: number
}) {
  switch (visual.kind) {
    case 'title':
      return (
        <div className="text-center">
          <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-[2.6rem]">
            {visual.text}
          </h2>
          {visual.subtitle && (
            <p className="mt-3 text-[1rem] text-[var(--study-soft)]">{visual.subtitle}</p>
          )}
        </div>
      )

    case 'bullets': {
      const shown = visual.reveal ?? visual.items.length
      return (
        <div className="w-full max-w-2xl">
          {visual.heading && <Heading>{visual.heading}</Heading>}
          <ul className="space-y-3">
            {visual.items.map((item, at) => (
              <motion.li
                key={item}
                initial={false}
                /* Not-yet-revealed items stay legible. At 0.18 they read as
                   a rendering fault, and anybody who glances at the list
                   before the voice gets there sees four broken rows. */
                animate={{
                  opacity: at < shown ? 1 : 0.32,
                  x: at < shown ? 0 : -6,
                }}
                transition={{ duration: 0.4, ease: EASE }}
                className="flex items-start gap-3 text-[1.05rem] leading-relaxed"
              >
                <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-[var(--study-accent)]" />
                <span>{item}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      )
    }

    case 'steps': {
      const active = visual.active ?? 0
      return (
        <div className="w-full max-w-2xl">
          {visual.heading && <Heading>{visual.heading}</Heading>}
          <ol className="space-y-2">
            {visual.items.map((item, at) => (
              <motion.li
                key={item}
                initial={false}
                /* The step being discussed is lit; the rest stay readable.
                   A summary beat shows every step at once, so burying four of
                   five at 0.22 would be telling the listener to ignore most of
                   what is being said. */
                animate={{ opacity: at === active ? 1 : at < active ? 0.62 : 0.42 }}
                transition={{ duration: 0.35, ease: EASE }}
                className={cn(
                  'flex items-start gap-3 rounded-[0.7rem] px-3 py-2.5 text-[1.02rem] leading-relaxed transition-colors',
                  at === active && 'bg-[var(--study-accent-soft)]',
                )}
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-[0.72rem] font-semibold',
                    at === active
                      ? 'bg-[var(--study-accent)] text-[var(--study-on-accent)]'
                      : 'bg-[var(--study-card-strong)] text-[var(--study-soft)]',
                  )}
                >
                  {at + 1}
                </span>
                <span>{item}</span>
              </motion.li>
            ))}
          </ol>
        </div>
      )
    }

    case 'diagram':
      return (
        <div className="w-full max-w-3xl text-center">
          {/* `draw` traces the strokes in rather than cutting to the finished
              picture — the thing that reads as being taught rather than shown. */}
          <Mermaid chart={visual.mermaid} draw />
          {visual.caption && (
            <p className="mt-4 text-[0.86rem] text-[var(--study-faint)]">{visual.caption}</p>
          )}
        </div>
      )

    case 'code':
      return <CodeStage visual={visual} seconds={seconds} beatKey={beatKey} />

    case 'compare':
      return (
        <div className="w-full max-w-3xl">
          {visual.heading && <Heading>{visual.heading}</Heading>}
          <div className="grid gap-3 sm:grid-cols-2">
            {[visual.left, visual.right].map((side, at) => (
              <div key={at} className="study-card p-5">
                <p className="text-[0.95rem] font-medium">{side.title}</p>
                <ul className="mt-3 space-y-2">
                  {side.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-2.5 text-[0.9rem] leading-relaxed text-[var(--study-soft)]"
                    >
                      <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-[var(--study-faint)]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )

    case 'callout': {
      const label =
        visual.tone === 'exam'
          ? 'Likely to be assessed'
          : visual.tone === 'pitfall'
            ? 'Where marks are lost'
            : 'Worth noticing'
      return (
        <div className="w-full max-w-2xl">
          <div
            className={cn(
              'rounded-[1rem] border-l-[3px] p-6',
              visual.tone === 'exam' && 'border-[var(--study-accent)] bg-[var(--study-accent-soft)]',
              visual.tone === 'pitfall' && 'border-[var(--study-bad)] bg-[var(--study-bad-soft)]',
              visual.tone === 'insight' && 'border-[var(--study-good)] bg-[var(--study-good-soft)]',
            )}
          >
            <p className="text-[0.7rem] uppercase tracking-[0.09em] text-[var(--study-faint)]">
              {label}
            </p>
            <p className="mt-2.5 text-[1.1rem] leading-relaxed">{visual.text}</p>
          </div>
        </div>
      )
    }

    default:
      return null
  }
}


/**
 * Code, typed in rather than pasted.
 *
 * Watching a line arrive is the difference between reading a listing and
 * being shown how it is built, and it is the one place a lesson can be
 * genuinely animated without inventing anything: the characters are the code,
 * arriving in the order somebody would write them.
 *
 * Paced to finish a little before the narration does, so the block is whole
 * and readable while the voice is still talking about it — rather than still
 * crawling out after the beat has moved on.
 */
function CodeStage({
  visual,
  seconds,
  beatKey,
}: {
  visual: Extract<studyApi.Visual, { kind: 'code' }>
  seconds: number
  beatKey: number
}) {
  const reduced = usePrefersReducedMotion()
  const lines = useMemo(() => visual.code.split(NEWLINE), [visual.code])
  const [typed, setTyped] = useState(0)
  const box = useRef<HTMLPreElement | null>(null)

  /*
   * Follow the highlight.
   *
   * A group holds one listing and moves the highlight through it, which is
   * the whole point — but a listing taller than the box would leave the line
   * being discussed somewhere off screen, and the student watching has no way
   * to know they should scroll. Bringing it into view is the difference
   * between a walkthrough and a wall of code.
   */
  const firstLit = visual.highlight?.length ? Math.min(...visual.highlight) : null
  useEffect(() => {
    if (!firstLit || !box.current) return
    const row = box.current.children[firstLit - 1] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [firstLit, typed, reduced])

  useEffect(() => {
    if (reduced) {
      setTyped(lines.length)
      return
    }
    setTyped(0)
    /* Two thirds of the beat, floored so a very short beat still animates and
       capped so a very long one is not still typing a minute later. */
    const span = Math.max(900, Math.min(seconds * 1000 * 0.66, 6000))
    const step = Math.max(30, span / Math.max(1, lines.length))

    let at = 0
    const timer = window.setInterval(() => {
      at += 1
      setTyped(at)
      if (at >= lines.length) window.clearInterval(timer)
    }, step)
    return () => window.clearInterval(timer)
    /* Keyed on the code itself, not the beat: a group that holds the same
       block and only moves the highlight must not retype it. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visual.code, reduced])

  return (
    <div className="w-full max-w-4xl">
      {visual.caption && (
        <p className="mb-3 text-[0.78rem] uppercase tracking-[0.07em] text-[var(--study-faint)]">
          {visual.caption}
        </p>
      )}
      {/* `data-lenis-prevent` or this does not scroll at all: the app's smooth
          scrolling owns the wheel document-wide and swallows the gesture over
          any nested scroller that has not opted out. Every other scrolling box
          in the app carries it for the same reason. */}
      <pre
        ref={box}
        data-lenis-prevent
        className="max-h-[62vh] overflow-auto rounded-[0.9rem] border border-[var(--study-line)] bg-[var(--study-card)] p-5 font-mono text-[0.95rem] leading-[1.75] md:text-[1rem]"
      >
        {lines.map((line, at) => {
          const lit = visual.highlight?.includes(at + 1)
          const shown = at < typed
          const cursor = shown && at === typed - 1 && typed < lines.length
          return (
            <div
              key={`${beatKey}-${at}`}
              className={cn(
                '-mx-5 border-l-2 px-5 transition-all duration-300',
                !shown && 'opacity-0',
                shown && lit && 'border-[var(--study-accent)] bg-[var(--study-accent-soft)]',
                shown && !lit && 'border-transparent opacity-70',
              )}
            >
              <span className="mr-4 select-none text-[var(--study-faint)]">
                {String(at + 1).padStart(2, ' ')}
              </span>
              {line || ' '}
              {cursor && (
                <span className="ml-0.5 inline-block h-[1.05em] w-[0.5ch] translate-y-[0.18em] animate-pulse bg-[var(--study-accent)]" />
              )}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 text-[0.72rem] uppercase tracking-[0.09em] text-[var(--study-faint)]">
      {children}
    </p>
  )
}
