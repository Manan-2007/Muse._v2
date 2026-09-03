import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  FileQuestion,
  FolderOpen,
  NotebookPen,
  Sparkles,
  Terminal,
  Timer,
  TrendingUp,
} from 'lucide-react'

import * as studyApi from '@/features/study/api'
import { Blank, Spinner, type PaneProps } from '@/features/study/panes/shared'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Where the tab opens.
 *
 * Study used to land on the timer, which is the one thing here that does not
 * tell you anything — a countdown at 25:00 is the same countdown on the first
 * day and the last. What a person actually wants on opening is the answer to
 * "where am I with this subject, and what should I do next", and everything
 * needed to answer that already exists behind the other panes.
 *
 * So this reads rather than writes. Every number here is computed from work
 * already recorded, and every card is a way into the pane that owns it —
 * nothing on this page is a thing you can only do here.
 */
export default function HomePane({ roomId, subject, caps, go }: PaneProps) {
  const [progress, setProgress] = useState<studyApi.Progress | null>(null)
  const [failed, setFailed] = useState(false)

  const subjectId = subject?.id ?? null

  const load = useCallback(async () => {
    if (!subjectId) return
    try {
      const { progress: rows } = await studyApi.progress(roomId, subjectId)
      setProgress(rows)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [roomId, subjectId])

  useEffect(() => {
    setProgress(null)
    void load()
  }, [load])

  if (!subject) return <Blank title="No subject" body="Pick or add a subject first." />
  if (failed) return <Blank title="Could not load this" body="The progress for this subject did not come back. Try switching subject and back." />
  if (!progress) return <Spinner />

  const { quiz, coding, notes, resources, suggestions } = progress
  const ready = resources.ready ?? 0
  const accuracy = quiz.accuracy === null ? null : Math.round(quiz.accuracy * 100)

  const nothingYet = quiz.answered === 0 && notes === 0 && coding.problems === 0 && ready === 0

  return (
    <div data-lenis-prevent className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl pb-10">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em]">
            {subject.name}
          </h1>
          <p className="mt-1.5 text-[0.86rem] text-[var(--study-soft)]">
            {nothingYet
              ? 'Nothing here yet. Add the course handout and the rest of this page starts filling itself in.'
              : subject.hasSyllabus
                ? 'Syllabus read — everything below is measured against what the course actually covers.'
                : 'No syllabus read yet, so topics are up to you.'}
          </p>
        </motion.header>

        {nothingYet ? (
          <FirstSteps go={go} canGenerate={Boolean(caps?.ai)} />
        ) : (
          <>
            <section className="mt-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Stat
                label="Accuracy"
                value={accuracy === null ? '—' : `${accuracy}%`}
                sub={quiz.answered > 0 ? `${quiz.correct} of ${quiz.answered}` : 'No questions yet'}
                tone={accuracy === null ? 'plain' : accuracy >= 70 ? 'good' : 'warn'}
                onClick={() => go('mcq')}
              />
              <Stat
                label="Notes"
                value={String(notes)}
                sub={notes === 1 ? 'page written' : 'pages written'}
                onClick={() => go('notes')}
              />
              <Stat
                label="Problems"
                value={`${coding.solved}/${coding.problems}`}
                sub="solved"
                tone={coding.problems > 0 && coding.solved === coding.problems ? 'good' : 'plain'}
                onClick={() => go('coding')}
              />
              <Stat
                label="Library"
                value={String(ready)}
                sub={ready === 1 ? 'document indexed' : 'documents indexed'}
                onClick={() => go('resources')}
              />
            </section>

            <div className="mt-3 grid gap-3 lg:grid-cols-5">
              {/* What to do next, which is the only thing on this page that is
                  a recommendation rather than a record. Weak topics first,
                  because a topic you got wrong is a better use of the next
                  twenty minutes than one the syllabus merely lists. */}
              <section className="study-card p-4 lg:col-span-3">
                <h2 className="flex items-center gap-2 text-[0.8rem] font-medium text-[var(--study-soft)]">
                  <Sparkles aria-hidden className="size-3.5" />
                  Next
                </h2>

                <ul className="mt-3 space-y-1.5">
                  {quiz.weakest.slice(0, 3).map((entry) => (
                    <li key={entry.topic}>
                      <button
                        type="button"
                        onClick={() => go('mcq', entry.topic)}
                        className="group flex w-full items-center gap-3 rounded-[0.7rem] px-3 py-2.5 text-left transition-colors hover:bg-[var(--study-card-strong)]"
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--study-bad-soft)] text-[0.7rem] font-semibold text-[var(--study-bad)]">
                          {Math.round(entry.accuracy * 100)}%
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.86rem]">{entry.topic}</span>
                          <span className="block text-[0.72rem] text-[var(--study-faint)]">
                            {entry.asked} answered — worth another set
                          </span>
                        </span>
                        <ArrowUpRight
                          aria-hidden
                          className="size-4 shrink-0 text-[var(--study-faint)] transition-transform group-hover:translate-x-0.5"
                        />
                      </button>
                    </li>
                  ))}

                  {suggestions.slice(0, quiz.weakest.length >= 3 ? 2 : 4).map((entry) => (
                    <li key={`${entry.unit}-${entry.topic}`}>
                      <button
                        type="button"
                        onClick={() => go('notes', entry.topic)}
                        className="group flex w-full items-center gap-3 rounded-[0.7rem] px-3 py-2.5 text-left transition-colors hover:bg-[var(--study-card-strong)]"
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--study-card-strong)] text-[var(--study-soft)]">
                          <NotebookPen aria-hidden className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.86rem]">{entry.topic}</span>
                          <span className="block truncate text-[0.72rem] text-[var(--study-faint)]">
                            {entry.unit} — nothing written yet
                          </span>
                        </span>
                        <ArrowUpRight
                          aria-hidden
                          className="size-4 shrink-0 text-[var(--study-faint)] transition-transform group-hover:translate-x-0.5"
                        />
                      </button>
                    </li>
                  ))}

                  {quiz.weakest.length === 0 && suggestions.length === 0 && (
                    <li className="px-3 py-6 text-center text-[0.8rem] text-[var(--study-faint)]">
                      {subject.hasSyllabus
                        ? 'Nothing outstanding on the syllabus. Answer a few more questions and weak topics will surface here.'
                        : 'Read a syllabus in the Library and this fills with the units the course actually examines.'}
                    </li>
                  )}
                </ul>
              </section>

              <section className="study-card p-4 lg:col-span-2">
                <h2 className="text-[0.8rem] font-medium text-[var(--study-soft)]">Start something</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Quick icon={Timer} label="Focus" onClick={() => go('timer')} />
                  <Quick icon={FileQuestion} label="Quiz" onClick={() => go('mcq')} />
                  <Quick icon={NotebookPen} label="Notes" onClick={() => go('notes')} />
                  <Quick icon={Terminal} label="Problem" onClick={() => go('coding')} />
                  <Quick icon={FolderOpen} label="Library" onClick={() => go('resources')} />
                  <Quick icon={TrendingUp} label="Progress" onClick={() => go('progress')} />
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone = 'plain',
  onClick,
}: {
  label: string
  value: string
  sub: string
  tone?: 'plain' | 'good' | 'warn'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="study-card p-4 text-left transition-colors hover:bg-[var(--study-card-strong)]"
    >
      <p className="text-[0.72rem] uppercase tracking-[0.07em] text-[var(--study-faint)]">{label}</p>
      <p
        className={cn(
          'mt-2 font-display text-[1.6rem] font-semibold leading-none tracking-[-0.02em]',
          tone === 'good' && 'text-[var(--study-good)]',
          tone === 'warn' && 'text-[var(--study-accent)]',
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate text-[0.72rem] text-[var(--study-faint)]">{sub}</p>
    </button>
  )
}

function Quick({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Timer
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-[0.7rem] border border-[var(--study-line)] px-3 py-3 text-left transition-colors hover:bg-[var(--study-card-strong)]"
    >
      <Icon aria-hidden className="size-4 text-[var(--study-soft)]" />
      <span className="text-[0.78rem]">{label}</span>
    </button>
  )
}

/** The empty subject, given an order to do things in rather than six doors. */
function FirstSteps({ go, canGenerate }: { go: (tab: string) => void; canGenerate: boolean }) {
  const steps: [typeof Timer, string, string, string, () => void][] = [
    [
      FolderOpen,
      'Add the course handout',
      'Upload the CHO or syllabus PDF. It gets read, indexed, and everything below is written from it.',
      'Open the library',
      () => go('resources'),
    ],
    [
      FileQuestion,
      'Answer some questions',
      canGenerate
        ? 'A set is written on any topic and marks itself as you go, explaining each one.'
        : 'Needs an AI key on this server.',
      'Write a set',
      () => go('mcq'),
    ],
    [
      Timer,
      'Sit down and start',
      'A focus timer the whole room shares, so a session actually begins rather than drifting.',
      'Open the timer',
      () => go('timer'),
    ],
  ]

  return (
    <ol className="mt-7 space-y-2.5">
      {steps.map(([Icon, title, body, action, onClick], at) => (
        <motion.li
          key={title}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE, delay: at * 0.06 }}
          className="study-card flex flex-wrap items-center gap-4 p-4"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--study-card-strong)]">
            <Icon aria-hidden className="size-4 text-[var(--study-soft)]" />
          </span>
          <span className="min-w-[12rem] flex-1">
            <span className="block text-[0.92rem] font-medium">{title}</span>
            <span className="mt-0.5 block text-[0.8rem] leading-relaxed text-[var(--study-soft)]">
              {body}
            </span>
          </span>
          <button type="button" onClick={onClick} className="study-btn shrink-0">
            {action}
          </button>
        </motion.li>
      ))}
    </ol>
  )
}
