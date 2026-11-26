import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

import { dataDir, readJson, walk } from './util.mjs'

export const REGION_START = '<!-- saasfoundry:generated:start -->'
export const REGION_END = '<!-- saasfoundry:generated:end -->'

export const loadSkills = (root) => readJson(join(dataDir(root), 'skills.json'))

/**
 * A view is one surface of a skill seen as a tree of files: the template, the generated project, this
 * repository's copy, the `.agents` projection. `exclude` drops real paths by prefix, then `map` renames the
 * prefix of what is left, so the Solo status set of the template (`statuses-solo/`) reads as the
 * `statuses/` folder a generated project holds. `files` lists the files of a view that is a few files in a
 * big folder (the repository's `AGENTS.md`), so the folder is never walked.
 *
 * Returns undefined when the view's root does not exist.
 */
export function buildView(root, spec) {
  const base = resolve(root, spec.root)
  if (!existsSync(base)) return undefined
  const paths = spec.files ? spec.files.filter((file) => existsSync(join(base, file))) : walk(base)
  const files = new Map()
  for (const rel of paths) {
    if ((spec.exclude ?? []).some((prefix) => rel.startsWith(prefix))) continue
    let viewPath = rel
    for (const [from, to] of Object.entries(spec.map ?? {})) {
      if (rel.startsWith(from)) {
        viewPath = to + rel.slice(from.length)
        break
      }
    }
    files.set(viewPath, join(base, rel))
  }
  const dirs = new Set()
  for (const viewPath of files.keys()) {
    for (let dir = posix.dirname(viewPath); dir !== '.' && dir !== '/'; dir = posix.dirname(dir)) dirs.add(dir)
  }
  return { base, spec, files, dirs }
}

export const markdownFiles = (view) => [...view.files.entries()].filter(([path]) => path.endsWith('.md'))

const countLines = (text) => (text.match(/\n/g) ?? []).length

/** The generated region of an instructions file, markers included, and what is left once it is cut out. */
export function splitRegion(text) {
  const start = text.indexOf(REGION_START)
  const end = text.indexOf(REGION_END)
  if (start === -1 || end === -1 || end < start) return undefined
  const stop = end + REGION_END.length
  return { region: text.slice(start, stop), handWritten: text.slice(0, start) + text.slice(stop) }
}

/** Bytes and lines of every Markdown file of a view, and of the whole. `entry` is the file the skill is loaded from. */
export function measureView(view, entry) {
  const files = {}
  let bytes = 0
  let lines = 0
  for (const [path, abs] of markdownFiles(view)) {
    const size = statSync(abs).size
    const text = readFileSync(abs, 'utf8')
    files[path] = { bytes: size, lines: countLines(text) }
    bytes += size
    lines += files[path].lines
  }
  const measured = { entry: files[entry] ?? { bytes: 0, lines: 0 }, total: { bytes, lines }, files }
  if (view.spec.regions) {
    const split = splitRegion(readFileSync(view.files.get(entry), 'utf8'))
    if (split) {
      measured.extra = { region: Buffer.byteLength(split.region), handWritten: Buffer.byteLength(split.handWritten) }
    }
  }
  return measured
}

/** Paragraphs, list items, table rows and headings of a Markdown text, each as one line. */
export function blocks(text) {
  const out = []
  let current = []
  const flush = () => {
    if (current.length > 0) out.push(current.join(' '))
    current = []
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      flush()
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s/.test(line) || /^\s*\|/.test(line) || /^#{1,6}\s/.test(line)) flush()
    current.push(line.trim())
  }
  flush()
  return out
}

/** A block without its list marker, quote marker, emphasis and opening bracket: what a reader sees first. */
export const leadOf = (block) => {
  let text = block
  for (;;) {
    const next = text.replace(/^(?:[-*+]\s+|\d+\.\s+|>\s*|\|\s*|#{1,6}\s+|[*_`[(]+)/, '')
    if (next === text) return text
    text = next
  }
}

/** Relative targets of the inline links of a Markdown text, fenced code and inline code left out. */
export function relativeLinks(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const targets = []
  for (const match of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/') || target.startsWith('<')) continue
    const path = target.split('#')[0].split('?')[0]
    if (path) targets.push({ target, path })
  }
  return targets
}
