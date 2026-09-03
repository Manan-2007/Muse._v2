import { Loader2, Sparkles } from 'lucide-react'

import type * as studyApi from '@/features/study/api'
import { cn } from '@/lib/utils'

/** What every pane is handed. */
export type PaneProps = {
  roomId: string
  subject: studyApi.Subject | null
  caps: studyApi.Capabilities | null
  /** Why `caps` is null, when the reason was the connection rather than a
      pending request. Never a claim about how the server is configured. */
  capsProblem?: string | null
  announce: (kind: string, subjectId?: string | null) => void
  selfId: string | undefined
  /** Jump to another pane — the home dashboard is mostly made of these. */
  go: (tab: string, topic?: string) => void
  /** A topic handed over by whatever sent you here, to prefill the box. */
  seed?: string | null
}

export function PaneShell({
  title,
  description,
  aside,
  children,
}: {
  title: string
  description?: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 pb-5">
        <div className="min-w-0">
          <h2 className="font-display text-[1.3rem] font-semibold tracking-[-0.02em]">{title}</h2>
          {description && (
            <p className="mt-1 max-w-lg text-[0.82rem] leading-relaxed text-[var(--study-soft)]">
              {description}
            </p>
          )}
        </div>
        {aside}
      </div>
      {/* Lenis owns the wheel for the whole document, so a nested scroller
          has to opt out explicitly or it simply never scrolls. Every other
          scrolling panel in the app carries this for the same reason. */}
      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="grid place-items-center py-16">
      <span className="flex items-center gap-2.5 text-[var(--study-soft)]">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {label && <span className="text-[0.82rem]">{label}</span>}
      </span>
    </div>
  )
}

export function Blank({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <p className="font-display text-[1rem] font-semibold">{title}</p>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-[var(--study-soft)]">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}

export function Problem({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-[0.9rem] bg-[var(--study-bad-soft)] px-4 py-3 text-[0.8rem] text-[var(--study-bad)]"
    >
      {message}
    </p>
  )
}

/**
 * Says where something came from.
 *
 * Not decoration. A set of questions written from a model's general knowledge
 * is a perfectly good set of questions, but it is not the same thing as one
 * drawn from the room's own documents — and a page that lets those look
 * identical is teaching somebody a syllabus that might not be theirs.
 */
export function GroundedBadge({ grounded, sources }: { grounded: boolean; sources: string[] }) {
  return (
    <span
      title={grounded ? `From ${sources.join(', ')}` : 'Written from general knowledge'}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem]',
        grounded
          ? 'border-[var(--study-line)] bg-[var(--study-card)]'
          : 'border-[var(--study-line)] bg-transparent text-[var(--study-faint)]',
      )}
    >
      {grounded ? (
        <>
          <span className="size-1.5 rounded-full bg-[var(--study-accent)]" />
          <span className="max-w-[10rem] truncate">
            {sources.length === 1 ? sources[0] : `${sources.length} documents`}
          </span>
        </>
      ) : (
        'General knowledge'
      )}
    </span>
  )
}

/** The button every generator sits behind, with the no-key case handled once. */
export function GenerateButton({
  busy,
  disabled,
  label,
  reason,
  onClick,
}: {
  busy: boolean
  disabled: boolean
  label: string
  reason?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={disabled ? reason : undefined}
      className="study-btn study-btn-primary h-10 px-4"
    >
      {busy ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <Sparkles aria-hidden className="size-4" />
      )}
      {busy ? 'Writing…' : label}
    </button>
  )
}

export function bytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
