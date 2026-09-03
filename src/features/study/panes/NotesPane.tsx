import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Mermaid } from '@/features/study/Mermaid'
import * as studyApi from '@/features/study/api'
import { useTutor } from '@/features/study/tutorContext'
import {
  Blank,
  GroundedBadge,
  PaneShell,
  Problem,
  Spinner,
  type PaneProps,
} from '@/features/study/panes/shared'
import { gateReason } from '@/features/study/useCapabilities'
import { TopicPicker } from '@/features/study/TopicPicker'

/** Notes on the subject, written from its documents where there are any. */
export default function NotesPane({ roomId, subject, caps, capsProblem, announce, seed }: PaneProps) {
  const [rows, setRows] = useState<studyApi.NoteSummary[] | null>(null)
  const [open, setOpen] = useState<studyApi.Note | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')

  const tutor = useTutor()
  const articleRef = useRef<HTMLElement | null>(null)

  const subjectId = subject?.id ?? null

  const load = useCallback(async () => {
    if (!subjectId) return
    try {
      const { notes } = await studyApi.notes(roomId, subjectId)
      setRows(notes)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the notes.')
      setRows([])
    }
  }, [roomId, subjectId])

  useEffect(() => {
    setRows(null)
    setOpen(null)
    void load()
  }, [load])

  /* A highlight belongs to the note it was made in — carrying it into the next
     one would offer to explain a passage that is no longer on screen. */
  useEffect(() => setSelected(''), [open?.id])

  const generate = async (topic: string, depth: string, resourceIds?: string[]) => {
    if (!subjectId) return
    setBusy(true)
    setError(null)
    try {
      const { note } = await studyApi.createNote(roomId, { subjectId, topic, depth, resourceIds })
      await load()
      announce('notes', subjectId)
      setOpen(note)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  /* Whatever is highlighted inside the article, if anything — read on release
     rather than watched continuously, because a selection mid-drag is not yet
     a thing anybody meant to select. */
  const readSelection = () => {
    const range = window.getSelection()
    const text = range?.toString().trim() ?? ''
    const inside =
      range && range.rangeCount > 0 && articleRef.current
        ? articleRef.current.contains(range.getRangeAt(0).commonAncestorContainer)
        : false
    setSelected(inside ? text : '')
  }

  const explain = () => {
    if (!open || !tutor) return
    const passage = selected.trim()
    tutor.ask({
      mode: 'explain',
      focus: {
        kind: 'note',
        title: passage ? `${open.title} — selected passage` : open.title,
        /* A selected line usually means nothing on its own, so the notes it
           came out of go along with it — the model needs to see what the
           "this" refers back to. */
        body: passage
          ? `${passage}\n\n---\n\nThe notes this passage came from:\n\n${open.content.slice(0, 10_000)}`
          : open.content.slice(0, 16_000),
      },
    })
  }

  if (!subject) return <Blank title="No subject" body="Pick or add a subject first." />

  if (open) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-4">
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="flex items-center gap-2 text-[0.82rem] text-[var(--study-soft)] outline-none transition-colors hover:text-[var(--study-text)]"
          >
            <ArrowLeft aria-hidden className="size-4" />
            All notes
          </button>

          <span className="flex items-center gap-2">
            {tutor && (
              <button
                type="button"
                onClick={explain}
                disabled={!tutor.available}
                title={tutor.available ? undefined : (tutor.reason ?? undefined)}
                className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--study-line)] bg-[var(--study-card)] px-3 text-[0.76rem] text-[var(--study-text)] outline-none transition-colors hover:bg-[var(--study-card-strong)] disabled:opacity-40"
              >
                <Sparkles aria-hidden className="size-3.5" />
                {selected ? 'Explain selection' : 'Explain'}
              </button>
            )}
            <GroundedBadge grounded={open.grounded} sources={open.sources} />
          </span>
        </div>

        <article
          ref={articleRef}
          onMouseUp={readSelection}
          onKeyUp={readSelection}
          onTouchEnd={readSelection}
          data-lenis-prevent
          className="min-h-0 flex-1 overflow-y-auto pb-6 pr-1"
        >
          <h3 className="font-display text-[1.35rem] font-semibold tracking-[-0.02em] text-[var(--study-text)]">
            {open.title}
          </h3>
          <div className="study-prose mt-4">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const text = String(children).replace(/\n$/, '')
                  /* A fenced mermaid block is a diagram, not source to read. */
                  if (className?.includes('language-mermaid')) return <Mermaid chart={text} />
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {open.content}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    )
  }

  return (
    <PaneShell
      title="Notes"
      description="Written notes with tables and diagrams, on any topic from this subject. Where the library has something on it, the notes follow that."
    >
      <TopicPicker
        roomId={roomId}
        subjectId={subjectId}
        disabled={!caps?.ai}
        reason={gateReason(caps, capsProblem, 'ai') ?? undefined}
        busy={busy}
        seed={seed}
        label="Write notes"
        showDepth
        onSubmit={(topic, options) => void generate(topic, options.depth, options.resourceIds)}
      />

      {error && (
        <div className="py-4">
          <Problem message={error} />
        </div>
      )}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Blank
          title="No notes yet"
          body="Pick a topic above. If a syllabus has been read for this subject, the suggestions come from the units it lists."
        />
      ) : (
        <ul className="space-y-2 pb-4">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="group flex items-center gap-3 rounded-[0.9rem] border border-[var(--study-line)] bg-[var(--study-card)] p-3 transition-colors hover:bg-[var(--study-card-strong)]">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { note } = await studyApi.note(roomId, row.id)
                      setOpen(note)
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Could not open that.')
                    }
                  }}
                  className="min-w-0 flex-1 text-left outline-none"
                >
                  <p className="truncate text-[0.88rem] text-[var(--study-text)]">{row.title}</p>
                  <p className="mt-1 truncate text-[0.72rem] text-[var(--study-faint)]">{row.topic}</p>
                </button>

                <GroundedBadge grounded={row.grounded} sources={row.sources} />

                <button
                  type="button"
                  onClick={async () => {
                    await studyApi.deleteNote(roomId, row.id).catch(() => undefined)
                    await load()
                  }}
                  aria-label="Delete these notes"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--study-faint)] opacity-0 outline-none transition-all hover:bg-[var(--study-bad-soft)] hover:text-[var(--study-bad)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PaneShell>
  )
}
