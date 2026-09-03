import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'

import { HttpError } from '../utils/HttpError.js'

/**
 * Uploaded video, stored on disk.
 *
 * A file the user picks locally cannot simply be played by the room: an object
 * URL only exists in the browser that made it, so everyone else would see a
 * dead link. For "watch this together" to mean anything the bytes have to leave
 * the machine, which is what this is for.
 *
 * Disk, not the database. SQLite would happily take a 700MB blob and then make
 * every unrelated query slower for the privilege.
 */

/**
 * Where uploaded media lives.
 *
 * Beside the source by default, which is right for development — the folder
 * is in the repo, and dropping a file into it is how the library gets
 * populated by hand. Overridable because a deployed server usually cannot
 * keep it there: containers rebuild their filesystem on every release, so
 * anything worth keeping has to sit on a mounted volume somewhere else, and
 * a path baked in at build time cannot point at one.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(import.meta.dirname, '../../uploads')
export const UPLOAD_ROUTE = '/uploads'

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

/** What a browser can actually play back in a `<video>` element. */
const PLAYABLE = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-m4v',
])

/**
 * What a browser can play in an `<audio>` element.
 *
 * Kept apart from the video list because the two upload routes accept
 * different things: dropping an MP3 into the watch queue is a mistake worth
 * catching, and so is dropping a film into the listening queue.
 *
 * FLAC is in here and AAC-in-ADTS is not, for the same reason: what matters is
 * whether the browsers people actually use will decode it, not whether the
 * container is respectable.
 */
const PLAYABLE_AUDIO = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'audio/x-flac',
])

/**
 * What the study shelf will take.
 *
 * Everything here is something the extractor can get words out of, because a
 * document that cannot be read is a document the whole feature can do nothing
 * with — it would upload, sit there, and quietly fail to answer any question
 * asked of it. `extract.service.ts` is the other half of this list, and the
 * two have to agree.
 *
 * The extension is the authority, not the declared type. The same .docx
 * arrives as the OOXML type from one browser, as application/zip from
 * another, and as application/octet-stream from a few file managers — a gate
 * built on the type alone rejects perfectly good coursework depending on
 * which machine it was dragged from. The type is still checked, as a second
 * way in for a file whose name lost its suffix.
 */
const STUDY_DOC_EXTENSIONS =
  /^\.(pdf|docx|pptx|xlsx|odt|odp|ods|epub|rtf|html?|xhtml|txt|text|md|markdown|csv|tsv|log|json)$/

const STUDY_DOC_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/epub+zip',
  'application/rtf',
  'text/rtf',
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
])

/**
 * The formats people most often try that this genuinely cannot read.
 *
 * Named individually because "unsupported" sends somebody away to guess,
 * where "save it as .docx" is a thing they can go and do in thirty seconds.
 * These are OLE compound binaries with no honest pure-JS parser, and
 * half-reading one produces a document full of field codes that embeds as
 * nonsense and retrieves as nonsense.
 */
const LEGACY_OFFICE: Record<string, string> = {
  '.doc': 'Word',
  '.ppt': 'PowerPoint',
  '.xls': 'Excel',
}

function docExtension(originalName: string) {
  return path.extname(originalName).toLowerCase()
}

function isStudyDoc(file: Express.Multer.File) {
  return (
    STUDY_DOC_EXTENSIONS.test(docExtension(file.originalname)) ||
    STUDY_DOC_TYPES.has(file.mimetype.toLowerCase())
  )
}

const MAX_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Marks a file as still arriving.
 *
 * An upload is written under a dot-prefixed `.part` name and only renamed into
 * place once the whole request has come through. The two halves of that name
 * both earn their keep: `listLibrary` already skips dotfiles, so a transfer in
 * flight can never appear in the library — and the suffix makes a leftover
 * obviously junk rather than a video someone deliberately dropped in.
 */
const PART_SUFFIX = '.part'
const inProgressName = (final: string) => `.${final}${PART_SUFFIX}`
const finalName = (part: string) => part.replace(/^\./, '').replace(/\.part$/, '')

/** Absolute path each request is currently writing to, for cleanup on abort. */
const partials = new WeakMap<Request, string>()

const EXTENSIONS = {
  video: /^\.(mp4|webm|ogv|ogg|mov|m4v)$/,
  audio: /^\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/,
  doc: STUDY_DOC_EXTENSIONS,
}

/* Where an odd extension lands. Falling back to the family's most universal
   container rather than refusing: the file has already been through
   `fileFilter`, so a missing suffix is a naming quirk, not a rejection. */
