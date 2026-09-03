import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { PDFParse } from 'pdf-parse'

/**
 * Turning an uploaded document into text worth embedding.
 *
 * The cleaning here is not tidiness for its own sake. Every chunk that comes
 * out of this becomes one vector, and a vector is only as good as the text it
 * was made from: a passage where a third of the words are the running header
 * and the page number is a passage whose embedding is mostly about the header.
 * Retrieval then quietly returns the wrong pages and the model answers
 * confidently from them, which is the worst failure this feature has — wrong,
 * and cited.
 */

export type Extracted = {
  text: string
  pages: number
  /** Page breaks as offsets into `text`, so a chunk can name where it came from. */
  pageOffsets: number[]
  /**
   * Bytes of embedded pictures the reader could not read a word of.
   *
   * A worksheet whose questions are a screenshot extracts almost nothing and
   * reports success, which is the worst combination: the shelf says
   * "searchable", the student believes the course material is indexed, and
   * every lesson written from it is quietly ungrounded. Measuring the images
   * is what lets the library say so.
   */
  imageBytes?: number
}

/**
 * Lines that appear on nearly every page are furniture, not content.
 *
 * Three pages is the threshold because two can coincide — a heading repeated
 * once is a heading, repeated on every page it is a header. Compared with
 * digits stripped, so "Page 4" and "Page 5" count as the same furniture rather
 * than as two unrelated lines.
 */
function furniture(pages: string[]): Set<string> {
  if (pages.length < 3) return new Set()

  const seen = new Map<string, number>()
  for (const page of pages) {
    const lines = page.split('\n').map((line) => line.trim()).filter(Boolean)
    /*
     * Only the edges of a page — a sentence recurring mid-page is a refrain in
     * the text, and deleting it would be deleting content.
     *
     * Three deep rather than two: a header is often a stack rather than a
     * line. This document opens every page with a title, then a page number,
     * then a footer line carrying the course code — and a two-line window
     * caught the first two and left the third on all seven pages.
     */
    const edges = [...lines.slice(0, 3), ...lines.slice(-3)]
    for (const line of new Set(edges)) {
      const key = line.replace(/\d+/g, '#').toLowerCase()
      if (key.length < 3) continue
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }

  const threshold = Math.max(3, Math.floor(pages.length * 0.6))
  return new Set([...seen].filter(([, count]) => count >= threshold).map(([key]) => key))
}

function cleanPage(page: string, drop: Set<string>) {
  const kept: string[] = []

  for (const raw of page.split('\n')) {
    const line = raw.trim()
    if (!line) {
      kept.push('')
      continue
    }

    /* A page number on its own line, in any of the shapes they come in. */
    if (/^\d{1,4}$/.test(line)) continue
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) continue

    /* Table-of-contents leaders and rule lines carry no meaning at all once
       the layout they belonged to is gone. */
    if (/^[.\-_—–=*·•\s]{4,}$/.test(line)) continue

    if (drop.has(line.replace(/\d+/g, '#').toLowerCase())) continue

    kept.push(line)
  }

  return kept.join('\n')
}

/**
 * Put back words the PDF broke across a line.
 *
 * A hyphen with a newline directly after it and a lowercase letter following
 * is a typesetter's line wrap; a real hyphenated word never has one injected
 * mid-word. Keeping the check that tight is what stops "well-known" losing its
 * hyphen at the end of a line.
 */
function dehyphenate(text: string) {
  return text.replace(/(\w)-\n([a-z])/g, '$1$2')
}

