import {Suspense, useCallback, useEffect, useMemo, useState} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FileQuestion,
  FolderOpen,
  Home,
  Loader2,
  MessagesSquare,
  NotebookPen,
  PlayCircle,
  RotateCw,
  Settings2,
  Sparkles,
  Terminal,
  Timer,
  TrendingUp,
  WifiOff,
  X,
} from 'lucide-react'

import * as studyApi from '@/features/study/api'
import { SubjectBar } from '@/features/study/SubjectBar'
import { FocusTimer } from '@/features/study/FocusTimer'
import { StudySettings } from '@/features/study/StudySettings'
import { TutorContext, type Tutor as TutorHandle, type TutorAsk } from '@/features/study/tutorContext'
import { gateReason, useCapabilities } from '@/features/study/useCapabilities'
import { useStudyPreferences } from '@/features/study/useStudyPreferences'
import { useStudySync, useStudyTimer } from '@/features/study/useStudyTimer'
import { cn } from '@/lib/utils'
import { lazyChunk } from '@/lib/lazyChunk'

/* Each pane is its own chunk. The library pane pulls a PDF-shaped list, the
   notes pane pulls a markdown renderer and a diagram engine, and the coding
   pane pulls an entire editor — loading all of that to show a dashboard would
   make the cheapest thing here the slowest. */
const HomePane = lazyChunk(() => import('@/features/study/panes/HomePane'))
const ResourcesPane = lazyChunk(() => import('@/features/study/panes/ResourcesPane'))
const McqPane = lazyChunk(() => import('@/features/study/panes/McqPane'))
const NotesPane = lazyChunk(() => import('@/features/study/panes/NotesPane'))
const CodingPane = lazyChunk(() => import('@/features/study/panes/CodingPane'))
const ExplainersPane = lazyChunk(() => import('@/features/study/panes/ExplainersPane'))
const ProgressPane = lazyChunk(() => import('@/features/study/panes/ProgressPane'))
const Tutor = lazyChunk(() => import('@/features/study/Tutor'))

const EASE = [0.16, 1, 0.3, 1] as const

export type StudyTab =
  | 'home'
  | 'explainers'
  | 'timer'
  | 'resources'
  | 'mcq'
  | 'notes'
  | 'coding'
  | 'progress'

const TABS: { id: StudyTab; label: string; icon: typeof Timer }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'explainers', label: 'Lessons', icon: PlayCircle },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'mcq', label: 'Questions', icon: FileQuestion },
  { id: 'coding', label: 'Problems', icon: Terminal },
  { id: 'resources', label: 'Library', icon: FolderOpen },
  { id: 'timer', label: 'Focus', icon: Timer },
  { id: 'progress', label: 'Progress', icon: TrendingUp },
]

/**
 * The Study stage.
 *
 * Same shape as Watch, Listen and Play — full screen, portalled, opening out
 * of the control that summoned it — because it is the same kind of thing: an
 * activity the whole room is in.
 *
 * Everything inside is scoped to a subject rather than to the room. A room
 * studying three courses is the normal case, and a shelf that mixes them is
 * worse than useless: the search that grounds every generated question would
 * pull the wrong document and answer confidently from it.
 *
 * Unlike every other stage this one carries its own palette rather than the
 * app's. See `.study-scope` in the stylesheet for why.
 */
