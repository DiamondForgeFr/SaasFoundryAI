import type { Client } from '@notionhq/client'

import { EpicSpec, FrSpec } from '../../../../builders/srs/types'
import { createNotionSrsAdapterFromEnv, extractNotionPageId, NotionSrsAdapter } from '../../../../tools/notion/srs.adapter'

interface MockCalls {
  meCalls: unknown[]
  pagesCreateCalls: unknown[]
  pagesRetrieveCalls: unknown[]
  blocksAppendCalls: unknown[]
  blocksListCalls: unknown[]
}

function buildMockClient(
  overrides: {
    meImpl?: () => Promise<unknown>
    pagesCreateImpl?: (args: unknown) => Promise<unknown>
    pagesRetrieveImpl?: (args: unknown) => Promise<unknown>
    blocksListImpl?: (args: unknown) => Promise<unknown>
    blocksAppendImpl?: (args: unknown) => Promise<unknown>
  } = {}
): { client: Client; calls: MockCalls } {
  const calls: MockCalls = { meCalls: [], pagesCreateCalls: [], pagesRetrieveCalls: [], blocksAppendCalls: [], blocksListCalls: [] }
  const client = {
    users: {
      me: async (args: unknown) => {
        calls.meCalls.push(args)
        return (overrides.meImpl ?? (async () => ({ id: 'bot_1', type: 'bot' })))()
      }
    },
    pages: {
      create: async (args: unknown) => {
        calls.pagesCreateCalls.push(args)
        return (
          overrides.pagesCreateImpl ??
          (async (a: unknown) => ({
            id: 'page_new',
            url: 'https://notion.so/page_new',
            object: 'page',
            properties: (a as { properties?: unknown }).properties
          }))
        )(args)
      },
      retrieve: async (args: unknown) => {
        calls.pagesRetrieveCalls.push(args)
        return (overrides.pagesRetrieveImpl ?? (async () => ({ id: 'page_x', url: 'https://notion.so/page_x', object: 'page', properties: {} })))(args)
      }
    },
    blocks: {
      children: {
        list: async (args: unknown) => {
          calls.blocksListCalls.push(args)
          return (overrides.blocksListImpl ?? (async () => ({ results: [], next_cursor: null, has_more: false })))(args)
        },
        append: async (args: unknown) => {
          calls.blocksAppendCalls.push(args)
          return (overrides.blocksAppendImpl ?? (async () => ({ results: [] })))(args)
        }
      }
    }
  }
  return { client: client as unknown as Client, calls }
}

const sampleEpic: EpicSpec = {
  title: 'User authentication',
  parentPageId: 'parent_123',
  businessValue: 'Users can sign in securely.',
  scope: 'Email + password auth, no SSO.',
  urs: [{ id: 'UR-1', narrative: 'A user can sign in with email.' }],
  frs: [
    {
      id: 'FR-1',
      title: 'Login endpoint',
      description: 'POST /auth/login',
      acceptanceCriteria: ['returns 200 with valid creds', 'returns 401 with invalid creds'],
      urRefs: ['UR-1']
    }
  ]
}

const sampleFr: FrSpec = {
  parentEpicPageId: 'epic_42',
  fr: {
    id: 'FR-1',
    title: 'Login endpoint',
    description: 'POST /auth/login',
    acceptanceCriteria: ['returns 200 with valid creds']
  },
  urs: [{ id: 'UR-1', narrative: 'A user can sign in.' }]
}