function collapse(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Plain text and markdown need the whitespace pass and nothing else. */
function extractPlain(raw: string): Extracted {
  const text = collapse(dehyphenate(raw))
  return { text, pages: 1, pageOffsets: [0] }
}

async function extractPdf(buffer: Buffer): Promise<Extracted> {
  /* Released explicitly — the parser holds a worker, and a document that
     throws mid-parse would otherwise leave it running for the life of the
     process. Every ingest goes through here, so a leak per upload adds up. */
  const parser = new PDFParse({ data: buffer })
  let pages: string[]
  let total: number
  try {
    const parsed = await parser.getText()
    /* Per page, as the library reports it, rather than splitting the whole
       document on a separator — the page boundaries are what the header and
       footer detection below is looking across, and guessing at them from
       form feeds is how that detection quietly stops working. */
    pages = parsed.pages.map((page) => page.text ?? '')
    total = parsed.total || pages.length
  } finally {
    await parser.destroy().catch(() => undefined)
  }

  const drop = furniture(pages)

  const cleaned: string[] = []
  const pageOffsets: number[] = []
  let offset = 0

  for (const page of pages) {
    const body = collapse(dehyphenate(cleanPage(page, drop)))
    /* An empty page still needs its offset recorded, or every page after it
       is cited one number early. */
    pageOffsets.push(offset)
    if (body) {
      cleaned.push(body)
      offset += body.length + 2
    }
  }

  return { text: cleaned.join('\n\n'), pages: total, pageOffsets }
}


/* ── Everything that is not a PDF ─────────────────────────────────────────
 *
 * Word, PowerPoint and the OpenDocument pair are all a ZIP of XML, so one
 * reader and one tag-stripper cover the lot; EPUB is the same trick again
 * with a reading order to respect. What differs per format is only which
 * entries hold the words and which tags mean "new paragraph", so that is all
 * each extractor below actually says.
 *
 * The legacy binaries — .doc, .ppt, .xls — are deliberately not here. They
 * are OLE compound files with no honest pure-JS parser, and half-reading one
 * would produce a document full of field codes that embeds as nonsense and
 * retrieves as nonsense. Rejecting them with "save it as .docx" is the
 * better answer.
 */

/**
 * Total uncompressed bytes any one archive may expand to.
 *
 * A 40 MB upload cap says nothing about what is inside it — a zip of a
 * repeated byte expands by three orders of magnitude, and inflating that
 * takes the server down with it. Checked against the sizes in the archive's
 * own directory, before anything is decompressed.
 */
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024

/** How many bytes of pictures an office archive is carrying. */
function imageBytesIn(buffer: Buffer): number {
  try {
    let total = 0
    unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        if (/\/(media|images)\/[^/]+\.(png|jpe?g|gif|bmp|tiff?|webp|emf|wmf)$/i.test(entry.name)) {
          total += entry.originalSize
        }
        /* Nothing is actually inflated — the filter is only being used to walk
           the archive's own directory. */
        return false
      },
    })
    return total
  } catch {
    return 0
  }
}

/**
 * The pictures themselves, not just how many bytes of them there are.
 *
 * `imageBytesIn` above answers "is this document mostly images", which is
 * enough to warn somebody. It is not enough to do anything about it. A slide
 * deck whose every code sample is a screenshot is not a broken upload — it is
 * a completely ordinary way for course material to be written, and reading it
 * requires actually looking at the pictures.
 *
 * Deliberately unopinionated about what happens next: this hands back bytes,
 * and `vision.service.ts` decides what they say. Keeping the model out of the
 * parser means the parser stays synchronous, offline and testable.
 */
export type EmbeddedImage = { name: string; bytes: Buffer; type: string }

/**
 * Below this, a picture is furniture.
 *
 * Bullets, logos, rules and spacer pixels all live in the same folder as the
 * screenshots, and every one sent to a vision model costs a request to be told
 * it contains nothing. 8 KB is comfortably under any real screenshot of code
 * and comfortably over the decorations.
 */
const MEANINGFUL_IMAGE_BYTES = 8 * 1024

/** What a vision model will actually accept — EMF/WMF are vector, and not it. */
const READABLE_IMAGE = /\.(png|jpe?g|gif|bmp|webp)$/i

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
}

