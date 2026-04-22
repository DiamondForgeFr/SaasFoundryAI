import { PageContent, SrsAdapter } from '../builders/srs/types'
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

interface RollbackableAdapter {
  archivePage?(pageId: string): Promise<void>
  updatePage(pageId: string, content: PageContent): Promise<void>
}

export async function bootstrapSrs(options: BootstrapSrsOptions): Promise<BootstrapSrsResult> {
  const { projectName, parentInput, adapter } = options

  await adapter.init()
  const parent = await adapter.resolveParent(parentInput)

  const rootTitle = `${projectName}-srs`
  const rootRef = await adapter.createPage(parent.id, rootTitle)
  const rootPage: SrsPageRef = { id: rootRef.id, url: rootRef.url, name: rootTitle }

  try {
    const categoryRef = await adapter.createPage(rootPage.id, CATEGORY_PAGE_NAME)
    const categoryPage: SrsPageRef = { id: categoryRef.id, url: categoryRef.url, name: CATEGORY_PAGE_NAME }
    return { rootPage, categoryPage }
  } catch (error) {
    // Category creation failed — best-effort archive of the orphan root page
    // so we don't pollute the user's workspace. Swallow rollback errors and
    // surface the original failure.
    const rollback = (adapter as unknown as RollbackableAdapter).archivePage
    if (typeof rollback === 'function') {
      try {
        await rollback.call(adapter, rootPage.id)
      } catch {
        // best-effort
      }
    }
    throw error
  }
}
