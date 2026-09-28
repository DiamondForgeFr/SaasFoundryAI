import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type ProjectStructure = 'monorepo' | 'multirepo'

export interface ScannerRoots {
  apiRoot: string
  webRoot: string
}

function pickExistingDir(candidates: string[]): string | undefined {
  for (const dir of candidates) {
    if (!existsSync(dir)) continue
    try {
      if (statSync(dir).isDirectory()) return dir
    } catch {
      // ignore unreadable entries
    }
  }
  return undefined
}

export function resolveScannerRoots(scanRoot: string, structure: ProjectStructure | undefined): ScannerRoots {
  if (structure === 'monorepo') {
    return {
      apiRoot: join(scanRoot, 'api'),
      webRoot: join(scanRoot, 'web')
    }
  }

  // multirepo or unknown : user likely ran the CLI inside a single app repo.
  // Try the conventional app sub-folders first (for dev/testing on mixed
  // checkouts), fall back to the scan root itself so scanners can look for
  // their signals at the top level.
  const apiCandidate = pickExistingDir([join(scanRoot, 'api'), join(scanRoot, 'src', 'modules')])
  const webCandidate = pickExistingDir([join(scanRoot, 'web'), join(scanRoot, 'src', 'pages')])
  return {
    apiRoot: apiCandidate === join(scanRoot, 'src', 'modules') ? scanRoot : (apiCandidate ?? scanRoot),
    webRoot: webCandidate === join(scanRoot, 'src', 'pages') ? scanRoot : (webCandidate ?? scanRoot)
  }
}
