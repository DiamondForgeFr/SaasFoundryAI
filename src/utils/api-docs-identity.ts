import { globSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { fileExists } from '../utils'
import { layoutStringProperties } from './source-layout'

/**
 * The title and description the API blueprint ships with. They appear in its OpenAPI
 * configuration, in the OpenAPI document and Stoplight page it emits, and in the header of
 * every api-client file orval generates from that document. Every generated API presented
 * itself as SaaSFoundryAI, with the CLI author's address as its contact (#884).
 */
export const TEMPLATE_API_DOCS = {
  title: 'SaaSFoundryAI API',
  description: 'An open-source solution for managing clients, invoices, and financial tasks.'
} as const

export interface ApiDocsIdentity {
  title: string
  description: string
}

/**
 * How a generated API presents itself: as the project. The description is kept on one line,
 * without the sequence that would close the block comment orval writes it into.
 */
export function apiDocsIdentity(projectName: string, projectDescription?: string): ApiDocsIdentity {
  const title = `${projectName} API`
  const description = projectDescription?.replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim()
  return { title, description: description || title }
}

/**
 * A TypeScript string literal as the generated projects' prettier prints it: single quotes,
 * unless the value holds more single quotes than double ones.
 */
export function tsStringLiteral(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\')
  const singles = (value.match(/'/g) ?? []).length
  const doubles = (value.match(/"/g) ?? []).length
  return singles > doubles ? `"${escaped.replace(/"/g, '\\"')}"` : `'${escaped.replace(/'/g, "\\'")}'`
}

/** The API's OpenAPI configuration, the document it ships and its offline Stoplight page. */
export async function applyApiDocsIdentity(apiPath: string, identity: ApiDocsIdentity): Promise<void> {
  const configPath = join(apiPath, 'src/configs/api-docs/open-api.config.ts')
  if (await fileExists(configPath)) {
    const config = (await readFile(configPath, 'utf8'))
      .replace(/^(\s+)title: .*,$/m, `$1title: ${tsStringLiteral(identity.title)},`)
      .replace(/^(\s+)description: .*,$/m, `$1description: ${tsStringLiteral(identity.description)},`)
    await writeFile(configPath, layoutStringProperties(config))
  }

  const documentPath = join(apiPath, 'docs/openapi.json')
  if (await fileExists(documentPath)) {
    const document = JSON.parse(await readFile(documentPath, 'utf8')) as { info?: Record<string, unknown> }
    document.info = { ...document.info, title: identity.title, description: identity.description }
    // Serialized as the API writes it, so its first boot rewrites the same bytes
    await writeFile(documentPath, JSON.stringify(document, null, 2))
  }

  const pagePath = join(apiPath, 'docs/index.html')
  if (await fileExists(pagePath)) {
    const page = await readFile(pagePath, 'utf8')
    await writeFile(
      pagePath,
      page.replace(`<title>${TEMPLATE_API_DOCS.title} documentation</title>`, () => `<title>${identity.title} documentation</title>`)
    )
  }
}

/**
 * The header orval writes into every generated api-client file. Left on the template's
 * title, `npm run codegen:check` would report drift as soon as the API emits its own.
 */
export async function applyApiClientIdentity(apiClientPath: string, identity: ApiDocsIdentity): Promise<void> {
  for (const file of globSync('src/generated/**/*.ts', { cwd: apiClientPath })) {
    const path = join(apiClientPath, file)
    const source = await readFile(path, 'utf8')
    const header = ` * ${TEMPLATE_API_DOCS.title}\n * ${TEMPLATE_API_DOCS.description}\n`
    if (source.includes(header))
      await writeFile(
        path,
        source.replace(header, () => ` * ${identity.title}\n * ${identity.description}\n`)
      )
  }
}