describe('NotionSrsAdapter', () => {
  describe('constructor', () => {
    it('requires apiToken when no client is injected', () => {
      expect(() => new NotionSrsAdapter({ apiToken: '' })).toThrow(/apiToken is required/)
    })

    it('accepts an injected client without apiToken', () => {
      const { client } = buildMockClient()
      expect(() => new NotionSrsAdapter({ apiToken: '', client })).not.toThrow()
    })
  })

  describe('init', () => {
    it('resolves when users.me succeeds', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })
      await expect(adapter.init()).resolves.toBeUndefined()
      expect(calls.meCalls).toHaveLength(1)
    })

    it('throws a helpful error on token failure', async () => {
      const { client } = buildMockClient({
        meImpl: async () => {
          throw new Error('unauthorized')
        }
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })
      await expect(adapter.init()).rejects.toThrow(/token validation failed — unauthorized/)
    })
  })

  describe('resolveParent', () => {
    it('resolves a Notion page URL to an id + name', async () => {
      const { client, calls } = buildMockClient({
        pagesRetrieveImpl: async () => ({
          id: 'abc12345-abc1-2345-abc1-2345abc12345',
          url: 'https://www.notion.so/My-parent-abc12345abc12345abc12345abc12345',
          object: 'page',
          properties: {
            title: { type: 'title', title: [{ type: 'text', text: { content: 'My parent' }, plain_text: 'My parent' }] }
          }
        })
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const parent = await adapter.resolveParent('https://www.notion.so/My-parent-abc12345abc12345abc12345abc12345')

      expect(parent.id).toBe('abc12345-abc1-2345-abc1-2345abc12345')
      expect(parent.name).toBe('My parent')
      expect(parent.url).toBe('https://www.notion.so/My-parent-abc12345abc12345abc12345abc12345')
      expect(calls.pagesRetrieveCalls).toHaveLength(1)
      expect(calls.pagesRetrieveCalls[0]).toEqual({ page_id: 'abc12345-abc1-2345-abc1-2345abc12345' })
    })

    it('resolves a raw 32-char hex id', async () => {
      const { client } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const parent = await adapter.resolveParent('abc12345abc12345abc12345abc12345')

      expect(parent.id).toBe('abc12345-abc1-2345-abc1-2345abc12345')
    })

    it('falls back to the page id as the name when no title is present', async () => {
      const { client } = buildMockClient({
        pagesRetrieveImpl: async () => ({
          id: 'page_x',
          url: 'https://notion.so/page_x',
          object: 'page',
          properties: {}
        })
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const parent = await adapter.resolveParent('abc12345abc12345abc12345abc12345')

      expect(parent.name).toBe('abc12345-abc1-2345-abc1-2345abc12345')
    })

    it('throws a helpful error on empty input', async () => {
      const { client } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await expect(adapter.resolveParent('   ')).rejects.toThrow(/input is empty/)
    })

    it('throws a helpful error when no Notion id can be extracted', async () => {
      const { client } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await expect(adapter.resolveParent('not-a-valid-page-ref')).rejects.toThrow(/could not extract a Notion page ID/)
    })

    it('wraps retrieve errors with a helpful "share with integration" hint', async () => {
      const { client } = buildMockClient({
        pagesRetrieveImpl: async () => {
          throw new Error('object_not_found')
        }
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await expect(adapter.resolveParent('abc12345abc12345abc12345abc12345')).rejects.toThrow(/could not access page.*object_not_found.*integration/s)
    })
  })

  describe('createPage (agnostic helper)', () => {
    it('creates an empty page when no content is provided', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const result = await adapter.createPage('parent_1', 'My Root')

      expect(result).toEqual({ id: 'page_new', url: 'https://notion.so/page_new', title: 'My Root' })
      expect(calls.pagesCreateCalls).toHaveLength(1)
      const call = calls.pagesCreateCalls[0] as { parent: { page_id: string }; properties: { title: { title: Array<{ text: { content: string } }> } }; children: unknown[] }
      expect(call.parent).toEqual({ page_id: 'parent_1' })
      expect(call.properties.title.title[0].text.content).toBe('My Root')
      expect(call.children).toEqual([])
    })

    it('renders PageContent blocks when content is provided', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await adapter.createPage('parent_1', 'With body', {
        blocks: [
          { kind: 'heading', level: 2, text: 'Section' },
          { kind: 'paragraph', text: 'Body' }
        ]
      })

      const call = calls.pagesCreateCalls[0] as { children: Array<{ type: string }> }
      expect(call.children.map((c) => c.type)).toEqual(['heading_2', 'paragraph'])
    })
  })

  describe('createEpicPage', () => {
    it('posts to the right parent with title + children and returns a PageRef', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const result = await adapter.createEpicPage(sampleEpic)

      expect(result).toEqual({ id: 'page_new', url: 'https://notion.so/page_new', title: 'User authentication' })
      expect(calls.pagesCreateCalls).toHaveLength(1)

      const call = calls.pagesCreateCalls[0] as {
        parent: { page_id: string }
        properties: { title: { title: Array<{ text: { content: string } }> } }
        children: unknown[]
      }
      expect(call.parent).toEqual({ page_id: 'parent_123' })
      expect(call.properties.title.title[0].text.content).toBe('User authentication')
      expect(call.children.length).toBeGreaterThan(0)
    })

    it('splits >100 children across one create + N appends (Notion caps at 100 per request)', async () => {
      // Uses createPage directly to drive the chunker with a controlled block count,
      // independent of template shape (which collapses many items into few blocks via tables).
      const manyBlocks = Array.from({ length: 150 }, (_, i) => ({ kind: 'paragraph' as const, text: `p-${i + 1}` }))
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await adapter.createPage('parent_123', 'Big page', { blocks: manyBlocks })

      expect(calls.pagesCreateCalls).toHaveLength(1)
      const create = calls.pagesCreateCalls[0] as { children: unknown[] }
      expect(create.children.length).toBe(100)
      expect(calls.blocksAppendCalls.length).toBeGreaterThanOrEqual(1)
      for (const append of calls.blocksAppendCalls as Array<{ children: unknown[] }>) {
        expect(append.children.length).toBeLessThanOrEqual(100)
      }
    })

    it('rolls back (archives) the created page when a follow-up append fails', async () => {
      const manyBlocks = Array.from({ length: 150 }, (_, i) => ({ kind: 'paragraph' as const, text: `p-${i + 1}` }))
      const pagesUpdateCalls: unknown[] = []
      const { client } = buildMockClient({
        blocksAppendImpl: async () => {
          throw new Error('append failed')
        }
      })
      const patchedClient = client as unknown as { pages: { update: (args: unknown) => Promise<unknown> } }
      patchedClient.pages.update = async (args: unknown) => {
        pagesUpdateCalls.push(args)
        return {}
      }
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await expect(adapter.createPage('parent_123', 'Big page', { blocks: manyBlocks })).rejects.toThrow(/append failed/)
      expect(pagesUpdateCalls).toHaveLength(1)
      expect(pagesUpdateCalls[0]).toMatchObject({ page_id: 'page_new', archived: true })
    })
  })

  describe('createFrPage', () => {
    it('posts to the parent epic with the composite title and UR/AC blocks', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const result = await adapter.createFrPage(sampleFr)

      expect(result.title).toBe('FR-1 — Login endpoint')
      const call = calls.pagesCreateCalls[0] as { parent: { page_id: string }; children: Array<Record<string, unknown>> }
      expect(call.parent).toEqual({ page_id: 'epic_42' })
      expect(call.children.length).toBeGreaterThan(0)
    })
  })

  describe('fetchPage', () => {
    it('returns a RawContent with mapped blocks and extracted title', async () => {
      const { client } = buildMockClient({
        pagesRetrieveImpl: async () => ({
          id: 'page_x',
          url: 'https://notion.so/page_x',
          object: 'page',
          properties: {
            title: { type: 'title', title: [{ type: 'text', text: { content: 'My Page' }, plain_text: 'My Page' }] }
          }
        }),
        blocksListImpl: async () => ({
          next_cursor: null,
          has_more: false,
          results: [
            { type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: 'Title' }, plain_text: 'Title' }] } },
            { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Body' }, plain_text: 'Body' }] } },
            { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'Item' }, plain_text: 'Item' }] } },
            { type: 'divider', divider: {} }
          ]
        })
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const raw = await adapter.fetchPage('page_x')

      expect(raw.pageId).toBe('page_x')
      expect(raw.url).toBe('https://notion.so/page_x')
      expect(raw.title).toBe('My Page')
      expect(raw.blocks).toHaveLength(4)
      expect(raw.blocks[0]).toEqual({ kind: 'heading', text: 'Title' })
      expect(raw.blocks[1]).toEqual({ kind: 'paragraph', text: 'Body' })
      expect(raw.blocks[2]).toEqual({ kind: 'list', text: 'Item' })
      expect(raw.blocks[3]).toEqual({ kind: 'other', text: '' })
    })
  })

  describe('listChildren', () => {
    it('returns only child_page blocks as PageRefs', async () => {
      const { client } = buildMockClient({
        blocksListImpl: async () => ({
          next_cursor: null,
          has_more: false,
          results: [
            { id: 'p1', type: 'child_page', child_page: { title: 'Epic 1' } },
            { id: 'p2', type: 'paragraph', paragraph: { rich_text: [] } },
            { id: 'p3', type: 'child_page', child_page: { title: 'Epic 2' } }
          ]
        })
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const refs = await adapter.listChildren('root')

      expect(refs).toEqual([
        { id: 'p1', url: '', title: 'Epic 1' },
        { id: 'p3', url: '', title: 'Epic 2' }
      ])
    })

    it('walks the has_more/next_cursor chain to read all children', async () => {
      let page = 0
      const { client, calls } = buildMockClient({
        blocksListImpl: async () => {
          page += 1
          if (page === 1) {
            return {
              has_more: true,
              next_cursor: 'cursor-2',
              results: [{ id: 'p1', type: 'child_page', child_page: { title: 'A' } }]
            }
          }
          if (page === 2) {
            return {
              has_more: true,
              next_cursor: 'cursor-3',
              results: [{ id: 'p2', type: 'child_page', child_page: { title: 'B' } }]
            }
          }
          return { has_more: false, next_cursor: null, results: [{ id: 'p3', type: 'child_page', child_page: { title: 'C' } }] }
        }
      })
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      const refs = await adapter.listChildren('root')

      expect(refs.map((r) => r.id)).toEqual(['p1', 'p2', 'p3'])
      expect(calls.blocksListCalls).toHaveLength(3)
      const cursors = (calls.blocksListCalls as Array<{ start_cursor?: string }>).map((c) => c.start_cursor)
      expect(cursors).toEqual([undefined, 'cursor-2', 'cursor-3'])
    })
  })

  describe('updatePage', () => {
    it('appends rendered blocks for title + blocks', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await adapter.updatePage('page_x', {
        title: 'New Title',
        blocks: [
          { kind: 'heading', level: 2, text: 'Section A' },
          { kind: 'paragraph', text: 'Body A' }
        ]
      })

      expect(calls.blocksAppendCalls).toHaveLength(1)
      const call = calls.blocksAppendCalls[0] as { block_id: string; children: Array<{ type: string }> }
      expect(call.block_id).toBe('page_x')
      expect(call.children.map((c) => c.type)).toEqual(['heading_1', 'heading_2', 'paragraph'])
    })

    it('does nothing when content is empty', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await adapter.updatePage('page_x', { blocks: [] })

      expect(calls.blocksAppendCalls).toHaveLength(0)
    })
  })
})

