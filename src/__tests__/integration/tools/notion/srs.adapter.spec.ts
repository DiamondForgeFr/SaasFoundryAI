import { Client } from '@notionhq/client'

import { EpicSpec, FrSpec } from '../../../../builders/srs/types'
import { NotionSrsAdapter } from '../../../../tools/notion/srs.adapter'

const hasCreds = !!process.env.NOTION_INTEGRATION_TOKEN && !!process.env.NOTION_SANDBOX_PARENT_PAGE_ID
const describeIntegration = hasCreds ? describe : describe.skip

describeIntegration('NotionSrsAdapter (integration, sandbox)', () => {
  let adapter: NotionSrsAdapter
  let cleanupClient: Client
  let sandboxParentPageId: string
  let epicSpec: EpicSpec

  const createdPageIds: string[] = []

  const buildFrSpec = (parentEpicPageId: string): FrSpec => ({
    parentEpicPageId,
    fr: {
      id: 'FR-1',
      title: 'Live create + list',
      description: 'Confirms the Notion Create + Children Read flow.',
      acceptanceCriteria: ['FR page appears under the parent Epic.']
    },
    urs: [{ id: 'UR-1', narrative: 'Adapter is callable against a live workspace.' }]
  })

  beforeAll(() => {
    const apiToken = process.env.NOTION_INTEGRATION_TOKEN as string
    sandboxParentPageId = process.env.NOTION_SANDBOX_PARENT_PAGE_ID as string
    const notionVersion = process.env.NOTION_API_VERSION

    adapter = new NotionSrsAdapter({ apiToken, notionVersion })
    cleanupClient = new Client({ auth: apiToken, notionVersion })

    epicSpec = {
      title: `SaaSFoundry integration test Epic ${Date.now()}`,
      parentPageId: sandboxParentPageId,
      businessValue: 'Automated sandbox run — safe to archive.',
      scope: 'Exercises create → fetch → list → update → archive path.',
      urs: [{ id: 'UR-1', narrative: 'Adapter is callable against a live workspace.' }],
      frs: [
        {
          id: 'FR-1',
          title: 'Live create + list',
          description: 'Confirms the Notion Create + Children Read flow.',
          acceptanceCriteria: ['FR page appears under the parent Epic.'],
          urRefs: ['UR-1']
        }
      ]
    }
  })

  afterAll(async () => {
    for (const pageId of createdPageIds.reverse()) {
      try {
        await cleanupClient.pages.update({ page_id: pageId, archived: true })
      } catch {
        // best-effort cleanup; sandbox pages are disposable
      }
    }
  }, 30000)

  it('validates the token via init()', async () => {
    await expect(adapter.init()).resolves.toBeUndefined()
  }, 15000)

  it('runs create → fetch → list → update end-to-end', async () => {
    const epic = await adapter.createEpicPage(epicSpec)
    expect(epic.id).toBeTruthy()
    expect(epic.title).toBe(epicSpec.title)
    createdPageIds.push(epic.id)

    const fr = await adapter.createFrPage(buildFrSpec(epic.id))
    expect(fr.id).toBeTruthy()
    expect(fr.title).toBe('FR-1 — Live create + list')
    createdPageIds.push(fr.id)

    const raw = await adapter.fetchPage(epic.id)
    expect(raw.pageId).toBe(epic.id)
    expect(raw.title).toBe(epicSpec.title)
    expect(raw.blocks.length).toBeGreaterThan(0)

    const children = await adapter.listChildren(epic.id)
    const childIds = children.map((c) => c.id)
    expect(childIds).toContain(fr.id)

    await adapter.updatePage(epic.id, {
      title: 'Integration test update',
      sections: [{ heading: 'Run log', body: 'Adapter ran successfully.' }]
    })

    const updated = await adapter.fetchPage(epic.id)
    const texts = updated.blocks.map((b) => b.text)
    expect(texts).toEqual(expect.arrayContaining(['Integration test update']))
  }, 60000)
})
