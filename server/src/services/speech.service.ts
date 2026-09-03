import { env } from '../config/env.js'
import { HttpError } from '../utils/HttpError.js'
import { unreachable, unreachableMessage } from '../utils/reachability.js'

/**
 * Turning a line of a script into a line of speech.
 *
 * Azure's plain REST endpoint rather than the streaming SDK, deliberately.
 * The SDK exists to give word-by-word boundary events while audio streams,
 * which matters when one request narrates a whole lesson and the visuals have
 * to be cued from inside it. Here a beat is one short passage with one visual,
 * so the beat's own audio length is the only timing anyone needs — and that is
 * a number, not an event stream. One less dependency, one less protocol, and
 * nothing lost.
 */

/**
 * Voices worth offering.
 *
 * The multilingual ones are Azure's newer, markedly more natural line, and
 * they are the ones that survive being listened to for eight minutes. The
 * Indian English pair are here because this is a course taught in India and a
 * familiar accent is easier to follow, not as a novelty.
 */
export const VOICES = [
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew — warm, measured' },
  { id: 'en-US-AvaMultilingualNeural', label: 'Ava — clear, brisk' },
  { id: 'en-GB-RyanNeural', label: 'Ryan — British, formal' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat — Indian English' },
  { id: 'en-IN-NeerjaNeural', label: 'Neerja — Indian English' },
] as const

export const DEFAULT_VOICE = VOICES[0].id

export function configured() {
  return Boolean(env.speech.key && env.speech.region)
}

export function isVoice(id: string) {
  return VOICES.some((voice) => voice.id === id)
}

/**
 * How long to wait on one clip.
 *
 * A beat is a couple of sentences; the measured round trip is well under two
 * seconds. Fifteen is generous enough to absorb a slow moment and short
 * enough that a stalled lesson fails rather than hangs.
 */
const TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 900

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * XML-escape, because the narration goes inside an SSML document.
 *
 * A stray ampersand in "input & output" makes the whole request invalid XML,
 * and Azure rejects it with a 400 that says nothing about which character was
 * at fault. Cheaper to never send one.
 */
function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The SSML for one beat.
 *
 * Slightly slowed and pitched down a touch from the default, which reads as
 * lecturing rather than newsreading. The trailing pause is what stops two
 * consecutive clips running into each other when the player moves on.
 */
function ssml(text: string, voice: string) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}"><mstts:express-as style="narration-professional"><prosody rate="-4%">${escapeXml(text)}</prosody></mstts:express-as><break time="350ms"/></voice></speak>`
}

/** One beat's narration, as MP3 bytes. */
export async function speak(text: string, voice: string): Promise<Buffer> {
  if (!configured()) {
    throw HttpError.unavailable('Narration is not configured on this server.')
  }

  const target = `https://${env.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`
  let lastStatus = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(target, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.speech.key,
          'Content-Type': 'application/ssml+xml',
          /* 24kHz mono is the sweet spot for a speaking voice: audibly better
             than 16k on consonants, and a third the size of 48k for something
             nobody listens to on headphones for the fidelity. */
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'huddle-study',
        },
        body: ssml(text, voice),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (cause) {
      if (unreachable(cause)) {
        throw HttpError.unavailable(unreachableMessage('the speech service', target, cause))
      }
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt)
        continue
      }
      throw HttpError.unavailable('Could not reach the speech service.')
    }

    if (response.ok) return Buffer.from(await response.arrayBuffer())

    lastStatus = response.status
    /* 429 is the one that actually happens: a lesson is twenty or thirty
       clips in quick succession, which is exactly the shape of request a
       per-second quota is there to catch. */
    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt * 2)
        continue
      }
    }

    const detail = await response.text().catch(() => '')
    throw HttpError.badGateway(
      `The speech service refused the request (${response.status}). ${detail.slice(0, 160)}`,
    )
  }

  throw HttpError.unavailable(`Narration failed after ${MAX_ATTEMPTS} attempts (${lastStatus}).`)
}
