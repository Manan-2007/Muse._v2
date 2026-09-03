import process from 'node:process'

import '../config/env.js'
import { listLibrary } from '../services/upload.service.js'
import { publish, readPublished } from '../services/publish.service.js'

/**
 * Publish videos already sitting in the uploads folder.
 *
 * Uploading through the app publishes on its own; this is for the films that
 * got there another way — dropped in over SSH, copied from a drive — and for
 * re-running one that failed halfway.
 *
 *   npm run publish              list what's there and what's published
 *   npm run publish -- <file>    publish one
 *   npm run publish -- --all     publish everything not already done
 */

function bar(fraction: number | null) {
  if (fraction === null) return ''
  const width = 24
  const filled = Math.round(fraction * width)
  return ` [${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${Math.round(fraction * 100)}%`
}

async function publishOne(file: string) {
  const started = Date.now()
  let lastLine = ''

  const entry = await publish(file, ({ stage, fraction }) => {
    const line = `  ${stage}${bar(fraction)}`
    if (line !== lastLine) {
      process.stdout.write(`\r${line.padEnd(60)}`)
      lastLine = line
    }
  })

  const seconds = Math.round((Date.now() - started) / 1000)
  process.stdout.write('\r'.padEnd(62) + '\r')
  console.log(`  done in ${Math.floor(seconds / 60)}m ${seconds % 60}s`)
  console.log(`  ${entry.segmentCount} files · ${entry.audio.map((a) => a.label).join(', ')}`)
  console.log(`  ${entry.url}\n`)
  return entry
}

const args = process.argv.slice(2)

if (args.length === 0) {
  const [library, published] = await Promise.all([listLibrary(), readPublished()])

  if (library.length === 0) {
    console.log('Nothing in the uploads folder.')
  } else {
    console.log('Uploads folder:\n')
    for (const item of library) {
      const done = published[item.file]
      console.log(`  ${done ? '✓' : ' '} ${item.file}`)
      if (done) console.log(`      ${done.url}`)
    }
    console.log('\nPublish with:  npm run publish -- "<filename>"   (or --all)')
  }
} else if (args[0] === '--all') {
  const [library, published] = await Promise.all([listLibrary(), readPublished()])
  const pending = library.filter((item) => item.playable && !published[item.file])

  if (pending.length === 0) {
    console.log('Everything playable is already published.')
  } else {
    console.log(`Publishing ${pending.length} file(s).\n`)
    for (const item of pending) {
      console.log(item.file)
      try {
        await publishOne(item.file)
      } catch (cause) {
        console.error(`  FAILED: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      }
    }
  }
} else {
  console.log(`${args[0]}`)
  await publishOne(args[0]!)
}
