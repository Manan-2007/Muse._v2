import { api } from '@/lib/api'
import { API_BASE, API_HEADERS, getToken } from '@/lib/config'

/**
 * The study page's REST surface.
 *
 * Nearly all of Study is requests rather than live events: a set of questions
 * is written once and read for weeks, a document is uploaded once and searched
 * forever. Only the shared timer rides the socket.
 */

export type Voice = { id: string; label: string }

export type Capabilities = {
  /** False when the server has no model key — the UI disables rather than fails. */
  ai: boolean
  /** Independent of `ai` — a chat deployment implies nothing about an embedding one. */
  search: boolean
  judge: boolean
  judgeLanguages: string[]
  /** Narration rides the same key as chat but a different host — asked separately. */
  narration: boolean
  voices: Voice[]
  chatModel: string | null
}

export type Subject = {
  id: string
  name: string
  code: string | null
  blurb: string | null
  hasSyllabus: boolean
  counts: { resources: number; mcqSets: number; notes: number; problems: number }
}

export type ResourceStatus = 'pending' | 'processing' | 'ready' | 'failed'

export type StudyResource = {
  id: string
  title: string
  mimeType: string
  bytes: number
  status: ResourceStatus
  error: string | null
  chunkCount: number
  createdAt: string
  addedBy: { id: string; name: string }
}

export type SyllabusUnit = {
  name: string
  weightage: number | null
  lectures: number | null
  topics: string[]
}

export type Syllabus = {
  id: string
  title: string
  resourceId: string | null
  units: SyllabusUnit[]
  outcomes: string[]
  createdAt: string
}

export type McqSetSummary = {
  id: string
  title: string
  topic: string
  difficulty: string
  grounded: boolean
  sources: string[]
  questionCount: number
  createdAt: string
  createdBy: { id: string; name: string }
  lastAttempt: { score: number | null; total: number; completedAt: string | null } | null
}

export type McqQuestion = { id: string; prompt: string; options: string[] }

export type McqSet = {
  id: string
  title: string
  topic: string
  difficulty: string
  grounded: boolean
  sources: string[]
  questions: McqQuestion[]
}

/** One answered question, with what answering it revealed. */
export type Revealed = {
  questionId: string
  chosenIndex: number
  correctIndex: number
  explanation: string
  correct: boolean
}

/**
 * Where somebody is in a set.
 *
 * Comes back with the set itself, so reloading halfway through a quiz does
 * not put you back in front of questions you have already answered with the
 * answers hidden again.
 */
export type McqAttempt = {
  id: string
  revealed: Revealed[]
  score: number
  answered: number
  total: number
  completed: boolean
}

export type NoteSummary = {
  id: string
  title: string
  topic: string
  grounded: boolean
  sources: string[]
  createdAt: string
  createdBy: { id: string; name: string }
}

export type Note = NoteSummary & { content: string }

export type ProblemSummary = {
  id: string
  title: string
  difficulty: string
  createdAt: string
  createdBy: { id: string; name: string }
  lastSubmission: { status: string; passedCount: number; totalCount: number } | null
}

export type Problem = {
  id: string
  title: string
  description: string
  difficulty: string
  languages: string[]
  starters: Record<string, string>
  samples: { input: string; expected: string }[]
  /** How many cases are held back — shown, but never their contents. */
  hiddenCount: number
}

/** One case, in pieces, so your output can sit next to the right one. */
export type CaseView = { input: string; expected: string; got: string; passed: boolean }

export type Verdict = {
  status: 'passed' | 'failed' | 'error'
  passedCount: number
  totalCount: number
  /** Compiler or runtime output — about the code, not about any one case. */
  detail: string | null
  /**
   * A case to look at, whichever way the run went — the failing one when
   * there is one, the first visible one otherwise. Null only when nothing
   * visible ran.
   */
  shown: CaseView | null
}

export type Suggestion = { unit: string; topic: string; weightage: number | null }

export type Progress = {
  quiz: {
    attempts: number
    answered: number
    correct: number
    accuracy: number | null
    weakest: { topic: string; accuracy: number; asked: number }[]
  }
  notes: number
  coding: { problems: number; solved: number; submissions: number }
  resources: Partial<Record<ResourceStatus, number>>
  suggestions: Suggestion[]
}

const base = (roomId: string) => `/rooms/${roomId}/study`

export const capabilities = (roomId: string) => api.get<Capabilities>(base(roomId))

export const subjects = (roomId: string) =>
  api.get<{ subjects: Subject[] }>(`${base(roomId)}/subjects`)

export const createSubject = (roomId: string, input: { name: string; code?: string; blurb?: string }) =>
  api.post<{ subject: Subject }>(`${base(roomId)}/subjects`, input)

