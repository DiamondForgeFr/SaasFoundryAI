import { copy } from 'fs-extra'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { blueprintsPath } from '../types'

export type ImpactValidationProfile = 'monorepo' | 'api' | 'web'

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

function validationConfiguration(profile: ImpactValidationProfile) {
  const command = (script: string) => [['npm', 'run', script]]
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

export async function installImpactValidation(targetPath: string, profile: ImpactValidationProfile): Promise<void> {
  const scriptsPath = join(targetPath, 'scripts/saasfoundry')
  const metadataPath = join(targetPath, '.saasfoundry')
  await mkdir(scriptsPath, { recursive: true })
  await mkdir(metadataPath, { recursive: true })
  await copy(join(VALIDATION_SOURCE, 'impact-classifier.mjs'), join(scriptsPath, 'impact-classifier.mjs'), { overwrite: true })
  await copy(join(VALIDATION_SOURCE, 'run-impact-validation.mjs'), join(scriptsPath, 'run-impact-validation.mjs'), { overwrite: true })
  await writeFile(join(metadataPath, 'validation.json'), `${JSON.stringify(validationConfiguration(profile), null, 2)}\n`)

  const packagePath = join(targetPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, string> }
  packageJson.scripts = {
    ...packageJson.scripts,
    'format:check': 'prettier --check .',
    'test:impact': 'node scripts/saasfoundry/run-impact-validation.mjs --config .saasfoundry/validation.json',
    'test:staged': 'npm run test:impact -- --staged',
    'test:impact:docs': 'npx prettier --check README.md',
    'test:impact:harness': 'npm run format:check',
    ...PROFILE_SCRIPTS[profile]
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const workflowTemplate = await readFile(join(VALIDATION_SOURCE, 'test.workflow.yml'), 'utf8')
  await mkdir(join(targetPath, '.github/workflows'), { recursive: true })
  await writeFile(join(targetPath, '.github/workflows/test.yml'), workflowTemplate.replaceAll('{{VALIDATION_PROFILE}}', profile))
}
