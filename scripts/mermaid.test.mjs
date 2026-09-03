/**
 * Repairing a generated diagram, checked against the malformations that
 * actually shipped.
 *
 * Every case here came out of a real lesson or note, or is a neighbouring
 * syntax a model reaches for when asked for a graph. Parsing is not asserted
 * here — that needs a browser and lives in the manual check — so this asserts
 * the repair's *shape*, which is what regresses silently.
 *
 *   node scripts/mermaid.test.mjs
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync(new URL('../src/features/study/mermaidSafe.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const sandbox = { exports: {}, console }
sandbox.module = { exports: sandbox.exports }
vm.createContext(sandbox)
vm.runInContext(js, sandbox)
const { safeMermaid } = sandbox.module.exports

const R = []
const check = (n, p, d = '') => R.push({ n, p, d })

// the two that shipped to a reader
const graphviz = safeMermaid('digraph TD\nA["null"] <---> B["10"]')
check('digraph becomes graph', graphviz.startsWith('graph TD'), graphviz.split('\n')[0])
check('  and the arrow it already had is left alone', graphviz.includes('<--->'), graphviz)

const parens = safeMermaid('graph TD\nA[List (I)] --> B[ArrayList]')
check('a label with parens gets quoted', parens.includes('A["List (I)"]'), parens)

const nested = safeMermaid('graph TD\nA[Old: [1, 2]] --> B[New]')
check('nested brackets get quoted whole', nested.includes('A["Old: [1, 2]"]'), nested)

// neighbouring syntaxes
check('graphviz -> becomes -->', safeMermaid('graph TD\nA -> B').includes('A --> B'))
check('=> becomes -->', safeMermaid('graph TD\nA => B').includes('A --> B'))
check('a code fence is stripped', !safeMermaid('```mermaid\ngraph TD\nA --> B\n```').includes('```'))
check('a stray "mermaid" line is stripped',
  safeMermaid('mermaid\ngraph TD\nA --> B').startsWith('graph TD'))
check('braces from a graphviz body are dropped',
  !safeMermaid('strict digraph G {\nA -> B\n}').includes('}'))
check('a missing header is added',
  safeMermaid('A --> B').startsWith('graph TD'))

// things that were already correct must survive untouched
const KEEP = [
  'graph TD\n  A["a"] --> B["b"]',
  'flowchart LR\n  A --> B',
  'sequenceDiagram\n  Alice->>John: Hello',
  'graph TD\n  A -.-> B\n  B ==> C',
  'graph TD\n  A <--> B',
]
for (const good of KEEP) {
  check(`untouched: ${good.split('\n')[0]}`, safeMermaid(good) === good, JSON.stringify(safeMermaid(good)))
}

// `end` closes a subgraph and must not be renamed there
const sub = safeMermaid('graph TD\n subgraph one\n A --> B\n end\n B --> C')
check('subgraph end is left alone', /\n\s*end\n/.test(sub), JSON.stringify(sub))
check('but end as a node is renamed', safeMermaid('graph TD\nA --> end').includes('endNode'))

let bad = 0
for (const r of R) { console.log((r.p ? '  PASS  ' : '  FAIL  ') + r.n + (r.p ? '' : '   ' + r.d)); if (!r.p) bad++ }
console.log(bad === 0 ? `\nall ${R.length} passed` : `\n${bad} FAILED`)
process.exit(bad ? 1 : 0)
