// ── Build Verification & Assertion Functions ───────────────────
// Used by the test harness to validate generated projects.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// ── Types ──────────────────────────────────────────────────────

export interface AssertionResult {
  passed: boolean
  message: string
}

// ── Core Assertions ────────────────────────────────────────────

export function assertFileExists(filePath: string): AssertionResult {
  const exists = existsSync(filePath)
  return {
    passed: exists,
    message: exists ? `OK: ${filePath} exists` : `FAIL: ${filePath} does not exist`
  }
}

export function assertDirExists(dirPath: string): AssertionResult {
  const exists = existsSync(dirPath) && statSync(dirPath).isDirectory()
  return {
    passed: exists,
    message: exists ? `OK: ${dirPath}/ exists` : `FAIL: ${dirPath}/ does not exist`
  }
}

export function assertFileContains(filePath: string, substring: string): AssertionResult {
  if (!existsSync(filePath)) {
    return { passed: false, message: `FAIL: ${filePath} does not exist` }
  }
  const content = readFileSync(filePath, 'utf8')
  const contains = content.includes(substring)
  return {
    passed: contains,
    message: contains ? `OK: ${filePath} contains "${substring.slice(0, 50)}"` : `FAIL: ${filePath} does not contain "${substring.slice(0, 50)}"`
  }
}

export function assertFileNotContains(filePath: string, substring: string): AssertionResult {
  if (!existsSync(filePath)) {
    return { passed: true, message: `OK: ${filePath} does not exist (skip content check)` }
  }
  const content = readFileSync(filePath, 'utf8')
  const contains = content.includes(substring)
  return {
    passed: !contains,
    message: !contains ? `OK: ${filePath} does not contain "${substring.slice(0, 50)}"` : `FAIL: ${filePath} contains unwanted "${substring.slice(0, 50)}"`
  }
}

// ── Placeholder Scanner ────────────────────────────────────────

const PLACEHOLDER_PATTERN = /\{\{[A-Z_]+\}\}/g

/**
 * Scan a directory recursively for unreplaced {{PLACEHOLDER}} patterns.
 * @param excludePatterns - file path substrings to exclude from scanning
 *   (e.g., in monorepo, per-app CLAUDE.md files are not processed by the skills installer)
 */
export function scanForUnreplacedPlaceholders(dirPath: string, excludePatterns: string[] = []): AssertionResult {
  const violations: string[] = []

  function scan(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      // Skip irrelevant directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue
        scan(fullPath)
        continue
      }

      // Only check text-like files
      if (!isTextFile(entry.name)) continue

      // Skip excluded paths
      if (excludePatterns.some((p) => fullPath.includes(p))) continue

      const content = readFileSync(fullPath, 'utf8')
      const matches = content.match(PLACEHOLDER_PATTERN)
      if (matches) {
        const unique = [...new Set(matches)]
        violations.push(`${fullPath}: ${unique.join(', ')}`)
      }
    }
  }

  scan(dirPath)

  return {
    passed: violations.length === 0,
    message: violations.length === 0 ? `OK: No unreplaced placeholders in ${dirPath}` : `FAIL: Unreplaced placeholders found:\n${violations.map((v) => `  - ${v}`).join('\n')}`
  }
}

// ── Build Output Assertions ────────────────────────────────────

/** Verify API build output (NestJS dist/) — output is at dist/src/main.js because tsconfig has no rootDir */
export function assertApiBuildOutput(apiPath: string): AssertionResult[] {
  return [assertFileExists(join(apiPath, 'dist', 'src', 'main.js')), assertDirExists(join(apiPath, 'dist'))]
}

/** Verify Web build output (Vite dist/) */
export function assertWebBuildOutput(webPath: string): AssertionResult[] {
  return [assertFileExists(join(webPath, 'dist', 'index.html')), assertDirExists(join(webPath, 'dist'))]
}

/** Verify monorepo build output (both API and Web) */
export function assertMonorepoBuildOutput(projectPath: string): AssertionResult[] {
  return [...assertApiBuildOutput(join(projectPath, 'apps', 'api')), ...assertWebBuildOutput(join(projectPath, 'apps', 'web'))]
}

