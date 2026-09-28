import fs from 'node:fs'
import path from 'node:path'

export function ensureGitignorePatterns(filePath: string, patterns: string[]): string[] {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : []
  const present = new Set(lines.map((line) => line.trim()))

  const added: string[] = []
  for (const pattern of patterns) {
    if (!present.has(pattern)) {
      added.push(pattern)
      present.add(pattern)
    }
  }
  if (added.length === 0) return []

  const next = lines.slice()
  if (next.length > 0 && next[next.length - 1] !== '') next.push('')
  for (const pattern of added) next.push(pattern)
  const output = next.join('\n').replace(/\n+$/g, '') + '\n'
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, output, 'utf8')
  return added
}
