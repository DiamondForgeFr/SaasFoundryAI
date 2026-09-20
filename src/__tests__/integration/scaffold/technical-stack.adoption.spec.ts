import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withTemporaryTechnicalStack } from '../../../renderers/technical-stack.renderer'
import { buildTechnicalTransitionManifest, finalizeTechnicalAdoptionCandidate } from '../../../scaffold/technical-stack.adoption'
import { planTechnicalStackAdoption } from '../../../scaffold/technical-stack.planner'
import { applyTechnicalStackTransition } from '../../../scaffold/technical-stack.transaction'
import type { Answers, ProjectPorts, SaaSFoundryManifest } from '../../../types'

const ports: ProjectPorts = { db: 5435, api: 3500, web: 5173 }

function config(isMonorepo: boolean): Answers {
  return {
    profile: 'full',
    agents: ['claude-code', 'codex'],
    projectName: 'transition-app',
    projectDescription: 'Transition integration test',
    isMonorepo,
    setupRepo: 'local',
    mainBranch: 'main',
    backendRepoUrl: '',
    frontendRepoUrl: '',
    dbSetup: 'manual',
    initDb: false,
    emailService: 'none',
    s3Setup: 'manual',
    includeAnalytics: false,
    includePwa: false,
    workflow: { tool: 'none', workingBranch: 'develop' }
  }
}

function harnessManifest(): SaaSFoundryManifest {
  return {
    manifestVersion: 3,
    version: '0.9.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'cli',
    projectName: 'transition-app',
    mainBranch: 'main',
    modules: { harness: { version: 1, managed: true, agents: ['claude-code', 'codex'] }, advancedSkills: [] },
    workflow: { tool: 'none', workingBranch: 'develop' },
    language: { srs: 'fr', tickets: 'en', codeComments: 'en' },
    fileHashes: { '.claude/skills/sf-workflow/SKILL.md': 'preserved-harness-baseline' }
  }
}

describe.each([
  ['monorepo', true],
  ['multirepo', false]
] as const)('technical adoption integration — %s', (_topology, isMonorepo) => {
  let sandbox: string
  let projectRoot: string
  let candidateRoot: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), `sf-adoption-${isMonorepo ? 'mono' : 'multi'}-`))
    projectRoot = join(sandbox, 'project')
    candidateRoot = join(sandbox, 'candidate')
    await Promise.all([mkdir(projectRoot), mkdir(candidateRoot)])
  })

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('adds the rendered stack, preserves the harness and becomes idempotent', async () => {
    const current = harnessManifest()
    const beforeManifest = Buffer.from(JSON.stringify(current, null, 2))
    const harnessInstructions = '# Customized harness — preserve exactly\n'
    await mkdir(join(projectRoot, '.claude/skills/sf-workflow'), { recursive: true })
    await writeFile(join(projectRoot, 'CLAUDE.md'), harnessInstructions)
    await writeFile(join(projectRoot, '.claude/skills/sf-workflow/SKILL.md'), 'customized workflow skill')
    await writeFile(join(projectRoot, '.saasfoundry.json'), beforeManifest)

    const answers = config(isMonorepo)
    await withTemporaryTechnicalStack({ config: answers, ports }, async (candidate) => {
      candidateRoot = candidate.rootDir
      const preliminary = buildTechnicalTransitionManifest({ current, config: answers, ports, cliVersion: '1.0.0' })
      await finalizeTechnicalAdoptionCandidate({ candidate, projectRoot, manifest: preliminary, cliVersion: '1.0.0' })
      const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })
      expect(plan.canApply).toBe(true)
      expect(plan.summary.add).toBeGreaterThan(100)
      const next = buildTechnicalTransitionManifest({ current, config: answers, ports, cliVersion: '1.0.0', plan })
      const nextBytes = Buffer.from(JSON.stringify(next, null, 2))

      const first = await applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: nextBytes
      })

      expect(first.mutated).toBe(true)
      expect(await readFile(join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(harnessInstructions)
      expect(await readFile(join(projectRoot, '.claude/skills/sf-workflow/SKILL.md'), 'utf8')).toBe('customized workflow skill')
      const installed = JSON.parse(await readFile(join(projectRoot, '.saasfoundry.json'), 'utf8')) as SaaSFoundryManifest
      expect(installed).toMatchObject({ structure: isMonorepo ? 'monorepo' : 'multirepo', ports, modules: { harness: current.modules?.harness } })
      expect(installed.fileHashes?.['.claude/skills/sf-workflow/SKILL.md']).toBe('preserved-harness-baseline')
      expect(Object.keys(installed.fileHashes ?? {}).some((path) => path.endsWith('/src/main.ts'))).toBe(true)

      if (isMonorepo) {
        await expect(readFile(join(projectRoot, 'apps/api/package.json'), 'utf8')).resolves.toContain('transition-app-api')
      } else {
        for (const app of ['transition-app-api', 'transition-app-web']) {
          await expect(readFile(join(projectRoot, 'apps', app, '.saasfoundry.json'), 'utf8')).resolves.toContain(`"projectName": "${app}"`)
          await expect(readFile(join(projectRoot, 'apps', app, 'AGENTS.md'), 'utf8')).resolves.toContain('SaaSFoundry')
        }
      }

      const installedBytes = await readFile(join(projectRoot, '.saasfoundry.json'))
      const secondPlan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })
      expect(secondPlan.summary.add).toBe(0)
      expect(secondPlan.summary.compatible).toBe(plan.summary.add)
      const secondManifest = buildTechnicalTransitionManifest({ current: installed, config: answers, ports, cliVersion: '1.0.0', plan: secondPlan })
      const secondBytes = Buffer.from(JSON.stringify(secondManifest, null, 2))
      expect(secondBytes).toEqual(installedBytes)

      await expect(applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: secondPlan, expectedManifest: installedBytes, nextManifest: secondBytes })).resolves.toMatchObject({
        mutated: false,
        created: []
      })
    })
  }, 120_000)
})
