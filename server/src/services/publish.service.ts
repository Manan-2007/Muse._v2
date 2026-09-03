import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { deletePrefix, publicUrl, r2Enabled, uploadDirectory } from './r2.service.js'
import { extractPoster, extractSubtitles, probe, toHls } from './transcode.service.js'
import { UPLOAD_DIR } from './upload.service.js'

/**
 * Getting a film from the uploads folder onto the CDN.
 *
 * Two steps that are useless apart: repackage to HLS so playback can start
 * without reading a huge index, and put the result on R2 so the bytes stop
 * coming out of this machine. Doing only the first leaves every viewer sharing
 * one home upload link; doing only the second still makes them download tens
 * of megabytes before the first frame.
 *
 * What is published is tracked in a small index beside the videos rather than
 * in the database. The uploads folder is already the source of truth for what
 * exists — a file dropped in over SSH appears, one deleted vanishes — and a
 * table would immediately start disagreeing with it.
 */

const INDEX_FILE = '.published.json'

export type PublishedEntry = {
  /** Filename in the uploads folder this was made from. */
  file: string
  /** Key prefix in the bucket, so it can be replaced or removed later. */
  keyPrefix: string
  /** Master playlist URL — this is what the player is handed. */
  url: string
  durationSeconds: number
  width: number | null
  height: number | null
  audio: { language: string; label: string }[]
  /** WebVTT tracks pulled out of the source, if it carried any text ones. */
  subtitles: { language: string; label: string; url: string }[]
  /** A frame from the film itself, or null if it couldn't be grabbed. */
  thumbnail: string | null
  segmentCount: number
  publishedAt: number
}

type PublishedIndex = Record<string, PublishedEntry>

const indexPath = () => path.join(UPLOAD_DIR, INDEX_FILE)

export async function readPublished(): Promise<PublishedIndex> {
  try {
    return JSON.parse(await readFile(indexPath(), 'utf8')) as PublishedIndex
  } catch {
    /* Missing or unreadable means nothing has been published yet, which is a
       perfectly ordinary state and not worth an error. */
    return {}
  }
}

async function record(entry: PublishedEntry) {
  const index = await readPublished()
  index[entry.file] = entry
  await writeFile(indexPath(), JSON.stringify(index, null, 2))
}

/**
 * Unpublish a file: its segments off the bucket, its entry out of the index.
 *
 * Bucket first, index second. If the bucket call fails the entry stays, and
 * the next attempt tries again — which is recoverable. Dropping the entry
 * first and then failing would strand a few thousand objects with nothing left
 * that knows their prefix, and storage is the one thing R2 charges for.
 *
 * A file that was never published is not an error here; there is simply
 * nothing to undo.
 */
export async function unpublish(file: string) {
  const index = await readPublished()
  const entry = index[file]
  if (!entry) return { removed: 0, wasPublished: false }

  const removed = r2Enabled() ? await deletePrefix(entry.keyPrefix) : 0

  delete index[file]
  await writeFile(indexPath(), JSON.stringify(index, null, 2))

  return { removed, wasPublished: true }
}

/** What has already been published for a given file, if anything. */
export async function publishedFor(file: string) {
  return (await readPublished())[file] ?? null
}

/**
 * Subtitle tracks for something already in the queue.
 *
 * Resolved from the published index by URL rather than stored on the queue
 * row. The row only ever held a ref, and copying the subtitle list onto it
 * would mean two records of the same fact that can disagree — republish a film
 * with different subtitles and every queue entry pointing at it would still be
 * describing the old ones.
 */
export async function subtitlesForRef(ref: string) {
  if (!ref.startsWith('http')) return []
  const index = await readPublished()
  for (const entry of Object.values(index)) {
    if (entry.url === ref) return entry.subtitles ?? []
  }
  return []
}

/**
 * Files currently being published, so two requests can't race on one.
 *
 * Also what the library listing would consult to show progress; for now it
 * exists to make `publishInBackground` idempotent, since an upload retried by
 * an impatient client must not start a second ffmpeg over the same film.
 */
const inFlight = new Set<string>()

export const isPublishing = (file: string) => inFlight.has(file)