const FALLBACK = { video: '.mp4', audio: '.mp3', doc: '.txt' } as const

/*
 * For documents the fallback consults the declared type first.
 *
 * The extension is not decoration here — it is what the extractor dispatches
 * on. A PDF dragged in without one would otherwise be stored as `.txt` and
 * then read as text, which produces a page of binary and a resource that
 * fails for a reason no one could guess from the file.
 */
const DOC_FALLBACK: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/epub+zip': '.epub',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'text/html': '.html',
  'application/xhtml+xml': '.html',
}

/**
 * Storage for one kind of upload.
 *
 * Per kind rather than one shared store, because the stored name has to carry
 * the right extension and the only honest way to know which family a file
 * belongs to is which endpoint it arrived at. Inferring it from the mimetype
 * instead is how a .docx that a file manager labelled
 * application/octet-stream ends up saved as somebody's .mp4.
 */
function storageFor(kind: 'video' | 'audio' | 'doc') {
  return multer.diskStorage({
    destination: (_req, _file, done) => done(null, UPLOAD_DIR),
    filename: (req, file, done) => {
      /*
       * Never trust the supplied name for the path. A crafted `originalname`
       * containing `../` would otherwise write wherever it liked; the
       * extension is the only part worth keeping, and it is whitelisted.
       */
      const ext = path.extname(file.originalname).toLowerCase()
      const safeExt = EXTENSIONS[kind].test(ext)
        ? ext
        : kind === 'doc'
          ? (DOC_FALLBACK[file.mimetype.toLowerCase()] ?? FALLBACK.doc)
          : FALLBACK[kind]
      const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

      const name = inProgressName(`${unique}${safeExt}`)
      /* Recorded here because multer only hands back `req.file` on success,
         and the failure this protects against is precisely the one where it
         never does. */
      partials.set(req, path.join(UPLOAD_DIR, name))
      done(null, name)
    },
  })
}

const videoUpload = multer({
  storage: storageFor('video'),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (PLAYABLE.has(file.mimetype)) return done(null, true)
    done(
      HttpError.badRequest(
        "That file type can't be played in a browser. Use MP4, WebM, or MOV.",
      ),
    )
  },
})

/* A song is not a film, so the ceiling isn't a film's either — 2GB of "audio"
   is a mistake or an attack, not an album track. */
const MAX_AUDIO_BYTES = 200 * 1024 * 1024

const audioUpload = multer({
  storage: storageFor('audio'),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (PLAYABLE_AUDIO.has(file.mimetype)) return done(null, true)
    done(
      HttpError.badRequest(
        "That file type can't be played in a browser. Use MP3, M4A, FLAC, WAV, or OGG.",
      ),
    )
  },
})

/**
 * Accept one video, and clean up after it if it never fully arrives.
 *
 * A cancelled upload — closed tab, dropped wifi, someone changing their mind
 * on a 2GB file — leaves multer holding a stream it will never finish. Nothing
 * in the library layer can tell those bytes apart from a real video: the file
 * has a plausible size and a playable extension, and it sits there offering
 * itself as something to watch and then failing halfway through.
 *
 * `close` without a finished response is exactly the abort case; a request
 * that made it to a reply — success, rejected type, too large — has either
 * been promoted by `finishUpload` or already cleaned up by multer.
 */
export function receiveVideo(req: Request, res: Response, next: NextFunction) {
  discardPartialOnAbort(req, res)
  videoUpload.single('video')(req, res, next)
}

/** The same contract for audio — see `receiveVideo`. */
export function receiveAudio(req: Request, res: Response, next: NextFunction) {
  discardPartialOnAbort(req, res)
  audioUpload.single('audio')(req, res, next)
}

/*
 * A syllabus is not a film, and neither is a textbook.
 *
 * Well under the audio ceiling, let alone video's: every one of these has to
 * be read, split and embedded, and a 200MB PDF is thousands of paid embedding
 * calls and several minutes of waiting for something nobody meant to upload.
 */
const MAX_DOC_BYTES = 40 * 1024 * 1024

const docUpload = multer({
  storage: storageFor('doc'),
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (isStudyDoc(file)) return done(null, true)

    const legacy = LEGACY_OFFICE[docExtension(file.originalname)]
    done(
      HttpError.badRequest(
        legacy
          ? `Old ${legacy} files can't be read. Open it and save as .${legacy === 'Word' ? 'docx' : legacy === 'PowerPoint' ? 'pptx' : 'xlsx'}, then upload that.`
          : "That file can't be read for studying. PDF, Word, PowerPoint, Excel, OpenDocument, EPUB, HTML, RTF, Markdown and plain text all work.",
      ),
    )
  },
})

