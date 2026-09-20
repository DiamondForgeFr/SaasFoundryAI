import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildTechnicalTransitionManifest, finalizeTechnicalAdoptionCandidate, readCandidateChildManifest } from '../../../scaffold/technical-stack.adoption'
import { planTechnicalStackAdoption } from '../../../scaffold/technical-stack.planner'
import { withTemporaryTechnicalStack, type RenderedTechnicalStack } from '../../../renderers/technical-stack.renderer'
import type { Answers, ProjectPorts, SaaSFoundryManifest } from '../../../types'

const ports: ProjectPorts = { db: 5435, api: 3500, web: 5173 }

function harnessManifest(): SaaSFoundryManifest {
  return {
    $schema: 'schema',
    manifestVersion: 3,
    version: '0.9.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'cli',
    projectName: 'adopt-me',
    mainBranch: 'main',
    modules: {
      harness: { version: 1, managed: true, agents: ['claude-code', 'codex', 'gemini-cli'] },
      advancedSkills: ['context7']
    },
    language: { srs: 'fr', tickets: 'en', codeComments: 'en' },
    workflow: { tool: 'github-projects', projectUrl: 'https://example.test/project', workingBranch: 'develop' },
    aiRules: { alwaysCreateTicketBeforeCode: true },
    tools: { docs: { name: 'notion' } },
    skillsAccounts: { context7: 'work' },
    fileHashes: { '.claude/skills/sf-workflow/SKILL.md': 'harness-hash', 'AGENTS.md': 'agent-hash' }
  }
}

function config(isMonorepo: boolean): Answers {
  return {
    profile: 'full',
    projectName: 'adopt-me',
    projectDescription: 'Adopt me',
    isMonorepo,
    setupRepo: 'local',
    mainBranch: 'main',
    backendRepoUrl: '',
    frontendRepoUrl: '',
    dbSetup: 'docker',
    initDb: false,
    emailService: 'none',
    s3Setup: 'manual',
    includeAnalytics: true,
    includePwa: true,
    advancedSkills: ['should-not-replace-harness']
  }
}

