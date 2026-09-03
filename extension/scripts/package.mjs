/**
 * Zip the extension for someone else's browser.
 *
 * Sideloading is the whole distribution story here, so this exists to make
 * "send it to the other person" one command rather than a folder-selection
 * ritual that quietly picks up `.DS_Store` and a stale build.
 *
 * Deliberately not a build step. There is nothing to compile — the extension
 * is plain JavaScript on purpose, so what ships is exactly what is in the
 * repo, and anyone can read the thing they are being asked to install.
 *
 *   node extension/scripts/package.mjs
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

const outDir = join(root, 'dist')
const outFile = join(outDir, `huddle-netflix-${manifest.version}.zip`)

mkdirSync(outDir, { recursive: true })
rmSync(outFile, { force: true })

/* `dist` is excluded so re-running never nests the last zip inside the next
   one, and the junk files are excluded because Chrome rejects an unpacked
   load containing paths it does not expect. */
execFileSync(
  'zip',
  ['-r', '-q', outFile, 'manifest.json', 'src', 'README.md',
   '-x', '*.DS_Store', '-x', '__MACOSX/*'],
  { cwd: root, stdio: 'inherit' },
)

console.log(`packaged ${manifest.name} v${manifest.version}`)
console.log(outFile)
