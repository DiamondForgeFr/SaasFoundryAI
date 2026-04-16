// ── Test Scenario Definitions ──────────────────────────────────
// Each scenario defines a project configuration to generate and validate.
// ALL_SCENARIOS is ordered by PRIORITY — first scenarios are the most critical.
// This allows `--count N` to run the N most important scenarios.

export type ScenarioType = 'generation' | 'update' | 'ai'

export interface GenerationScenario {
  type: 'generation'
  name: string
  projectName: string
  isMonorepo: boolean
  dbSetup: 'docker' | 'credentials' | 'manual'
  s3Setup: 'docker' | 'credentials' | 'manual'
  emailService: 'none' | 'mailersend'
  includeAnalytics: boolean
}

export interface UpdateScenario {
  type: 'update'
  name: string
  /** Base generation config (always minimal) */
  base: Omit<GenerationScenario, 'type' | 'name'>
  /** Modules to add after initial generation */
  addModules: {
    email?: boolean
    storage?: boolean
    analytics?: boolean
  }
}

export interface AIScenario {
  type: 'ai'
  name: string
  projectName: string
  isMonorepo: boolean
  /** What to verify (no builds needed) */
  checks: ('skills' | 'claude-md' | 'workflow')[]
}

export type TestScenario = GenerationScenario | UpdateScenario | AIScenario

// ── ALL SCENARIOS — ordered by priority ────────────────────────
// Priority rationale:
//   1-2: Minimal builds (catch fundamental breakage fast)
//   3-4: Full builds (all modules combined)
//   5-6: Update flows (module addition still compiles)
//   7-9: AI config (no build, structural only — fast)
//  10-12: Single module variations
//  13-14: Module combos
//  15-16: Monorepo module combos
//  17-18: Remaining update flows

export const ALL_SCENARIOS: TestScenario[] = [
  // ── Priority 1-2: Minimal builds ──────────────────────────────
  {
    type: 'generation',
    name: 'multirepo-minimal',
    projectName: 'multi-min',
    isMonorepo: false,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'none',
    includeAnalytics: false
  },
  {
    type: 'generation',
    name: 'monorepo-minimal',
    projectName: 'mono-min',
    isMonorepo: true,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'none',
    includeAnalytics: false
  },

  // ── Priority 3-4: Full builds (all modules) ──────────────────
  {
    type: 'generation',
    name: 'multirepo-full',
    projectName: 'multi-full',
    isMonorepo: false,
    dbSetup: 'docker',
    s3Setup: 'docker',
    emailService: 'mailersend',
    includeAnalytics: true
  },
  {
    type: 'generation',
    name: 'monorepo-full',
    projectName: 'mono-full',
    isMonorepo: true,
    dbSetup: 'docker',
    s3Setup: 'docker',
    emailService: 'mailersend',
    includeAnalytics: true
  },

  // ── Priority 5-6: Update flows (most complex) ────────────────
  {
    type: 'update',
    name: 'update-add-all-modules',
    base: {
      projectName: 'upd-all',
      isMonorepo: true,
      dbSetup: 'manual',
      s3Setup: 'manual',
      emailService: 'none',
      includeAnalytics: false
    },
    addModules: { email: true, storage: true, analytics: true }
  },
  {
    type: 'update',
    name: 'update-add-email',
    base: {
      projectName: 'upd-email',
      isMonorepo: false,
      dbSetup: 'manual',
      s3Setup: 'manual',
      emailService: 'none',
      includeAnalytics: false
    },
    addModules: { email: true }
  },

  // ── Priority 7-9: AI config (fast, no build) ─────────────────
  {
    type: 'ai',
    name: 'ai-multirepo-skills',
    projectName: 'ai-multi',
    isMonorepo: false,
    checks: ['skills', 'claude-md']
  },
  {
    type: 'ai',
    name: 'ai-monorepo-skills',
    projectName: 'ai-mono',
    isMonorepo: true,
    checks: ['skills', 'claude-md']
  },
  {
    type: 'ai',
    name: 'ai-workflow-config',
    projectName: 'ai-wf',
    isMonorepo: false,
    checks: ['workflow', 'claude-md']
  },

  // ── Priority 10-12: Single module variations ──────────────────
  {
    type: 'generation',
    name: 'multirepo-email-only',
    projectName: 'multi-email',
    isMonorepo: false,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'mailersend',
    includeAnalytics: false
  },
  {
    type: 'generation',
    name: 'multirepo-storage-only',
    projectName: 'multi-storage',
    isMonorepo: false,
    dbSetup: 'docker',
    s3Setup: 'docker',
    emailService: 'none',
    includeAnalytics: false
  },
  {
    type: 'generation',
    name: 'multirepo-analytics-only',
    projectName: 'multi-analytics',
    isMonorepo: false,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'none',
    includeAnalytics: true
  },

  // ── Priority 13-14: Module combos ─────────────────────────────
  {
    type: 'generation',
    name: 'multirepo-email-storage',
    projectName: 'multi-es',
    isMonorepo: false,
    dbSetup: 'docker',
    s3Setup: 'credentials',
    emailService: 'mailersend',
    includeAnalytics: false
  },
  {
    type: 'generation',
    name: 'monorepo-email-analytics',
    projectName: 'mono-ea',
    isMonorepo: true,
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'mailersend',
    includeAnalytics: true
  },

  // ── Priority 15-16: Monorepo module combos ────────────────────
  {
    type: 'generation',
    name: 'monorepo-storage-analytics',
    projectName: 'mono-sa',
    isMonorepo: true,
    dbSetup: 'docker',
    s3Setup: 'docker',
    emailService: 'none',
    includeAnalytics: true
  },
  {
    type: 'update',
    name: 'update-add-email-monorepo',
    base: {
      projectName: 'upd-email-mono',
      isMonorepo: true,
      dbSetup: 'manual',
      s3Setup: 'manual',
      emailService: 'none',
      includeAnalytics: false
    },
    addModules: { email: true }
  },

  // ── Priority 17-18: Remaining update flows ────────────────────
  {
    type: 'update',
    name: 'update-add-storage',
    base: {
      projectName: 'upd-storage',
      isMonorepo: false,
      dbSetup: 'manual',
      s3Setup: 'manual',
      emailService: 'none',
      includeAnalytics: false
    },
    addModules: { storage: true }
  },
  {
    type: 'update',
    name: 'update-add-analytics',
    base: {
      projectName: 'upd-analytics',
      isMonorepo: false,
      dbSetup: 'manual',
      s3Setup: 'manual',
      emailService: 'none',
      includeAnalytics: false
    },
    addModules: { analytics: true }
  }
]

export function getScenario(name: string): TestScenario {
  const scenario = ALL_SCENARIOS.find((s) => s.name === name)
  if (!scenario) {
    const available = ALL_SCENARIOS.map((s) => s.name).join(', ')
    throw new Error(`Unknown scenario "${name}". Available: ${available}`)
  }
  return scenario
}

export function getScenariosByType<T extends ScenarioType>(type: T): Extract<TestScenario, { type: T }>[] {
  return ALL_SCENARIOS.filter((s) => s.type === type) as Extract<TestScenario, { type: T }>[]
}

/** Get the first N scenarios (by priority order) */
export function getTopScenarios(count: number): TestScenario[] {
  return ALL_SCENARIOS.slice(0, Math.min(count, ALL_SCENARIOS.length))
}