describe('createNotionSrsAdapterFromEnv', () => {
  const previousToken = process.env.NOTION_API_TOKEN
  const previousVersion = process.env.NOTION_API_VERSION

  afterEach(() => {
    if (previousToken === undefined) delete process.env.NOTION_API_TOKEN
    else process.env.NOTION_API_TOKEN = previousToken
    if (previousVersion === undefined) delete process.env.NOTION_API_VERSION
    else process.env.NOTION_API_VERSION = previousVersion
  })

  it('throws when NOTION_API_TOKEN is unset', () => {
    delete process.env.NOTION_API_TOKEN
    expect(() => createNotionSrsAdapterFromEnv()).toThrow(/NOTION_API_TOKEN is not set/)
  })

  it('constructs an adapter when NOTION_API_TOKEN is set', () => {
    process.env.NOTION_API_TOKEN = 'secret'
    expect(createNotionSrsAdapterFromEnv()).toBeInstanceOf(NotionSrsAdapter)
  })
})

describe('extractNotionPageId', () => {
  it('returns a dashed UUID when given a 32-char hex id', () => {
    expect(extractNotionPageId('abc12345abc12345abc12345abc12345')).toBe('abc12345-abc1-2345-abc1-2345abc12345')
  })

  it('returns a dashed UUID when given an already-dashed UUID', () => {
    expect(extractNotionPageId('ABC12345-ABC1-2345-ABC1-2345ABC12345')).toBe('abc12345-abc1-2345-abc1-2345abc12345')
  })

  it('extracts the id from a Notion URL with a slug', () => {
    expect(extractNotionPageId('https://www.notion.so/My-Page-abc12345abc12345abc12345abc12345')).toBe('abc12345-abc1-2345-abc1-2345abc12345')
  })

  it('extracts the id from a Notion URL with query params', () => {
    expect(extractNotionPageId('https://www.notion.so/ws/abc12345abc12345abc12345abc12345?v=1')).toBe('abc12345-abc1-2345-abc1-2345abc12345')
  })

  it('returns null when no 32-char hex id can be found', () => {
    expect(extractNotionPageId('not a page ref')).toBeNull()
    expect(extractNotionPageId('')).toBeNull()
  })

  it('trims surrounding angle brackets (markdown autolinks)', () => {
    expect(extractNotionPageId('<https://www.notion.so/abc12345abc12345abc12345abc12345>')).toBe('abc12345-abc1-2345-abc1-2345abc12345')
  })

  it('ignores a hex blob sitting inside a query-param value', () => {
    // The real page id is in the path; a second hex blob buried in ?ref= must not be considered a candidate.
    expect(extractNotionPageId('https://www.notion.so/page-abc12345abc12345abc12345abc12345?ref=def67890def67890def67890def67890')).toBe('abc12345-abc1-2345-abc1-2345abc12345')
  })

  it('returns null when multiple hex candidates sit at path boundaries (ambiguous)', () => {
    // Both hex blobs sit at natural URL boundaries — we refuse to guess.
    expect(extractNotionPageId('https://www.notion.so/foo-abc12345abc12345abc12345abc12345/bar-def67890def67890def67890def67890')).toBeNull()
  })

  it('rejects a hex run longer than 32 chars (no arbitrary truncation)', () => {
    // A 40-char hex run must not have its first 32 chars silently extracted.
    expect(extractNotionPageId('abc12345abc12345abc12345abc12345abcdef01')).toBeNull()
  })
})
