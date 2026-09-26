import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { load } from 'js-yaml'

import { impactValidationPlaceholders, installImpactValidation, ImpactValidationProfile } from '../../../builders/impact-validation'

const ROOT = path.resolve(__dirname, '../../../..')
const CLASSIFIER = path.join(ROOT, 'scaffolds/shared/validation/impact-classifier.mjs')
const RUNNER = path.join(ROOT, 'scaffolds/shared/validation/run-impact-validation.mjs')

it('serializes branch placeholders as YAML-safe JSON data instead of shell source', () => {
  const placeholders = impactValidationPlaceholders('$(echo${IFS}PWN>&2)', 'feature/[review]')
  expect(JSON.parse(placeholders.VALIDATION_MAIN_BRANCH_JSON)).toBe('$(echo${IFS}PWN>&2)')
  expect(JSON.parse(placeholders.CI_PR_BRANCHES_JSON)).toEqual(['feature/[review]', '$(echo${IFS}PWN>&2)'])
  expect(JSON.parse(placeholders.CI_PUSH_BRANCHES_JSON)).toEqual(['feature/[review]', '$(echo${IFS}PWN>&2)', 'rc-*'])
})

describe.each<ImpactValidationProfile>(['monorepo', 'api', 'web'])('%s generated impact validation', (profile) => {
  let target: string

  beforeEach(async () => {
    target = await mkdtemp(path.join(tmpdir(), `sf-impact-${profile}-`))
    await writeFile(path.join(target, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts: { existing: 'true' } }, null, 2)}\n`)
    await writeFile(path.join(target, 'README.md'), '# Fixture\n')
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  it('deposits the canonical byte-identical classifier and runner', async () => {
    await installImpactValidation(target, profile)

    await expect(readFile(path.join(target, 'scripts/saasfoundry/impact-classifier.mjs'))).resolves.toEqual(await readFile(CLASSIFIER))
    await expect(readFile(path.join(target, 'scripts/saasfoundry/run-impact-validation.mjs'))).resolves.toEqual(await readFile(RUNNER))
  })

  it('writes a profile-specific data contract and non-mutating package scripts', async () => {
    await installImpactValidation(target, profile)

    const config = JSON.parse(await readFile(path.join(target, '.saasfoundry/validation.json'), 'utf8'))
    expect(config).toMatchObject({ version: 1, profile })
    expect(Object.keys(config.commands)).toEqual(['guards', 'docs', 'frontend', 'backend', 'shared', 'harnessScaffold', 'lifecycle', 'full'])
    for (const commands of Object.values(config.commands) as string[][][]) {
      for (const command of commands) expect(command.every((part) => typeof part === 'string')).toBe(true)
    }

    const packageJson = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))
    expect(packageJson.scripts).toMatchObject({
      existing: 'true',
      'format:check': 'prettier --check .',
      'test:impact': 'node scripts/saasfoundry/run-impact-validation.mjs --config .saasfoundry/validation.json',
      'test:staged': 'npm run test:impact -- --staged'
    })
    expect(packageJson.scripts['test:full']).toContain('format:check')
    expect(packageJson.scripts['test:full']).not.toMatch(/npm run format(?:\s|$)/)
  })

  it('renders the shared trusted-base workflow with only project placeholders left', async () => {
    await installImpactValidation(target, profile)

    const workflow = await readFile(path.join(target, '.github/workflows/test.yml'), 'utf8')
    expect(workflow).toContain(`--profile ${profile}`)
    expect(workflow).not.toContain('{{VALIDATION_PROFILE}}')
    expect(workflow).toContain('{{CI_PR_BRANCHES_JSON}}')
    expect(workflow).toContain('{{CI_PUSH_BRANCHES_JSON}}')
    expect(workflow).toContain('{{VALIDATION_MAIN_BRANCH_JSON}}')
    expect(workflow).not.toContain('== "{{MAIN_BRANCH}}"')
    expect(workflow).toContain('scripts/saasfoundry/impact-classifier.mjs')
    expect(workflow).toContain('services:\n      postgres:')
    expect(workflow).toContain('needs: [classify, validate, lifecycle]')
    expect(workflow).toContain('Malformed boolean output')
    expect(workflow).toContain('name: CI / Required gate')

    const rendered = workflow
      .replaceAll('{{VALIDATION_MAIN_BRANCH_JSON}}', JSON.stringify('main'))
      .replaceAll('{{CI_PR_BRANCHES_JSON}}', JSON.stringify(['develop', 'main']))
      .replaceAll('{{CI_PUSH_BRANCHES_JSON}}', JSON.stringify(['develop', 'main', 'rc-*']))
    expect(() => load(rendered)).not.toThrow()
  })
})
