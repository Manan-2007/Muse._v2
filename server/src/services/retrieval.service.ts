import { prisma } from '../models/prisma.js'
import * as embeddings from './embeddings.service.js'
import type { EmbeddingProvider } from './embeddings.service.js'

/**
 * Finding the passages worth showing a model.
 *
 * Brute force, deliberately. A room's shelf is a course or two — thousands of
 * chunks at the very top end — and scoring that many vectors in JavaScript is
 * a millisecond of arithmetic. A native index would beat it, and would also be
 * a compiled SQLite extension to install and keep working on every machine
 * this runs on, in exchange for a saving nobody could feel. If a shelf ever
 * grows enough to change that, only the inside of `search` has to change.
 *
 * Scoped to one subject, never to the whole room. Mixing a chemistry syllabus
 * into a compiler-design question is not a small inaccuracy — retrieval pulls
 * the wrong document, and the model then answers from it with every
 * appearance of being grounded.
 */

/**
 * What a document's divisions are called.
 *
 * A slide cited as "p.3" is a small lie, and the model repeats it in every
 * note and explanation it writes from that passage. Derived from the file
 * rather than stored, because it is a property of the format and the format
 * is already recorded.
 */
type Unit = 'p.' | 'slide' | 'sheet' | 'chapter' | 'section'

const UNITS: Record<string, Unit> = {
  '.pdf': 'p.',
  '.pptx': 'slide',
  '.odp': 'slide',
  '.xlsx': 'sheet',
  '.ods': 'sheet',
  '.epub': 'chapter',
}

function unitFor(file: string, mimeType: string) {
  const dot = file.lastIndexOf('.')
  const byExtension = dot === -1 ? undefined : UNITS[file.slice(dot).toLowerCase()]
  if (byExtension) return byExtension
  if (mimeType.includes('presentation')) return 'slide'
  if (mimeType.includes('spreadsheet')) return 'sheet'
  if (mimeType.includes('epub')) return 'chapter'
  return 'section'
}

export type Hit = {
  chunkId: string
  resourceId: string
  title: string
  page: number | null
  /** What `page` counts in this document — a deck has slides, not pages. */
  unit: Unit
  text: string
  score: number
}

/**
 * Cosine similarity.
 *
 * Both vectors come back from the same embedding deployment, which returns
 * unit vectors — so the magnitudes are 1 and the dot product alone would do.
 * The division is kept anyway: it costs nothing per comparison and it means
 * this stays correct if the deployment is ever changed for one that does not
 * normalise, which is the kind of change that would otherwise degrade search
 * quietly rather than break it.
 */
function cosine(a: number[], b: number[]) {
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    aa += x * x
    bb += y * y
  }
  if (aa === 0 || bb === 0) return 0
  return dot / Math.sqrt(aa * bb)
}

/**
 * Below this, a passage is not about the question.
 *
 * Cosine over these embeddings does not fall to zero for unrelated text, so
 * "the best few" is not the same as "any that are relevant". Without a floor,
 * a question about something the shelf says nothing about still returns the
 * three least irrelevant pages, and the model dutifully grounds an answer in
 * them — wrong, and cited.
 *
 * The number is per provider because the scales genuinely differ, and a floor
 * borrowed from the wrong one fails silently in whichever direction it is
 * wrong: too high and nothing is ever grounded, too low and everything is.
 * Both were measured against a real course handout rather than assumed —
 * relevant queries against irrelevant ones, looking for a gap between them.
 *
 *   Gemini  relevant 0.585-0.665, irrelevant 0.476-0.500
 *   Azure   the OpenAI scale, where unrelated prose sits far higher
 *
 * A later measurement found the harder case the first one had missed. A query
 * from the same field but a different topic — "React hooks" against a handout
 * about Flexbox, both front-end web — scored 0.547, comfortably above where
 * genuinely unrelated text lands (0.463 for photosynthesis, 0.471 for the
 * French Revolution) and above a floor of 0.54. So notes on one topic could
 * cite the handout for another and call themselves grounded, which is the
 * exact failure the floor exists to prevent, in the one case most likely to
 * come up: a shelf of documents from the same course.
 *
 *   same field, wrong topic  0.547  -> must be rejected
 *   right topic              0.713-0.748
 *
 * Hence 0.57: above that false positive, and still under the 0.585 where
 * genuinely relevant passages began in the first measurement.
 *
 * If a third provider is ever added, measure it the same way rather than
 * guessing; the cost of guessing is a feature that looks like it works.
 */
const FLOOR: Record<NonNullable<EmbeddingProvider>, number> = {
  gemini: 0.57,
  azure: 0.78,
}

