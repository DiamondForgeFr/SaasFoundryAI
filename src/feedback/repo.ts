import { readFile } from 'fs/promises'
import path from 'path'

export interface FeedbackRepo {
  owner: string
  repo: string
  slug: string
  httpsUrl: string
}

/**
 * Resolve the CLI package root by walking up from this file's runtime location.
 *
 * At runtime the compiled output lives at `dist/feedback/repo.js`, so
 * `__dirname/../..` points at the published package root (which contains
 * `package.json`). The same shape is preserved in source (`src/feedback/`)
 * for jest runs via ts-jest.
 */
export function resolveCliPackageRoot(): string {
  return path.resolve(__dirname, '..', '..')
}

export async function readFeedbackRepo(): Promise<FeedbackRepo> {
  const pkgPath = path.join(resolveCliPackageRoot(), 'package.json')
  const raw = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as { repository?: unknown }
  const url = extractRepositoryUrl(pkg.repository)
  if (!url) throw new Error(`SaaSFoundry feedback: package.json#repository is missing or malformed at ${pkgPath}`)
  const parsed = parseGitHubUrl(url)
  if (!parsed) throw new Error(`SaaSFoundry feedback: could not parse GitHub repo from ${url}`)
  return parsed
}

export function parseGitHubUrl(url: string): FeedbackRepo | null {
  const cleaned = url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .trim()
  const patterns = [/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i, /^git@github\.com:([^/]+)\/([^/]+)\/?$/i, /^([^/\s]+)\/([^/\s]+)$/]
  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (!match) continue
    const owner = match[1]
    const repo = match[2]
    return { owner, repo, slug: `${owner}/${repo}`, httpsUrl: `https://github.com/${owner}/${repo}` }
  }
  return null
}

function extractRepositoryUrl(repository: unknown): string | null {
  if (typeof repository === 'string') return repository
  if (repository && typeof repository === 'object') {
    const r = repository as { url?: unknown }
    if (typeof r.url === 'string') return r.url
  }
  return null
}