export function imagesIn(buffer: Buffer, limit = 40): EmbeddedImage[] {
  try {
    const found: EmbeddedImage[] = []
    const files = unzipSync(new Uint8Array(buffer), {
      filter: (entry) =>
        /\/(media|images)\/[^/]+$/i.test(entry.name) &&
        READABLE_IMAGE.test(entry.name) &&
        entry.originalSize >= MEANINGFUL_IMAGE_BYTES,
    })

    for (const [name, bytes] of Object.entries(files)) {
      const extension = name.split('.').pop()?.toLowerCase() ?? 'png'
      found.push({ name, bytes: Buffer.from(bytes), type: IMAGE_TYPES[extension] ?? 'image/png' })
    }

    /* Largest first: if there is a cap to hit, the biggest pictures are the
       ones most likely to be a page of code rather than a small diagram. */
    found.sort((a, b) => b.bytes.length - a.bytes.length)
    return found.slice(0, limit)
  } catch {
    return []
  }
}

/** Read the named entries out of a ZIP, as UTF-8 text. */
function openZip(buffer: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  let budget = MAX_UNZIPPED_BYTES

  const files = unzipSync(new Uint8Array(buffer), {
    filter: (entry) => {
      if (!wanted(entry.name)) return false
      budget -= entry.originalSize
      if (budget < 0) throw new Error('This archive expands to far more than it should.')
      return true
    },
  })

  const out = new Map<string, string>()
  const decoder = new TextDecoder('utf-8')
  for (const [name, bytes] of Object.entries(files)) out.set(name, decoder.decode(bytes))
  return out
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  deg: '°',
  times: '×',
  middot: '·',
}

function entities(text: string) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * XML or HTML to plain text.
 *
 * `breaks` names the tags that end a line of thought — everything else is
 * markup around words and is simply removed. Done with patterns rather than a
 * parser because the input is machine-written XML from a small set of
 * producers, and the only question being asked of it is where the paragraphs
 * are.
 */
function untag(markup: string, breaks: RegExp, hard?: RegExp) {
  let text = markup
  if (hard) text = text.replace(hard, '\n')
  return entities(
    text
      .replace(breaks, '\n\n')
      .replace(/<[^>]*>/g, '')
      /* A run split across formatting spans must not weld into one word. */
      .replace(/ /g, ' '),
  )
}

/** Entry names like `slide10.xml` must sort after `slide2.xml`, not before. */
function byNumber(a: string, b: string) {
  const digits = (name: string) => Number(name.match(/(\d+)\D*$/)?.[1] ?? 0)
  return digits(a) - digits(b) || a.localeCompare(b)
}

/**
 * Assemble sections into one document.
 *
 * Sections are what the format itself divides on — slides, chapters, sheets —
 * and they become the "pages" a retrieved passage is cited by, which is why
 * they are kept rather than concatenated blindly.
 */
function fromSections(sections: string[], imageBytes = 0): Extracted {
  const kept: string[] = []
  const pageOffsets: number[] = []
  let offset = 0

  for (const section of sections) {
    const body = collapse(dehyphenate(section))
    pageOffsets.push(offset)
    if (body) {
      kept.push(body)
      offset += body.length + 2
    }
  }

  return { text: kept.join('\n\n'), pages: sections.length || 1, pageOffsets, imageBytes }
}

function extractDocx(buffer: Buffer): Extracted {
  const imageBytes = imageBytesIn(buffer)
  const parts = openZip(buffer, (name) =>
    /^word\/(document|footnotes|endnotes)\d*\.xml$/.test(name),
  )

  /* Body first, then the notes — a footnote read in the middle of the
     sentence that referenced it is worse than one read at the end. */
  const order = [...parts.keys()].sort((a, b) =>
    Number(b.includes('document')) - Number(a.includes('document')) || a.localeCompare(b),
  )

  const text = order
    .map((name) =>
      untag(parts.get(name)!, /<\/w:(p|tbl)>/g, /<w:(br|cr|tab)\b[^>]*\/?>/g),
    )
    .join('\n\n')

  return fromSections([text], imageBytes)
}