/**
 * Publish without making the caller wait.
 *
 * Repackaging a feature-length film takes minutes and uploading it takes
 * longer, which is far past what an HTTP request can hold open. The upload
 * endpoint therefore answers as soon as the bytes are on disk — the file is
 * already playable directly at that point — and this quietly upgrades it to
 * the CDN version afterwards.
 *
 * Failures are logged rather than thrown. There is no one left to tell, and
 * the local file still plays; losing the faster path is a degradation, not an
 * outage.
 */
export function publishInBackground(file: string) {
  if (inFlight.has(file)) return
  inFlight.add(file)

  void publish(file)
    .then((entry) => {
      console.log(`  published ${file} -> ${entry.url}`)
    })
    .catch((cause: unknown) => {
      console.error(
        `  could not publish ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    })
    .finally(() => inFlight.delete(file))
}

/**
 * A stable bucket location for a file.
 *
 * Derived from the name and size rather than being random, so publishing the
 * same film twice overwrites its own segments instead of quietly leaving a
 * second copy behind — storage is the one thing R2 does charge for.
 */
function keyPrefixFor(file: string, bytes: number) {
  const digest = createHash('sha1').update(`${file}:${bytes}`).digest('hex').slice(0, 12)
  const slug =
    path
      .parse(file)
      .name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'video'

  return `hls/${slug}-${digest}`
}

export type PublishProgress = {
  stage: 'probing' | 'packaging' | 'uploading' | 'done'
  /** 0–1 within the current stage, or null when it can't be measured. */
  fraction: number | null
}

/**
 * Publish one file from the uploads folder.
 *
 * The HLS output goes to a scratch directory rather than next to the source:
 * it is a derived artefact, it is thousands of files, and leaving it in the
 * uploads folder would put all of it in the library listing.
 */
export async function publish(
  file: string,
  onProgress?: (progress: PublishProgress) => void,
): Promise<PublishedEntry> {
  if (!r2Enabled()) {
    throw new Error('R2 is not configured — set R2_* in server/.env to publish')
  }

  const source = path.join(UPLOAD_DIR, file)
  const info = await stat(source).catch(() => null)
  if (!info?.isFile()) throw new Error(`No such file in the uploads folder: ${file}`)

  onProgress?.({ stage: 'probing', fraction: null })
  const probed = await probe(source)

  const work = await mkdtemp(path.join(tmpdir(), 'syncroom-hls-'))
  try {
    onProgress?.({ stage: 'packaging', fraction: 0 })
    await toHls(source, work, (fraction) => onProgress?.({ stage: 'packaging', fraction }))

    /* After the ladder, so a subtitle failure can't waste the expensive step —
       and into the same directory, so one upload carries both. */
    const written = await extractSubtitles(source, work, probed.subtitles)

    /* Same reasoning, same directory: a poster is worth having but not worth
       failing the publish over. */
    const posterFile = 'poster.jpg'
    const hasPoster = await extractPoster(source, path.join(work, posterFile), probed.durationSeconds)
      .then(() => true)
      .catch(() => false)

    const keyPrefix = keyPrefixFor(file, info.size)
    onProgress?.({ stage: 'uploading', fraction: 0 })
    const segmentCount = await uploadDirectory(work, keyPrefix, (done, total) =>
      onProgress?.({ stage: 'uploading', fraction: total > 0 ? done / total : null }),
    )

    const entry: PublishedEntry = {
      file,
      keyPrefix,
      url: publicUrl(`${keyPrefix}/master.m3u8`),
      durationSeconds: Math.round(probed.durationSeconds),
      width: probed.width,
      height: probed.height,
      audio: probed.audio.map((track) => ({ language: track.language, label: track.label })),
      subtitles: written.map((track) => ({
        language: track.language,
        label: track.label,
        url: publicUrl(`${keyPrefix}/${track.file}`),
      })),
      thumbnail: hasPoster ? publicUrl(`${keyPrefix}/${posterFile}`) : null,
      segmentCount,
      publishedAt: Date.now(),
    }

    await record(entry)
    onProgress?.({ stage: 'done', fraction: 1 })
    return entry
  } finally {
    /* Thousands of segments and a full copy of the film's bytes. Leaving this
       behind fills the disk after a handful of publishes. */
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}
