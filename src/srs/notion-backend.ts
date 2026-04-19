import { createNotionSrsAdapterFromEnv } from '../tools/notion/srs.adapter'
import { registerSrsBackend } from './registry'

export const NOTION_BACKEND_KEY = 'notion'

registerSrsBackend(NOTION_BACKEND_KEY, () => createNotionSrsAdapterFromEnv())
