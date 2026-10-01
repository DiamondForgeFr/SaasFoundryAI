import { copy } from 'fs-extra'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { blueprintsPath } from '../types'

export type ImpactValidationProfile = 'monorepo' | 'api' | 'web'

export function impactValidationPlaceholders(mainBranch: string, workingBranch?: string): Record<string, string> {
  const pullRequestBranches = [...new Set([workingBranch || mainBranch, mainBranch])]
  return {
    VALIDATION_MAIN_BRANCH_JSON: JSON.stringify(mainBranch),
    CI_PR_BRANCHES_JSON: JSON.stringify(pullRequestBranches),
    CI_PUSH_BRANCHES_JSON: JSON.stringify([...pullRequestBranches, 'rc-*'])
  }
}

const VALIDATION_SOURCE = resolve(blueprintsPath, '../shared/validation')

const PROFILE_SCRIPTS: Record<ImpactValidationProfile, Record<string, string>> = {
  monorepo: {
    'test:impact:guards': 'npm run format:check && npm run codegen:check',
    'test:impact:frontend': 'npx turbo run build lint type-check --filter=*-web',
    'test:impact:backend': 'npx turbo run build lint type-check test:unit --filter=*-api',
    'test:impact:shared': 'npm run build && npm run lint && npm run type-check && npm run test:unit',
    'test:impact:lifecycle': 'npm run test:e2e',
    'test:full': 'npm run format:check && npm run codegen:check && npm run build && npm run lint && npm run type-check && npm run test:unit && npm run test:e2e'
  },
  api: {
    'test:impact:guards': 'npm run format:check',
    'test:impact:frontend': 'npm run format:check',
    'test:impact:backend': 'npm run build:ci && npm run lint && npm run type-check && npm run test:unit',
    'test:impact:shared': 'npm run build:ci && npm run lint && npm run type-check && npm run test:unit',
    'test:impact:lifecycle': 'npm run test:e2e',
    'test:full': 'npm run format:check && npm run build:ci && npm run lint && npm run type-check && npm run test:unit && npm run test:e2e'
  },
  web: {
    'test:impact:guards': 'npm run format:check',
    'test:impact:frontend': 'npm run build && npm run lint && npm run type-check',
    'test:impact:backend': 'npm run format:check',
    'test:impact:shared': 'npm run build && npm run lint && npm run type-check',
    'test:impact:lifecycle': 'npm run test:e2e',
    'test:full': 'npm run format:check && npm run build && npm run lint && npm run type-check && npm run test:e2e'
  }
}

const command = (script: string) => [['npm', 'run', script]]

function validationConfiguration(profile: ImpactValidationProfile) {
  return {
    version: 1,
    profile,
    commands: {
      guards: command('test:impact:guards'),
      docs: command('test:impact:docs'),
      frontend: command('test:impact:frontend'),
      backend: command('test:impact:backend'),
      shared: command('test:impact:shared'),
      harnessScaffold: command('test:impact:harness'),
      lifecycle: command('test:impact:lifecycle'),
      full: command('test:full')
    }
  }
}

/**
 * The same lanes, as the pre-commit hook runs them: without the E2E suite. Every change
 * under the API or the web app selects the lifecycle lane, so a hook reading
 * validation.json ran `test:e2e` on almost every commit (#867). CI keeps validation.json,
 * where the lifecycle lane still runs it; a commit's full validation is everything else.
 */
function commitConfiguration(profile: ImpactValidationProfile) {
  const config = validationConfiguration(profile)
  return {
    ...config,
    commands: {
      ...config.commands,
      lifecycle: command('test:impact:guards'),
      full: [...command('test:impact:guards'), ...command('test:impact:shared')]
    }
  }
}

/**
 * Paths `prettier --check .` leaves alone: what SaaSFoundryAI writes and refreshes on
 * `sf update`, and what is generated. Checking them failed the format check of every
 * freshly generated project, and formatting them would turn the next update into
 * conflicts (#867). The project's own files stay checked.
 */
function prettierIgnore(profile: ImpactValidationProfile): string {
  const apiDocs = profile === 'monorepo' ? 'apps/api/docs/' : profile === 'api' ? 'docs/' : null
  return [
    '# Written and refreshed by SaaSFoundryAI (`sf update`)',
    '.saasfoundry.json',
    '.saasfoundry/',
    'scripts/saasfoundry/',
    '.github/workflows/test.yml',
    '**/.github/workflows/pr-review-sync.yml',
    '.claude/',
    '.agents/',
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    '',
    '# Generated',
    '**/src/generated/',
    ...(apiDocs ? [`${apiDocs}openapi.json`, `${apiDocs}index.html`] : []),
    ''
  ].join('\n')
}

export async function installImpactValidation(targetPath: string, profile: ImpactValidationProfile): Promise<void> {
  const scriptsPath = join(targetPath, 'scripts/saasfoundry')
  const metadataPath = join(targetPath, '.saasfoundry')
  await mkdir(scriptsPath, { recursive: true })
  await mkdir(metadataPath, { recursive: true })
  await copy(join(VALIDATION_SOURCE, 'impact-classifier.mjs'), join(scriptsPath, 'impact-classifier.mjs'), { overwrite: true })
  await copy(join(VALIDATION_SOURCE, 'run-impact-validation.mjs'), join(scriptsPath, 'run-impact-validation.mjs'), { overwrite: true })
  await writeFile(join(metadataPath, 'validation.json'), `${JSON.stringify(validationConfiguration(profile), null, 2)}\n`)
  await writeFile(join(metadataPath, 'validation.commit.json'), `${JSON.stringify(commitConfiguration(profile), null, 2)}\n`)
  await writeFile(join(targetPath, '.prettierignore'), prettierIgnore(profile))

  const packagePath = join(targetPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, string> }
  packageJson.scripts = {
    ...packageJson.scripts,
    'format:check': 'prettier --check .',
    'test:impact': 'node scripts/saasfoundry/run-impact-validation.mjs --config .saasfoundry/validation.json',
    'test:staged': 'npm run test:impact -- --staged --config .saasfoundry/validation.commit.json',
    'test:impact:docs': 'npx prettier --check README.md',
    'test:impact:harness': 'npm run format:check',
    ...PROFILE_SCRIPTS[profile]
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const workflowTemplate = await readFile(join(VALIDATION_SOURCE, 'test.workflow.yml'), 'utf8')
  await mkdir(join(targetPath, '.github/workflows'), { recursive: true })
  await writeFile(join(targetPath, '.github/workflows/test.yml'), workflowTemplate.replaceAll('{{VALIDATION_PROFILE}}', profile))
}
