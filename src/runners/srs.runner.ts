import { SrsAdapter } from '../builders/srs/types'
import { SrsPageRef } from '../types'

export interface BootstrapSrsOptions {
  projectName: string
  parentInput: string
  adapter: SrsAdapter
}

export interface BootstrapSrsResult {
  rootPage: SrsPageRef
}

export async function bootstrapSrs(options: BootstrapSrsOptions): Promise<BootstrapSrsResult> {
  const { projectName, parentInput, adapter } = options

  await adapter.init()
  const parent = await adapter.resolveParent(parentInput)

  const rootTitle = `${projectName}-srs`
  const rootRef = await adapter.createPage(parent.id, rootTitle)
  const rootPage: SrsPageRef = { id: rootRef.id, url: rootRef.url, name: rootTitle }

  return { rootPage }
}
