import { readFileSync } from 'fs'
import path from 'path'

import { glob } from 'glob'

// VitePress containers (::: tip / info / warning / details / danger) need their fences on
// their own lines. Prettier does not know that: `proseWrap: always` treats a fence as
// ordinary text and reflows it into the neighbouring paragraph. When that happens the
// container never closes — the literal ":::" renders as page text and the block swallows
// everything after it, to the end of the document.
//
// It went unnoticed for a long time because nothing renders the docs in CI except the
// build, and the build succeeds either way: an unclosed container is valid markdown, just
// not the page anyone intended. Every container in docs/ was affected (#541), the home
// page included.
//
// This guard exists because the cause is a formatter that runs on every commit, so the
// defect returns by itself unless something fails loudly.
//
// The fix is always the same: a blank line after `::: kind Title`, and a blank line before
// the closing `:::`. Prettier does not merge across a paragraph break.
const DOCS = path.resolve(__dirname, '../../../../docs')

// `code-group` is the one container with no title and no prose body — its children are
// fenced code blocks, so the "blank line after the opener" rule does not apply to it.
const NO_BODY_CONTAINERS = new Set(['code-group'])

interface Offence {
  file: string
  line: number
  kind: 'opener body glued onto the title' | 'closing fence glued onto the previous line'
  text: string
}

function scan(file: string): Offence[] {
  const relative = path.relative(DOCS, file)
  const lines = readFileSync(file, 'utf8').split('\n')
  const offences: Offence[] = []
  let inFence = false

  lines.forEach((line, index) => {
    // Code fences hold things like `arn:aws:s3:::bucket`, which is not a container.
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) return

    const opener = /^::: ?([a-z-]+)(\s+.*)?$/.exec(line)
    if (opener && !NO_BODY_CONTAINERS.has(opener[1])) {
      const next = lines[index + 1] ?? ''
      if (next.trim() !== '') {
        offences.push({ file: relative, line: index + 1, kind: 'opener body glued onto the title', text: line.slice(0, 80) })
      }
    }

    if (/\S :::$/.test(line)) {
      offences.push({ file: relative, line: index + 1, kind: 'closing fence glued onto the previous line', text: line.slice(-60) })
    }
  })

  return offences
}

describe('VitePress containers in docs/', () => {
  const files = glob.sync('**/*.md', { cwd: DOCS, absolute: true, ignore: ['.vitepress/**', 'node_modules/**'] })

  it('finds markdown to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('keeps every container fence on its own line, so containers actually close', () => {
    const offences = files.flatMap(scan)

    if (offences.length > 0) {
      const detail = offences.map((o) => `  ${o.file}:${o.line}  ${o.kind}\n      …${o.text}`).join('\n')
      throw new Error(
        [
          `${offences.length} VitePress container fence(s) have been reflowed into their neighbouring text.`,
          '',
          detail,
          '',
          'Those containers never close: the literal ":::" renders as page text and the block',
          'swallows the rest of the page.',
          '',
          'Fix: put a blank line after `::: kind Title`, and a blank line before the closing `:::`.',
          'Prettier does not merge across a paragraph break, so the repair survives `npm run format`.',
          '',
          'Note the direction when syncing a skill copy: `scaffolds/` is prettier-ignored and',
          '`.claude/` is not, so format first, then copy the in-repo file over the scaffolded one.'
        ].join('\n')
      )
    }

    expect(offences).toEqual([])
  })
})
