import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// src/srs/ is the agnostic dispatch layer. Only notion-backend.ts is allowed to
// touch Notion symbols — every other file must stay backend-neutral so we can
// plug Confluence / local-markdown / ... without editing the core.
const SRS_ROOT = join(__dirname, '..', '..', '..', 'srs')
const NOTION_BACKEND = 'notion-backend.ts'
const NOTION_IMPORT_PATTERNS = [/from\s+['"]@notionhq\/client['"]/, /from\s+['"][^'"]*tools\/notion[^'"]*['"]/]

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      files.push(...collectTsFiles(full))
    } else if (s.isFile() && entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

describe('src/srs/ Notion-import guard', () => {
  const files = collectTsFiles(SRS_ROOT)

  it('finds at least one TS file to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const rel = relative(SRS_ROOT, file)
    const isNotionBackend = rel === NOTION_BACKEND
    const label = isNotionBackend ? `${rel} — allowed to import Notion symbols` : `${rel} — must not leak Notion imports into the agnostic surface`

    it(label, () => {
      const source = readFileSync(file, 'utf8')
      for (const pattern of NOTION_IMPORT_PATTERNS) {
        const match = source.match(pattern)
        if (isNotionBackend) continue
        if (match) {
          throw new Error(
            [
              `${rel} imports Notion symbols but only ${NOTION_BACKEND} may do so.`,
              `  Offending import: ${match[0]}`,
              '',
              'Move the Notion-specific logic behind the SrsAdapter contract and',
              'register it from notion-backend.ts instead.'
            ].join('\n')
          )
        }
      }
      if (isNotionBackend) {
        expect(NOTION_IMPORT_PATTERNS.some((p) => p.test(source))).toBe(true)
      }
    })
  }
})
