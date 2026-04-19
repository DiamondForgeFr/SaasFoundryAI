import { SrsAdapter } from '../builders/srs/types'
import { SrsPageRef } from '../types'

export interface BootstrapSrsOptions {
  projectName: string
  parentInput: string
  adapter: SrsAdapter
}

export interface BootstrapSrsResult {
  rootPage: SrsPageRef
  categoryPage: SrsPageRef
}

const CATEGORY_PAGE_NAME = 'User flows & Specifications'

export async function bootstrapSrs(options: BootstrapSrsOptions): Promise<BootstrapSrsResult> {
  const { projectName, parentInput, adapter } = options

  await adapter.init()
  const parent = await adapter.resolveParent(parentInput)

  const rootTitle = `${projectName} — Project Overview`
  const rootRef = await adapter.createPage(parent.id, rootTitle)
  const rootPage: SrsPageRef = { id: rootRef.id, url: rootRef.url, name: rootTitle }

  const categoryRef = await adapter.createPage(rootPage.id, CATEGORY_PAGE_NAME)
  const categoryPage: SrsPageRef = { id: categoryRef.id, url: categoryRef.url, name: CATEGORY_PAGE_NAME }

  return { rootPage, categoryPage }
}
