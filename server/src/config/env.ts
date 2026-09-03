import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/* Prisma reads server/.env on its own; the app has to be told. */
const envPath = path.resolve(import.meta.dirname, '../../.env')
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath)
  } catch {
    /* Malformed .env — the checks below report what's missing. */
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in server/.env`)
  return value
}

/**
 * Origins allowed to call this API.
 *
 * Comma-separated, because a split deployment normally has at least two: the
 * production frontend and whatever preview URL is being tested against it.
 */
function origins(): string[] {
  const raw = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
  return raw
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export const env = {
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  clientOrigins: origins(),
  /**
   * True when the frontend is served from a different origin than this API.
   *
   * Flips the session cookie to `SameSite=None; Secure`, which is the only
   * combination a browser will send cross-site — and which *requires* HTTPS on
   * both ends. Note this is still not sufficient on its own: Safari blocks
   * third-party cookies outright, which is why the bearer token exists.
   */
  crossSite: process.env.CROSS_SITE === 'true',
  /**
   * Optional. Only YouTube *search* needs it — adding by link goes through the
   * public oEmbed endpoint, so the watch feature works without a key at all.
   */
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',

  /**
   * Cloudflare R2, where video actually lives.
   *
   * Serving a movie off this machine through a tunnel puts the room's playback
   * behind a home upload pipe: one 3GB file means a 21MB index every viewer
   * must read before the first frame, over a link shared by everyone watching.
   * R2 takes both problems away — the bytes sit on a CDN, and egress is free,
   * so the server's only job is to put them there once.
   *
   * Optional. Without it uploads stay on disk and are served locally, which is
   * fine for one person on localhost and is what the tests run against.
   */
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    endpoint: process.env.R2_ENDPOINT ?? '',
    /** Public bucket origin, no trailing slash — what viewers actually hit. */
    publicUrl: (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, ''),
  },

  /**
   * TURN relay, for calls between people on different networks.
   *
   * Optional in the sense that the app runs without it — but calls will only
   * connect when both ends can reach each other directly, which in practice
   * means "on the same wifi". There is no working credential-free public relay
   * any more, so this genuinely needs an account somewhere.
   */
  turn: {
    urls: (process.env.TURN_URL ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    username: process.env.TURN_USERNAME ?? '',
    credential: process.env.TURN_CREDENTIAL ?? '',
    /* Metered mints short-lived credentials from an API key — preferred, since
       what reaches the browser then expires on its own. */
    meteredApiKey: process.env.METERED_API_KEY ?? '',
    meteredDomain: process.env.METERED_DOMAIN ?? '',
  },

  /**
   * Azure OpenAI, for everything the Study page generates.
   *
   * Optional, and the whole feature says so rather than half-working: with no
   * key, Study still keeps subjects, resources and a timer, and every button
   * that would have called a model is disabled with the reason on it. A
   * generator that silently returns nothing is worse than one that is plainly
   * switched off.
   *
   * Two deployments on one resource — a chat model and an embedding model.
   * They are separate names on the same endpoint and key, which is why this is
   * one config group rather than two.
   */
  azure: {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT ?? '').replace(/\/$/, ''),
    apiKey: process.env.AZURE_OPENAI_API_KEY ?? '',
    /** Deployment name of the chat model — a GPT-4o deployment. */
    chatDeployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT ?? 'gpt-4o',
    /** Deployment name of the embedding model. */
    embeddingDeployment:
      process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ?? 'text-embedding-3-small',
    /* Pinned rather than floating: Azure's API surface changes between
       versions, and a deployment that starts answering differently because a
       default moved underneath it is a bad afternoon. */
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
  },

  /**
   * Speech, for narrating explainers.
   *
   * Same subscription key as the chat deployment above, because a
   * Cognitive Services multi-service resource carries both — verified
   * against this project's own key rather than assumed. It is a separate
   * config group only because it is reached at a different host, keyed by
   * region rather than by resource name.
   *
   * Region is derived from the OpenAI endpoint when it is not set
   * explicitly, since the two live on the same resource: an endpoint of
   * `https://name-eastus2.cognitiveservices.azure.com` is a resource in
   * eastus2, and asking somebody to write that out twice is asking them to
   * get it wrong once.
   */
  speech: {
    key: process.env.AZURE_SPEECH_KEY || (process.env.AZURE_OPENAI_API_KEY ?? ''),
    region:
      process.env.AZURE_SPEECH_REGION ||
      (process.env.AZURE_OPENAI_ENDPOINT ?? '').match(/-([a-z]+[0-9]*)\.cognitiveservices/)?.[1] ||
      '',
  },

  /**
   * Gemini, as the free rung on the embedding ladder.
   *
   * Chat and embeddings are asked of different providers by design, not by
   * accident — an Azure resource commonly carries a chat deployment with no
   * embedding deployment beside it, since the two are provisioned and billed
   * separately. Rather than block the whole feature on that second
   * deployment existing, embeddings alone fall back here, and further to a
   * model run in-process if even this is absent. Chat never falls back:
   * splitting that too would mean every generator's tone changing depending
   * on which key happened to be configured that day.
   */
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
  },

  /**
   * The code judge.
   *
   * Deliberately somebody else's machine. Running a stranger's code is the one
   * thing in this project worth refusing to do in-process: a judge service has
   * already solved the toolchains, the CPU and memory ceilings, and the
   * sandbox escapes, and doing it here would mean solving them again, less
   * well, for a feature that is not what the app is for.
   *
   * Optional. Without it, coding questions still generate and read — only the
   * run button is off.
   */
  judge: {
    /**
     * Base URL of a Judge0-compatible API.
     *
     * Defaults to the project's own public instance, so Run and Submit work
     * on a fresh checkout instead of being two permanently greyed buttons
     * that never say why. It is shared and rate limited, which is the honest
     * trade for needing no account: set `JUDGE_URL` to your own deployment
     * when a class is using this in earnest.
     *
     * Set it to an empty string to switch running off altogether — the
     * buttons then disable and say so, and problems can still be written and
     * read. That is the setting for anyone who would rather no code left the
     * machine at all.
     */
    url: (process.env.JUDGE_URL ?? 'https://ce.judge0.com').replace(/\/$/, ''),
    apiKey: process.env.JUDGE_API_KEY ?? '',
    /** RapidAPI-style host header, when the provider wants one. */
    apiHost: process.env.JUDGE_API_HOST ?? '',
  },
}

/** Name of the httpOnly cookie carrying the session token. */
export const SESSION_COOKIE = 'muse_session'
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30
export const SESSION_TTL = '30d'

export const ROOM_TYPES = ['friends', 'couple', 'study', 'family', 'team'] as const
export type RoomType = (typeof ROOM_TYPES)[number]

/**
 * Who can find a room, and who can walk in.
 *
 * `open` is listed on Discover and anyone signed in may join. `private` is
 * listed to nobody and the code is the only way in — holding it is the
 * permission, the same as an invite link.
 */
export const ROOM_VISIBILITIES = ['open', 'private'] as const
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number]
