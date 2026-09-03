import { env } from '../config/env.js'
import { HttpError } from '../utils/HttpError.js'
import { unreachable, unreachableMessage } from '../utils/reachability.js'

/**
 * Gemini's embedding model, as the rung below Azure's.
 *
 * A separate file rather than a branch inside `azure.service.ts` — the two
 * are unrelated APIs with unrelated auth (a query-string key here, a header
 * there) and unrelated shapes, and a file that speaks both under one name
 * would be two services wearing a shared name rather than one service.
 *
 * Chat is not offered here. The three generators are meant to sound like one
 * voice regardless of which embedding provider a given server happens to
 * have, and letting chat fall back too would mean that voice changing with
 * whatever key was configured that day.
 */

const MODEL = 'gemini-embedding-001'
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * The service's own ceiling, not a guess.
 *
 * Measured directly: a batch of 101 is refused outright with "at most 100
 * requests can be in one batch." Kept at 90 rather than the full 100, so a
 * chunk that happens to be split into two requests server-side by some future
 * change still lands inside the limit rather than skimming it.
 */
const BATCH = 90

const TIMEOUT_MS = 60_000

export function configured() {
  return Boolean(env.gemini.apiKey)
}

type EmbedResponse = { embedding?: { values: number[] } }
type BatchResponse = { embeddings?: { values: number[] }[] }

/** See the note on retries in `azure.service.ts` — the same link, the same
    dropped connections, and an ingest of a long document makes many more
    calls than a single generation does. */
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 1200

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function post<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(`${BASE}/${path}?key=${env.gemini.apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (cause) {
      /* Same reasoning as the Azure client: a missing route is not a hiccup,
         and retrying past it hides what is actually wrong. */
      if (unreachable(cause)) {
        throw HttpError.unavailable(unreachableMessage('Gemini', BASE, cause))
      }

      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt)
        continue
      }
      throw HttpError.unavailable(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'Gemini took too long to answer.'
          : 'Could not reach Gemini — the connection kept dropping.',
      )
    }

    if (response.ok) return response.json() as Promise<T>

    const text = await response.text().catch(() => '')

    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt)
        continue
      }
      if (response.status === 429) {
        throw HttpError.unavailable('Gemini is rate limited right now. Try again in a moment.')
      }
    }

    throw HttpError.badGateway(
      `Gemini refused the request (${response.status}). ${text.slice(0, 200)}`,
    )
  }

  throw HttpError.unavailable(`Could not reach Gemini after ${MAX_ATTEMPTS} attempts.`)
}

/**
 * Embed a batch of passages.
 *
 * Order is trusted positionally rather than checked, unlike the Azure path —
 * Gemini's batch response carries no per-item index to sort by, only a bare
 * array. Measured directly before relying on this: embedding "cat" and "dog"
 * together and separately, the batched vectors matched their solo counterparts
 * at a cosine of 1.0 in request order, so the API does preserve it — but there
 * is nothing here that would notice if a future version stopped.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!configured()) throw HttpError.unavailable('Gemini is not configured on this server.')
  if (texts.length === 0) return []

  const out: number[][] = []

  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH)

    if (batch.length === 1) {
      const payload = await post<EmbedResponse>(`models/${MODEL}:embedContent`, {
        content: { parts: [{ text: batch[0] }] },
      })
      if (!payload.embedding) throw HttpError.badGateway('Gemini returned no embedding.')
      out.push(payload.embedding.values)
      continue
    }

    const payload = await post<BatchResponse>(`models/${MODEL}:batchEmbedContents`, {
      requests: batch.map((text) => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
      })),
    })
    const rows = payload.embeddings ?? []
    if (rows.length !== batch.length) {
      throw HttpError.badGateway('Gemini returned a different number of vectors than were sent.')
    }
    for (const row of rows) out.push(row.values)
  }

  return out
}
