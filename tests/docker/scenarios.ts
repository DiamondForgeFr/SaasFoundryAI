export type BrowserDepth = 'smoke' | 'full'

export interface GenerationScenario {
  type: 'generation'
  name: string
  projectName: string
  isMonorepo: boolean
  dbSetup: 'docker' | 'credentials' | 'manual'
  s3Setup: 'docker' | 'credentials' | 'manual'
  emailService: 'none' | 'mailersend'
  includeAnalytics: boolean
  includePwa?: boolean
  validateApiContract?: boolean
  auditDependencies?: boolean
  validateSourceLocks?: boolean
}

export interface UpdateScenario {
  type: 'update'
  name: string
  base: Omit<GenerationScenario, 'type' | 'name'>
  addModules: { email?: boolean; storage?: boolean; analytics?: boolean }
}

export interface AIScenario {
  type: 'ai'
  name: string
  projectName: string
  isMonorepo: boolean
  checks: ('skills' | 'claude-md' | 'workflow')[]
}

export interface MigrationScenario {
  type: 'migration'
  name: string
  projectName: string
  isMonorepo: boolean
}

export interface CliScenario {
  type: 'cli'
  name: string
  projectName: string
  profile: 'full' | 'harness'
  isMonorepo: boolean
}

export interface BootScenario {
  type: 'boot'
  name: 'new-monorepo' | 'new-multirepo'
  projectName: string
  structure: 'monorepo' | 'multirepo'
  profile: 'full'
  timeoutSeconds: number
  bootTimeoutSeconds: number
}

export interface PreviousReleaseScenario {
  type: 'previous-release'
  name: 'update-previous-release'
  timeoutSeconds: number
}

export interface CurrentUpdateScenario {
  type: 'current-update'
  name: 'update-current-monorepo'
  projectName: string
  structure: 'monorepo'
  timeoutSeconds: number
  bootTimeoutSeconds: number
}

/**
 * Legacy types remain importable by the old implementation helpers in
 * generate-and-build.ts. They are deliberately absent from ALL_SCENARIOS, so neither
 * local lanes nor CI can execute the old matrix. The replacement map proves their
 * signals before those helpers are removed in a later mechanical cleanup.
 */
export type TestScenario = BootScenario | PreviousReleaseScenario | CurrentUpdateScenario
export type LegacyScenario = GenerationScenario | UpdateScenario | AIScenario | MigrationScenario | CliScenario

/** Browser depth belongs to a lane entry so the historical update can be smoke on
 * ordinary PRs and full in the exhaustive lane without duplicating implementation. */
export const ALL_SCENARIOS: readonly TestScenario[] = [
  {
    type: 'boot',
    name: 'new-monorepo',
    projectName: 'mono-live',
    structure: 'monorepo',
    profile: 'full',
    timeoutSeconds: 1_800,
    bootTimeoutSeconds: 180
  },
  {
    type: 'boot',
    name: 'new-multirepo',
    projectName: 'multi-live',
    structure: 'multirepo',
    profile: 'full',
    timeoutSeconds: 1_800,
    bootTimeoutSeconds: 180
  },
  {
    type: 'previous-release',
    name: 'update-previous-release',
    timeoutSeconds: 1_800
  },
  {
    type: 'current-update',
    name: 'update-current-monorepo',
    projectName: 'current-update',
    structure: 'monorepo',
    timeoutSeconds: 1_800,
    bootTimeoutSeconds: 180
  }
] as const

export function getScenario(name: string): TestScenario {
  const scenario = ALL_SCENARIOS.find((candidate) => candidate.name === name)
  if (!scenario) throw new Error(`Unknown lifecycle scenario "${name}". Available: ${ALL_SCENARIOS.map((candidate) => candidate.name).join(', ')}`)
  return scenario
}
