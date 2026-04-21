import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CodebaseScanner, CodebaseScannerContext, TestFinding } from './types'

const DESCRIBE_RE = /\bdescribe\s*\(\s*['"`]([^'"`]+)['"`]/g
const CASE_RE = /\b(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g
const FILE_STEM_RE = /([^/]+?)(?:\.(?:e2e|spec)\.tsx?$)/

function normalizeRel(path: string): string {
  return path.split('\\').join('/')
}

export function extractDescribeTitles(content: string): string[] {
  const out: string[] = []
  for (const match of content.matchAll(DESCRIBE_RE)) out.push(match[1])
  return out
}

export function extractCaseTitles(content: string): string[] {
  const out: string[] = []
  for (const match of content.matchAll(CASE_RE)) out.push(match[1])
  return out
}

export function extractTestAreaFromPath(relPath: string): string {
  const norm = normalizeRel(relPath)
  const modulesMarker = 'src/modules/'
  const pagesMarker = 'src/pages/'
  const mIdx = norm.indexOf(modulesMarker)
  if (mIdx !== -1) {
    const after = norm.slice(mIdx + modulesMarker.length)
    const first = after.split('/')[0]
    if (first) return first
  }
  const pIdx = norm.indexOf(pagesMarker)
  if (pIdx !== -1) {
    const after = norm.slice(pIdx + pagesMarker.length)
    const segments = after.split('/').filter(Boolean)
    if (segments.length >= 2) return `${segments[0]}/${segments[1].replace(/\.(spec|test|e2e)\.tsx?$/, '')}`
    if (segments.length === 1) return segments[0].replace(/\.(spec|test|e2e)\.tsx?$/, '')
  }
  const stem = norm.match(FILE_STEM_RE)
  return stem ? stem[1] : 'unknown'
}

export const testsScanner: CodebaseScanner = {
  id: 'tests',
  describe: 'Jest/Vitest spec files → test findings (regex-based)',
  async collect(context: CodebaseScannerContext): Promise<TestFinding[]> {
    const specFiles = context.files.filter((f) => {
      const norm = normalizeRel(f)
      return /\.(?:spec|e2e)\.tsx?$/.test(norm)
    })

    const findings: TestFinding[] = []
    for (const relFile of specFiles) {
      const abs = join(context.scanRoot, relFile)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      const describes = extractDescribeTitles(content)
      const cases = extractCaseTitles(content)
      if (describes.length === 0 && cases.length === 0) continue

      const area = extractTestAreaFromPath(relFile)
      const describe = describes[0] ?? area
      findings.push({
        kind: 'test',
        title: `${describe} (${area})`,
        area,
        file: normalizeRel(relFile),
        describe,
        cases
      })
    }
    return findings
  }
}
