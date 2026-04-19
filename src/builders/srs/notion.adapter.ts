import { Client } from '@notionhq/client'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, SrsAdapter } from './types'

export interface NotionSrsAdapterOptions {
  apiToken: string
  notionVersion?: string
}

export class NotionSrsAdapter implements SrsAdapter {
  private readonly client: Client

  constructor(options: NotionSrsAdapterOptions) {
    if (!options.apiToken) {
      throw new Error('NotionSrsAdapter: apiToken is required')
    }
    this.client = new Client({
      auth: options.apiToken,
      notionVersion: options.notionVersion
    })
  }

  async init(): Promise<void> {
    try {
      await this.client.users.me({})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`NotionSrsAdapter: token validation failed — ${message}`)
    }
  }

  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    void spec
    throw new Error('NotionSrsAdapter.createEpicPage: not yet implemented')
  }

  async createFrPage(spec: FrSpec): Promise<PageRef> {
    void spec
    throw new Error('NotionSrsAdapter.createFrPage: not yet implemented')
  }

  async updatePage(pageId: string, content: PageContent): Promise<void> {
    void pageId
    void content
    throw new Error('NotionSrsAdapter.updatePage: not yet implemented')
  }

  async fetchPage(pageId: string): Promise<RawContent> {
    void pageId
    throw new Error('NotionSrsAdapter.fetchPage: not yet implemented')
  }

  async listChildren(parentPageId: string): Promise<PageRef[]> {
    void parentPageId
    throw new Error('NotionSrsAdapter.listChildren: not yet implemented')
  }
}

export function createNotionSrsAdapterFromEnv(): NotionSrsAdapter {
  const apiToken = process.env.NOTION_API_TOKEN
  if (!apiToken) {
    throw new Error('createNotionSrsAdapterFromEnv: NOTION_API_TOKEN is not set')
  }
  return new NotionSrsAdapter({
    apiToken,
    notionVersion: process.env.NOTION_API_VERSION
  })
}
