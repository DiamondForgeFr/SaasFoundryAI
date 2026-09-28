import { mkdir, readFile, writeFile } from 'fs/promises'

import { installAgentInstructions } from '../harness/agent-instructions'
import { resolveHarnessAgents, type HarnessAgent } from '../harness/agent-registry'
import type { SaaSFoundryManifest } from '../types'

export function projectMultirepoChildManifest(manifest: SaaSFoundryManifest, app: 'api' | 'web'): SaaSFoundryManifest {
  const harness = manifest.modules?.harness
  if (!harness) throw new Error('Cannot project a multirepo child manifest without a harness declaration.')
  const appName = `${manifest.projectName}-${app}`
  return {
    $schema: manifest.$schema,
    manifestVersion: manifest.manifestVersion,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    structure: 'cli',
    projectName: appName,
    projection: { kind: 'multirepo-child', rootProjectName: manifest.projectName, app },
    mainBranch: manifest.mainBranch,
    modules: { harness: JSON.parse(JSON.stringify(harness)), advancedSkills: [...(manifest.modules?.advancedSkills ?? [])] },
    language: manifest.language ? JSON.parse(JSON.stringify(manifest.language)) : undefined,
    workflow: manifest.workflow ? JSON.parse(JSON.stringify(manifest.workflow)) : undefined,
    aiRules: manifest.aiRules ? JSON.parse(JSON.stringify(manifest.aiRules)) : undefined,
    tools: manifest.tools ? JSON.parse(JSON.stringify(manifest.tools)) : undefined,
    skillsAccounts: manifest.skillsAccounts ? JSON.parse(JSON.stringify(manifest.skillsAccounts)) : undefined,
    fileHashes: {}
  }
}

/**
 * Multirepo apps are independent Git checkouts. Agent lifecycle commands run
 * from those checkout roots, so each app needs a regular manifest projection
 * even though the project root remains the canonical scaffold manifest.
 */
export async function writeMultirepoAgentManifests(manifest: SaaSFoundryManifest, projectName: string): Promise<void> {
  if (manifest.structure !== 'multirepo') return
  if (manifest.projectName !== projectName) throw new Error('The multirepo projection project name must match the root manifest.')
  for (const app of ['api', 'web'] as const) {
    const appName = `${projectName}-${app}`
    const projection = projectMultirepoChildManifest(manifest, app)
    await mkdir(`apps/${appName}`, { recursive: true })
    await writeFile(`apps/${appName}/.saasfoundry.json`, JSON.stringify(projection, null, 2))
  }
}

export async function installSelectedAgentInstructions(manifest: SaaSFoundryManifest, projectName: string, agents: HarnessAgent[] | undefined): Promise<void> {
  const declaredAgents = resolveHarnessAgents(agents)

  const targets = manifest.structure === 'monorepo' ? ['.'] : [`apps/${projectName}-api`, `apps/${projectName}-web`]
  for (const targetPath of targets) {
    const targetManifestPath = targetPath === '.' ? '.saasfoundry.json' : `${targetPath}/.saasfoundry.json`
    const targetManifest = targetPath === '.' ? manifest : (JSON.parse(await readFile(targetManifestPath, 'utf8')) as SaaSFoundryManifest)
    const report = await installAgentInstructions({ targetPath, agents: declaredAgents, manifest: targetManifest })
    if (Object.keys(report.fileHashes).length > 0) {
      targetManifest.fileHashes = { ...targetManifest.fileHashes, ...report.fileHashes }
      await writeFile(targetManifestPath, JSON.stringify(targetManifest, null, 2))
      if (targetPath === '.') Object.assign(manifest, targetManifest)
    }
  }
}