export type SearchOptions = {
  /** How many passages to return at most. */
  limit?: number
  /** Only these documents. Empty or absent means the whole shelf. */
  only?: string[]
  /** Never these documents — see the note on the syllabus in `gather`. */
  exclude?: string[]
  /** Override the relevance floor — the syllabus reader wants everything. */
  floor?: number
}

/**
 * Passages from one subject's shelf that bear on `query`.
 *
 * Returns an empty array when the subject has nothing embedded, or when
 * nothing clears the floor. Both are ordinary and the caller must handle them
 * by saying so rather than by pretending it found something.
 */
/**
 * Whole documents, in their own order, with no query to rank them by.
 *
 * For "write notes from these two handouts", where the documents *are* the
 * request. Similarity search needs something to be similar to, and an empty
 * query embeds to a direction with no meaning — it would return passages in
 * an order that looks considered and is actually arbitrary.
 *
 * So this does not pretend to rank. It reads from the start of each chosen
 * document and takes an even share from each, because a person who picked two
 * files meant both of them, and a straight cut at a global limit would spend
 * the whole budget on whichever happened to be longer.
 */
export async function passagesFrom(
  subjectId: string,
  resourceIds: string[],
  limit = 8,
): Promise<Hit[]> {
  if (resourceIds.length === 0) return []

  const perDocument = Math.max(1, Math.ceil(limit / resourceIds.length))

  const rows = await prisma.resourceChunk.findMany({
    where: { subjectId, resourceId: { in: resourceIds }, resource: { status: 'ready' } },
    orderBy: [{ resourceId: 'asc' }, { index: 'asc' }],
    select: {
      id: true,
      text: true,
      page: true,
      resourceId: true,
      resource: { select: { title: true, file: true, mimeType: true } },
    },
  })

  const taken = new Map<string, number>()
  const hits: Hit[] = []

  for (const row of rows) {
    const used = taken.get(row.resourceId) ?? 0
    if (used >= perDocument) continue
    taken.set(row.resourceId, used + 1)
    hits.push({
      chunkId: row.id,
      resourceId: row.resourceId,
      title: row.resource.title,
      page: row.page,
      unit: unitFor(row.resource.file, row.resource.mimeType),
      text: row.text,
      /* Not a similarity — nothing was compared. Reported as a full match
         because these passages were chosen by hand, which is a stronger
         signal than anything a cosine could have produced. */
      score: 1,
    })
    if (hits.length >= limit) break
  }

  return hits
}

export async function search(
  subjectId: string,
  query: string,
  options: SearchOptions = {},
): Promise<Hit[]> {
  const limit = options.limit ?? 6
  const provider = await embeddings.provider()
  const floor = options.floor ?? (provider ? FLOOR[provider] : 1)

  const only = options.only?.length ? options.only : null
  const exclude = options.exclude?.length ? options.exclude : null

  const rows = await prisma.resourceChunk.findMany({
    where: {
      subjectId,
      resource: { status: 'ready' },
      ...(only ? { resourceId: { in: only } } : {}),
      ...(exclude ? { resourceId: { notIn: exclude } } : {}),
    },
    select: {
      id: true,
      text: true,
      page: true,
      embedding: true,
      resourceId: true,
      resource: { select: { title: true, file: true, mimeType: true } },
    },
  })
  if (rows.length === 0) return []

  const wanted = await embeddings.embedOne(query)

  const scored: Hit[] = []
  for (const row of rows) {
    let vector: number[]
    try {
      vector = JSON.parse(row.embedding) as number[]
    } catch {
      /* A chunk whose vector will not parse is a chunk written by a version
         that stored it differently, or a truncated write. Skipping it loses
         one passage; throwing would lose the whole search. */
      continue
    }

    const score = cosine(wanted, vector)
    if (score < floor) continue

    scored.push({
      chunkId: row.id,
      resourceId: row.resourceId,
      title: row.resource.title,
      page: row.page,
      unit: unitFor(row.resource.file, row.resource.mimeType),
      text: row.text,
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/**
 * Hits rendered for a prompt, with their source named on every passage.
 *
 * The titles are in the text itself rather than only in the metadata so the
 * model can cite them in what it writes — a note that says which document a
 * claim came from is checkable, and one that does not is a claim the reader
 * has to take on faith.
 */
export function asContext(hits: Hit[]) {
  return hits
    .map((hit, index) => {
      const where = hit.page ? `${hit.title}, ${hit.unit} ${hit.page}` : hit.title
      return `[${index + 1}] (${where})\n${hit.text}`
    })
    .join('\n\n')
}

/** Distinct document titles behind a set of hits, for recording provenance. */
export function sourceTitles(hits: Hit[]) {
  return [...new Set(hits.map((hit) => hit.title))]
}
