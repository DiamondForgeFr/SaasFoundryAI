import { renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
import { FrSpec } from '../../../../builders/srs/types'

describe('renderFrPage', () => {
  it('uses "ID — Title" as the page title', () => {
    const spec: FrSpec = { parentEpicPageId: 'epic', fr: { id: 'FR-1', title: 'Login endpoint' } }
    const page = renderFrPage(spec)
    expect(page.title).toBe('FR-1 — Login endpoint')
  })

  it('emits each section with its heading + placeholder paragraph when empty', () => {
    const spec: FrSpec = { parentEpicPageId: 'epic', fr: { id: 'FR-1', title: 'empty FR' } }
    const page = renderFrPage(spec)

    const headings = page.blocks.filter((b) => b.kind === 'heading').map((b) => ('text' in b ? b.text : ''))
    expect(headings).toEqual(['FR-1 — empty FR', 'User Requirements', 'Acceptance Criteria', 'Design (DS)', 'Test Cases (TC)'])

    const placeholders = page.blocks.filter((b) => b.kind === 'paragraph').map((b) => ('text' in b ? b.text : ''))
    expect(placeholders).toEqual(['No linked user requirements.', 'No acceptance criteria yet.', 'No design items yet.', 'No test cases yet.'])
  })

  it('renders bulleted lists when sections have content', () => {
    const spec: FrSpec = {
      parentEpicPageId: 'epic',
      fr: {
        id: 'FR-1',
        title: 'Login',
        description: 'POST /auth/login',
        acceptanceCriteria: ['returns 200', 'returns 401']
      },
      urs: [{ id: 'UR-1', narrative: 'sign in' }],
      dsItems: [{ id: 'DS-1', title: 'Form' }],
      tcItems: [{ id: 'TC-1', title: 'Happy path' }]
    }

    const page = renderFrPage(spec)

    const lists = page.blocks.filter((b) => b.kind === 'bulleted_list')
    expect(lists).toHaveLength(4)
    expect(lists[0]).toMatchObject({ kind: 'bulleted_list', items: ['UR-1: sign in'] })
    expect(lists[1]).toMatchObject({ kind: 'bulleted_list', items: ['returns 200', 'returns 401'] })
    expect(lists[2]).toMatchObject({ kind: 'bulleted_list', items: ['DS-1: Form'] })
    expect(lists[3]).toMatchObject({ kind: 'bulleted_list', items: ['TC-1: Happy path'] })

    const descParagraphs = page.blocks.filter((b) => b.kind === 'paragraph').map((b) => ('text' in b ? b.text : ''))
    expect(descParagraphs).toContain('POST /auth/login')
  })
})