export const deleteSubject = (roomId: string, subjectId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/subjects/${subjectId}`)

export const resources = (roomId: string, subjectId: string) =>
  api.get<{ resources: StudyResource[] }>(`${base(roomId)}/resources?subjectId=${subjectId}`)

/**
 * Upload a document.
 *
 * Outside `api.ts` because that helper sets a JSON content type, and a
 * multipart body must be left alone for the browser to set its own boundary.
 * The auth headers are rebuilt here for the same reason they are there —
 * cookie same-origin, bearer token across one.
 */
export async function uploadResource(
  roomId: string,
  subjectId: string,
  file: File,
  title?: string,
) {
  const body = new FormData()
  body.append('document', file)
  body.append('subjectId', subjectId)
  if (title) body.append('title', title)

  const headers: Record<string, string> = { ...API_HEADERS }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  /* `/api` by hand, because this is the one call that does not go through
     `api.ts` — that helper adds the prefix along with the JSON content type,
     and a multipart body must be left alone for the browser to set its own
     boundary. Without it this posts to a path the SPA answers with its own
     HTML, and the failure reads as "that upload did not work" with nothing
     in the server log, because the server never saw it. */
  const response = await fetch(`${API_BASE}/api${base(roomId)}/resources`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  })

  /* Same trap as `api.ts`: a static host answers an unmatched /api path with
     its index page and a 200, so "ok" is not enough to trust the body. */
  const isJson = (response.headers.get('content-type') ?? '').includes('json')
  const payload = (isJson ? await response.json().catch(() => ({})) : {}) as {
    resource?: StudyResource
    error?: string
  }
  if (!response.ok) throw new Error(payload.error ?? 'That upload did not work.')
  if (!payload.resource) throw new Error('The API did not answer that upload — check the server address.')
  return payload.resource
}

export const retryResource = (roomId: string, resourceId: string) =>
  api.post<{ ok: true }>(`${base(roomId)}/resources/${resourceId}/retry`)

export const deleteResource = (roomId: string, resourceId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/resources/${resourceId}`)

export const syllabus = (roomId: string, subjectId: string) =>
  api.get<{ syllabus: Syllabus | null }>(`${base(roomId)}/syllabus?subjectId=${subjectId}`)

export const readSyllabus = (roomId: string, resourceId: string) =>
  api.post<{ syllabus: Syllabus }>(`${base(roomId)}/syllabus`, { resourceId })

export const nextUp = (roomId: string, subjectId: string) =>
  api.get<{ suggestions: Suggestion[] }>(`${base(roomId)}/next?subjectId=${subjectId}`)

export const mcqSets = (roomId: string, subjectId: string) =>
  api.get<{ sets: McqSetSummary[] }>(`${base(roomId)}/mcq?subjectId=${subjectId}`)

export const createMcq = (
  roomId: string,
  input: {
    subjectId: string
    topic: string
    count: number
    difficulty: string
    /** Draw only from these documents. Absent means the whole shelf. */
    resourceIds?: string[]
  },
) => api.post<{ set: McqSetSummary }>(`${base(roomId)}/mcq`, input)

export const mcqSet = (roomId: string, setId: string) =>
  api.get<{ set: McqSet; attempt: McqAttempt | null }>(`${base(roomId)}/mcq/${setId}`)

/**
 * Answer one question and find out what it was.
 *
 * A null `attemptId` starts a fresh attempt — which is also how retaking a
 * set works, since retaking is just the first answer of the next attempt.
 */
export const answerMcq = (
  roomId: string,
  setId: string,
  input: { attemptId: string | null; questionId: string; chosenIndex: number },
) => api.post<{ attempt: McqAttempt }>(`${base(roomId)}/mcq/${setId}/answers`, input)

export const deleteMcq = (roomId: string, setId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/mcq/${setId}`)

export const notes = (roomId: string, subjectId: string) =>
  api.get<{ notes: NoteSummary[] }>(`${base(roomId)}/notes?subjectId=${subjectId}`)

export const note = (roomId: string, noteId: string) =>
  api.get<{ note: Note }>(`${base(roomId)}/notes/${noteId}`)

export const createNote = (
  roomId: string,
  input: { subjectId: string; topic: string; depth: string; resourceIds?: string[] },
) => api.post<{ note: Note }>(`${base(roomId)}/notes`, input)

export const deleteNote = (roomId: string, noteId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/notes/${noteId}`)

export const problems = (roomId: string, subjectId: string) =>
  api.get<{ problems: ProblemSummary[] }>(`${base(roomId)}/coding?subjectId=${subjectId}`)

export const createProblem = (
  roomId: string,
  input: { subjectId: string; topic: string; difficulty: string; resourceIds?: string[] },
) => api.post<{ problem: { id: string; title: string; difficulty: string } }>(`${base(roomId)}/coding`, input)

export const problem = (roomId: string, problemId: string) =>
  api.get<{ problem: Problem }>(`${base(roomId)}/coding/${problemId}`)

