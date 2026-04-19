import type { Client } from '@notionhq/client'

import { createNotionSrsAdapterFromEnv, NotionSrsAdapter } from '../../../../builders/srs/notion.adapter'
import { EpicSpec, FrSpec } from '../../../../builders/srs/types'

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
  })

  describe('updatePage', () => {
    it('appends rendered blocks for title + sections', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await adapter.updatePage('page_x', {
        title: 'New Title',
        sections: [{ heading: 'Section A', body: 'Body A' }]
      })

      expect(calls.blocksAppendCalls).toHaveLength(1)
      const call = calls.blocksAppendCalls[0] as { block_id: string; children: Array<{ type: string }> }
      expect(call.block_id).toBe('page_x')
      expect(call.children.map((c) => c.type)).toEqual(['heading_1', 'heading_2', 'paragraph'])
    })

    it('does nothing when content is empty', async () => {
      const { client, calls } = buildMockClient()
      const adapter = new NotionSrsAdapter({ apiToken: 'tk', client })

      await adapter.updatePage('page_x', {})

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
