import * as azure from './azure.service.js'
import * as gemini from './gemini.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * Which provider actually turns text into a vector, decided once.
 *
 * Chat and embeddings are asked of different services here by design. A key
 * that answers `gpt-4o` on Azure does not imply an embedding deployment
 * exists beside it — they are provisioned and billed separately — so a server
 * with only a chat deployment configured would otherwise have every upload
 * fail with a 404 that has nothing to do with the document. Search falls back
 * to Gemini's embedding model in that case, and generation is untouched
 * either way: the three generators go through `azure.service.ts`'s chat
 * directly, so which embedding rung is active never changes how a set of
 * questions reads.
 */

export type EmbeddingProvider = 'azure' | 'gemini' | null

/** Cached after the first real answer — see the note on the promise below. */
let resolved: Promise<EmbeddingProvider> | null = null

/**
 * Whether Azure's embedding deployment exists, found out by asking rather
 * than by reading configuration — the deployment name being set says nothing
 * about whether it was ever created.
 */
async function azureEmbeddingsWork(): Promise<boolean> {
  if (!azure.configured()) return false
  try {
    await azure.embed(['probe'])
    return true
  } catch {
    return false
  }
}

/**
 * Resolved once per process, not once per call.
 *
 * The answer is a fact about how the server is deployed, not about the
 * request in front of it — asking Azure whether its embedding deployment
 * exists before every single chunk would be a paid, timed round trip spent
 * re-learning something that will not change until somebody edits `.env` and
 * restarts.
 */
export function provider(): Promise<EmbeddingProvider> {
  if (!resolved) {
    resolved = azureEmbeddingsWork().then((works) => {
      if (works) return 'azure'
      if (gemini.configured()) return 'gemini'
      return null
    })
  }
  return resolved
}

export async function available(): Promise<boolean> {
  return (await provider()) !== null
}

/** Embed a batch of passages through whichever provider is actually live. */
export async function embed(texts: string[]): Promise<number[][]> {
  const which = await provider()
  if (which === 'azure') return azure.embed(texts)
  if (which === 'gemini') return gemini.embed(texts)
  throw HttpError.unavailable(
    'No embedding provider is configured on this server, so documents cannot be made searchable.',
  )
}

export async function embedOne(text: string): Promise<number[]> {
  const [only] = await embed([text])
  if (!only) throw HttpError.badGateway('The embedding provider returned nothing.')
  return only
}
