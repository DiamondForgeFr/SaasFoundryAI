import fs from 'node:fs'
import path from 'node:path'

function needsQuoting(value: string): boolean {
  return /[\s"'#$`\\]/.test(value)
}

function formatValue(value: string): string {
  if (!needsQuoting(value)) return value
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

export function upsertEnvKey(filePath: string, key: string, value: string): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : []
  const formatted = `${key}=${formatValue(value)}`
  const keyRegex = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)

  let replaced = false
  const next = lines.map((line) => {
    if (!replaced && keyRegex.test(line)) {
      replaced = true
      return formatted
    }
    return line
  })

  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('')
    next.push(formatted)
  }

  const trimmed =
    next
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n+$/g, '') + '\n'
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, trimmed, 'utf8')
}

function parseEnvLine(line: string): [string, string] | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match) return null
  let raw = match[2].trim()
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    raw = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    raw = raw.slice(1, -1)
  }
  return [match[1], raw]
}

export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const parsed = parseEnvLine(line)
    if (!parsed) continue
    const [key, value] = parsed
    if (env[key] === undefined) env[key] = value
  }
}
