import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository this file belongs to: tests/skill-check/lib -> three levels up. */
export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const KB = 1024
export const ceilKb = (bytes) => Math.ceil(bytes / KB) * KB

/** Where the data of the check lives under a root: ledgers, budgets, scenarios, recipes. */
export const dataDir = (root) => join(root, 'tests', 'skill-check')

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Whitespace is collapsed so a token that a 200-column wrap split across two lines still matches. */
export const squash = (text) => text.replace(/\s+/g, ' ').trim()

/** A wrong flag, a missing file: exit 2, never a check failure. */
export class UsageError extends Error {}

/** Every file under `dir`, as sorted POSIX paths relative to it. Symlinks are followed; `node_modules` and `.git` are skipped. */
export function walk(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = join(dir, entry.name)
    let isDir = entry.isDirectory()
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      try {
        const stat = statSync(full)
        isDir = stat.isDirectory()
        isFile = stat.isFile()
      } catch {
        continue
      }
    }
    if (isDir) out.push(...walk(full, rel))
    else if (isFile) out.push(rel)
  }
  return out.sort()
}

const isPrimitive = (value) => value === null || typeof value !== 'object'

/**
 * JSON as Prettier lays it out for this repository: objects expanded, arrays of primitives on one line while
 * they fit in 200 columns. The data files are committed and `format:check` reads them, so the writer must
 * not produce a layout Prettier would change.
 */
export function formatJson(value, indent = 0) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every(isPrimitive)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`
      if (inline.length + pad.length + 6 <= 200) return inline
    }
    return `[\n${value.map((item) => `${pad}  ${formatJson(item, indent + 1)}`).join(',\n')}\n${pad}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    if (entries.length === 0) return '{}'
    return `{\n${entries.map(([key, item]) => `${pad}  ${JSON.stringify(key)}: ${formatJson(item, indent + 1)}`).join(',\n')}\n${pad}}`
  }
  return JSON.stringify(value)
}

/** `1,234` style number for the tables. */
export const fmt = (n) => n.toLocaleString('en-US')

export function parseArgs(argv, { booleans = [], strings = [], lists = [] } = {}) {
  const options = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      options._.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = arg.slice(2, eq === -1 ? undefined : eq)
    const camel = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (booleans.includes(name)) {
      options[camel] = true
    } else if (strings.includes(name) || lists.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
      if (value === undefined) throw new UsageError(`--${name} needs a value`)
      options[camel] = lists.includes(name) ? [...(options[camel] ?? []), ...value.split(',').filter(Boolean)] : value
    } else {
      throw new UsageError(`unknown option --${name}`)
    }
  }
  return options
}
