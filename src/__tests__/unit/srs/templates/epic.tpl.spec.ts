import { renderEpicPage } from '../../../../builders/srs/templates/pages/epic.tpl'
import { EpicSpec, PageBlock, TableBlock } from '../../../../builders/srs/types'

function kinds(page: ReturnType<typeof renderEpicPage>): string[] {
  return page.blocks.map((b) => (b.kind === 'heading' ? `heading:${b.level}` : b.kind))
}

function findTableAfterHeading(blocks: PageBlock[], headingText: string): TableBlock {
  for (let i = 0; i < blocks.length - 1; i++) {
    const current = blocks[i]
    const next = blocks[i + 1]
    if (current.kind === 'heading' && current.text === headingText && next.kind === 'table') {
      return next
    }
  }
  throw new Error(`table after heading "${headingText}" not found`)
}

describe('renderEpicPage', () => {
  it('emits the title and the full section scaffold for a rich EpicSpec', () => {
    const spec: EpicSpec = {
      title: 'User authentication',
      parentPageId: 'parent',
      businessValue: 'Users can sign in securely.',
      scope: 'Email + password auth, no SSO.',
      urs: [{ id: 'UR-1', narrative: 'sign in with email', businessValue: 'daily login' }],
      frs: [
        {
          id: 'FR-1',
          title: 'Login endpoint',
          description: 'POST /auth/login',
          acceptanceCriteria: ['returns 200 with valid creds', 'returns 401 with invalid creds'],
          urRefs: ['UR-1'],
          dsRefs: ['DS-1'],
          tcRefs: ['TC-1']
        }
      ],
      dsItems: [{ id: 'DS-1', title: 'Login form' }],
      tcItems: [{ id: 'TC-1', title: 'Happy path' }]
    }

    const page = renderEpicPage(spec)

    expect(page.title).toBe('User authentication')
    expect(kinds(page)).toEqual([
      'heading:1',
      'paragraph',
      'heading:2',
      'paragraph',
      'divider',
      'heading:2',
      'table',
      'heading:2',
      'table',
      'divider',
      'heading:2',
      'bulleted_list',
      'divider',
      'heading:2',
      'heading:3',
      'paragraph',
      'paragraph',
      'bulleted_list',
      'paragraph'
    ])
  })

  it('renders the Requirement Types counts row from the spec', () => {
    const spec: EpicSpec = {
      title: 'Epic',
      parentPageId: 'p',
      urs: [{ id: 'UR-1', narrative: 'a' }],
      frs: [
        { id: 'FR-1', title: 'a' },
        { id: 'FR-2', title: 'b' }
      ],
      dsItems: [{ id: 'DS-1', title: 'x' }],
      tcItems: []
    }

    const page = renderEpicPage(spec)
    const reqTypeTable = findTableAfterHeading(page.blocks, 'Requirement Types')

    expect(reqTypeTable.header).toEqual(['UR', 'FR', 'DS', 'TC'])
    expect(reqTypeTable.rows).toEqual([['1', '2', '1', '0']])
  })

  it('degrades gracefully when URs/FRs are empty', () => {
    const spec: EpicSpec = { title: 'Empty', parentPageId: 'p', urs: [], frs: [] }
    const page = renderEpicPage(spec)
    const paragraphs = page.blocks.filter((b) => b.kind === 'paragraph')
    const texts = paragraphs.map((p) => ('text' in p ? p.text : ''))
    expect(texts).toContain('No user requirements yet.')
    expect(texts).toContain('No functional requirements yet.')
  })

  it('builds the Traceability table rows from FR refs (with em-dash for missing refs)', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [],
      frs: [
        { id: 'FR-1', title: 'a', urRefs: ['UR-1'] },
        { id: 'FR-2', title: 'b' }
      ]
    }
    const page = renderEpicPage(spec)
    const traceTable = findTableAfterHeading(page.blocks, 'Traceability')

    expect(traceTable.rows).toEqual([
      ['FR-1', 'UR-1', '—', '—'],
      ['FR-2', '—', '—', '—']
    ])
  })
})
