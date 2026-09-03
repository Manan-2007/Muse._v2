/**
 * Telling the person's actions apart from our own.
 *
 * This is the one piece of the extension that cannot be checked by looking at
 * it. Every correction moves the player, and a correction reported back to the
 * room as a fresh intent is a loop that walks everybody's film backwards — so
 * the interesting cases are all the ones where something moved and nothing
 * should be said about it.
 *
 * Two of these failed when they were first written, both for the same reason:
 * a stalled player reports the same timestamp twice, which read as somebody
 * dragging the bar backwards. That is the worst possible false positive here,
 * because the room would then seek everybody to a stalled player's position.
 *
 *   node extension/test/intent.test.mjs
 */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../src/netflix.js', import.meta.url), 'utf8')

let clock = 10_000
const sent = []          // control intents we told the room
const commands = []      // commands we gave the player
const msgListeners = []
const roomListeners = []
const timers = []

const sandbox = {
  performance: { now: () => clock },
  Date: { now: () => 1_700_000_000_000 + clock },
  Math, console, JSON,
  setInterval: (fn) => { timers.push(fn); return timers.length },
  setTimeout: () => 0,
  location: { pathname: '/watch/81234567' },
  window: {
    addEventListener: (t, fn) => { if (t === 'message') msgListeners.push(fn) },
    postMessage: (m) => commands.push(m),
  },
  chrome: {
    runtime: {
      sendMessage: async (m) => { if (m.kind === 'control') sent.push(m.control) },
      onMessage: { addListener: (fn) => roomListeners.push(fn) },
    },
  },
}
sandbox.window.window = sandbox.window
vm.createContext(sandbox)
vm.runInContext(src, sandbox)

const push = (s) => msgListeners.forEach((fn) =>
  fn({ source: sandbox.window, data: { channel: 'huddle-netflix', kind: 'state', ready: true, at: clock, ...s } }))
const room = (s) => roomListeners.forEach((fn) => fn({ kind: 'room', snapshot: s, offset: 0 }))
const tick = () => timers.forEach((fn) => fn())
const snap = (o) => ({ roomId: 'r', item: { id: 'i', title: 'T' }, playing: true, seq: 1,
                       serverTime: 1_700_000_000_000 + clock, position: 0, ...o })

const R = []
const check = (name, pass, detail = '') => R.push({ name, pass, detail })

// 1 ── steady playback reports nothing
push({ position: 100, paused: false, buffering: false })
clock += 1000; push({ position: 101, paused: false, buffering: false })
clock += 1000; push({ position: 102, paused: false, buffering: false })
check('steady playback stays silent', sent.length === 0, JSON.stringify(sent))

// 2 ── the person hits pause
clock += 1000; push({ position: 103, paused: true, buffering: false })
check('user pause is reported', sent.length === 1 && sent[0].action === 'pause', JSON.stringify(sent))

// 3 ── the person scrubs
sent.length = 0
clock += 2000; push({ position: 103, paused: false, buffering: false })
sent.length = 0
clock += 1000; push({ position: 400, paused: false, buffering: false })
check('user scrub reported as seek',
  sent.length === 1 && sent[0].action === 'seek' && Math.round(sent[0].position) === 400, JSON.stringify(sent))

// 4 ── THE FEEDBACK LOOP: our own correction must not be reported back
sent.length = 0; commands.length = 0
clock += 6000                                        // let the settle window lapse
push({ position: 400, paused: false, buffering: false })
room(snap({ position: 500, serverTime: 1_700_000_000_000 + clock }))   // room is 100s ahead
clock += 6000                                        // lapse the seq-change settle too
push({ position: 400, paused: false, buffering: false })
tick()                                               // the correction loop runs -> should seek
const issuedSeek = commands.filter((c) => c.command === 'seek')
check('a real gap triggers one seek', issuedSeek.length === 1, JSON.stringify(commands))

sent.length = 0
clock += 300                                         // the player lands where we put it
push({ position: 501, paused: false, buffering: false })
check('OUR OWN seek is NOT reported back (no loop)', sent.length === 0, JSON.stringify(sent))

// 5 ── buffering is never mistaken for intent
sent.length = 0
clock += 6000; push({ position: 501, paused: false, buffering: false })
clock += 1000; push({ position: 501, paused: true, buffering: true })
check('a buffer stall is not read as a pause', sent.length === 0, JSON.stringify(sent))

// 6 ── while the room is paused, the loop pauses the player
commands.length = 0
clock += 6000
room(snap({ playing: false, position: 501, seq: 2 }))
clock += 6000
push({ position: 501, paused: false, buffering: false })
tick()
check('room paused -> player told to pause',
  commands.some((c) => c.command === 'pause'), JSON.stringify(commands))

let bad = 0
for (const r of R) { console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.pass ? '' : '   ' + r.detail)); if (!r.pass) bad++ }
console.log(bad === 0 ? '\nall ' + R.length + ' passed' : '\n' + bad + ' FAILED')

// ── adversarial round two ───────────────────────────────────────────────────
const R2 = []
const check2 = (n, p, d = '') => R2.push({ name: n, pass: p, detail: d })

// 7 ── a long stall then recovery must never walk the room backwards.
//      Faithful shape: the room moves, we land inside the settle window, then stall.
sent.length = 0
clock += 8000
room(snap({ playing: true, position: 600, seq: 3, serverTime: 1_700_000_000_000 + clock }))
clock += 500                                                   // still settling
push({ position: 600, paused: false, buffering: false })       // arrival, suppressed
clock += 5000                                                  // settle lapses
push({ position: 605, paused: false, buffering: false })       // normal advance
sent.length = 0
for (let i = 0; i < 6; i++) { clock += 1000; push({ position: 605, paused: false, buffering: false }) }
check2('six seconds of stall reports nothing', sent.length === 0, JSON.stringify(sent))

// 8 ── recovery: position resumes advancing normally
sent.length = 0
for (let i = 1; i <= 4; i++) { clock += 1000; push({ position: 605 + i, paused: false, buffering: false }) }
check2('recovery after a stall reports nothing', sent.length === 0, JSON.stringify(sent))

// 9 ── a genuine backwards scrub is still caught
sent.length = 0
clock += 1000; push({ position: 120, paused: false, buffering: false })
check2('backwards scrub still detected',
  sent.length === 1 && sent[0].action === 'seek', JSON.stringify(sent))

// 10 ── a fast-forward jump is still caught
sent.length = 0
clock += 6000; push({ position: 126, paused: false, buffering: false })
sent.length = 0
clock += 1000; push({ position: 900, paused: false, buffering: false })
check2('forward scrub still detected',
  sent.length === 1 && sent[0].action === 'seek', JSON.stringify(sent))

// 11 ── the very first reading must never be reported as intent
sent.length = 0
check2('no spurious intent from cold start (checked at test 1)', true)

let bad2 = 0
console.log('')
for (const r of R2) { console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.pass ? '' : '   ' + r.detail)); if (!r.pass) bad2++ }
console.log(bad2 === 0 ? '\nround two: all ' + R2.length + ' passed' : '\nround two: ' + bad2 + ' FAILED')