/**
 * Verify the three monorepo shared packages are present, scoped to the project
 * name, wired into both apps and built via `turbo run build`.
 */
export function assertMonorepoSharedPackages(projectPath: string, projectName: string): AssertionResult[] {
  const results: AssertionResult[] = []
  const packages = ['shared-types', 'shared-validation', 'shared-config']
  const scopedName = (pkg: string) => `"name": "@${projectName}/${pkg}"`

  for (const pkg of packages) {
    const pkgPath = join(projectPath, 'packages', pkg)
    results.push(assertDirExists(pkgPath))
    results.push(assertFileExists(join(pkgPath, 'package.json')))
    results.push(assertFileExists(join(pkgPath, 'src', 'index.ts')))
    results.push(assertFileContains(join(pkgPath, 'package.json'), scopedName(pkg)))
    results.push(assertFileNotContains(join(pkgPath, 'package.json'), '{{PROJECT_NAME}}'))
    results.push(assertFileExists(join(pkgPath, 'dist', 'index.js')))
  }

  results.push(assertFileExists(join(projectPath, 'apps', 'api', 'src', 'shared-wiring.ts')))
  results.push(assertFileExists(join(projectPath, 'apps', 'web', 'src', 'shared-wiring.ts')))

  return results
}

/**
 * Verify the source-only `ui-primitives` workspace is present, scoped to the
 * project name, and that `apps/web` no longer carries the vendored `shadcn/`
 * copy nor the UI deps that have moved into the package (mono-only — multirepo
 * keeps the blueprint shadcn copy untouched).
 */
export function assertMonorepoUiPrimitives(projectPath: string, projectName: string): AssertionResult[] {
  const results: AssertionResult[] = []
  const pkgPath = join(projectPath, 'packages', 'ui-primitives')

  results.push(assertDirExists(pkgPath))
  results.push(assertFileExists(join(pkgPath, 'package.json')))
  results.push(assertFileExists(join(pkgPath, 'src', 'index.ts')))
  results.push(assertFileExists(join(pkgPath, 'src', 'theme.css')))
  results.push(assertFileExists(join(pkgPath, 'src', 'button.tsx')))
  results.push(assertFileContains(join(pkgPath, 'package.json'), `"name": "@${projectName}/ui-primitives"`))
  results.push(assertFileNotContains(join(pkgPath, 'package.json'), '{{PROJECT_NAME}}'))

  // apps/web must consume the workspace package, not the vendored copy
  const webPkg = join(projectPath, 'apps', 'web', 'package.json')
  results.push(assertFileContains(webPkg, `"@${projectName}/ui-primitives"`))
  results.push(assertFileNotContains(webPkg, '"radix-ui"'))
  results.push(assertFileNotContains(webPkg, '"lucide-react"'))
  results.push(assertFileNotContains(webPkg, '"class-variance-authority"'))
  results.push(assertFileNotContains(webPkg, '"cmdk"'))

  // Vendored shadcn dir + cn helper are gone in the mono topology
  const shadcnDir = join(projectPath, 'apps', 'web', 'src', 'components', 'ui', 'shadcn')
  if (existsSync(shadcnDir)) {
    results.push({ passed: false, message: `FAIL: ${shadcnDir} should not exist in monorepo (primitives live in packages/ui-primitives)` })
  } else {
    results.push({ passed: true, message: `OK: apps/web/src/components/ui/shadcn/ correctly removed in monorepo` })
  }

  // shadcn-CLI alias file is removed in mono — primitives are owned by the workspace package
  const componentsJson = join(projectPath, 'apps', 'web', 'components.json')
  if (existsSync(componentsJson)) {
    results.push({ passed: false, message: `FAIL: ${componentsJson} should not exist in monorepo (alias would point to deleted shadcn tree)` })
  } else {
    results.push({ passed: true, message: `OK: apps/web/components.json correctly removed in monorepo` })
  }

  // vite.config.ts manualChunks must group ui-primitives into ui-components
  const viteConfig = join(projectPath, 'apps', 'web', 'vite.config.ts')
  results.push(assertFileContains(viteConfig, `'/ui-primitives/src/'`))

  return results
}