function extractPptx(buffer: Buffer): Extracted {
  const imageBytes = imageBytesIn(buffer)
  const parts = openZip(buffer, (name) =>
    /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name),
  )

  const slides = [...parts.keys()].filter((name) => name.includes('/slides/')).sort(byNumber)

  return fromSections(
    slides.map((name) => {
      const number = name.match(/(\d+)\.xml$/)?.[1]
      const notes = parts.get(`ppt/notesSlides/notesSlide${number}.xml`)

      const body = untag(parts.get(name)!, /<\/a:p>/g, /<a:br\b[^>]*\/?>/g)
      /* Speaker notes are usually the sentence the slide's three words were an
         abbreviation of, so they are worth more to a search than the slide. */
      const spoken = notes ? untag(notes, /<\/a:p>/g) : ''

      return spoken.trim() ? `${body}\n\n${spoken}` : body
    }),
    imageBytes,
  )
}

/** OpenDocument text and presentations — LibreOffice, Google Docs exports. */
function extractOpenDocument(buffer: Buffer): Extracted {
  const imageBytes = imageBytesIn(buffer)
  const parts = openZip(buffer, (name) => name === 'content.xml')
  const content = parts.get('content.xml')
  if (!content) return { text: '', pages: 1, pageOffsets: [0] }

  const breaks = /<\/text:(p|h)>/g
  const hard = /<text:(line-break|tab)\b[^>]*\/?>/g

  /* A presentation divides into slides the same way a deck does; a document
     has no page structure in the XML at all and stays one section. */
  const slides = content.match(/<draw:page\b[\s\S]*?<\/draw:page>/g)
  if (slides?.length) return fromSections(slides.map((slide) => untag(slide, breaks, hard)), imageBytes)

  return fromSections([untag(content, breaks, hard)], imageBytes)
}

function extractEpub(buffer: Buffer): Extracted {
  const imageBytes = imageBytesIn(buffer)
  const parts = openZip(buffer, (name) => /\.(opf|x?html?|xml)$/i.test(name))

  /*
   * Spine order, not filename order.
   *
   * A book's chapters are named by the tool that built it, and those names
   * sort into an order that has nothing to do with reading it. The OPF is
   * where the actual sequence is written down.
   */
  const opfName = [...parts.keys()].find((name) => name.endsWith('.opf'))
  const opf = opfName ? parts.get(opfName)! : ''
  const root = opfName?.includes('/') ? opfName.slice(0, opfName.lastIndexOf('/') + 1) : ''

  const manifest = new Map<string, string>()
  for (const item of opf.match(/<item\b[^>]*>/g) ?? []) {
    const id = item.match(/\bid="([^"]+)"/)?.[1]
    const href = item.match(/\bhref="([^"]+)"/)?.[1]
    if (id && href) manifest.set(id, decodeURIComponent(root + href))
  }

  const spine = (opf.match(/<itemref\b[^>]*>/g) ?? [])
    .map((ref) => ref.match(/\bidref="([^"]+)"/)?.[1])
    .map((id) => (id ? manifest.get(id) : undefined))
    .filter((name): name is string => Boolean(name && parts.has(name)))

  /* No usable spine — a malformed book, or one whose OPF this did not find.
     Reading it in name order is worse than not reading it at all only if the
     order mattered more than the words, and it does not. */
  const chapters = spine.length
    ? spine
    : [...parts.keys()].filter((name) => /\.x?html?$/i.test(name)).sort(byNumber)

  return fromSections(chapters.map((name) => htmlToText(parts.get(name) ?? '')), imageBytes)
}

