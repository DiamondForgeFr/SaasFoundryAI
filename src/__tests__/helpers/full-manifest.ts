import { createHash } from 'crypto'

/**
 * A `.saasfoundry.json` the size of the one a fresh `sf new --profile full --structure monorepo` writes
 * (#972): every module the schema knows, the Solo workflow with its long status descriptions, an SRS
 * backend, and a `fileHashes` map that on its own takes the file past GitHub's 65,536-character limit for an
 * issue body. The hashes are deterministic (the SHA-256 of the path) so a failure reproduces.
 */
export const FULL_MANIFEST_FILE_COUNT = 700

function generatedFileHashes(count: number): Record<string, string> {
  const areas = ['apps/api/src/modules', 'apps/api/src/common', 'apps/web/src/components/ui', 'apps/web/src/pages/private', 'packages/shared-config/src', '.agents/skills/sf-workflow']
  const hashes: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    const file = `${areas[i % areas.length]}/feature-${String(i).padStart(4, '0')}/component-${i}.ts`
    hashes[file] = createHash('sha256').update(file).digest('hex')
  }
  return hashes
}

const STATUS_DESCRIPTION =
  'Task currently being worked on by AI after the developer confirmed pickup. One commit per subtask. When all subtasks are done: run existing tests (unit, E2E, lint, TypeScript), commit and push all changes, then move to AI Testing and generate a test plan.'

export function fullManifestFixture(): Record<string, unknown> {
  return {
    $schema: 'https://raw.githubusercontent.com/DiamondForgeFr/SaasFoundryAI/master/schemas/saasfoundry-manifest.schema.json',
    manifestVersion: 4,
    version: '1.0.1',
    generatedAt: '2026-11-02T09:14:31.000Z',
    structure: 'monorepo',
    projectName: 'diamondforge',
    mainBranch: 'main',
    ports: { db: 5436, api: 3501, web: 5174, s3: 9000, s3Console: 9001 },
    modules: {
      email: { provider: 'mailersend', version: 1 },
      s3Setup: 'docker',
      dbSetup: 'docker',
      includeAnalytics: true,
      advancedSkills: ['docs', 'e2e'],
      harness: {
        version: 5,
        managed: true,
        agents: ['claude-code', 'codex'],
        routing: { kinds: { 'bug-fix': { tier: 'fix' } }, tiers: { fix: { 'claude-code': { model: 'claude-opus-5-5', effort: 'medium' } } } },
        delegation: { ticketDelivery: 'allowed', decidedAt: '2026-11-02T10:00:00.000Z' },
        guard: { shellShape: 'refuse' }
      },
      pwa: { version: 1 }
    },
    language: { srs: 'fr', tickets: 'fr', codeComments: 'en' },
    skillsAccounts: { notion: 'work-account', github: 'personal-account' },
    workflow: {
      tool: 'github-projects',
      template: 'SaaSFoundry Solo',
      projectUrl: 'https://github.com/orgs/DiamondForgeFr/projects/7',
      workingBranch: 'develop',
      prTargetBranch: 'develop',
      branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
      commitFormat: { pattern: '<type>(#<ticket>): <description>', requireTicket: true, types: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert'] },
      statuses: ['Backlog', 'In progress', 'AI testing', 'In review', 'Done'].map((name, index) => ({
        name,
        description: STATUS_DESCRIPTION,
        color: ['GRAY', 'BLUE', 'PURPLE', 'PINK', 'GREEN'][index]
      })),
      issueTypes: ['sf-epic', 'sf-story', 'sf-task', 'sf-issue'].map((name) => ({ name, description: 'Delivers a technical action (refactor, infra, tooling)', color: 'GRAY' })),
      localCi: { requiredStatuses: ['local-format', 'local-lint', 'local-build', 'local-unit'] },
      validated: true,
      lastValidated: '2026-11-02T10:05:00.000Z'
    },
    aiRules: { alwaysCreateBranchFromWorking: true, alwaysCreateTicketBeforeCode: true, autoUpdateTicketStatus: true, requireHumanCheckOnPushedBranch: false },
    tools: {
      srs: {
        enabled: true,
        backend: 'notion',
        rootPage: { id: '34ba31bb-4f3f-8139-a6e4-f4327648a6b9', url: 'https://app.notion.com/p/diamondforge-srs-34ba31bb4f3f8139a6e4f4327648a6b9', name: 'diamondforge-srs' },
        pendingIngestion: {
          sourceBackend: 'notion',
          sourceParent: { id: '11111111-2222-3333-4444-555555555555', url: 'https://app.notion.com/p/parent', name: 'Parent' },
          createdAt: '2026-11-02T09:20:00.000Z'
        },
        scan: { exclude: ['scaffolds/', 'docs/'] }
      },
      tracker: { name: 'github-projects', account: 'work-account' },
      docs: { name: 'notion', account: 'work-account' },
      design: [{ name: 'figma', account: 'design-account' }]
    },
    fileHashes: generatedFileHashes(FULL_MANIFEST_FILE_COUNT)
  }
}
