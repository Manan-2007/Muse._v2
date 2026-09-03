import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  S3Client,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

import { env } from '../config/env.js'

/**
 * Cloudflare R2, spoken to over the S3 API.
 *
 * The bucket is where playback actually comes from. That matters more than it
 * sounds: while video is served off this machine, every viewer is pulling
 * through one home upload link, and the room gets worse the more people are in
 * it — which is the exact opposite of what a watch-together app should do.
 * Once the segments are on R2 the server is out of the playback path entirely
 * and can be asleep for all the viewers care.
 *
 * R2 rather than S3 for one reason: egress is free. Streaming is nearly all
 * egress, so on metered storage the bill scales with how much people enjoy the
 * thing.
 */

/** Whether this deployment has somewhere to publish to. */
export function r2Enabled() {
  const { accessKeyId, secretAccessKey, bucket, endpoint, publicUrl } = env.r2
  return Boolean(accessKeyId && secretAccessKey && bucket && endpoint && publicUrl)
}

let client: S3Client | null = null

function s3() {
  if (!client) {
    /*
     * `auto` is the only region R2 accepts. The SDK insists on one being set,
     * and any real AWS region name here is quietly wrong rather than an error.
     */
    client = new S3Client({
      region: 'auto',
      endpoint: env.r2.endpoint,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
    })
  }
  return client
}

/** Public URL for a stored object. Keys are already URL-safe — see `hlsKey`. */
export function publicUrl(key: string) {
  return `${env.r2.publicUrl}/${key}`
}

/**
 * Content types R2 has to be told about.
 *
 * Object storage has no opinion about file extensions, and a playlist served
 * as `application/octet-stream` is a download rather than a video. Safari is
 * the strict one here: it will refuse a manifest whose type it doesn't
 * recognise, so this is not cosmetic.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.ts': 'video/mp2t',
  '.vtt': 'text/vtt',
  '.jpg': 'image/jpeg',
}

function contentTypeFor(file: string) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Put one file in the bucket.
 *
 * Streamed through `Upload` rather than read into memory: a movie segment is
 * small, but the same path carries the original file on the fallback route and
 * that one is measured in gigabytes.
 */
export async function uploadFile(localPath: string, key: string) {
  const upload = new Upload({
    client: s3(),
    params: {
      Bucket: env.r2.bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentTypeFor(localPath),
      /* Segments are immutable — the name contains the sequence number, so a
         given key's bytes never change. Long cache is safe and is most of what
         makes the CDN worth having. */
      CacheControl: key.endsWith('.m3u8')
        ? 'public, max-age=60'
        : 'public, max-age=31536000, immutable',
    },
  })

  await upload.done()
  return key
}

/** Every file under a directory, depth-first, as paths relative to it. */
async function walk(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir)
  const found: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry)
    const info = await stat(full)
    if (info.isDirectory()) found.push(...(await walk(full, path.join(prefix, entry))))
    else found.push(path.join(prefix, entry))
  }

  return found
}

/**
 * Publish a finished HLS directory.
 *
 * Uploaded with a bounded amount of concurrency. A two-hour film is well over
 * a thousand segments; firing them all at once buries the upload link and
 * makes the failures harder to read than the work saved is worth.
 */
export async function uploadDirectory(
  localDir: string,
  keyPrefix: string,
  onProgress?: (done: number, total: number) => void,
) {
  const files = await walk(localDir)
  const CONCURRENCY = 6
  let done = 0

  /*
   * Segments first, playlists last, and the master last of all.
   *
   * A playlist is a promise that the things it names already exist. Uploading
   * it first — which is what directory order happens to do, since `master.m3u8`
   * sorts ahead of the `v0/` it describes — publishes that promise before it is
   * true, and for the hour a feature film takes to upload, every player is
   * fetching segments that are not there yet.
   *
   * Republishing over an existing film is where this really bites: the old
   * version is serving perfectly well until a new master claims renditions
   * whose segments are still being written. Ordering it this way means the
   * switchover is the single last upload, and until that moment viewers keep
   * getting the version that already works.
   *
   * The master is held back entirely rather than merely sorted last: with six
   * workers running, "last into the queue" still finishes alongside whatever
   * five large segments went in just before it, and a tiny playlist wins that
   * race every time.
   */
  const isMaster = (file: string) => file.endsWith('master.m3u8')
  const master = files.filter(isMaster)
  const rank = (file: string) => (file.endsWith('.m3u8') ? 1 : 0)
  const queue = files.filter((file) => !isMaster(file)).sort((a, b) => rank(a) - rank(b))
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const file = queue.shift()
      if (!file) return
      await uploadFile(
        path.join(localDir, file),
        `${keyPrefix}/${file.split(path.sep).join('/')}`,
      )
      done += 1
      onProgress?.(done, files.length)
    }
  })

  await Promise.all(workers)

  /* Everything it names is now on the bucket, so the film can be switched over. */
  for (const file of master) {
    await uploadFile(path.join(localDir, file), `${keyPrefix}/${file.split(path.sep).join('/')}`)
    done += 1
    onProgress?.(done, files.length)
  }

  return files.length
}

/**
 * Let browsers read the bucket cross-origin.
 *
 * Native HLS — Safari playing an `.m3u8` straight from a `<video>` — needs
 * none of this. Everywhere else the playlist is parsed in JavaScript and the
 * segments are fetched by XHR, which puts the whole thing under CORS: without
 * these headers the manifest downloads fine and then the player reports a
 * network error it cannot explain.
 *
 * `*` because the content is public anyway — the bucket serves it to anyone
 * with the URL regardless — and pinning the origin would break the moment a
 * preview deployment or a second frontend appears.
 */
export async function ensureCors() {
  await s3().send(
    new PutBucketCorsCommand({
      Bucket: env.r2.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            /* Range lives behind these two: a player seeking into a segment
               needs to read the response's extent, not just its body. */
            ExposeHeaders: ['Content-Length', 'Content-Range', 'ETag'],
            MaxAgeSeconds: 86400,
          },
        ],
      },
    }),
  )
}

/** Smallest possible write, used to prove the credentials work. */
export async function verifyAccess() {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: '.syncroom-access-check',
      Body: 'ok',
      ContentType: 'text/plain',
    }),
  )
}

/**
 * Remove everything published under one key prefix.
 *
 * A film is not an object, it is a few thousand of them — the master playlist,
 * a playlist per rendition, an init segment each, and every `.m4s` besides. So
 * this lists and deletes rather than taking a filename, and it pages, because
 * a feature at six seconds a segment runs well past the thousand keys a single
 * list call returns.
 *
 * Deletes are batched a thousand at a time, which is the API's own ceiling.
 * Returns how many objects actually went, so the caller can say something
 * true rather than something hopeful.
 */
export async function deletePrefix(keyPrefix: string) {
  const client = s3()
  let removed = 0
  let token: string | undefined

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: env.r2.bucket,
        Prefix: `${keyPrefix}/`,
        ContinuationToken: token,
      }),
    )

    const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key! })).filter((o) => o.Key)
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: env.r2.bucket,
          Delete: { Objects: keys, Quiet: true },
        }),
      )
      removed += keys.length
    }

    /* Paging continues off the *listing*, which is why this reads the token
       back rather than assuming one pass emptied the prefix. */
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token)

  return removed
}
