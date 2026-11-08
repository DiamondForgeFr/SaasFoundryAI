import { findClaudeMdReferences, isMigrationMarker, KEPT_FOR_REVIEW_HEADING, resolveClaudeMdReference, rewriteRemovedClaudeMdReferences } from '../../../harness/instruction-references'

const names = (content: string): string[] => findClaudeMdReferences(content).map((reference) => reference.text)

describe('findClaudeMdReferences (#1152)', () => {
  it('finds a bare name, a relative path and a Markdown link, in prose, inline code and fenced blocks', () => {
    const content = ['Read CLAUDE.md first.', 'Check `apps/api/CLAUDE.md` and [web](./apps/web/CLAUDE.md).', '```', '│   └── CLAUDE.md     # API-specific context', '```'].join('\n')

    expect(names(content)).toEqual(['CLAUDE.md', 'apps/api/CLAUDE.md', './apps/web/CLAUDE.md', 'CLAUDE.md'])
  })

  it('numbers lines from the first line it is given', () => {
    const content = 'one\ntwo CLAUDE.md\nthree\nfour apps/api/CLAUDE.md'

    expect(findClaudeMdReferences(content).map((reference) => reference.line)).toEqual([2, 4])
    expect(findClaudeMdReferences(content, 30).map((reference) => reference.line)).toEqual([31, 33])
  })

  it('does not read another file or a URL as a CLAUDE.md path', () => {
    const content = ['CLAUDE.local.md MYCLAUDE.md my-CLAUDE.md foo.CLAUDE.md CLAUDE.mdx _CLAUDE.md', 'CLAUDE.md.saasfoundry.new claude.md Claude.md', 'https://example.com/docs/CLAUDE.md'].join('\n')

    expect(names(content)).toEqual([])
  })

  it('accepts the punctuation a sentence puts after the name', () => {
    expect(names('See CLAUDE.md. Then (CLAUDE.md), "CLAUDE.md": **CLAUDE.md**, CLAUDE.md;')).toHaveLength(5)
  })
})

describe('resolveClaudeMdReference (#1152)', () => {
  const resolve = (dir: string, directory: string): string | undefined => resolveClaudeMdReference(dir, { directory })

  it('resolves a bare name against the directory of the file that holds it', () => {
    expect(resolve('', '')).toBe('CLAUDE.md')
    expect(resolve('apps/api', '')).toBe('apps/api/CLAUDE.md')
  })

  it('resolves a path from the directory of the file that holds it', () => {
    expect(resolve('', 'apps/web/')).toBe('apps/web/CLAUDE.md')
    expect(resolve('apps/api', './')).toBe('apps/api/CLAUDE.md')
    expect(resolve('apps/api', '../web/')).toBe('apps/web/CLAUDE.md')
  })

  it('names no project file for a path under the home directory, an absolute path or one above the project', () => {
    expect(resolve('', '~/.claude/')).toBeUndefined()
    expect(resolve('', '/etc/')).toBeUndefined()
    expect(resolve('', '../')).toBeUndefined()
  })
})

describe('rewriteRemovedClaudeMdReferences (#1152)', () => {
  const removed = new Set(['CLAUDE.md', 'apps/api/CLAUDE.md'])

  it('points each reference to a removed file at the AGENTS.md beside it, keeping the path as written', () => {
    const text = 'Check `apps/api/CLAUDE.md`.\nUpdate this CLAUDE.md as the project evolves.\n'

    expect(rewriteRemovedClaudeMdReferences(text, '', removed, 10)).toEqual({
      text: 'Check `apps/api/AGENTS.md`.\nUpdate this AGENTS.md as the project evolves.\n',
      rewrites: [
        { line: 10, from: 'apps/api/CLAUDE.md', to: 'apps/api/AGENTS.md' },
        { line: 11, from: 'CLAUDE.md', to: 'AGENTS.md' }
      ]
    })
  })

  it('leaves a reference to a file that stays, and everything else, byte for byte', () => {
    const text = 'Check apps/web/CLAUDE.md, ~/.claude/CLAUDE.md, CLAUDE.local.md and https://example.com/CLAUDE.md.\r\nTwo  spaces\tand a tab.\n'

    expect(rewriteRemovedClaudeMdReferences(text, '', removed)).toEqual({ text, rewrites: [] })
  })

  it('resolves a bare name against the directory the text is written in', () => {
    const text = 'Update this CLAUDE.md. Root: ../../CLAUDE.md\n'

    expect(rewriteRemovedClaudeMdReferences(text, 'apps/api', removed).text).toBe('Update this AGENTS.md. Root: ../../AGENTS.md\n')
    expect(rewriteRemovedClaudeMdReferences(text, 'apps/web', removed).text).toBe('Update this CLAUDE.md. Root: ../../AGENTS.md\n')
  })
})

describe('isMigrationMarker (#1152)', () => {
  it('recognises the heading and the comment the migration writes, and nothing else', () => {
    expect(isMigrationMarker(KEPT_FOR_REVIEW_HEADING)).toBe(true)
    expect(isMigrationMarker('<!-- saasfoundry:migrated-from-claude-md — the sections below come from CLAUDE.md. -->')).toBe(true)
    expect(isMigrationMarker('## Kept from CLAUDE.md for review of the API')).toBe(false)
    expect(isMigrationMarker('Check apps/api/CLAUDE.md')).toBe(false)
  })
})
