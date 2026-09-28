import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const forbidden = [
  { pattern: /\balert\s*\(/, message: 'Use an in-app error surface instead of alert().' },
  { pattern: /console\.(log|error|warn)\s*\(/, message: 'Use src/lib/logger.ts for application logging.' },
]

const files = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path)
  }
}

await walk(sourceRoot)
const failures = []
for (const file of files) {
  if (/[/\\]lib[/\\]logger\.ts$/.test(file)) continue
  const contents = await readFile(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(contents)) failures.push(`${file}: ${rule.message}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`Production lint passed (${files.length} TypeScript files scanned).`)