export function StudyStage({
  roomId,
  selfId,
  onClose,
  insetRight = 0,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
  origin,
}: {
  roomId: string
  selfId: string | undefined
  onClose: () => void
  insetRight?: number
  panelOpen?: boolean
  onTogglePanel?: () => void
  unread?: number
  origin?: DOMRect | null
}) {
  const [tab, setTab] = useState<StudyTab>('home')
  const [subjects, setSubjects] = useState<studyApi.Subject[] | null>(null)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  /* A topic handed from the home page to whichever pane it points at, so
     "this is your weakest topic" is one click from a set about it rather than
     a name to remember and retype. */
  const [seed, setSeed] = useState<string | null>(null)

  const { preferences, theme, update } = useStudyPreferences(selfId)
  const timer = useStudyTimer(roomId, true)

  const loadSubjects = useCallback(async () => {
    try {
      const { subjects: rows } = await studyApi.subjects(roomId)
      setSubjects(rows)
      /* Keep whatever was open if it still exists, so a refresh triggered by
         somebody else's upload does not move the page underneath you. */
      setSubjectId((current) =>
        current && rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? null),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load subjects.')
      setSubjects([])
    }
  }, [roomId])

  useEffect(() => {
    void loadSubjects()
  }, [loadSubjects])

  /* Asked separately from the subjects, and asked again if it does not land.
     What this server can do is what every generator here is gated on, so a
     dropped request for it must not read as a server with no keys. */
  const { caps, problem: capsProblem, checking: capsChecking, retry: retryCaps } =
    useCapabilities(roomId)

  /* Somebody else added a subject; the list is the one thing every pane shares
     so it is refreshed here rather than in each of them. */
  const announce = useStudySync(roomId, (kind) => {
    if (kind === 'subjects') void loadSubjects()
  })

  const subject = useMemo(
    () => subjects?.find((row) => row.id === subjectId) ?? null,
    [subjects, subjectId],
  )

  const [tutorOpen, setTutorOpen] = useState(false)
  const [handover, setHandover] = useState<TutorAsk | null>(null)

  /* The tutor lives up here rather than in any one pane, because the thing it
     is asked about comes from whichever pane happens to be open — a hint about
     a question, then the notes behind it, is one conversation. */
  const tutor = useMemo<TutorHandle>(
    () => ({
      available: Boolean(caps?.ai),
      reason: gateReason(caps, capsProblem, 'ai'),
      ask: (request) => {
        setTutorOpen(true)
        setHandover(request)
      },
      open: (focus = null) => {
        setTutorOpen(true)
        setHandover({ mode: 'ask', focus, message: '' })
      },
    }),
    [caps, capsProblem],
  )

  const go = useCallback((next: string, topic?: string) => {
    setTab(next as StudyTab)
    setSeed(topic ?? null)
  }, [])

  const revealX = origin ? `${Math.round(origin.left + origin.width / 2)}px` : '50%'
  const revealY = origin ? `${Math.round(origin.top + origin.height / 2)}px` : '50%'

  const paneProps = { roomId, subject, caps, capsProblem, announce, selfId, go, seed }

  return createPortal(
    <TutorContext.Provider value={tutor}>
      <motion.div
        className="study-scope fixed left-0 top-0 z-[135] flex flex-col overflow-hidden transition-[padding] duration-500 ease-glass"
        data-study-theme={theme}
        data-study-accent={preferences.accent}
        style={{
          width: '100vw',
          height: '100dvh',
          paddingRight: `${insetRight}rem`,
          fontSize: preferences.roomy ? '1.075rem' : undefined,
          ['--reveal-x' as string]: revealX,
          ['--reveal-y' as string]: revealY,
          animation: 'stage-reveal 0.62s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <header className="relative z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--study-line)] px-4 py-3">
          <SubjectBar
            roomId={roomId}
            subjects={subjects}
            activeId={subjectId}
            onPick={(id) => {
              setSubjectId(id)
              setSeed(null)
            }}
            onChanged={() => {
              void loadSubjects()
              announce('subjects')
            }}
          />

          <span className="flex shrink-0 items-center gap-1.5">
            {!timer.connected && (
              <span
                title="Reconnecting"
                className="grid size-11 place-items-center rounded-full text-[var(--study-accent)] sm:size-10"
              >
                <WifiOff aria-hidden className="size-4" />
              </span>
            )}

            {/* Always reachable, whichever pane is open — the per-item
                Explain / Hint / Help buttons are shortcuts into this same
                panel, not the only way in. */}
            <button
              type="button"
              onClick={() => (tutorOpen ? setTutorOpen(false) : tutor.open())}
              disabled={!caps?.ai || !subject}
              aria-label="Tutor"
              aria-pressed={tutorOpen}
              title={
                caps?.ai
                  ? 'Ask about this subject'
                  : (gateReason(caps, capsProblem, 'ai') ?? 'Ask about this subject')
              }
              className={cn(
                /* 44px on a touch screen, 40 on a pointer — the sizes the rest
                   of the app already uses for a control in a bar like this. */
                'study-btn h-11 px-4 sm:h-10',
                tutorOpen && 'border-transparent bg-[var(--study-accent-soft)] text-[var(--study-accent)]',
              )}
            >
              <Sparkles aria-hidden className="size-[1.05rem]" />
              <span className="hidden sm:inline">Tutor</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-label="Appearance"
                aria-expanded={settingsOpen}
                className="study-btn size-11 px-0 sm:size-10"
              >
                <Settings2 aria-hidden className="size-[1.05rem]" />
              </button>
              <AnimatePresence>
                {settingsOpen && (
                  <StudySettings
                    preferences={preferences}
                    update={update}
                    onClose={() => setSettingsOpen(false)}
                  />
                )}
              </AnimatePresence>
            </div>

            {onTogglePanel && (
              <button
                type="button"
                onClick={onTogglePanel}
                aria-label="Chat and call"
                aria-pressed={panelOpen}
                className={cn(
                  'study-btn relative size-11 px-0 sm:size-10',
                  panelOpen && 'border-transparent bg-[var(--study-accent-soft)] text-[var(--study-accent)]',
                )}
              >
                <MessagesSquare aria-hidden className="size-[1.05rem]" />
                {unread > 0 && !panelOpen && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[var(--study-accent)] px-1 text-[0.6rem] font-semibold leading-4 text-[var(--study-on-accent)]">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Leave study"
              className="study-btn size-11 px-0 sm:size-10"
            >
              <X aria-hidden className="size-[1.05rem]" />
            </button>
          </span>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
          {/* A rail on a wide screen, a scrolling strip on a narrow one — the
              same shape the Listen browser uses for its own sections. */}
          <nav
            data-lenis-prevent
            className="flex shrink-0 gap-1 overflow-x-auto px-3 py-2 md:w-44 md:flex-col md:overflow-visible md:border-r md:border-[var(--study-line)] md:px-3 md:py-4"
          >
            {TABS.map((entry) => {
              const active = tab === entry.id
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => go(entry.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex shrink-0 items-center gap-2.5 rounded-full px-3 py-2 text-left text-[0.82rem] transition-colors duration-200',
                    active ? 'text-[var(--study-text)]' : 'text-[var(--study-soft)] hover:text-[var(--study-text)]',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="study-nav-active"
                      className="absolute inset-0 -z-10 rounded-full bg-[var(--study-card-strong)]"
                      transition={{ duration: 0.3, ease: EASE }}
                    />
                  )}
                  <entry.icon aria-hidden className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{entry.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 md:px-6 md:py-6">
            {error && (
              <p role="alert" className="pb-3 text-[0.8rem] text-[var(--study-bad)]">
                {error}
              </p>
            )}

            {/*
              * Said once, here, rather than as a dead tooltip on six buttons.
              *
              * The person reading this is usually not the person running the
              * server, so it says which machine the problem is on — otherwise
              * the honest reading of a greyed-out tab is "my computer is not
              * allowed to do this", and they go looking for a setting they do
              * not have.
              */}
            {capsProblem && (
              <div
                role="alert"
                className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[0.9rem] bg-[var(--study-bad-soft)] px-4 py-3 text-[0.8rem] text-[var(--study-bad)]"
              >
                <WifiOff aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  {capsProblem} Generating is paused until it answers — this is the room’s server,
                  not your connection.
                </span>
                <button
                  type="button"
                  onClick={retryCaps}
                  disabled={capsChecking}
                  className="study-btn h-8 shrink-0 px-3 text-[0.76rem]"
                >
                  {capsChecking ? (
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCw aria-hidden className="size-3.5" />
                  )}
                  {capsChecking ? 'Checking…' : 'Try again'}
                </button>
              </div>
            )}

            {/* A subject is the unit everything else hangs off, so the panes are
                not shown until there is one — an empty Library for a subject
                that does not exist would just be a dead end. */}
            {subjects !== null && subjects.length === 0 ? (
              <Empty />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="h-full min-h-0"
                >
                  <Suspense fallback={<Waiting />}>
                    {tab === 'home' && <HomePane {...paneProps} />}
                    {tab === 'explainers' && <ExplainersPane {...paneProps} />}
                    {tab === 'timer' && <FocusTimer timer={timer} />}
                    {tab === 'resources' && <ResourcesPane {...paneProps} />}
                    {tab === 'mcq' && <McqPane {...paneProps} />}
                    {tab === 'notes' && <NotesPane {...paneProps} />}
                    {tab === 'coding' && <CodingPane {...paneProps} />}
                    {tab === 'progress' && <ProgressPane {...paneProps} />}
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* A column on a wide screen, a sheet over the work on a narrow one.
              Beside rather than over wherever there is room, because every
              question it answers is about something still on screen. */}
          <AnimatePresence>
            {tutorOpen && subject && (
              <motion.aside
                key="study-tutor"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.26, ease: EASE }}
                className={cn(
                  'absolute inset-0 z-20 bg-[var(--study-bg)]',
                  'lg:relative lg:inset-auto lg:z-auto lg:w-[23rem] lg:shrink-0 lg:border-l lg:border-[var(--study-line)]',
                )}
              >
                <Suspense fallback={<Waiting />}>
                  <Tutor
                    roomId={roomId}
                    subjectId={subject.id}
                    subjectName={subject.name}
                    request={handover}
                    onConsumed={() => setHandover(null)}
                    onClose={() => setTutorOpen(false)}
                  />
                </Suspense>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </TutorContext.Provider>,
    document.body,
  )
}

function Waiting() {
  return (
    <div className="grid h-full place-items-center">
      <Loader2 aria-hidden className="size-5 animate-spin text-[var(--study-soft)]" />
    </div>
  )
}

function Empty() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <Home aria-hidden className="mx-auto size-7 text-[var(--study-faint)]" />
        <p className="mt-4 font-display text-[1.05rem] font-semibold">Add a subject to begin</p>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-[var(--study-soft)]">
          Everything here belongs to one subject — its documents, its questions, its notes. Upload a
          course handout to one and the rest is written from what that course actually covers.
        </p>
      </div>
    </div>
  )
}
