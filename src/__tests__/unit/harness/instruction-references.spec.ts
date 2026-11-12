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

  describe('form', () => {
    const forms = (content: string): string[] => findClaudeMdReferences(content).map((reference) => reference.form)

    it('is "path" for a name written with a directory', () => {
      expect(forms('Check `apps/api/CLAUDE.md`, [web](./CLAUDE.md) and ../x/CLAUDE.md')).toEqual(['path', 'path', 'path'])
    })

    it('is "tree" for the name of an entry in a drawn tree, in any of its glyphs', () => {
      const tree = ['│   │   └── CLAUDE.md     # API-specific context', '├── CLAUDE.md', '|-- CLAUDE.md', '+-- CLAUDE.md', '`-- CLAUDE.md', '    └─ CLAUDE.md'].join('\n')

      expect(forms(tree)).toEqual(['tree', 'tree', 'tree', 'tree', 'tree', 'tree'])
    })

    it('is "name" for a bare name in running text, a list item or a table cell: it can label the file as well as name it', () => {
      const text = ['Read CLAUDE.md first.', '- CLAUDE.md: the project instructions', '* CLAUDE.md', '| `CLAUDE.md` | rules |', 'SaaSFoundry fixture CLAUDE.md canary', '└── see CLAUDE.md'].join('\n')

      expect(forms(text)).toEqual(['name', 'name', 'name', 'name', 'name', 'name'])
    })
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

  it('points each path and tree entry that names a removed file at the AGENTS.md beside it, keeping the path as written', () => {
    const text = 'Check `apps/api/CLAUDE.md`.\n```\n│   └── CLAUDE.md     # context\n```\n'

    expect(rewriteRemovedClaudeMdReferences(text, '', removed, 10)).toEqual({
      text: 'Check `apps/api/AGENTS.md`.\n```\n│   └── AGENTS.md     # context\n```\n',
      rewrites: [
        { line: 10, from: 'apps/api/CLAUDE.md', to: 'apps/api/AGENTS.md' },
        { line: 12, from: 'CLAUDE.md', to: 'AGENTS.md' }
      ],
      mentions: []
    })
  })

  it('leaves a bare name in running text as written and returns its line: it can label the file instead of naming it', () => {
    const text = 'Update this CLAUDE.md as the project evolves.\nSaaSFoundry fixture CLAUDE.md canary.\n'

    expect(rewriteRemovedClaudeMdReferences(text, '', removed, 5)).toEqual({ text, rewrites: [], mentions: [5, 6] })
  })

  it('leaves a reference to a file that stays, and everything else, byte for byte', () => {
    const text = 'Check apps/web/CLAUDE.md, ~/.claude/CLAUDE.md, CLAUDE.local.md and https://example.com/CLAUDE.md.\r\nTwo  spaces\tand a tab.\n'

    expect(rewriteRemovedClaudeMdReferences(text, '', removed)).toEqual({ text, rewrites: [], mentions: [] })
  })

  it('resolves a name against the directory the text is written in', () => {
    const text = 'Update this CLAUDE.md. Root: ../../CLAUDE.md\n│   └── CLAUDE.md\n'

    expect(rewriteRemovedClaudeMdReferences(text, 'apps/api', removed)).toMatchObject({
      text: 'Update this CLAUDE.md. Root: ../../AGENTS.md\n│   └── AGENTS.md\n',
      mentions: [1]
    })
    // In apps/web the bare name and the tree entry name apps/web/CLAUDE.md, which stays
    expect(rewriteRemovedClaudeMdReferences(text, 'apps/web', removed)).toMatchObject({
      text: 'Update this CLAUDE.md. Root: ../../AGENTS.md\n│   └── CLAUDE.md\n',
      mentions: []
    })
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
