import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  ScrollText,
  Trash2,
  Upload,
} from 'lucide-react'

import * as studyApi from '@/features/study/api'
import { Blank, bytes, PaneShell, Problem, Spinner, type PaneProps } from '@/features/study/panes/shared'
import { cn } from '@/lib/utils'

/**
 * The subject's shelf, and the syllabus read out of it.
 *
 * Everything generated anywhere else in Study is grounded in what is here, so
 * this is the pane that decides whether the rest is about the right course or
 * about the model's general idea of the subject.
 */
export default function ResourcesPane({ roomId, subject, caps, announce }: PaneProps) {
  const [rows, setRows] = useState<studyApi.StudyResource[] | null>(null)
  const [syllabus, setSyllabus] = useState<studyApi.Syllabus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const subjectId = subject?.id ?? null

  const load = useCallback(async () => {
    if (!subjectId) return
    try {
      const [{ resources }, { syllabus: outline }] = await Promise.all([
        studyApi.resources(roomId, subjectId),
        studyApi.syllabus(roomId, subjectId),
      ])
      setRows(resources)
      setSyllabus(outline)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the shelf.')
      setRows([])
    }
  }, [roomId, subjectId])

  useEffect(() => {
    setRows(null)
    setSyllabus(null)
    void load()
  }, [load])

  /*
   * Poll only while something is actually being read.
   *
   * Ingestion is seconds to minutes depending on the document, and there is no
   * socket event for it — it is one slow state change, not a stream. Polling
   * stops the moment nothing is in flight, so an idle shelf costs nothing.
   */
  const working = rows?.some((row) => row.status === 'pending' || row.status === 'processing')
  useEffect(() => {
    if (!working) return
    const id = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(id)
  }, [working, load])

  const upload = async (files: FileList | null) => {
    if (!files?.length || !subjectId) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        await studyApi.uploadResource(roomId, subjectId, file)
      }
      await load()
      announce('resources', subjectId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That upload did not work.')
    } finally {
      setUploading(false)
    }
  }

  const readSyllabus = async (resourceId: string) => {
    setReading(resourceId)
    setError(null)
    try {
      const { syllabus: outline } = await studyApi.readSyllabus(roomId, resourceId)
      setSyllabus(outline)
      announce('subjects', subjectId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That document did not read as a syllabus.')
    } finally {
      setReading(null)
    }
  }

  if (!subject) return <Blank title="No subject" body="Pick or add a subject first." />

  return (
    <PaneShell
      title="Library"
      description="Course handouts, slides and notes for this subject. What you put here is what every question and every set of notes is written from."
      aside={
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={uploading}
          className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-[var(--study-accent)] px-4 text-[0.82rem] font-medium text-[var(--study-on-accent)] outline-none transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {uploading ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Upload aria-hidden className="size-4" />
          )}
          {uploading ? 'Uploading…' : 'Add a document'}
        </button>
      }
    >
      <input
        ref={picker}
        type="file"
        /* Extensions, not just media types. A .docx is announced as the OOXML
           type by one browser, as application/zip by another and as
           octet-stream by a few file managers, and a picker that lists only
           types greys out coursework depending on which machine it is on. */
        accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.epub,.rtf,.html,.htm,.txt,.md,.markdown,.csv,.tsv"
        multiple
        hidden
        onChange={(event) => {
          void upload(event.target.files)
          event.target.value = ''
        }}
      />

      {error && (
        <div className="pb-4">
          <Problem message={error} />
        </div>
      )}

      {syllabus && <Outline syllabus={syllabus} />}

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void upload(event.dataTransfer.files)
        }}
        className={cn(
          'rounded-[0.9rem] border border-dashed p-1 transition-colors',
          dragging ? 'border-[var(--study-accent)] bg-[var(--study-accent-soft)]' : 'border-[var(--study-line)]',
        )}
      >
        {rows === null ? (
          <Spinner label="Reading the shelf…" />
        ) : rows.length === 0 ? (
          <Blank
            title="Nothing here yet"
            body="Drop a file in, or use the button above. PDFs, Word, PowerPoint, slides, spreadsheets, EPUB and plain text all get read. A course handout first — everything else is written from what it says the course covers."
          />
        ) : (
          <ul className="divide-y divide-[var(--study-line)]">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                canRead={Boolean(caps?.ai) && row.status === 'ready'}
                reading={reading === row.id}
                isSyllabus={syllabus?.resourceId === row.id}
                onRead={() => void readSyllabus(row.id)}
                onRetry={async () => {
                  await studyApi.retryResource(roomId, row.id).catch(() => undefined)
                  await load()
                }}
                onDelete={async () => {
                  await studyApi.deleteResource(roomId, row.id).catch(() => undefined)
                  await load()
                  announce('resources', subjectId)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </PaneShell>
  )
}

function Row({
  row,
  canRead,
  reading,
  isSyllabus,
  onRead,
  onRetry,
  onDelete,
}: {
  row: studyApi.StudyResource
  canRead: boolean
  reading: boolean
  isSyllabus: boolean
  onRead: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--study-faint)]" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.85rem] text-[var(--study-text)]">{row.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-[var(--study-faint)]">
          <span>{bytes(row.bytes)}</span>
          <span aria-hidden>·</span>
          <Status row={row} />
          {isSyllabus && (
            <>
              <span aria-hidden>·</span>
              <span className="text-[var(--study-bad)]">syllabus</span>
            </>
          )}
        </p>
        {row.error && <p className="mt-1.5 text-[0.74rem] leading-relaxed text-[var(--study-soft)]">{row.error}</p>}
      </div>

      <span className="flex shrink-0 items-center gap-1">
        {canRead && (
          <Action
            label={isSyllabus ? 'Read it again' : 'Read as syllabus'}
            onClick={onRead}
            busy={reading}
            icon={<ScrollText aria-hidden className="size-3.5" />}
          />
        )}
        {row.status === 'failed' && (
          <Action
            label="Try again"
            onClick={onRetry}
            icon={<RotateCcw aria-hidden className="size-3.5" />}
          />
        )}
        <Action
          label="Remove"
          onClick={onDelete}
          danger
          icon={<Trash2 aria-hidden className="size-3.5" />}
        />
      </span>
    </li>
  )
}

function Status({ row }: { row: studyApi.StudyResource }) {
  if (row.status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--study-soft)]">
        <CheckCircle2 aria-hidden className="size-3" />
        searchable · {row.chunkCount} passages
      </span>
    )
  }
  if (row.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--study-bad)]">
        <AlertCircle aria-hidden className="size-3" />
        could not be read
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[var(--study-soft)]">
      <Loader2 aria-hidden className="size-3 animate-spin" />
      reading…
    </span>
  )
}