describe('technical adoption candidate and manifest finalization', () => {
  let sandbox: string
  let projectRoot: string
  let candidateRoot: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'sf-adoption-finalize-'))
    projectRoot = join(sandbox, 'project')
    candidateRoot = join(sandbox, 'candidate')
    await Promise.all([mkdir(projectRoot), mkdir(candidateRoot)])
  })

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('preserves the harness surface and adds ownership only for created technical files', async () => {
    const current = harnessManifest()
    await mkdir(join(candidateRoot, 'apps/api/src'), { recursive: true })
    await writeFile(join(candidateRoot, 'apps/api/src/main.ts'), 'main')
    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })

    const next = buildTechnicalTransitionManifest({ current, config: config(true), ports, cliVersion: '1.0.0', plan })

    expect(next).toMatchObject({
      version: '1.0.0',
      generatedAt: current.generatedAt,
      structure: 'monorepo',
      ports,
      language: current.language,
      workflow: current.workflow,
      aiRules: current.aiRules,
      tools: current.tools,
      skillsAccounts: current.skillsAccounts,
      modules: {
        harness: current.modules?.harness,
        advancedSkills: ['context7'],
        email: { provider: 'none', version: 1 },
        dbSetup: 'docker',
        s3Setup: 'manual',
        includeAnalytics: true,
        pwa: { version: 1 }
      }
    })
    expect(next.fileHashes).toEqual({
      '.claude/skills/sf-workflow/SKILL.md': 'harness-hash',
      'AGENTS.md': 'agent-hash',
      'apps/api/src/main.ts': expect.any(String)
    })
    expect(current.structure).toBe('cli')
  })

  it('leaves private root collaboration deposits outside the technical plan', async () => {
    const manifest = buildTechnicalTransitionManifest({ current: harnessManifest(), config: config(true), ports, cliVersion: '1.0.0' })
    await withTemporaryTechnicalStack({ config: config(true), ports }, async (candidate) => {
      candidateRoot = candidate.rootDir
      await finalizeTechnicalAdoptionCandidate({ candidate, projectRoot, manifest, cliVersion: '1.0.0' })

      await expect(access(join(candidateRoot, 'CLAUDE.md'))).resolves.toBeUndefined()
      await expect(access(join(candidateRoot, '.claude'))).resolves.toBeUndefined()
      await expect(access(join(candidateRoot, 'package.json'))).resolves.toBeUndefined()
      const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })
      expect(plan.entries.some((entry) => entry.path === 'CLAUDE.md' || entry.path.startsWith('.claude/'))).toBe(false)
    })
  })

  it('refuses destructive finalization for an untrusted or live-project candidate', async () => {
    await writeFile(join(projectRoot, 'AGENTS.md'), 'keep me')
    const fake = { rootDir: projectRoot, apiPath: join(projectRoot, 'apps/api'), webPath: join(projectRoot, 'apps/web') } as RenderedTechnicalStack
    const manifest = buildTechnicalTransitionManifest({ current: harnessManifest(), config: config(true), ports, cliVersion: '1.0.0' })

    await expect(finalizeTechnicalAdoptionCandidate({ candidate: fake, projectRoot, manifest, cliVersion: '1.0.0' })).rejects.toThrow('withTemporaryTechnicalStack')
    await expect(access(join(projectRoot, 'AGENTS.md'))).resolves.toBeUndefined()
  })

  it('rejects a hostile multirepo project name before any derived path is written', async () => {
    const manifest = buildTechnicalTransitionManifest({ current: harnessManifest(), config: config(false), ports, cliVersion: '1.0.0' })
    manifest.projectName = '../../../outside'

    await withTemporaryTechnicalStack({ config: config(false), ports }, async (candidate) => {
      await expect(finalizeTechnicalAdoptionCandidate({ candidate, projectRoot, manifest, cliVersion: '1.0.0' })).rejects.toThrow('Invalid project name')
    })
  })

  it('revokes temporary-candidate authority when its callback ends', async () => {
    const manifest = buildTechnicalTransitionManifest({ current: harnessManifest(), config: config(true), ports, cliVersion: '1.0.0' })
    let retained: RenderedTechnicalStack | undefined
    await withTemporaryTechnicalStack({ config: config(true), ports }, async (candidate) => {
      retained = candidate
      expect(Object.isFrozen(candidate)).toBe(true)
    })

    await expect(finalizeTechnicalAdoptionCandidate({ candidate: retained!, projectRoot, manifest, cliVersion: '1.0.0' })).rejects.toThrow('active candidate')
  })

  it('finishes multirepo child manifests, skills and declared agent entrypoints inside the candidate', async () => {
    const manifest = buildTechnicalTransitionManifest({ current: harnessManifest(), config: config(false), ports, cliVersion: '1.0.0' })
    await withTemporaryTechnicalStack({ config: config(false), ports }, async (candidate) => {
      candidateRoot = candidate.rootDir
      await finalizeTechnicalAdoptionCandidate({ candidate, projectRoot, manifest, cliVersion: '1.0.0' })

      for (const app of ['adopt-me-api', 'adopt-me-web']) {
        const child = await readCandidateChildManifest(candidateRoot, app)
        expect(child).toMatchObject({
          structure: 'cli',
          projectName: app,
          modules: { harness: manifest.modules?.harness, advancedSkills: ['context7'] },
          workflow: manifest.workflow,
          tools: manifest.tools,
          skillsAccounts: manifest.skillsAccounts
        })
        await expect(access(join(candidateRoot, 'apps', app, '.claude/skills/sf-git-commit/SKILL.md'))).resolves.toBeUndefined()
        await expect(access(join(candidateRoot, 'apps', app, 'AGENTS.md'))).resolves.toBeUndefined()
        await expect(access(join(candidateRoot, 'apps', app, 'GEMINI.md'))).resolves.toBeUndefined()
        expect(Object.keys(child.fileHashes ?? {})).toEqual(expect.arrayContaining(['AGENTS.md', 'GEMINI.md']))
      }
    })
  })
})