/**
 * Verify storage-on-monorepo deposits MIME/size constants in shared-config and
 * the org controller consumes them (instead of the inline literals it carries
 * in multirepo). Mirrors the no-drift contract: a single source of truth for
 * the upload bounds when both apps live in the same workspace.
 */
export function assertMonorepoStorageSharedConfig(projectPath: string, projectName: string): AssertionResult[] {
  const results: AssertionResult[] = []

  const storageFile = join(projectPath, 'packages', 'shared-config', 'src', 'storage.ts')
  results.push(assertFileExists(storageFile))
  results.push(assertFileContains(storageFile, 'STORAGE_LOGO_MAX_BYTES'))
  results.push(assertFileContains(storageFile, 'STORAGE_LOGO_ALLOWED_MIMES'))

  const indexFile = join(projectPath, 'packages', 'shared-config', 'src', 'index.ts')
  results.push(assertFileContains(indexFile, `from './storage'`))

  const orgController = join(projectPath, 'apps', 'api', 'src', 'modules', 'organizations', 'controllers', 'organization.controller.ts')
  results.push(assertFileContains(orgController, `from '@${projectName}/shared-config'`))
  results.push(assertFileContains(orgController, 'STORAGE_LOGO_MAX_BYTES'))
  results.push(assertFileContains(orgController, 'STORAGE_LOGO_ALLOWED_MIMES'))
  // The inlined literals are gone in monorepo (proves the rewrite happened).
  results.push(assertFileNotContains(orgController, 'fileSize: 5 * 1024 * 1024'))

  return results
}

/**
 * Verify the multirepo storage path keeps the inlined literals (parity guard:
 * no shared-config deposit leaks into multirepo, where the package doesn't
 * exist).
 */
export function assertMultirepoStorageInlined(apiPath: string): AssertionResult[] {
  const orgController = join(apiPath, 'src', 'modules', 'organizations', 'controllers', 'organization.controller.ts')
  return [assertFileContains(orgController, 'fileSize: 5 * 1024 * 1024'), assertFileNotContains(orgController, '/shared-config'), assertFileNotContains(orgController, 'STORAGE_LOGO_MAX_BYTES')]
}

/**
 * Verify email-on-monorepo deposits `EmailOptions` in shared-types and the
 * MailerSend service consumes it (instead of declaring the inlined interface
 * it carries in multirepo). Mirrors the storage no-drift contract.
 */
export function assertMonorepoEmailSharedTypes(projectPath: string, projectName: string): AssertionResult[] {
  const results: AssertionResult[] = []

  const emailFile = join(projectPath, 'packages', 'shared-types', 'src', 'email.ts')
  results.push(assertFileExists(emailFile))
  results.push(assertFileContains(emailFile, 'EmailOptions'))

  const indexFile = join(projectPath, 'packages', 'shared-types', 'src', 'index.ts')
  results.push(assertFileContains(indexFile, `from './email'`))

  const mailerService = join(projectPath, 'apps', 'api', 'src', 'modules', 'email', 'services', 'mailersend.service.ts')
  results.push(assertFileContains(mailerService, `from '@${projectName}/shared-types'`))
  // The inlined interface body is gone in monorepo (proves the rewrite happened).
  results.push(assertFileNotContains(mailerService, 'export interface EmailOptions {'))

  return results
}

/**
 * Verify the multirepo email path keeps the inlined `EmailOptions` interface
 * (parity guard: no shared-types deposit leaks into multirepo, where the
 * package doesn't exist).
 */
export function assertMultirepoEmailInlined(apiPath: string): AssertionResult[] {
  const mailerService = join(apiPath, 'src', 'modules', 'email', 'services', 'mailersend.service.ts')
  return [assertFileContains(mailerService, 'export interface EmailOptions {'), assertFileNotContains(mailerService, '/shared-types')]
}

/**
 * Verify the multirepo web app keeps the vendored shadcn primitives in place
 * (no monorepo-only side effects leak into the multirepo topology).
 */