function extractXlsx(buffer: Buffer): Extracted {
  const imageBytes = imageBytesIn(buffer)
  const parts = openZip(buffer, (name) =>
    /^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(name),
  )

  /* Cell values are indices into one shared string table — the same word
     written in a thousand cells is stored once. Without this a spreadsheet
     extracts as a grid of integers. */
  const shared = [...(parts.get('xl/sharedStrings.xml')?.matchAll(/<si>([\s\S]*?)<\/si>/g) ?? [])].map(
    (match) => untag(match[1]!, /$^/g).replace(/\s+/g, ' ').trim(),
  )

  const names = [...(parts.get('xl/workbook.xml')?.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g) ?? [])].map(
    (match) => entities(match[1]!),
  )

  const sheets = [...parts.keys()].filter((name) => name.includes('/worksheets/')).sort(byNumber)

  return fromSections(
    sheets.map((name, at) => {
      const rows = [...(parts.get(name)!.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g) ?? [])].map((row) =>
        [...row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
          .map(([, attrs, body]) => {
            const value = body!.match(/<v>([\s\S]*?)<\/v>/)?.[1]
            /* t="s" means the value is a shared-string index; t="inlineStr"
               keeps its text in the cell. Anything else is a literal. */
            if (/\bt="s"/.test(attrs!)) return shared[Number(value)] ?? ''
            if (/\bt="inlineStr"/.test(attrs!)) return untag(body!, /$^/g).trim()
            return value ? entities(value) : ''
          })
          .filter(Boolean)
          .join(' · '),
      )

      const heading = names[at] ? `${names[at]}\n\n` : ''
      return heading + rows.filter(Boolean).join('\n')
    }),
    imageBytes,
  )
}

function htmlToText(markup: string) {
  return untag(
    markup
      /* Dropped whole, contents and all — a stylesheet embedded in the page
         is thousands of words of selectors that would swamp the prose. */
      .replace(/<(script|style|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' '),
    /<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi,
    /<(br|hr)\b[^>]*\/?>/gi,
  )
}

/**
 * Rich text, reduced to the text.
 *
 * RTF is a stream of control words around the words themselves. This drops
 * the ones that carry no text at all — font tables, colour tables, embedded
 * pictures — then removes the rest, which is enough for a document somebody
 * wrote in a word processor and saved in the wrong format.
 */
function rtfToText(raw: string) {
  return raw
    /* A destination group is `{\fonttbl…}` or `{\*\fonttbl…}` — the optional
       `\*` is what marks a group a reader may skip, and requiring it leaves
       the font table's own names sitting in the middle of the prose. */
    .replace(/\{\\(?:\*\\)?(?:fonttbl|colortbl|stylesheet|listtable|info|pict|object|themedata)[\s\S]*?\}\s*\}?/g, ' ')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\s?\??/g, (_, code: string) => String.fromCodePoint(Number(code) & 0xffff))
    .replace(/\\(par|line|page)\b/g, '\n')
    .replace(/\\(tab)\b/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
    .replace(/[{}]/g, '')
}

/**
 * Which family a file belongs to.
 *
 * Decided on the extension first and the declared type second, because the
 * type a browser attaches is not reliable: the same .docx arrives as the
 * OOXML type from Chrome on one machine, as application/zip on another, and
 * as application/octet-stream from a few file managers. The extension is what
 * the person actually named the thing.
 */
type Family = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'opendocument' | 'epub' | 'html' | 'rtf' | 'plain'

const BY_EXTENSION: Record<string, Family> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
  '.odt': 'opendocument',
  '.odp': 'opendocument',
  '.ods': 'opendocument',
  '.epub': 'epub',
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  '.rtf': 'rtf',
  '.txt': 'plain',
  '.text': 'plain',
  '.md': 'plain',
  '.markdown': 'plain',
  '.csv': 'plain',
  '.tsv': 'plain',
  '.log': 'plain',
  '.json': 'plain',
}

const BY_MIME: Record<string, Family> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'opendocument',
  'application/vnd.oasis.opendocument.presentation': 'opendocument',
  'application/vnd.oasis.opendocument.spreadsheet': 'opendocument',
  'application/epub+zip': 'epub',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
}

export function familyOf(fileName: string, mimeType: string): Family {
  return (
    BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? BY_MIME[mimeType.toLowerCase()] ?? 'plain'
  )
}

/**
 * Read a file into clean text.
 *
 * Returns empty text rather than throwing when a document has no words in it —
 * a scan, or a deck that is entirely images, is a normal thing for somebody to
 * upload, and the caller needs to tell that apart from a corrupt file so it
 * can say which one happened.
 */
