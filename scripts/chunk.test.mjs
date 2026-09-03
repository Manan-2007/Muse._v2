/**
 * Recovering from a deploy that landed while the tab was open.
 *
 * Not checkable by reading it: the failure only exists when a hashed chunk
 * has gone missing, and the recovery is a page reload, which is exactly the
 * thing a test cannot casually perform. So the reload is stubbed and counted.
 *
 * The case that matters most is the third one — a chunk that is broken for
 * some *other* reason must not reload forever.
 *
 *   node scripts/chunk.test.mjs
 */
/* The recovery path, exercised the way a stale deploy triggers it. */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync(new URL('../src/lib/lazyChunk.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText

let reloads = 0
const store = new Map()
const sandbox = {
  console, Date, Promise, String,
  require: () => ({ lazy: (f) => ({ __factory: f }) }),
  window: {
    location: { reload: () => { reloads++ } },
    sessionStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  },
}
sandbox.exports = {}
sandbox.module = { exports: sandbox.exports }
vm.createContext(sandbox)
vm.runInContext(js, sandbox)
const { lazyChunk, clearChunkReloadGuard } = sandbox.module.exports

const R = []
const check = (n, p, d='') => R.push({n,p,d})

// 1 — a healthy chunk is untouched
const good = lazyChunk(() => Promise.resolve({ default: 'Pane' }))
check('a chunk that loads resolves normally', (await good.__factory()).default === 'Pane')
check('  and triggers no reload', reloads === 0, `reloads=${reloads}`)

// 2 — the stale-deploy case: import rejects
const stale = () => Promise.reject(new Error('error loading dynamically imported module'))
const bad = lazyChunk(stale)
const pending = bad.__factory()
await new Promise(r => setTimeout(r, 20))
check('a stale chunk triggers exactly one reload', reloads === 1, `reloads=${reloads}`)
check('  and never settles, so nothing renders mid-reload',
  await Promise.race([pending.then(()=>'settled'), new Promise(r=>setTimeout(()=>r('pending'),30))]) === 'pending')

// 3 — a second failure must NOT loop; the error goes to the boundary
const bad2 = lazyChunk(stale)
let threw = null
try { await bad2.__factory() } catch (e) { threw = e.message }
check('a second failure rethrows instead of looping', threw !== null, String(threw))
check('  and adds no further reload', reloads === 1, `reloads=${reloads}`)

// 4 — the guard clears, so the next deploy can recover too
clearChunkReloadGuard()
const bad3 = lazyChunk(stale)
bad3.__factory()
await new Promise(r => setTimeout(r, 20))
check('after the guard clears, recovery is available again', reloads === 2, `reloads=${reloads}`)

let bad_ = 0
for (const r of R) { console.log((r.p?'  PASS  ':'  FAIL  ')+r.n+(r.p?'':'   '+r.d)); if(!r.p) bad_++ }
console.log(bad_===0 ? `\nall ${R.length} passed` : `\n${bad_} FAILED`)
process.exit(bad_?1:0)
