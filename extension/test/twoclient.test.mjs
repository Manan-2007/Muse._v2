/**
 * Two people, one room, both "on Netflix" — the actual thing being shipped.
 *
 * Simulates two extension workers against the real running server: both join
 * the same room's stage, one announces a title, one presses play, and we check
 * the other's computed target position tracks it. This is the scenario the
 * user is about to test across two devices.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')

/* Point at a deployed API with HUDDLE_API to prove the same things there. */
const BASE = process.env.HUDDLE_API ?? 'http://localhost:4000'
/* Unique per run, so running it twice does not collide on an email. */
const STAMP = String(process.hrtime.bigint())
const results = []
const check = (n, p, d = '') => { results.push({ n, p, d }); }

async function makeUser(email, name) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'twoclienttest123', name }),
  }).then(r => r.json())
  if (!r.token) throw new Error('register failed: ' + JSON.stringify(r))
  return r.token
}

const tokenA = await makeUser(`twoclient-a-${STAMP}@example.com`, 'Person A')
const tokenB = await makeUser(`twoclient-b-${STAMP}@example.com`, 'Person B')

const room = await fetch(`${BASE}/api/rooms`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
  body: JSON.stringify({ name: 'Two Client Room', type: 'friends' }),
}).then(r => r.json())
const roomId = room.room.id
const code = room.room.slug

// B joins by code, exactly as the extension's resolveRoom() does
const joined = await fetch(`${BASE}/api/rooms/join`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
  body: JSON.stringify({ code }),
}).then(r => r.json())
check('B can join A\'s room by code', joined?.room?.id === roomId, JSON.stringify(joined).slice(0,120))

function connect(token, label) {
  const socket = io(BASE, { path: '/socket.io', transports: ['websocket'], auth: { token } })
  const states = []
  socket.on('watch:state', (s) => { if (s.roomId === roomId) states.push(s) })
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve({ socket, states, label }))
    socket.on('connect_error', reject)
    setTimeout(() => reject(new Error(label + ' timed out')), 6000)
  })
}

const A = await connect(tokenA, 'A')
const B = await connect(tokenB, 'B')
check('both extension sockets authenticate', true)

const settle = (ms = 500) => new Promise(r => setTimeout(r, ms))

A.socket.emit('watch:open', { roomId })
B.socket.emit('watch:open', { roomId })
await settle(700)
check('both joined the stage', A.states.length > 0 && B.states.length > 0,
  `A=${A.states.length} B=${B.states.length}`)

// A announces a Netflix title, exactly as worker.js announce() does
const queued = await fetch(`${BASE}/api/rooms/${roomId}/watch/queue`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
  body: JSON.stringify({ source: 'external', ref: 'https://www.netflix.com/watch/81905147', title: 'Yes Man' }),
}).then(r => r.json())

B.states.length = 0
A.socket.emit('watch:load', { roomId, itemId: queued.item.id })
await settle(700)

const bSaw = B.states.at(-1)
check('B is told what A put on, without asking',
  bSaw?.item?.title === 'Yes Man' && bSaw?.item?.source === 'external',
  JSON.stringify(bSaw?.item))
check('loading it starts the room playing', bSaw?.playing === true, String(bSaw?.playing))

// B seeks; A must see it
A.states.length = 0
B.socket.emit('watch:control', { roomId, action: 'seek', position: 942 })
await settle(700)
const aSaw = A.states.at(-1)
check('a seek by B reaches A', Math.round(aSaw?.position ?? -1) === 942, String(aSaw?.position))

// B pauses; A must see it
A.states.length = 0
B.socket.emit('watch:control', { roomId, action: 'pause', position: 942 })
await settle(700)
check('a pause by B reaches A', A.states.at(-1)?.playing === false, String(A.states.at(-1)?.playing))

// resume, then confirm the projected clock actually advances in real time
A.states.length = 0
B.socket.emit('watch:control', { roomId, action: 'play', position: 942 })
await settle(700)
const resumed = A.states.at(-1)
check('a play by B reaches A', resumed?.playing === true, String(resumed?.playing))

// the position both sides compute from one snapshot, two seconds apart
const target = (snap) => snap.position + (Date.now() - snap.serverTime) / 1000
const t1 = target(resumed)
await settle(2000)
const t2 = target(resumed)
check('the shared clock advances in real time (~2s)',
  Math.abs((t2 - t1) - 2) < 0.35, `advanced ${(t2 - t1).toFixed(2)}s`)

A.socket.disconnect(); B.socket.disconnect()

let bad = 0
for (const r of results) { console.log((r.p ? '  PASS  ' : '  FAIL  ') + r.n + (r.p ? '' : '   ' + r.d)); if (!r.p) bad++ }
console.log(bad === 0 ? `\nall ${results.length} passed` : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