function Action({
  label,
  onClick,
  icon,
  busy,
  danger,
}: {
  label: string
  onClick: () => void
  icon: React.ReactNode
  busy?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-8 place-items-center rounded-full text-[var(--study-faint)] outline-none transition-colors',
        '',
        danger ? 'hover:bg-[var(--study-bad-soft)] hover:text-[var(--study-bad)]' : 'hover:bg-[var(--study-card-strong)] hover:text-[var(--study-text)]',
      )}
    >
      {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : icon}
    </button>
  )
}

/**
 * The syllabus, once it has been read.
 *
 * Shown as the course's own structure — units, weightings, topics — because
 * that is the thing every generator below will be working from, and seeing it
 * is how you know whether it read the handout correctly.
 */
function Outline({ syllabus }: { syllabus: studyApi.Syllabus }) {
  return (
    <div className="mb-4 rounded-[0.9rem] border border-[var(--study-line)] bg-[var(--study-card)] p-4">
      <p className="font-display text-[0.95rem] font-semibold text-[var(--study-text)]">{syllabus.title}</p>
      <p className="mt-1 text-[0.76rem] text-[var(--study-faint)]">
        Read from the handout — every generated question and note is written against this.
      </p>

      <ol className="mt-4 space-y-3">
        {syllabus.units.map((unit, index) => (
          <li key={`${unit.name}-${index}`}>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-[0.84rem] text-[var(--study-text)]">{unit.name}</span>
              {unit.weightage != null && (
                <span className="text-[0.72rem] text-[var(--study-faint)]">{unit.weightage}%</span>
              )}
              {unit.lectures != null && (
                <span className="text-[0.72rem] text-[var(--study-faint)]">{unit.lectures} lectures</span>
              )}
            </p>
            {unit.topics.length > 0 && (
              <p className="mt-1 text-[0.76rem] leading-relaxed text-[var(--study-soft)]">
                {unit.topics.join(' · ')}
              </p>
            )}
          </li>
        ))}
      </ol>

      {syllabus.outcomes.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[0.76rem] text-[var(--study-faint)] outline-none transition-colors hover:text-[var(--study-soft)]">
            {syllabus.outcomes.length} stated outcomes
          </summary>
          <ul className="mt-2 space-y-1.5">
            {syllabus.outcomes.map((outcome, index) => (
              <li key={index} className="text-[0.76rem] leading-relaxed text-[var(--study-soft)]">
                {outcome}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