/**
 * The embedded pictures in a file, for the formats that carry them plainly.
 *
 * Office formats are ZIPs, so their images are simply files inside and come
 * out exactly as they went in. A PDF's are not: they live in the object graph
 * behind filters, and getting at them means a renderer rather than an unzip —
 * so a scanned PDF is still beyond this, and says so rather than quietly
 * returning nothing as though it had looked.
 */
export async function imagesFrom(filePath: string, mimeType: string): Promise<EmbeddedImage[]> {
  const family = familyOf(filePath, mimeType)
  if (!['docx', 'pptx', 'xlsx', 'opendocument', 'epub'].includes(family)) return []
  return imagesIn(await readFile(filePath))
}

export async function extract(filePath: string, mimeType: string): Promise<Extracted> {
  const buffer = await readFile(filePath)

  switch (familyOf(filePath, mimeType)) {
    case 'pdf':
      return extractPdf(buffer)
    case 'docx':
      return extractDocx(buffer)
    case 'pptx':
      return extractPptx(buffer)
    case 'xlsx':
      return extractXlsx(buffer)
    case 'opendocument':
      return extractOpenDocument(buffer)
    case 'epub':
      return extractEpub(buffer)
    case 'html':
      return fromSections([htmlToText(buffer.toString('utf8'))])
    case 'rtf':
      return fromSections([rtfToText(buffer.toString('utf8'))])
    default:
      return extractPlain(buffer.toString('utf8'))
  }
}

/**
 * Split text into passages to embed.
 *
 * Paragraph-first, because a paragraph is already the author's own idea of one
 * idea, and a cut through the middle of one produces two passages that each
 * half-say something. Only when a single paragraph is longer than the ceiling
 * does this fall back to cutting it at sentence boundaries.
 *
 * Sizes are in characters, not tokens — roughly four characters to a token for
 * English prose, so the ~2000/200 here is about the 500/50 tokens the design
 * calls for. Counting real tokens would mean shipping a tokeniser to make a
 * decision that is this insensitive to being slightly off.
 */
const CHUNK_CHARS = 2000
const OVERLAP_CHARS = 200

export type Chunk = { index: number; text: string; page: number | null }

function pageFor(offset: number, pageOffsets: number[]) {
  if (pageOffsets.length <= 1) return null
  /* The last page whose start is at or before this offset. */
  let page = 1
  for (let i = 0; i < pageOffsets.length; i += 1) {
    if ((pageOffsets[i] ?? 0) <= offset) page = i + 1
    else break
  }
  return page
}

export function chunk(extracted: Extracted): Chunk[] {
  const { text, pageOffsets } = extracted
  if (!text.trim()) return []

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks: Chunk[] = []

  let buffer = ''
  let bufferStart = 0
  let cursor = 0

  const flush = () => {
    const body = buffer.trim()
    if (!body) return
    chunks.push({ index: chunks.length, text: body, page: pageFor(bufferStart, pageOffsets) })
    /* Carry the tail forward, so an idea that straddles the join is present in
       both neighbours rather than invisible to each of them. */
    buffer = body.length > OVERLAP_CHARS ? body.slice(-OVERLAP_CHARS) : body
    bufferStart = cursor
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      /* One paragraph longer than a whole chunk — cut it at sentence ends. */
      const sentences = paragraph.match(/[^.!?]+[.!?]+|\S+$/g) ?? [paragraph]
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > CHUNK_CHARS) flush()
        buffer += (buffer ? ' ' : '') + sentence.trim()
        cursor += sentence.length
      }
      continue
    }

    if (buffer.length + paragraph.length > CHUNK_CHARS) flush()
    buffer += (buffer ? '\n\n' : '') + paragraph
    cursor += paragraph.length + 2
  }

  const tail = buffer.trim()
  if (tail && !chunks.some((entry) => entry.text === tail)) {
    chunks.push({ index: chunks.length, text: tail, page: pageFor(bufferStart, pageOffsets) })
  }

  return chunks
}
