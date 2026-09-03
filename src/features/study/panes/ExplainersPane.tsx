import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Clock, Loader2, RotateCw, Sparkles, Trash2 } from 'lucide-react'

import { ExplainerPlayer } from '@/features/study/ExplainerPlayer'
import * as studyApi from '@/features/study/api'
import {
  Blank,
  GroundedBadge,
  PaneShell,
  Problem,
  Spinner,
  type PaneProps,
} from '@/features/study/panes/shared'
import { gateReason } from '@/features/study/useCapabilities'
import { DocumentPicker } from '@/features/study/DocumentPicker'
import { useShelf } from '@/features/study/useShelf'
import { cn } from '@/lib/utils'

/** Statuses that are still going somewhere, so the list keeps watching. */
const WORKING = new Set(['pending', 'scripting', 'narrating'])

const PROGRESS: Record<string, string> = {
  pending: 'Queued',
  scripting: 'Writing the lesson…',
  narrating: 'Recording the narration…',
  failed: 'Could not be built',
}

/** Narrated, animated lessons on one topic, written from the subject's material. */
export default function ExplainersPane({ roomId, subject, caps, capsProblem, announce, seed }: PaneProps) {
  const [rows, setRows] = useState<studyApi.ExplainerSummary[] | null>(null)
  const [open, setOpen] = useState<studyApi.Explainer | null>(null)
  const [topic, setTopic] = useState(seed ?? '')
  const [style, setStyle] = useState('')
  const [voice, setVoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  /* Empty means the whole shelf — the same default every other generator has. */
  const [picked, setPicked] = useState<string[]>([])

  const subjectId = subject?.id ?? null
  const shelf = useShelf(roomId, subjectId)

  const load = useCallback(async () => {
    if (!subjectId) return
    try {
      const { explainers } = await studyApi.explainers(roomId, subjectId)
      setRows(explainers)
      return explainers
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the lessons.')
      setRows([])
      return []
    }
  }, [roomId, subjectId])

  useEffect(() => {
    setRows(null)
    setOpen(null)
    void load()
  }, [load])

  useEffect(() => {
    if (seed) setTopic(seed)
  }, [seed])

  /* A choice of documents means nothing in a different course. */
  useEffect(() => setPicked([]), [subjectId])

  /*
   * Watch while anything is still being built.
   *
   * A lesson takes a minute or two — a script, then a narration clip per beat
   * — so the request returns immediately and the row reports its own progress.
   * The poll stops as soon as nothing is working, rather than running forever
   * behind a page nobody is looking at.
   */
  const polling = useRef<number | null>(null)
  useEffect(() => {
    const working = (rows ?? []).some((row) => WORKING.has(row.status))
    if (!working) {
      if (polling.current) window.clearInterval(polling.current)
      polling.current = null
      return
    }
    if (polling.current) return
    polling.current = window.setInterval(() => void load(), 3000)
    return () => {
      if (polling.current) window.clearInterval(polling.current)
      polling.current = null
    }
  }, [rows, load])

  /* Picking documents already says what to teach — see DocumentPicker. */
  const needsTopic = picked.length === 0
  const ready = !needsTopic || topic.trim().length > 0

  const generate = async () => {
    if (!subjectId || !ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await studyApi.createExplainer(roomId, {
        subjectId,
        topic: topic.trim(),
        style: style.trim(),
        voice: voice || undefined,
        resourceIds: picked.length ? picked : undefined,
      })
      setTopic('')
      await load()
      announce('explainers', subjectId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const again = async (id: string) => {
    setRetrying(id)
    setError(null)
    try {
      await studyApi.retryExplainer(roomId, id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setRetrying(null)
    }
  }

  const play = async (id: string) => {
    setError(null)
    try {
      const { explainer } = await studyApi.explainer(roomId, id)
      setOpen(explainer)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that lesson.')
    }
  }

  if (!subject) return <Blank title="No subject" body="Pick or add a subject first." />

  if (open) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-3">
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="flex items-center gap-2 text-[0.82rem] text-[var(--study-soft)] outline-none transition-colors hover:text-[var(--study-text)]"
          >
            <ArrowLeft aria-hidden className="size-4" />
            All lessons
          </button>
          <span className="flex min-w-0 items-center gap-3">
            <span className="truncate text-[0.88rem]">{open.title}</span>
            <GroundedBadge grounded={open.grounded} sources={open.sources} />
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <ExplainerPlayer
            beats={open.beats}
            title={open.title}
            onExit={() => setOpen(null)}
          />
        </div>
      </div>
    )
  }

  const unavailable = !caps?.ai || !caps?.narration

  return (
    <PaneShell
      title="Lessons"
      description="Narrated walkthroughs that build the diagram as they explain it. Written from this subject's material, at the level the course is taught."
    >
      <div className="study-card mb-5 p-3.5">
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !unavailable && ready) void generate()
          }}
          placeholder={
            needsTopic
              ? 'A topic — what should this lesson teach?'
              : 'A topic, if you want to narrow it — optional'
          }
          maxLength={300}
          className="study-field h-10 w-full"
        />

        {/*
          * How they want to be taught, in their own words.
          *
          * Free text rather than a difficulty menu, because the useful thing a
          * student knows about their own revision is never on a menu: "I keep
          * confusing these two under pressure" or "skip the history, I need
          * the derivation" changes what a good lesson looks like far more
          * than "intermediate" does.
          */}
        <textarea
          value={style}
          onChange={(event) => setStyle(event.target.value)}
          rows={2}
          placeholder="Optional — how do you want it taught? e.g. “exam in 3 days, I keep losing marks on the boundary cases, don't oversimplify”"
          maxLength={1000}
          className="study-field mt-2 h-auto w-full resize-none rounded-[0.9rem] py-2.5 leading-relaxed"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
            aria-label="Narrator"
            className="study-field h-10 shrink-0 px-3"
          >
            <option value="" style={{ background: 'var(--study-bg)', color: 'var(--study-text)' }}>
              Default narrator
            </option>
            {(caps?.voices ?? []).map((entry) => (
              <option
                key={entry.id}
                value={entry.id}
                style={{ background: 'var(--study-bg)', color: 'var(--study-text)' }}
              >
                {entry.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || unavailable || !ready}
            title={
              gateReason(caps, capsProblem, 'ai') ??
              gateReason(caps, capsProblem, 'narration') ??
              undefined
            }
            className="study-btn study-btn-primary ml-auto h-10 px-4"
          >
            {busy ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Sparkles aria-hidden className="size-4" />
            )}
            {busy ? 'Starting…' : 'Make the lesson'}
          </button>
        </div>

        <DocumentPicker shelf={shelf} picked={picked} onChange={setPicked} className="mt-3" />

        <p className="mt-2.5 text-[0.72rem] leading-relaxed text-[var(--study-faint)]">
          A lesson takes a minute or two to write and record. You can leave this tab while it does.
        </p>
      </div>

      {error && (
        <div className="pb-4">
          <Problem message={error} />
        </div>
      )}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Blank
          title="No lessons yet"
          body="Name a topic above. If the library has material on it, the lesson is built from that — and the syllabus decides what belongs in it either way."
        />
      ) : (
        <ul className="space-y-2 pb-4">
          {rows.map((row) => {
            const working = WORKING.has(row.status)
            const ready = row.status === 'ready'
            return (
              <li key={row.id}>
                <div className="study-card group flex items-center gap-3 p-3.5 transition-colors hover:bg-[var(--study-card-strong)]">
                  <button
                    type="button"
                    onClick={() => ready && void play(row.id)}
                    disabled={!ready}
                    className="min-w-0 flex-1 text-left outline-none disabled:cursor-default"
                  >
                    <p className="truncate text-[0.92rem]">{row.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.74rem] text-[var(--study-faint)]">
                      {working ? (
                        <span className="flex items-center gap-1.5 text-[var(--study-soft)]">
                          <Loader2 aria-hidden className="size-3 animate-spin" />
                          {PROGRESS[row.status]}
                        </span>
                      ) : row.status === 'failed' ? (
                        <span className="text-[var(--study-bad)]">
                          {row.error || PROGRESS.failed}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Clock aria-hidden className="size-3" />
                          {minutes(row.duration)}
                        </span>
                      )}
                      {row.style && (
                        <span className="truncate italic opacity-80" title={row.style}>
                          “{row.style}”
                        </span>
                      )}
                    </p>
                  </button>

                  {ready && <GroundedBadge grounded={row.grounded} sources={row.sources} />}

                  {/* The topic and the way they asked for it to be taught are
                      still on the row, and so is whatever script it managed to
                      write — so this costs a click, not the typing again. */}
                  {row.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => void again(row.id)}
                      disabled={retrying === row.id}
                      className="study-btn h-8 shrink-0 px-3 text-[0.76rem]"
                    >
                      {retrying === row.id ? (
                        <Loader2 aria-hidden className="size-3.5 animate-spin" />
                      ) : (
                        <RotateCw aria-hidden className="size-3.5" />
                      )}
                      Try again
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      await studyApi.deleteExplainer(roomId, row.id).catch(() => undefined)
                      await load()
                    }}
                    aria-label={`Delete ${row.title}`}
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-[var(--study-faint)] outline-none transition-all',
                      'hover:bg-[var(--study-bad-soft)] hover:text-[var(--study-bad)]',
                      'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                    )}
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </PaneShell>
  )
}

function minutes(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} sec`
  return `${Math.floor(seconds / 60)} min ${String(Math.round(seconds % 60)).padStart(2, '0')} sec`
}
