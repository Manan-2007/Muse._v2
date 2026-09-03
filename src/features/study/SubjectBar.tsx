import { useState } from 'react'
import { BookOpen, Check, Loader2, Plus, X } from 'lucide-react'

import * as studyApi from '@/features/study/api'
import { cn } from '@/lib/utils'

/**
 * Which subject the page is about.
 *
 * In the header rather than in a pane, because it governs all of them — every
 * list below is scoped to whatever is selected here, and a control that
 * changes seven panes at once should not be buried in one of them.
 */
export function SubjectBar({
  roomId,
  subjects,
  activeId,
  onPick,
  onChanged,
}: {
  roomId: string
  subjects: studyApi.Subject[] | null
  activeId: string | null
  onPick: (id: string) => void
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return

    setBusy(true)
    setError(null)
    try {
      await studyApi.createSubject(roomId, { name: name.trim(), code: code.trim() || undefined })
      setName('')
      setCode('')
      setAdding(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (adding) {
    return (
      <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Subject name"
          maxLength={120}
          className="study-field min-w-0 flex-1"
        />
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Code (optional)"
          maxLength={40}
          className="study-field w-36 shrink-0"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          aria-label="Add subject"
          className="study-btn study-btn-primary size-9 shrink-0 px-0"
        >
          {busy ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Check aria-hidden className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false)
            setError(null)
          }}
          aria-label="Cancel"
          className="study-btn size-9 shrink-0 px-0"
        >
          <X aria-hidden className="size-4" />
        </button>
        {error && (
          <p role="alert" className="w-full text-[0.76rem] text-[var(--study-bad)]">
            {error}
          </p>
        )}
      </form>
    )
  }

  return (
    <div data-lenis-prevent className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
      <BookOpen aria-hidden className="size-4 shrink-0 text-[var(--study-faint)]" />

      {subjects === null ? (
        <span className="text-[0.78rem] text-[var(--study-faint)]">Loading…</span>
      ) : (
        subjects.map((subject) => {
          const active = subject.id === activeId
          return (
            <button
              key={subject.id}
              type="button"
              onClick={() => onPick(subject.id)}
              aria-pressed={active}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[0.8rem] outline-none transition-colors duration-200',
                active
                  ? 'bg-[var(--study-card-strong)] text-[var(--study-text)]'
                  : 'text-[var(--study-soft)] hover:bg-[var(--study-card)] hover:text-[var(--study-text)]',
              )}
            >
              <span className="whitespace-nowrap">{subject.name}</span>
              {subject.code && (
                <span className="whitespace-nowrap text-[0.68rem] text-[var(--study-faint)]">
                  {subject.code}
                </span>
              )}
              {/* A subject that has read its syllabus knows what it covers,
                  which changes what every generator below will produce —
                  worth showing rather than leaving to be discovered. */}
              {subject.hasSyllabus && (
                <span
                  aria-label="Syllabus read"
                  title="Syllabus read"
                  className="size-1.5 shrink-0 rounded-full bg-[var(--study-accent)]"
                />
              )}
            </button>
          )
        })
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="Add a subject"
        className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--study-faint)] outline-none transition-colors hover:bg-[var(--study-card)] hover:text-[var(--study-text)]"
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  )
}
