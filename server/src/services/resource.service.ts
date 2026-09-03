import path from 'node:path'
import { rm } from 'node:fs/promises'

import { prisma } from '../models/prisma.js'
import { UPLOAD_DIR } from './upload.service.js'
import * as embeddings from './embeddings.service.js'
import { chunk, extract, imagesFrom } from './extract.service.js'
import * as vision from './vision.service.js'

/**
 * Turning an uploaded document into something the shelf can answer from.
 *
 * The work happens after the upload has already replied. Reading a textbook,
 * splitting it and embedding every piece is tens of seconds and a few dozen
 * calls to Azure — inside the request that would be a request that times out,
 * and the person watching would have no idea whether their file arrived.
 *
 * So the row is written first with `status: 'pending'`, the response goes
 * back, and this runs on afterwards, moving the row through `processing` to
 * `ready` or `failed`. The client polls the list it already has open. That is
 * the same shape `publish.service.ts` uses for transcoding a film, for the
 * same reason.
 */

export const RESOURCE_STATUS = ['pending', 'processing', 'ready', 'failed'] as const
export type ResourceStatus = (typeof RESOURCE_STATUS)[number]

export function filePath(file: string) {
  return path.join(UPLOAD_DIR, file)
}

async function fail(resourceId: string, message: string) {
  await prisma.resource
    .update({ where: { id: resourceId }, data: { status: 'failed', error: message } })
    .catch(() => undefined)
}

/**
 * Read, split, embed, store.
 *
 * Never throws to its caller — it is started with `void` and there is nobody
 * left to catch it by the time it runs. Everything that can go wrong is
 * recorded on the row instead, because the row is the only thing the person
 * who uploaded the file is still looking at.
 */
export async function ingest(resourceId: string): Promise<void> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!resource) return

  try {
    await prisma.resource.update({
      where: { id: resourceId },
      data: { status: 'processing', error: null },
    })

    const extracted = await extract(filePath(resource.file), resource.mimeType)

    /*
     * Read the pictures too, when there are enough of them to matter.
     *
     * Gated on the same ratio that used to only produce a warning, because
     * the cost is real — a request per few images against the shared quota —
     * and a document with a logo and one diagram has nothing to gain. When it
     * does fire, the transcription is folded into the text before chunking,
     * so a screenshot of a `for` loop is indexed, retrieved and quoted
     * exactly like a paragraph that happened to be typed.
     */
    const imageBytes = extracted.imageBytes ?? 0
    const textBytes = Buffer.byteLength(extracted.text, 'utf8')
    const pictureHeavy = imageBytes > 120_000 && imageBytes > textBytes * 4

    let transcribed = ''
    if (pictureHeavy && vision.configured()) {
      const images = await imagesFrom(filePath(resource.file), resource.mimeType)
      transcribed = await vision.transcribe(images)
    }

    const pieces = chunk(
      transcribed
        ? { ...extracted, text: `${extracted.text}\n\n${transcribed}`.trim() }
        : extracted,
    )

    /*
     * A file that parsed but said nothing is a scan, almost always.
     *
     * Worth its own message rather than a generic failure: "this looks like a
     * scan" tells somebody to go and find a text version, where "could not
     * process" tells them to try the same file again.
     */
    if (pieces.length === 0) {
      await fail(
        resourceId,
        'No text could be read from this file. If it is a scan or photographs of pages, the words are pictures — a text version of the same document will work.',
      )
      return
    }

    /*
     * Read, but mostly pictures.
     *
     * A worksheet whose questions are one big screenshot extracts a few
     * hundred words of surrounding prose and reports success — and the shelf
     * then says "searchable" about a document whose actual content nothing
     * can read. Every lesson and every question written from that subject is
     * quietly ungrounded, and nobody is told why.
     *
     * The threshold is deliberately loose. A document with a logo and a
     * diagram is normal; one where the pictures outweigh the text by this
     * much is a document whose meaning is in the pictures.
     */
    /* Still mostly pictures *after* trying to read them — either the vision
       pass was unavailable, or what it found was decoration rather than
       content. Either way the caveat below is still the honest thing to say. */
    const mostlyPictures = imageBytes > 120_000 && imageBytes > textBytes * 20 && !transcribed

    const vectors = await embeddings.embed(pieces.map((piece) => piece.text))
    if (vectors.length !== pieces.length) {
      await fail(resourceId, 'The embedding model returned a different number of vectors.')
      return
    }

    /*
     * Replace rather than append.
     *
     * Ingest can run twice for one resource — a retry after a rate limit, or a
     * server restarted mid-run. Without clearing first, the second pass leaves
     * two copies of every passage, and retrieval then returns the same page
     * twice and spends half the model's context repeating itself.
     */
    await prisma.$transaction([
      prisma.resourceChunk.deleteMany({ where: { resourceId } }),
      prisma.resourceChunk.createMany({
        data: pieces.map((piece, index) => ({
          resourceId,
          roomId: resource.roomId,
          subjectId: resource.subjectId,
          index: piece.index,
          page: piece.page,
          text: piece.text,
          embedding: JSON.stringify(vectors[index]),
        })),
      }),
      prisma.resource.update({
        where: { id: resourceId },
        data: {
          status: 'ready',
          /* Ready, but said so with a caveat. `error` is what the library
             surfaces, and this is worth surfacing: it is the difference
             between a document that is indexed and one that only looks it. */
          error: mostlyPictures
            ? `Only ${Math.round(textBytes / 1024)} KB of text was readable — most of this file is images, and the words inside a picture cannot be searched or quoted. Anything written from this subject will not be drawing on them.`
            : null,
          chunkCount: pieces.length,
        },
      }),
    ])
  } catch (cause) {
    await fail(resourceId, cause instanceof Error ? cause.message : 'Could not read this file.')
  }
}

/** Start an ingest and return immediately. See the note at the top. */
export function ingestInBackground(resourceId: string) {
  void ingest(resourceId).catch(() => undefined)
}

/**
 * Delete a resource, its chunks, and the file behind it.
 *
 * The row goes through Prisma's cascade; the file on disk has nothing to
 * cascade from, so it is removed here. A missing file is not an error worth
 * surfacing — the row is going either way, and a resource that half-exists is
 * worse than one that is fully gone.
 */
export async function remove(resourceId: string) {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!resource) return

  await prisma.resource.delete({ where: { id: resourceId } })
  await rm(filePath(resource.file), { force: true }).catch(() => undefined)
}