export const submitCode = (
  roomId: string,
  problemId: string,
  input: { language: string; code: string; samplesOnly: boolean },
) => api.post<{ verdict: Verdict }>(`${base(roomId)}/coding/${problemId}/submissions`, input)

/**
 * Remarks on a run that already happened.
 *
 * The verdict goes up with the code because the model reviewing it should be
 * reading what the judge actually reported rather than guessing whether the
 * program works.
 */
export const reviewCode = (
  roomId: string,
  problemId: string,
  input: { language: string; code: string; verdict: Verdict },
) => api.post<{ remarks: string }>(`${base(roomId)}/coding/${problemId}/review`, input)

/** Re-run the generator's own check over an existing problem's cases. */
export const recheckCases = (roomId: string, problemId: string) =>
  api.post<{ removed: number; remaining: number }>(
    `${base(roomId)}/coding/${problemId}/recheck`,
  )

export const deleteProblem = (roomId: string, problemId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/coding/${problemId}`)

export const progress = (roomId: string, subjectId: string) =>
  api.get<{ progress: Progress }>(`${base(roomId)}/progress?subjectId=${subjectId}`)

export type AssistantMode = 'explain' | 'hint' | 'coding' | 'ask'

/**
 * The thing being asked about, sent verbatim rather than by id.
 *
 * The server could look most of these up, but not all of them — a selected
 * paragraph is not a row anywhere — and sending the text keeps one shape for
 * all four cases.
 */
export type Focus = { kind: 'note' | 'question' | 'problem'; title: string; body: string }

export type AssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  grounded: boolean
  sources: string[]
  createdAt: string
}

export const assistantHistory = (roomId: string, subjectId: string) =>
  api.get<{ messages: AssistantMessage[] }>(`${base(roomId)}/assistant?subjectId=${subjectId}`)

export const assistantAsk = (
  roomId: string,
  input: { subjectId: string; mode: AssistantMode; message: string; focus?: Focus | null },
) =>
  api.post<{ reply: { content: string; grounded: boolean; sources: string[] } }>(
    `${base(roomId)}/assistant`,
    input,
  )

export const assistantClear = (roomId: string, subjectId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/assistant?subjectId=${subjectId}`)

// ─── Explainers ───────────────────────────────────────────────────────────────

/**
 * What one beat puts on screen.
 *
 * A closed vocabulary, mirrored exactly from the server. Closed is the point:
 * every visual here is drawn by code from data, so it is as correct as the
 * data — which is why the lessons can be trusted in a way a generated video
 * could not be.
 */
export type Visual =
  | { kind: 'title'; text: string; subtitle?: string }
  | { kind: 'bullets'; heading?: string; items: string[]; reveal?: number }
  | { kind: 'steps'; heading?: string; items: string[]; active?: number }
  | { kind: 'diagram'; mermaid: string; caption?: string }
  | { kind: 'code'; language: string; code: string; highlight?: number[]; caption?: string }
  | {
      kind: 'compare'
      heading?: string
      left: { title: string; points: string[] }
      right: { title: string; points: string[] }
    }
  | { kind: 'callout'; tone: 'exam' | 'pitfall' | 'insight'; text: string }

export type Beat = {
  say: string
  show: Visual
  /** Beats sharing this keep one visual mounted and only advance it. */
  group?: string
  audio?: string
  seconds?: number
}

export type ExplainerStatus = 'pending' | 'scripting' | 'narrating' | 'ready' | 'failed'

export type ExplainerSummary = {
  id: string
  title: string
  topic: string
  style: string
  voice: string
  duration: number
  grounded: boolean
  sources: string[]
  status: ExplainerStatus
  error: string | null
  createdAt: string
  createdBy?: { id: string; name: string }
}

export type Explainer = ExplainerSummary & { beats: Beat[] }

export const explainers = (roomId: string, subjectId: string) =>
  api.get<{ explainers: ExplainerSummary[] }>(
    `${base(roomId)}/explainers?subjectId=${subjectId}`,
  )

export const explainer = (roomId: string, explainerId: string) =>
  api.get<{ explainer: Explainer }>(`${base(roomId)}/explainers/${explainerId}`)

export const createExplainer = (
  roomId: string,
  input: {
    subjectId: string
    topic: string
    style: string
    voice?: string
    resourceIds?: string[]
  },
) => api.post<{ explainer: ExplainerSummary }>(`${base(roomId)}/explainers`, input)

/** Build a failed lesson again, keeping the topic and the script it got to. */
export const retryExplainer = (roomId: string, explainerId: string) =>
  api.post<{ explainer: ExplainerSummary }>(
    `${base(roomId)}/explainers/${explainerId}/retry`,
    {},
  )

export const deleteExplainer = (roomId: string, explainerId: string) =>
  api.del<{ ok: true }>(`${base(roomId)}/explainers/${explainerId}`)
