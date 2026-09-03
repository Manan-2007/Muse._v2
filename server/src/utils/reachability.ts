/**
 * Telling "the network hiccuped" apart from "there is no path to this host".
 *
 * Both arrive as a thrown `fetch`, and treating them the same is what makes a
 * misconfigured machine look like a flaky provider. A dropped connection is
 * worth another go a second later. A missing route is not — it will fail
 * identically on every attempt, so retrying only spends the person's time
 * before telling them something that points at the wrong thing.
 *
 * The distinction matters most when it is least obvious. A laptop whose
 * primary network service carries IPv6 but no working IPv4 reaches every
 * dual-stack host normally and fails on every IPv4-only one — which reads as
 * "that one provider is down" until somebody checks the routing table.
 */

/** Errors that mean the host cannot be reached at all, not that a try failed. */
const NO_ROUTE = new Set([
  /* No route to the network the address is on — the case above. */
  'ENETUNREACH',
  /* A route exists but the host itself is unreachable across it. */
  'EHOSTUNREACH',
  /* The name did not resolve. A wrong endpoint, or no DNS at all. */
  'ENOTFOUND',
])

/** The OS error code buried under a failed `fetch`, if there is one. */
function code(cause: unknown): string | null {
  if (!(cause instanceof Error)) return null
  const nested = (cause as { cause?: unknown }).cause
  const found = (nested as { code?: unknown })?.code ?? (cause as { code?: unknown }).code
  return typeof found === 'string' ? found : null
}

export function unreachable(cause: unknown) {
  const found = code(cause)
  return found !== null && NO_ROUTE.has(found)
}

/**
 * What to say about it.
 *
 * Names the host, because the useful next step is checking whether the
 * machine running this server can reach that address — and says so, rather
 * than leaving the reader to conclude the service is down.
 *
 * It also says *whose* machine, which matters more than it looks. This text
 * travels to a browser, and the person reading it is usually not sitting at
 * the server: they are in someone else's room, on someone else's laptop's
 * connection. "This machine has no route" reads, to them, as an accusation
 * about their own computer — so they go looking for a setting they do not
 * have, on a machine that was never the problem.
 */
export function unreachableMessage(what: string, target: string, cause?: unknown) {
  let host = target
  try {
    host = new URL(target).host
  } catch {
    /* Not a URL worth parsing — the caller's string will do. */
  }

  const where = `the server running this room has no network route to ${host}`
  const whose = `That is the server's own connection, not yours.`

  /*
   * Name the IPv4 case when it is the IPv4 case.
   *
   * `ENETUNREACH` against a literal v4 address is not a vague network
   * problem, it is one specific and very recoverable state: the machine is
   * up, DNS resolved, IPv6 works — and the host it is trying to reach only
   * publishes an A record. Every provider this server talks to is IPv4-only,
   * so a laptop that has drifted onto an IPv6-only link loses all of them at
   * once while every page in the browser keeps loading fine.
   *
   * Saying "no route" alone sends somebody to check whether the internet is
   * on, which it is. Saying "no IPv4 route" points at the thing to fix.
   */
  const address = describe(cause)
  if (address) {
    return `Could not reach ${what}: the server running this room has no IPv4 route, and ${host} is reachable only over IPv4 (${address}). ${whose} Putting that machine back on a network that carries IPv4 fixes it.`
  }

  return `Could not reach ${what}: ${where}. ${whose}`
}

/** The IPv4 address a failed connection was aimed at, when it says so. */
function describe(cause: unknown): string | null {
  if (!(cause instanceof Error)) return null
  const nested = (cause as { cause?: unknown }).cause
  const text = [(nested as { message?: unknown })?.message, cause.message]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
  /* e.g. "connect ENETUNREACH 20.62.58.5:443 - Local (0.0.0.0:52630)" — the
     first dotted quad is the destination, the local end is the parenthesised
     one and is not worth showing. */
  const found = /ENETUNREACH\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(text)
  return found?.[1] ?? null
}
