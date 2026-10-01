import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Repository URLs the templates and early prompts shipped as placeholders. A package
 * pointing at one of them points at SaaSFoundryAI's author, not at the project (#858).
 */
const PLACEHOLDER_REPOSITORY = /github\.com[/:]agachet\/saasfoundry(?:[/.#]|$)/i

export interface PackageIdentity {
  name: string
  description: string
  keywords: string[]
  /** Git URL of the project's repository; unknown when absent. */
  repositoryUrl?: string
}

/** The project's repository URL, or undefined when the value is empty or a template placeholder. */
export function knownRepositoryUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const trimmed = url.trim()
  return trimmed && !PLACEHOLDER_REPOSITORY.test(trimmed) ? trimmed : undefined
}

/**
 * The browsable address of a git URL: `git@host:owner/repo.git` and
 * `https://host/owner/repo(.git)` both become `https://host/owner/repo`.
 */
function webUrlOf(repositoryUrl: string): string | undefined {
  const scp = /^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(repositoryUrl)
  if (scp) return `https://${scp[1]}/${scp[2]}`
  const http = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(repositoryUrl)
  return http ? `https://${http[1]}/${http[2]}` : undefined
}

/**
 * Stamp a generated `package.json` with the project's identity.
 *
 * `repository`, `homepage` and `bugs` describe one repository: they are set together from
 * the project's URL, or removed together when none is known. Falling back to the template's
 * values made every such project advertise SaaSFoundryAI's author repository (#858).
 */
export function applyPackageIdentity(packageJson: Record<string, unknown>, identity: PackageIdentity): Record<string, unknown> {
  packageJson.name = identity.name
  packageJson.description = identity.description
  packageJson.keywords = identity.keywords

  const repositoryUrl = knownRepositoryUrl(identity.repositoryUrl)
  if (!repositoryUrl) {
    delete packageJson.repository
    delete packageJson.homepage
    delete packageJson.bugs
    return packageJson
  }

  packageJson.repository = { type: 'git', url: repositoryUrl }
  const webUrl = webUrlOf(repositoryUrl)
  if (webUrl) {
    packageJson.homepage = `${webUrl}#readme`
    packageJson.bugs = { url: `${webUrl}/issues` }
  } else {
    delete packageJson.homepage
    delete packageJson.bugs
  }
  return packageJson
}

export interface LivePackageIdentity {
  description?: string
  repositoryUrl?: string
}

/**
 * Description and repository URL of a package already on disk. `sf update` regenerates the
 * project from its manifest, which records neither: without reading them back, the target
 * of the three-way merge erases the project's own identity (#858).
 */
export async function readLivePackageIdentity(packageDir: string): Promise<LivePackageIdentity> {
  try {
    const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
    const repository = packageJson.repository
    const url = typeof repository === 'string' ? repository : repository && typeof repository === 'object' ? (repository as Record<string, unknown>).url : undefined
    return {
      description: typeof packageJson.description === 'string' ? packageJson.description : undefined,
      repositoryUrl: knownRepositoryUrl(url)
    }
  } catch {
    return {}
  }
}
