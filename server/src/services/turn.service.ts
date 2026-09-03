import { env } from '../config/env.js'

/**
 * ICE servers, handed to the client at call time.
 *
 * Served from here rather than baked into the frontend bundle for one blunt
 * reason: TURN credentials are credentials. Anything in a `VITE_` variable is
 * compiled into public JavaScript, so shipping a relay password that way
 * publishes it to everyone who loads the page — and relay bandwidth is metered
 * and billable.
 *
 * STUN alone lets two peers find each other when the network allows a direct
 * path. It cannot help when it doesn't: symmetric NAT, carrier-grade NAT on
 * mobile, and most corporate firewalls all refuse one. Those calls need a TURN
 * relay to carry the media, which is why `relay` below is reported honestly
 * instead of pretending STUN is enough.
 */

/** Public STUN. Verified reachable; costs nothing and needs no account. */
const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
]

export type IceConfig = {
  iceServers: { urls: string[]; username?: string; credential?: string }[]
  /** False when no relay is configured — cross-network calls will fail. */
  relay: boolean
}

/**
 * Metered hands out short-lived credentials from an API key.
 *
 * Preferred over static ones when available: the credentials the browser sees
 * expire, so a leaked bundle can't be used to burn someone else's quota
 * indefinitely.
 */
async function fromMetered(): Promise<IceConfig['iceServers'] | null> {
  if (!env.turn.meteredApiKey || !env.turn.meteredDomain) return null

  try {
    const response = await fetch(
      `https://${env.turn.meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.turn.meteredApiKey)}`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!response.ok) return null

    const body = (await response.json()) as {
      urls?: string | string[]
      username?: string
      credential?: string
    }[]

    const servers = (Array.isArray(body) ? body : [])
      .map((entry) => ({
        urls: typeof entry.urls === 'string' ? [entry.urls] : (entry.urls ?? []),
        username: entry.username,
        credential: entry.credential,
      }))
      .filter((entry) => entry.urls.length > 0)

    return servers.length > 0 ? servers : null
  } catch {
    /* Falls through to static credentials, then to STUN-only. */
    return null
  }
}

function fromStatic(): IceConfig['iceServers'] | null {
  const urls = env.turn.urls
  if (urls.length === 0) return null

  return [
    {
      urls,
      username: env.turn.username || undefined,
      credential: env.turn.credential || undefined,
    },
  ]
}

export async function iceConfig(): Promise<IceConfig> {
  const relayServers = (await fromMetered()) ?? fromStatic()

  return {
    iceServers: [{ urls: STUN_URLS }, ...(relayServers ?? [])],
    relay: relayServers !== null,
  }
}
