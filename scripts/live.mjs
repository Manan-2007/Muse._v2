/**
 * Put the local server on the internet, and say exactly what to click.
 *
 * The API here runs on a laptop, which two people on two devices cannot both
 * reach — so it goes out through an ngrok tunnel. That part was already the
 * routine. What was not was everything that has to agree on the tunnel's
 * address afterwards: the deployed frontend, the browser extension, and the
 * server's own CORS list. Getting one of them wrong fails in a way that looks
 * like the feature is broken rather than the address is stale.
 *
 * So this starts the server and the tunnel together, reads the address ngrok
 * actually got rather than assuming it, and prints the two links that carry
 * it everywhere else. Nothing here needs to be typed twice.
 *
 *   npm run live
 */

import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = join(root, 'server', '.env')

/** ngrok's own local API, which is the only honest source for the address. */
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function has(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** The public URL for a tunnel pointing at our port, once ngrok has one. */
async function tunnelFor(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const body = await fetch(NGROK_API).then((r) => r.json())
      const match = (body.tunnels ?? []).find(
        (t) => t.public_url?.startsWith('https://') && t.config?.addr?.endsWith(`:${port}`),
      )
      if (match) return match.public_url
    } catch {
      /* Agent still starting. */
    }
    await wait(500)
  }
  return null
}

/**
 * Keep the server's allowlist honest about the frontends.
 *
 * Only ever adds. The extension ids in here were added by hand and are not
 * this script's to tidy up — and a list that quietly loses one is a room that
 * quietly stops working for whoever owned it.
 */
function ensureOrigins(...origins) {
  if (!existsSync(ENV_PATH)) return null

  const text = readFileSync(ENV_PATH, 'utf8')
  const line = text.match(/^CLIENT_ORIGIN=.*$/m)
  if (!line) return null

  const current = line[0]
    .replace(/^CLIENT_ORIGIN=/, '')
    .replace(/^["']|["']$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const missing = origins.filter((o) => o && !current.includes(o))
  if (missing.length === 0) return { changed: false, origins: current }

  const next = [...current, ...missing]
  writeFileSync(ENV_PATH, text.replace(line[0], `CLIENT_ORIGIN="${next.join(',')}"`))
  return { changed: true, origins: next, added: missing }
}

if (!has('ngrok')) {
  console.error('ngrok is not installed. `brew install ngrok`, then `ngrok config add-authtoken <token>`.')
  process.exit(1)
}

const PORT = 4000
const children = []
const stop = () => {
  for (const child of children) child.kill('SIGTERM')
}
process.on('SIGINT', () => {
  stop()
  process.exit(0)
})
process.on('exit', stop)

console.log('starting the API…')
children.push(
  spawn('npm', ['run', 'dev:server'], { cwd: root, stdio: 'inherit', env: process.env }),
)

/* Reuse a tunnel that is already up rather than fighting it for the port —
   ngrok refuses a second agent, and that failure reads as "the tunnel is
   broken" when in fact it is already working. */
let url = await tunnelFor(PORT, 2)
if (url) {
  console.log(`reusing the tunnel already running on ${url}`)
} else {
  console.log('opening the tunnel…')
  const args = ['http', String(PORT)]
  if (process.env.NGROK_DOMAIN) args.push('--domain', process.env.NGROK_DOMAIN)
  children.push(spawn('ngrok', args, { cwd: root, stdio: 'ignore' }))
  url = await tunnelFor(PORT)
}

if (!url) {
  console.error('\nngrok never reported a tunnel. Is the agent authenticated?')
  process.exit(1)
}

const app = process.env.HUDDLE_APP ?? 'https://huddle-sync.vercel.app'
const link = `${app}/?api=${encodeURIComponent(url)}`

const result = ensureOrigins(app)
if (result?.changed) {
  console.log(`\nadded to CLIENT_ORIGIN: ${result.added.join(', ')} — restart the API to apply`)
}

console.log(`
─────────────────────────────────────────────────────────────
  API          ${url}
  Open this    ${link}
─────────────────────────────────────────────────────────────

  Send that link to whoever is watching with you. Opening it once
  points their browser at this API and is remembered afterwards, so
  the plain address works from then on.

  Everyone watching needs the extension loaded, and their own
  chrome-extension://<id> added to CLIENT_ORIGIN in server/.env.
  The id is printed at the bottom of the extension's popup.
`)
