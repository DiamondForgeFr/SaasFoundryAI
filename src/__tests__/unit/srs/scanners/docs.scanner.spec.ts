import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { docsScanner, extractHeadings, slugify } from '../../../../srs/scanners/docs.scanner'
import { CodebaseScannerContext, DocContextFinding } from '../../../../srs/scanners/types'

function walkSync(root: string): string[] {
  const out: string[] = []
  const visit = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const child = join(abs, entry)
      const st = statSync(child)
      if (st.isDirectory()) visit(child)
      else if (st.isFile()) out.push(relative(root, child).split('\\').join('/'))
    }
  }
  visit(root)
  return out
}

describe('slugify (pure)', () => {
  it('lowercases and dashes a heading', () => {
    expect(slugify('My First Heading')).toBe('my-first-heading')
  })

  it('caps the slug at 4 words', () => {
    expect(slugify('One Two Three Four Five Six')).toBe('one-two-three-four')
  })

  it('strips punctuation', () => {
    expect(slugify('Hello, World!')).toBe('hello-world')
  })
})

describe('extractHeadings (pure)', () => {
  it('extracts H1/H2/H3 headings and the first paragraph excerpt', () => {
    const source = `# Top
Intro paragraph line 1.
Intro paragraph line 2.

Another paragraph.

## Section A
Details about A.

### Sub section
Deep detail.
`
    const out = extractHeadings(source)
    expect(out).toEqual([
      { level: 1, heading: 'Top', excerpt: 'Intro paragraph line 1. Intro paragraph line 2.' },
      { level: 2, heading: 'Section A', excerpt: 'Details about A.' },
      { level: 3, heading: 'Sub section', excerpt: 'Deep detail.' }
    ])
  })

  it('ignores H4+ headings', () => {
    const source = `#### too deep\ncontent`
    expect(extractHeadings(source)).toEqual([])
  })

  it('strips YAML frontmatter', () => {
    const source = `---
title: hello
---

# Real Heading
Body.
`
    const out = extractHeadings(source)
    expect(out).toEqual([{ level: 1, heading: 'Real Heading', excerpt: 'Body.' }])
  })

  it('caps the excerpt to avoid runaway output', () => {
    const big = 'x'.repeat(500)
    const source = `# Cap\n${big}`
    const out = extractHeadings(source)
    expect(out[0].excerpt.length).toBeLessThanOrEqual(280)
  })
})

describe('docsScanner.collect', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-docs-'))
  })

  const seedFile = (absPath: string, source: string): void => {
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, source)
  }

  it('emits doc-context findings for README / CLAUDE / docs/**/*.md', async () => {
    seedFile(
      join(tmp, 'README.md'),
      `# Project
Quick overview paragraph.
`
    )
    seedFile(
      join(tmp, 'CLAUDE.md'),
      `# AI rules
Do X, not Y.
`
    )
    seedFile(
      join(tmp, 'docs', 'guide.md'),
      `# Guide
Guide intro.

## Step one
First step.
`
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo'
    }

    const findings = (await docsScanner.collect(context)) as DocContextFinding[]

    expect(findings).toHaveLength(4)
    const byHeading = Object.fromEntries(findings.map((f) => [f.heading, f]))
    expect(byHeading.Project.file).toBe('README.md')
    expect(byHeading.Project.area).toBe('project')
    expect(byHeading['AI rules'].file).toBe('CLAUDE.md')
    expect(byHeading.Guide.file).toBe('docs/guide.md')
    expect(byHeading['Step one'].headingLevel).toBe(2)
  })

  it('picks up nested README under api/ and web/', async () => {
    seedFile(join(tmp, 'api', 'README.md'), `# API\nBackend overview.`)
    seedFile(join(tmp, 'web', 'README.md'), `# Web\nFrontend overview.`)

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo'
    }

    const findings = (await docsScanner.collect(context)) as DocContextFinding[]

    expect(findings.map((f) => f.file).sort()).toEqual(['api/README.md', 'web/README.md'])
  })

  it('ignores non-doc markdown files (e.g. in src/)', async () => {
    seedFile(join(tmp, 'src', 'notes.md'), `# Notes\nSome notes.`)

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'multirepo'
    }

    const findings = await docsScanner.collect(context)
    expect(findings).toEqual([])
  })

  it('returns [] when no doc files exist', async () => {
    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: [],
      structure: 'monorepo'
    }
    const findings = await docsScanner.collect(context)
    expect(findings).toEqual([])
  })
})
