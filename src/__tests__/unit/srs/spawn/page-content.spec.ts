import { renderEpicPage } from '../../../../builders/srs/templates/pages/epic.tpl'
import { renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
import { parseEpicPage, parseFrPage } from '../../../../srs/spawn/page-content'
import { asRead } from '../../../helpers/srs-pages'

// #837 — read back through the renderers that write the pages, so a template change that
// the parser does not follow fails here rather than as empty ticket bodies
describe('parseFrPage', () => {
  it('reads back what renderFrPage wrote', () => {
    const page = renderFrPage({
      parentEpicPageId: 'v',
      fr: {
        id: 'FR-1',
        title: 'Edit a mission',
        priority: 'P1',
        description: 'An operator changes a mission in the console.',
        acceptanceCriteria: ['The edit is saved as a draft', 'Publishing applies it'],
        urRefs: ['UR-1', 'UR-2'],
        dsRefs: ['DS-1'],
        tcRefs: ['TC-1'],
        validationRules: ['A mission keeps one entry point'],
        securityRationale: 'Only operators may publish'
      }
    })

    expect(parseFrPage(asRead(page))).toEqual({
      description: 'An operator changes a mission in the console.',
      priority: 'P1',
      acceptanceCriteria: ['The edit is saved as a draft', 'Publishing applies it'],
      urRefs: ['UR-1', 'UR-2'],
      dsRefs: ['DS-1'],
      tcRefs: ['TC-1'],
      validationRules: ['A mission keeps one entry point'],
      securityRationale: 'Only operators may publish'
    })
  })

  it('reads the empty cells as nothing, not as "—"', () => {
    const parsed = parseFrPage(asRead(renderFrPage({ parentEpicPageId: 'v', fr: { id: 'FR-2', title: 'Bare' } })))

    expect(parsed).toEqual({ description: undefined, priority: undefined, acceptanceCriteria: [], urRefs: [], dsRefs: [], tcRefs: [], validationRules: [], securityRationale: undefined })
  })

  it('finds nothing on a page whose tables were not read', () => {
    const page = asRead(renderFrPage({ parentEpicPageId: 'v', fr: { id: 'FR-3', title: 'x', description: 'hidden' } }))
    for (const block of page.blocks) delete block.rows

    expect(parseFrPage(page).description).toBeUndefined()
  })
})

describe('parseEpicPage', () => {
  it('reads a feature page: intent, UR narratives and DS titles, group rows skipped', () => {
    const page = renderEpicPage({
      title: 'Automorph',
      parentPageId: 'root',
      businessValue: 'Reshape a mission without a redeploy.',
      scope: 'The console only.',
      urs: [{ id: 'UR-1', narrative: 'reshape a mission', group: 'UR-G' }],
      frs: [],
      dsItems: [{ id: 'DS-1', title: 'Mission diff', description: 'stored as a diff', group: 'DS-G' }]
    })

    const parsed = parseEpicPage(asRead(page))

    expect(parsed.businessValue).toBe('Reshape a mission without a redeploy.')
    expect(parsed.scope).toBe('The console only.')
    expect([...parsed.urs]).toEqual([['UR-1', 'reshape a mission']])
    expect([...parsed.ds]).toEqual([['DS-1', 'Mission diff']])
  })

  it('reads what a version page says changed', () => {
    const page = renderEpicPage({ title: 'v0', parentPageId: 'f', parentId: 'feature', businessValue: 'A first edit', version: { changes: ['Edit a mission', 'Publish it'] }, urs: [], frs: [] })

    expect(parseEpicPage(asRead(page))).toMatchObject({ businessValue: 'A first edit', scope: undefined, changes: ['Edit a mission', 'Publish it'] })
  })
})