/** The same contract again, for something to study from — see `receiveVideo`. */
export function receiveDocument(req: Request, res: Response, next: NextFunction) {
  discardPartialOnAbort(req, res)
  docUpload.single('document')(req, res, next)
}

function discardPartialOnAbort(req: Request, res: Response) {
  res.on('close', () => {
    if (res.writableFinished) return
    const partial = partials.get(req)
    if (!partial) return
    partials.delete(req)
    void rm(partial, { force: true }).catch(() => undefined)
  })
}

/**
 * Promote a completed upload to its real name.
 *
 * Until this runs the file is hidden and unservable, which is the point — the
 * rename is the moment it becomes a video, and it is atomic.
 */
export async function finishUpload(req: Request, file: Express.Multer.File) {
  const name = finalName(file.filename)
  await rename(path.join(UPLOAD_DIR, file.filename), path.join(UPLOAD_DIR, name))
  partials.delete(req)
  return name
}

/** Discard an upload that arrived but isn't going to be kept. */
export async function discardUpload(req: Request, file: Express.Multer.File) {
  partials.delete(req)
  await rm(path.join(UPLOAD_DIR, file.filename), { force: true }).catch(() => undefined)
}

/*
 * Leftovers from a crash.
 *
 * The abort handler covers a request that dies; it cannot cover the process
 * dying underneath it. Nothing can be in flight at startup, so anything still
 * marked in-progress here is unambiguously dead.
 */
try {
  for (const name of readdirSync(UPLOAD_DIR)) {
    if (name.endsWith(PART_SUFFIX)) rmSync(path.join(UPLOAD_DIR, name), { force: true })
  }
} catch {
  /* Unreadable uploads folder is the library's problem to report, not a
     reason to refuse to boot. */
}

/** Human-readable size cap, so the client can say the limit rather than guess. */
export const MAX_UPLOAD_MB = Math.round(MAX_BYTES / (1024 * 1024))

/**
 * Containers a `<video>` element will actually accept.
 *
 * `.mkv` and `.avi` are deliberately absent. They are perfectly good
 * containers and browsers largely refuse them anyway — Safari flatly, the
 * others unreliably — so treating them as playable would produce a file that
 * appears in the list and then silently fails for one person in the room.
 */
const PLAYABLE_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)$/i
/** Recognised as video, so a dropped-in file can be listed and explained. */
const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi|wmv|flv|ts|m2ts)$/i

export type LibraryEntry = {
  /** Filename on disk, which is also the id — the directory is the source of truth. */
  file: string
  title: string
  /** Server-relative path, ready for the queue. */
  ref: string
  bytes: number
  /** False for containers no browser will play; the client says why. */
  playable: boolean
  /**
   * False when an MP4 keeps its index at the end of the file.
   *
   * Nothing is wrong with the video — it simply cannot *start* until the
   * browser has the `moov` atom, and if that sits behind a multi-gigabyte
   * `mdat` the player stalls on a file that looks perfectly fine in the list.
   * Surfacing it is the difference between a one-line `ffmpeg` fix and an
   * afternoon of blaming the network.
   */
  fastStart: boolean
  modifiedAt: number
}

/** MP4-family containers, the only ones with a `moov` atom to be misplaced. */
const MP4_EXT = /\.(mp4|mov|m4v)$/i

/**
 * Whether an MP4's index sits at the front, where a streaming player needs it.
 *
 * Walks the top-level atoms — each is an 8-byte header naming itself and its
 * length, so this seeks rather than reads, and costs a handful of 16-byte
 * reads no matter how large the file is. Whichever of `moov`/`mdat` appears
 * first decides it.
 *
 * Anything unreadable or not MP4 answers `true`: a false alarm on a working
 * file is worse than staying quiet, because the warning is only useful if it
 * always means something.
 */
/**
 * How long the index check may take before it is abandoned.
 *
 * It normally costs two 16-byte reads. But it is the only part of listing a
 * folder that touches file *contents*, so it is the part that can stall — a
 * disk waking, a network volume, an indexer holding the file — and a stalled
 * read here left the whole library endpoint hanging with no response at all,
 * which the UI could only render as a spinner that never stopped.
 *
 * Answering "assume it's fine" after a second is strictly better: the flag is
 * only ever a hint shown next to a file, and a wrong hint is worth far less
 * than a page that never loads.
 */
const FAST_START_TIMEOUT_MS = 1000

