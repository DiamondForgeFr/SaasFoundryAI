export const LEGACY_DOCKER_SCENARIOS = [
  'multirepo-minimal',
  'monorepo-minimal',
  'multirepo-full',
  'monorepo-full',
  'update-add-all-modules',
  'update-add-email',
  'ai-multirepo-skills',
  'ai-monorepo-skills',
  'ai-workflow-config',
  'migration-v0-to-current',
  'multirepo-email-only',
  'multirepo-storage-only',
  'multirepo-analytics-only',
  'multirepo-email-storage',
  'monorepo-email-analytics',
  'monorepo-storage-analytics',
  'update-add-email-monorepo',
  'update-add-storage',
  'update-add-analytics',
  'multirepo-pwa',
  'cli-new-harness',
  'cli-new-placement',
  'multirepo-boot-and-test'
] as const

export type LegacyDockerScenario = (typeof LEGACY_DOCKER_SCENARIOS)[number]
export type SignalReplacement = { kind: 'lifecycle'; target: string; signal: string } | { kind: 'jest'; target: string; signal: string }

const jestReplacement = (target: string, signal: string): SignalReplacement => ({ kind: 'jest', target, signal })
const lifecycle = (target: string, signal: string): SignalReplacement => ({ kind: 'lifecycle', target, signal })

export const LEGACY_SIGNAL_REPLACEMENTS: Readonly<Record<LegacyDockerScenario, readonly SignalReplacement[]>> = {
  'multirepo-minimal': [lifecycle('update-previous-release-smoke', 'disabled-module multirepo boot/build'), jestReplacement('src/__tests__/unit/scaffold-lockfiles.spec.ts', 'source lock drift')],
  'monorepo-minimal': [lifecycle('update-current-monorepo-full', 'current minimal monorepo boot before real update')],
  'multirepo-full': [lifecycle('new-multirepo-full', 'full build, live runtime, audit, API unit and inline topology assertions')],
  'monorepo-full': [lifecycle('new-monorepo-full', 'full build, live runtime, audit, OpenAPI/client and shared topology assertions')],
  'update-add-all-modules': [lifecycle('update-current-monorepo-full', 'combined late-module monorepo update, build and idempotence')],
  'update-add-email': [
    lifecycle('update-previous-release-smoke', 'real late email multirepo update'),
    jestReplacement('src/__tests__/integration/installers/email.installer.spec.ts', 'email-only deposits')
  ],
  'ai-multirepo-skills': [jestReplacement('src/__tests__/integration/installers/skills.installer.spec.ts', 'multirepo skills')],
  'ai-monorepo-skills': [jestReplacement('src/__tests__/integration/installers/skills.installer.spec.ts', 'monorepo skills')],
  'ai-workflow-config': [jestReplacement('src/__tests__/integration/installers/workflow-skill.installer.spec.ts', 'workflow and CLAUDE deposits')],
  'migration-v0-to-current': [
    jestReplacement('src/__tests__/unit/migrations/golden-fixtures.spec.ts', 'full migration chain'),
    jestReplacement('src/__tests__/integration/commands/update.spec.ts', 'update early-return persistence')
  ],
  'multirepo-email-only': [lifecycle('new-multirepo-full', 'email production wiring'), jestReplacement('src/__tests__/integration/installers/email.installer.spec.ts', 'email-only shape')],
  'multirepo-storage-only': [lifecycle('new-multirepo-full', 'storage production wiring'), jestReplacement('src/__tests__/integration/installers/storage.installer.spec.ts', 'storage-only modes')],
  'multirepo-analytics-only': [
    lifecycle('new-multirepo-full', 'analytics production wiring'),
    jestReplacement('src/__tests__/integration/installers/analytics.installer.spec.ts', 'analytics-only deposits')
  ],
  'multirepo-email-storage': [lifecycle('new-multirepo-full', 'combined module build'), jestReplacement('src/__tests__/integration/installers/storage.installer.spec.ts', 'credentials mode')],
  'monorepo-email-analytics': [lifecycle('new-monorepo-full', 'shared email and analytics production build')],
  'monorepo-storage-analytics': [lifecycle('new-monorepo-full', 'shared storage and analytics production build')],
  'update-add-email-monorepo': [lifecycle('update-current-monorepo-full', 'real late email monorepo update and shared types')],
  'update-add-storage': [
    lifecycle('update-previous-release-smoke', 'real late storage multirepo update'),
    jestReplacement('src/__tests__/integration/installers/storage.installer.spec.ts', 'storage-only deposit')
  ],
  'update-add-analytics': [
    lifecycle('update-previous-release-smoke', 'real late analytics multirepo update'),
    jestReplacement('src/__tests__/integration/installers/analytics.installer.spec.ts', 'analytics-only deposit')
  ],
  'multirepo-pwa': [lifecycle('new-multirepo-full', 'built PWA manifest, worker, icons and registration assertions')],
  'cli-new-harness': [lifecycle('new-monorepo-full', 'compiled CLI harness on a non-empty repository')],
  'cli-new-placement': [lifecycle('new-monorepo-full', 'real CLI sibling placement and pre-existing file preservation')],
  'multirepo-boot-and-test': [lifecycle('new-multirepo-full', 'isolated PostgreSQL, strict API/web readiness and teardown')]
}
