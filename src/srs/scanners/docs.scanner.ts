import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CodebaseScanner, CodebaseScannerContext, DocContextFinding } from './types'

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/
const EXCERPT_CAP = 280

function normalizeRel(path: string): string {
  return path.split('\\').join('/')
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  return content.slice(end + 4)
}

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
}

export interface DocHeading {
  level: 1 | 2 | 3
  heading: string
  excerpt: string
}

export function extractHeadings(content: string): DocHeading[] {
  const body = stripFrontmatter(content)
  const lines = body.split('\n')
  const out: DocHeading[] = []

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(HEADING_RE)
    if (!headingMatch) continue
    const level = headingMatch[1].length as 1 | 2 | 3
    const heading = headingMatch[2].trim()

    // Skip leading blanks, gather the first non-blank paragraph.
    let cursor = i + 1
    while (cursor < lines.length && lines[cursor].trim() === '') cursor++
    const excerptLines: string[] = []
    while (cursor < lines.length) {
      const cur = lines[cursor]
      if (cur.trim() === '') break
      if (HEADING_RE.test(cur)) break
      excerptLines.push(cur.trim())
      cursor++
    }
    const excerpt = excerptLines.join(' ').slice(0, EXCERPT_CAP)
    out.push({ level, heading, excerpt })
  }

  return out
}

const DOC_FILE_GLOBS: RegExp[] = [/^README\.md$/i, /^CLAUDE\.md$/, /\/README\.md$/i, /\/CLAUDE\.md$/, /^docs\//, /\/docs\//]

function isDocFile(relPath: string): boolean {
  const norm = normalizeRel(relPath)
  if (!norm.endsWith('.md')) return false
  return DOC_FILE_GLOBS.some((re) => re.test(norm))
}

export const docsScanner: CodebaseScanner = {
  id: 'docs',
  describe: 'Markdown docs (README/CLAUDE/docs) → doc-context findings (regex-based)',
  async collect(context: CodebaseScannerContext): Promise<DocContextFinding[]> {
    const docFiles = context.files.filter(isDocFile)

    const findings: DocContextFinding[] = []
    for (const relFile of docFiles) {
      const abs = join(context.scanRoot, relFile)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      for (const h of extractHeadings(content)) {
        const area = slugify(h.heading) || 'doc'
        findings.push({
          kind: 'doc-context',
          title: h.heading,
          area,
          file: normalizeRel(relFile),
          heading: h.heading,
          headingLevel: h.level,
          excerpt: h.excerpt
        })
      }
    }
    return findings
  }
}
