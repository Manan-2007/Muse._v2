import * as azure from './azure.service.js'
import type { EmbeddedImage } from './extract.service.js'

/**
 * Reading the pictures.
 *
 * A lecture handout whose every code sample is a screenshot is not a broken
 * upload; it is one of the commonest ways course material is actually
 * written. Until now those files reached the library, reported "searchable",
 * and contained almost nothing — the text extractor could only see the prose
 * around the images, so a question about the code in them had nothing to
 * draw on and quietly answered from the model's general knowledge instead.
 *
 * The chat deployment is already vision-capable, so this needs no new
 * dependency, no OCR binary and no second provider: the same `gpt-4o` that
 * writes the notes can read a screenshot of a `for` loop, and does it better
 * than classical OCR precisely because it knows what code looks like — it
 * gets indentation, brackets and `l` versus `1` right for reasons OCR has no
 * access to.
 *
 * What comes back is transcription, never description. "A diagram showing
 * inheritance" is worse than useless in a search index: it reads as content,
 * matches queries about inheritance, and then contributes nothing when it is
 * retrieved. The prompt below is mostly about refusing to do that.
 */

/**
 * How many pictures to read from one document.
 *
 * Each is a billed request against the same quota every generator shares, and
 * a slide deck can carry hundreds. Twenty is enough to cover the code in a
 * normal handout and small enough that one pathological upload cannot spend
 * an afternoon's quota on its own.
 */
const MAX_IMAGES = 20

/**
 * How many to send in a single request.
 *
 * More per request means fewer round trips, but one reply covering eight
 * pictures reliably starts merging them — the model writes about "the code"
 * as though the batch were one listing. Four keeps them distinct and still
 * cuts the request count by three quarters.
 */
const BATCH = 4

/** Above this, a picture is too big to be worth sending whole. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const SYSTEM = `You transcribe images taken from course material — lecture slides, handouts, textbook scans.

Return exactly what is written in the image, and nothing else.

RULES, IN ORDER OF IMPORTANCE

1. Transcribe, never describe. If the image is a screenshot of code, output that code, character for character, with its original indentation. If it is a table, output the table. If it is prose, output the prose. Never write "this image shows..." or "a diagram of..." — a description is worse than silence here, because it will be indexed as though it were content and then answer nobody's question.

2. Code must be exact. Preserve indentation, braces, semicolons, operators, casing and variable names precisely. Getting 'l' vs '1' or 'O' vs '0' wrong makes the transcription worse than nothing, because it looks correct. Wrap code in a fenced block with its language.

3. If an image carries no readable text — a photograph, a logo, decoration, a purely pictorial diagram with no labels — output the single word NOTHING for that image. Do not invent a caption. Do not describe it.

4. For a diagram that does have labels, output the labels and the relationships between them as short lines of text ("Animal -> Dog", "Animal -> Cat"), not as a paragraph about the diagram.

5. Do not add commentary, headings, explanations or summaries of your own. No "Here is the transcription". The output is the content itself.

Separate each image's transcription with a line containing only ---`

/** Available whenever the chat deployment is — same key, same endpoint. */
export function configured() {
  return azure.configured()
}

function dataUrl(image: EmbeddedImage) {
  return `data:${image.type};base64,${image.bytes.toString('base64')}`
}

/**
 * Transcribe what is written inside a document's pictures.
 *
 * Returns text ready to be appended to whatever the parser managed to read,
 * so it is chunked, embedded and retrieved exactly like the rest of the file.
 * There is deliberately no marker distinguishing it: a passage of code is a
 * passage of code, and a retrieval that treats it as second class because of
 * how it arrived would defeat the point of reading it.
 *
 * Failure is silent by design. This runs inside ingest, where the text that
 * *was* read is already worth having — losing the whole upload because the
 * vision half timed out would be a worse outcome than a document that is
 * merely as good as it used to be.
 */
export async function transcribe(images: EmbeddedImage[]): Promise<string> {
  if (!configured() || images.length === 0) return ''

  const usable = images.filter((image) => image.bytes.length <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES)
  if (usable.length === 0) return ''

  const passages: string[] = []

  for (let start = 0; start < usable.length; start += BATCH) {
    const batch = usable.slice(start, start + BATCH)
    try {
      const reply = await azure.chat(
        [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  batch.length === 1
                    ? 'Transcribe this image.'
                    : `Transcribe these ${batch.length} images, separated by ---, in order.`,
              },
              ...batch.map((image) => ({
                type: 'image_url' as const,
                /* High detail: the whole point is small text in a screenshot,
                   and the low-detail path downsamples exactly that away. */
                image_url: { url: dataUrl(image), detail: 'high' as const },
              })),
            ],
          },
        ],
        { temperature: 0, maxTokens: 4000 },
      )

      for (const piece of (reply.content ?? '').split(/^---$/m)) {
        const text = piece.trim()
        /* The model's own way of saying an image had nothing in it. Keeping
           these would fill the index with the word NOTHING. */
        if (!text || /^nothing$/i.test(text)) continue
        passages.push(text)
      }
    } catch {
      /* One bad batch does not spoil the rest — a rate limit part way through
         a deck should cost those four pictures, not all of them. */
    }
  }

  return passages.join('\n\n')
}
