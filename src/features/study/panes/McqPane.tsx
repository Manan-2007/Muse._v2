import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Lightbulb,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'

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
import { TopicPicker } from '@/features/study/TopicPicker'
import { useTutor } from '@/features/study/tutorContext'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as const
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

type Open = {
  set: studyApi.McqSet
  attempt: studyApi.McqAttempt | null
  /** Which question is on screen. One at a time — see the note on Attempt. */
  index: number
  /** True once the last question is answered and the score is being shown. */
  showingResult: boolean
}

/** Questions on the subject, written from its documents where there are any. */
export default function McqPane({ roomId, subject, caps, capsProblem, announce, seed }: PaneProps) {
  const [sets, setSets] = useState<studyApi.McqSetSummary[] | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subjectId = subject?.id ?? null

  const load = useCallback(async () => {
    if (!subjectId) return
    try {
      const { sets: rows } = await studyApi.mcqSets(roomId, subjectId)
      setSets(rows)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the sets.')
      setSets([])
    }
  }, [roomId, subjectId])

  useEffect(() => {
    setSets(null)
    setOpen(null)
    void load()
  }, [load])

  const generate = async (
    topic: string,
    count: number,
    difficulty: string,
    resourceIds?: string[],
  ) => {
    if (!subjectId) return
    setBusy(true)
    setError(null)
    try {
      await studyApi.createMcq(roomId, { subjectId, topic, count, difficulty, resourceIds })
      await load()
      announce('mcq', subjectId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const start = async (setId: string) => {
    setError(null)
    try {
      const { set, attempt } = await studyApi.mcqSet(roomId, setId)
      /* Resume where they stopped. The first question with no answer against
         it is the one they were looking at when they closed the tab. */
      const done = new Set((attempt?.revealed ?? []).map((entry) => entry.questionId))
      const next = set.questions.findIndex((question) => !done.has(question.id))
      setOpen({
        set,
        attempt,
        index: next === -1 ? Math.max(0, set.questions.length - 1) : next,
        showingResult: Boolean(attempt?.completed),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that set.')
    }
  }

  if (!subject) return <Blank title="No subject" body="Pick or add a subject first." />

  if (open) {
    return (
      <Attempt
        roomId={roomId}
        state={open}
        setState={setOpen}
        onLeave={() => {
          setOpen(null)
          void load()
        }}
        onRetake={() => void start(open.set.id)}
      />
    )
  }

  return (
    <PaneShell
      title="Questions"
      description="Multiple choice that marks itself as you go. Where the library has something on the topic, the questions come from there."
    >
      <TopicPicker
        roomId={roomId}
        subjectId={subjectId}
        disabled={!caps?.ai}
        reason={gateReason(caps, capsProblem, 'ai') ?? undefined}
        busy={busy}
        seed={seed}
        onSubmit={(topic, options) =>
          void generate(topic, options.count, options.difficulty, options.resourceIds)
        }
        showCount
        showDifficulty
      />

      {error && (
        <div className="py-4">
          <Problem message={error} />
        </div>
      )}

      {sets === null ? (
        <Spinner />
      ) : sets.length === 0 ? (
        <Blank
          title="No questions yet"
          body="Pick a topic above. If the library has a handout for this subject, the questions will follow what it actually covers."
        />
      ) : (
        <ul className="grid gap-2.5 pb-4 sm:grid-cols-2">
          {sets.map((set) => {
            const scored =
              set.lastAttempt?.score != null && set.lastAttempt.total > 0
                ? set.lastAttempt.score / set.lastAttempt.total
                : null

            return (
              <li key={set.id}>
                <div className="study-card group relative flex h-full flex-col p-4 transition-colors hover:bg-[var(--study-card-strong)]">
                  <button
                    type="button"
                    onClick={() => void start(set.id)}
                    className="min-w-0 flex-1 text-left outline-none"
                  >
                    {/* The whole card is the target, so the title's own box does
                        not have to be — this stretches it over the card. */}
                    <span className="absolute inset-0 rounded-[0.9rem]" />
                    <p className="pr-8 text-[0.92rem] font-medium leading-snug">{set.title}</p>
                    <p className="mt-1.5 text-[0.74rem] text-[var(--study-faint)]">
                      {set.questionCount} questions · {set.difficulty}
                    </p>
                  </button>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <GroundedBadge grounded={set.grounded} sources={set.sources} />
                    {scored !== null && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-1 text-[0.7rem] font-medium',
                          scored >= 0.7
                            ? 'bg-[var(--study-good-soft)] text-[var(--study-good)]'
                            : 'bg-[var(--study-card-strong)] text-[var(--study-soft)]',
                        )}
                      >
                        {set.lastAttempt!.score}/{set.lastAttempt!.total}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      await studyApi.deleteMcq(roomId, set.id).catch(() => undefined)
                      await load()
                    }}
                    aria-label={`Delete ${set.title}`}
                    className="absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-full text-[var(--study-faint)] opacity-0 outline-none transition hover:bg-[var(--study-bad-soft)] hover:text-[var(--study-bad)] focus-visible:opacity-100 group-hover:opacity-100"
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

/**
 * One question at a time, marked the moment it is answered.
 *
 * The old shape — answer twenty, press Mark, read twenty explanations — is
 * how a paper test works because paper cannot do anything else. On a screen
 * it wastes the one moment the explanation is worth most: you have just
 * committed to an answer, you still remember why, and being told right then
 * whether that reasoning held is the thing that actually teaches. Twenty
 * minutes later it is a wall of text about questions you have half forgotten.
 *
 * Answers are final once given, which is the price of revealing early — and
 * enforced on the server, since the reply carries the correct index.
 */
function Attempt({
  roomId,
  state,
  setState,
  onLeave,
  onRetake,
}: {
  roomId: string
  state: Open
  setState: (next: Open) => void
  onLeave: () => void
  onRetake: () => void
}) {
  const { set, attempt, index, showingResult } = state
  const [sending, setSending] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tutor = useTutor()

  const revealedBy = useMemo(() => {
    const map = new Map<string, studyApi.Revealed>()
    for (const entry of attempt?.revealed ?? []) map.set(entry.questionId, entry)
    return map
  }, [attempt])

  const question = set.questions[index]
  const revealed = question ? (revealedBy.get(question.id) ?? null) : null
  const answered = attempt?.answered ?? 0
  const score = attempt?.score ?? 0
  const total = set.questions.length
  const last = index >= total - 1

  const choose = async (chosenIndex: number) => {
    if (!question || revealed || sending !== null) return
    setSending(chosenIndex)
    setError(null)
    try {
      const { attempt: next } = await studyApi.answerMcq(roomId, set.id, {
        attemptId: attempt?.id ?? null,
        questionId: question.id,
        chosenIndex,
      })
      setState({ ...state, attempt: next })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That answer did not save.')
    } finally {
      setSending(null)
    }
  }

  if (showingResult) {
    return (
      <Result
        set={set}
        attempt={attempt}
        onLeave={onLeave}
        onRetake={onRetake}
        onReview={(at) => setState({ ...state, index: at, showingResult: false })}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 pb-4">
        <button type="button" onClick={onLeave} className="study-btn h-8 border-transparent bg-transparent px-2 text-[var(--study-soft)]">
          <ArrowLeft aria-hidden className="size-4" />
          All sets
        </button>

        <span className="flex items-center gap-3 text-[0.76rem] text-[var(--study-soft)]">
          <span>
            {index + 1} of {total}
          </span>
          {answered > 0 && (
            <span className="rounded-full bg-[var(--study-card-strong)] px-2.5 py-1 font-medium">
              {score}/{answered}
            </span>
          )}
        </span>
      </div>

      {/* One bar, one segment per question, filled as they are answered and
          coloured by whether they were right. It replaces both a progress bar
          and a score readout, and it is glanceable in a way neither is.

          The segment you are on is deliberately neutral rather than the
          accent: red and green already mean wrong and right here, and with
          the default accent a third red segment reads as another one missed. */}
      <div className="mb-6 flex shrink-0 gap-1">
        {set.questions.map((entry, at) => {
          const done = revealedBy.get(entry.id)
          return (
            <span
              key={entry.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                done
                  ? done.correct
                    ? 'bg-[var(--study-good)]'
                    : 'bg-[var(--study-bad)]'
                  : at === index
                    ? 'bg-[var(--study-soft)]'
                    : 'bg-[var(--study-card-strong)]',
              )}
            />
          )
        })}
      </div>

      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={question?.id ?? index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="mx-auto max-w-2xl pb-8"
          >
            <h3 className="text-[1.15rem] font-medium leading-relaxed">{question?.prompt}</h3>

            <div className="mt-6 space-y-2.5">
              {question?.options.map((option, optionIndex) => {
                const isChosen = revealed?.chosenIndex === optionIndex
                const isCorrect = revealed?.correctIndex === optionIndex
                const pending = sending === optionIndex

                return (
                  <button
                    key={optionIndex}
                    type="button"
                    disabled={Boolean(revealed) || sending !== null}
                    onClick={() => void choose(optionIndex)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-[0.9rem] border p-3.5 text-left transition-all duration-200',
                      !revealed &&
                        'border-[var(--study-line)] bg-[var(--study-card)] hover:border-[var(--study-line-strong)] hover:bg-[var(--study-card-strong)]',
                      pending && 'border-[var(--study-accent)]',
                      /* After the reveal: the right answer is always marked,
                         whether or not it was the one picked — being shown
                         only that you were wrong teaches nothing. */
                      isCorrect && 'border-[var(--study-good)] bg-[var(--study-good-soft)]',
                      revealed && isChosen && !isCorrect &&
                        'border-[var(--study-bad)] bg-[var(--study-bad-soft)]',
                      revealed && !isChosen && !isCorrect && 'border-transparent opacity-45',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-full border text-[0.7rem] font-semibold transition-colors',
                        isCorrect
                          ? 'border-[var(--study-good)] bg-[var(--study-good)] text-white'
                          : revealed && isChosen
                            ? 'border-[var(--study-bad)] bg-[var(--study-bad)] text-white'
                            : 'border-[var(--study-line-strong)] text-[var(--study-soft)]',
                      )}
                    >
                      {isCorrect ? (
                        <Check aria-hidden className="size-3.5" />
                      ) : revealed && isChosen ? (
                        <X aria-hidden className="size-3.5" />
                      ) : (
                        LETTERS[optionIndex]
                      )}
                    </span>
                    <span className="pt-0.5 text-[0.88rem] leading-relaxed">{option}</span>
                  </button>
                )
              })}
            </div>

            {error && (
              <div className="mt-4">
                <Problem message={error} />
              </div>
            )}

            <AnimatePresence initial={false}>
              {revealed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="mt-5 rounded-[0.9rem] border border-[var(--study-line)] bg-[var(--study-card)] p-4">
                    <p
                      className={cn(
                        'flex items-center gap-2 text-[0.82rem] font-medium',
                        revealed.correct
                          ? 'text-[var(--study-good)]'
                          : 'text-[var(--study-bad)]',
                      )}
                    >
                      {revealed.correct ? (
                        <>
                          <Check aria-hidden className="size-4" /> Correct
                        </>
                      ) : (
                        <>
                          <X aria-hidden className="size-4" /> Not quite — the answer is{' '}
                          {LETTERS[revealed.correctIndex]}
                        </>
                      )}
                    </p>
                    <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--study-soft)]">
                      {revealed.explanation}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--study-line)] pt-4">
        {/* Only before answering. Afterwards the explanation is right there,
            and a hint about a question you have already answered is noise. */}
        {!revealed && tutor && question ? (
          <button
            type="button"
            onClick={() =>
              tutor.ask({
                mode: 'hint',
                focus: {
                  kind: 'question',
                  title: question.prompt.slice(0, 120),
                  body: `${question.prompt}\n\n${question.options
                    .map((option, i) => `${LETTERS[i]}) ${option}`)
                    .join('\n')}`,
                },
              })
            }
            disabled={!tutor.available}
            title={tutor.available ? undefined : (tutor.reason ?? undefined)}
            className="study-btn h-9 border-transparent bg-transparent px-2 text-[var(--study-soft)]"
          >
            <Lightbulb aria-hidden className="size-4" />
            Hint
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          disabled={!revealed}
          onClick={() =>
            last
              ? setState({ ...state, showingResult: true })
              : setState({ ...state, index: index + 1 })
          }
          className="study-btn study-btn-primary h-10 px-5"
        >
          {last ? 'See how you did' : 'Next'}
          {!last && <ArrowRight aria-hidden className="size-4" />}
        </button>
      </div>
    </div>
  )
}

/** The score, and a way back into any question you want to look at again. */
function Result({
  set,
  attempt,
  onLeave,
  onRetake,
  onReview,
}: {
  set: studyApi.McqSet
  attempt: studyApi.McqAttempt | null
  onLeave: () => void
  onRetake: () => void
  onReview: (index: number) => void
}) {
  const total = set.questions.length
  const score = attempt?.score ?? 0
  const share = total > 0 ? score / total : 0
  const revealedBy = new Map((attempt?.revealed ?? []).map((entry) => [entry.questionId, entry]))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 pb-4">
        <button type="button" onClick={onLeave} className="study-btn h-8 border-transparent bg-transparent px-2 text-[var(--study-soft)]">
          <ArrowLeft aria-hidden className="size-4" />
          All sets
        </button>
      </div>

      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl pb-8 text-center">
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="mx-auto grid size-32 place-items-center rounded-full"
            style={{
              background: `conic-gradient(var(--study-accent) ${share * 360}deg, var(--study-card-strong) 0deg)`,
            }}
          >
            <span className="grid size-[6.6rem] place-items-center rounded-full bg-[var(--study-bg)]">
              <span className="font-display text-[1.8rem] font-semibold leading-none">
                {score}
                <span className="text-[var(--study-faint)]">/{total}</span>
              </span>
            </span>
          </motion.div>

          <p className="mt-5 text-[0.88rem] text-[var(--study-soft)]">
            {share === 1
              ? 'Every one. Nothing to revisit here.'
              : share >= 0.7
                ? 'Solid. The ones below are worth a second look.'
                : share > 0
                  ? 'Worth going through the explanations before moving on.'
                  : 'Start with the explanations — the topic is still new.'}
          </p>

          <div className="mt-6 flex justify-center gap-2">
            <button type="button" onClick={onRetake} className="study-btn h-10 px-4">
              <RotateCcw aria-hidden className="size-4" />
              Try again
            </button>
            <button type="button" onClick={onLeave} className="study-btn study-btn-primary h-10 px-4">
              Done
            </button>
          </div>

          <ul className="mt-8 space-y-2 text-left">
            {set.questions.map((question, at) => {
              const entry = revealedBy.get(question.id)
              return (
                <li key={question.id}>
                  <button
                    type="button"
                    onClick={() => onReview(at)}
                    className="study-card flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-[var(--study-card-strong)]"
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
                        entry?.correct
                          ? 'bg-[var(--study-good-soft)] text-[var(--study-good)]'
                          : 'bg-[var(--study-bad-soft)] text-[var(--study-bad)]',
                      )}
                    >
                      {entry?.correct ? (
                        <Check aria-hidden className="size-3" />
                      ) : (
                        <X aria-hidden className="size-3" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-[0.84rem] leading-relaxed">
                      {question.prompt}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