async function hasFastStart(fullPath: string): Promise<boolean> {
  if (!MP4_EXT.test(fullPath)) return true

  return Promise.race([
    readFastStart(fullPath),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), FAST_START_TIMEOUT_MS)),
  ])
}

async function readFastStart(fullPath: string): Promise<boolean> {

  const { open } = await import('node:fs/promises')

  let handle
  try {
    handle = await open(fullPath, 'r')
    const { size } = await handle.stat()
    const header = Buffer.alloc(16)

    for (let offset = 0; offset + 8 <= size; ) {
      const { bytesRead } = await handle.read(header, 0, 16, offset)
      if (bytesRead < 8) return true

      const type = header.toString('ascii', 4, 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false

      let length = header.readUInt32BE(0)
      /* 1 means the real 64-bit length follows the type; 0 means "to EOF",
         which can only be the last atom and so settles nothing. */
      if (length === 1) {
        if (bytesRead < 16) return true
        length = Number(header.readBigUInt64BE(8))
      } else if (length === 0) {
        return true
      }

      if (length < 8) return true
      offset += length
    }
  } catch {
    return true
  } finally {
    await handle?.close().catch(() => undefined)
  }

  return true
}

function prettyTitle(file: string) {
  return (
    path
      .parse(file)
      .name.replace(/[._]+/g, ' ')
      /* Upload-generated names look like `mslqfvrt-98vy5ew8` — leave those
         alone rather than mangling them into fake words. */
      .trim() || file
  )
}

/**
 * Everything sitting in the uploads folder.
 *
 * Read from disk on request rather than tracked in the database, because the
 * folder *is* the interface: dropping a file in with Finder or `scp` should
 * make it appear, and deleting it should make it vanish, with nothing to keep
 * in sync and no rows left pointing at files that no longer exist.
 */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const { readdir, stat } = await import('node:fs/promises')

  let names: string[]
  try {
    names = await readdir(UPLOAD_DIR)
  } catch {
    return []
  }

  const entries = await Promise.all(
    names
      .filter((name) => !name.startsWith('.') && VIDEO_EXT.test(name))
      .map(async (name) => {
        try {
          const fullPath = path.join(UPLOAD_DIR, name)
          const info = await stat(fullPath)
          if (!info.isFile()) return null

          const playable = PLAYABLE_EXT.test(name)

          return {
            file: name,
            title: prettyTitle(name),
            /* `encodeURIComponent` on the name only — a movie called
               "Blade Runner (1982).mp4" is a perfectly ordinary thing to drop
               in, and spaces and brackets have to survive the URL. */
            ref: `${UPLOAD_ROUTE}/${encodeURIComponent(name)}`,
            bytes: info.size,
            playable,
            /* Only worth asking about a file that could otherwise play. */
            fastStart: playable ? await hasFastStart(fullPath) : true,
            modifiedAt: info.mtimeMs,
          } satisfies LibraryEntry
        } catch {
          return null
        }
      }),
  )

  /* Newest first: the thing you just dropped in is the thing you want. */
  return entries
    .filter((entry): entry is LibraryEntry => entry !== null)
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Audio containers a browser will decode in an `<audio>` element. */
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i

export type AudioLibraryEntry = {
  file: string
  title: string
  ref: string
  bytes: number
  modifiedAt: number
}

/**
 * Audio sitting in the same uploads folder.
 *
 * Separate from `listLibrary` rather than a flag on it: the two are read by
 * different screens, and a single list would mean the music page filtering out
 * films and the watch page filtering out songs on every request. There is also
 * no `fastStart` question to ask here — audio files carry no `moov` atom worth
 * misplacing at these sizes.
 */
export async function listAudioLibrary(): Promise<AudioLibraryEntry[]> {
  const { readdir, stat } = await import('node:fs/promises')

  let names: string[]
  try {
    names = await readdir(UPLOAD_DIR)
  } catch {
    return []
  }

  const entries = await Promise.all(
    names
      .filter((name) => !name.startsWith('.') && AUDIO_EXT.test(name))
      .map(async (name) => {
        try {
          const info = await stat(path.join(UPLOAD_DIR, name))
          if (!info.isFile()) return null

          return {
            file: name,
            title: prettyTitle(name),
            ref: `${UPLOAD_ROUTE}/${encodeURIComponent(name)}`,
            bytes: info.size,
            modifiedAt: info.mtimeMs,
          } satisfies AudioLibraryEntry
        } catch {
          return null
        }
      }),
  )

  return entries
    .filter((entry): entry is AudioLibraryEntry => entry !== null)
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}
