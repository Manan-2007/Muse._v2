import { env } from '../config/env.js'
import { HttpError } from '../utils/HttpError.js'
import { unreachable, unreachableMessage } from '../utils/reachability.js'

/**
 * The one place this project talks to a model.
 *
 * Plain `fetch`, like every other outbound call here — the official SDK would
 * bring a dependency, a client object and its own retry policy to wrap two
 * POST requests that are already this short. `sources.service.ts` reaches
 * TMDB and YouTube exactly this way, and doing it differently for Azure would
 * mean two conventions for the same job.
 *
 * Everything below is optional at runtime. `configured()` is what the callers
 * check before offering a button, so a missing key switches a feature off
 * visibly rather than failing at the moment somebody presses it.
 */

/** Long enough for a page of generated notes; short enough to give up on. */
const CHAT_TIMEOUT_MS = 120_000
const EMBED_TIMEOUT_MS = 60_000

/**
 * How many chunks to embed per request.
 *
 * Azure accepts an array, and a request per chunk would make a hundred-page
 * PDF a hundred round trips. Sixteen keeps each request comfortably inside
 * the token ceiling for a batch of ~500-token passages.
 */
const EMBED_BATCH = 16

export function configured() {
  return Boolean(env.azure.endpoint && env.azure.apiKey)
}

/** Thrown as a 503 rather than a 500 — it is a missing key, not a bug. */
function requireConfigured() {
  if (!configured()) {
    throw HttpError.unavailable(
      'The study assistant is not configured on this server — no Azure OpenAI key.',
    )
  }
}

function url(deployment: string, path: string) {
  return `${env.azure.endpoint}/openai/deployments/${deployment}/${path}?api-version=${env.azure.apiVersion}`
}

/**
 * How many times to try a request that failed for a reason worth retrying.
 *
 * A dropped connection is not the same kind of failure as a refused request.
 * The model can answer in two seconds and still have the reply never arrive —
 * measured here against a live deployment, where Azure reported its own
 * `total_duration_ms` at 2276 while the socket took 77 seconds to finish, and
 * sometimes died outright. On that kind of link, a generator that gives up on
 * the first dropped connection fails perhaps half the time for reasons that
 * have nothing to do with the request.
 *
 * Only transient failures are retried. A 400 means the prompt is wrong and
 * will be exactly as wrong the second time.
 */
const MAX_ATTEMPTS = 3

/** Backoff between attempts. Short — the caller is a person waiting. */
const RETRY_DELAY_MS = 1200

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function post(target: string, body: unknown, timeoutMs: number): Promise<unknown> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': env.azure.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      /* No route to the host will not become one in a second and a half, and
         retrying past it costs the wait and then blames the connection for a
         problem that is the machine's own. */
      if (unreachable(cause)) {
        throw HttpError.unavailable(unreachableMessage('the model', target, cause))
      }

      /* A dropped connection and a genuine timeout arrive the same way. Both
         are worth another go; the timeout is generous enough that hitting it
         twice means something is actually wrong. */
      lastError = cause
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt)
        continue
      }
      throw HttpError.unavailable(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'The model took too long to answer. Try a smaller request.'
          : 'Could not reach the model — the connection kept dropping.',
      )
    }

    if (response.ok) return response.json()

    const text = await response.text().catch(() => '')

    /*
     * 429 is the one worth naming.
     *
     * It is the failure a room will actually hit — several people generating
     * at once against one deployment's quota — and "rate limited, wait a
     * moment" is something a person can act on, where "request failed" is not.
     */
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`${response.status} ${text.slice(0, 120)}`)
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt)
        continue
      }
      if (response.status === 429) {
        throw HttpError.unavailable('The model is rate limited right now. Try again in a moment.')
      }
    }

    /* Anything else is the request's own fault and will fail identically on a
       second attempt — a bad prompt, a wrong deployment name, a dead key. */
    throw HttpError.badGateway(
      `The model refused the request (${response.status}). ${text.slice(0, 200)}`,
    )
  }

  throw HttpError.unavailable(
    `Could not reach the model after ${MAX_ATTEMPTS} attempts. ${
      lastError instanceof Error ? lastError.message.slice(0, 120) : ''
    }`.trim(),
  )
}

/**
 * One piece of a message, for the calls that carry pictures.
 *
 * The chat endpoint accepts either a plain string or an array of parts, and
 * only the array form can hold an image. Kept as a separate shape rather than
 * widening `content` everywhere, so the dozen call sites that only ever send
 * prose are not made to think about it.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'user'; content: ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ToolSpec = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatReply = {
  content: string | null
  toolCalls: ToolCall[]
}

/**
 * One turn of chat.
 *
 * `json` asks the model to answer as a single JSON object. Every generator
 * here needs a shape it can put in a database rather than prose, and asking
 * in the prompt alone gets you a fenced code block or an apology often
 * enough to matter.
 */
export async function chat(
  messages: ChatMessage[],
  options: { json?: boolean; tools?: ToolSpec[]; temperature?: number; maxTokens?: number } = {},
): Promise<ChatReply> {
  requireConfigured()

  const body: Record<string, unknown> = {
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4000,
  }
  if (options.json) body.response_format = { type: 'json_object' }
  if (options.tools?.length) {
    body.tools = options.tools
    body.tool_choice = 'auto'
  }

  const payload = (await post(
    url(env.azure.chatDeployment, 'chat/completions'),
    body,
    CHAT_TIMEOUT_MS,
  )) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]
  }

  const message = payload.choices?.[0]?.message
  if (!message) throw HttpError.badGateway('The model returned nothing.')

  return { content: message.content ?? null, toolCalls: message.tool_calls ?? [] }
}

/**
 * Chat that must come back as parsed JSON.
 *
 * Wrapped rather than left to each caller because every generator needs the
 * same two lines of defence: the model can still answer with a fenced block
 * despite `json_object`, and a truncated answer is invalid JSON that would
 * otherwise surface as an unhandled parse error rather than a readable one.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  const reply = await chat(messages, { ...options, json: true })
  const text = (reply.content ?? '').trim()
  if (!text) throw HttpError.badGateway('The model returned an empty answer.')

  const cleaned = text.startsWith('```')
    ? text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    : text

  try {
    return JSON.parse(cleaned) as T
  } catch {
    throw HttpError.badGateway('The model answered in a shape this could not read.')
  }
}

/**
 * Embed a batch of passages.
 *
 * Order is preserved and guaranteed: Azure returns an `index` per item, and
 * they are sorted on it here rather than trusted to arrive in order, because
 * a silently reordered batch would attach every embedding to the wrong text
 * and the failure would look like nothing more than bad search results.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  requireConfigured()
  if (texts.length === 0) return []

  const out: number[][] = []

  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const batch = texts.slice(start, start + EMBED_BATCH)
    const payload = (await post(
      url(env.azure.embeddingDeployment, 'embeddings'),
      { input: batch },
      EMBED_TIMEOUT_MS,
    )) as { data?: { index: number; embedding: number[] }[] }

    const rows = payload.data ?? []
    if (rows.length !== batch.length) {
      throw HttpError.badGateway('The embedding model returned a different number of vectors.')
    }

    for (const row of [...rows].sort((a, b) => a.index - b.index)) out.push(row.embedding)
  }

  return out
}

/** One vector for one string — the query side of a search. */
export async function embedOne(text: string): Promise<number[]> {
  const [only] = await embed([text])
  if (!only) throw HttpError.badGateway('The embedding model returned nothing.')
  return only
}