export function assertMultirepoUiPrimitivesUntouched(webPath: string): AssertionResult[] {
  return [
    assertDirExists(join(webPath, 'src', 'components', 'ui', 'shadcn')),
    assertFileExists(join(webPath, 'src', 'components', 'ui', 'shadcn', 'button.tsx')),
    assertFileExists(join(webPath, 'src', 'utils', 'ui.ts')),
    assertFileExists(join(webPath, 'components.json'))
  ]
}

// ── Skills Assertions ──────────────────────────────────────────

const CORE_SKILLS = ['sf-git-commit', 'sf-git-create-pr', 'sf-git-fix-pr-comments', 'sf-git-merge', 'sf-utils-fix-errors', 'sf-utils-fix-grammar']

/** Verify skills are installed in a multirepo app */
export function assertMultirepoSkills(apiPath: string, webPath: string): AssertionResult[] {
  const results: AssertionResult[] = []

  // Each app should have skills
  for (const appPath of [apiPath, webPath]) {
    results.push(assertDirExists(join(appPath, '.claude', 'skills')))
    for (const skill of CORE_SKILLS) {
      results.push(assertDirExists(join(appPath, '.claude', 'skills', skill)))
    }
  }

  return results
}

/** Verify skills are installed at monorepo root only */
export function assertMonorepoSkills(projectPath: string): AssertionResult[] {
  const results: AssertionResult[] = []

  // Root should have skills
  results.push(assertDirExists(join(projectPath, '.claude', 'skills')))
  for (const skill of CORE_SKILLS) {
    results.push(assertDirExists(join(projectPath, '.claude', 'skills', skill)))
  }

  // Individual apps should NOT have skills
  for (const app of ['apps/api', 'apps/web']) {
    const appSkillsDir = join(projectPath, app, '.claude', 'skills')
    if (existsSync(appSkillsDir)) {
      results.push({
        passed: false,
        message: `FAIL: Skills should not be in ${appSkillsDir} (monorepo centralizes at root)`
      })
    }
  }

  return results
}

// ── CLAUDE.md Assertions ───────────────────────────────────────

/** Verify CLAUDE.md has been properly configured */
export function assertClaudeMdConfigured(claudeMdPath: string, projectName: string): AssertionResult[] {
  const results: AssertionResult[] = []

  results.push(assertFileExists(claudeMdPath))

  if (existsSync(claudeMdPath)) {
    // Should contain project name (not placeholder)
    results.push(assertFileContains(claudeMdPath, projectName))
    results.push(assertFileNotContains(claudeMdPath, '{{PROJECT_NAME}}'))
    results.push(assertFileNotContains(claudeMdPath, '{{VERSION}}'))
  }

  return results
}

// ── Workflow Assertions ────────────────────────────────────────

/** Verify workflow skill is installed with proper structure */
export function assertWorkflowSkill(skillPath: string): AssertionResult[] {
  const results: AssertionResult[] = []

  results.push(assertDirExists(skillPath))
  results.push(assertFileExists(join(skillPath, 'SKILL.md')))

  // Check for status files
  const statusesDir = join(skillPath, 'statuses')
  if (existsSync(statusesDir)) {
    results.push(assertDirExists(statusesDir))
    const statusFiles = readdirSync(statusesDir).filter((f) => f.endsWith('.md'))
    results.push({
      passed: statusFiles.length > 0,
      message: statusFiles.length > 0 ? `OK: ${statusFiles.length} status files in ${statusesDir}` : `FAIL: No status files in ${statusesDir}`
    })
  }

  return results
}

// ── Helpers ────────────────────────────────────────────────────

function isTextFile(filename: string): boolean {
  const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.env', '.html', '.css', '.prisma', '.toml', '.sh']
  return textExtensions.some((ext) => filename.endsWith(ext))
}

// ── Reporter ───────────────────────────────────────────────────

export function reportResults(scenarioName: string, results: AssertionResult[]): boolean {
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Scenario: ${scenarioName}`)
  console.log(`${'='.repeat(60)}`)

  for (const result of results) {
    if (!result.passed) {
      console.log(`  ${result.message}`)
    }
  }

  if (failed === 0) {
    console.log(`  All ${passed} assertions passed`)
  } else {
    console.log(`  ---`)
    console.log(`  ${passed} passed, ${failed} FAILED`)
  }

  return failed === 0
}
