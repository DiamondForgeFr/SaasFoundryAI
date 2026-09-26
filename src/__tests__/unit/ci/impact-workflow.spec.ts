import { readFileSync } from 'node:fs'
import path from 'node:path'

import { load } from 'js-yaml'

const ROOT = path.resolve(__dirname, '../../../..')
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/test.yml')
const VALIDATION_PATH = path.join(ROOT, '.saasfoundry/validation.json')

interface Job {
  if?: string
  needs?: string | string[]
  outputs?: Record<string, string>
  steps?: Array<{ id?: string; uses?: string; with?: Record<string, unknown>; run?: string }>
}

interface Workflow {
  on: Record<string, unknown>
  jobs: Record<string, Job>
}

describe('impact-aware SaaSFoundry CI contract', () => {
  const source = readFileSync(WORKFLOW_PATH, 'utf8')
  const workflow = load(source) as Workflow

  it('classifies every supported event instead of filtering paths before the safety contract runs', () => {
    expect(workflow.on).toHaveProperty('pull_request')
    expect(workflow.on).toHaveProperty('merge_group')
    expect(workflow.on).toHaveProperty('push')
    expect(workflow.on).toHaveProperty('schedule')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(source).not.toMatch(/^\s+paths(?:-ignore)?:/m)
    expect(source).not.toContain('pull_request_target')
  })

  it('uses complete history and executes pull-request code only through the trusted base classifier', () => {
    const checkout = workflow.jobs.classify.steps?.find((step) => step.uses === 'actions/checkout@v4')
    expect(checkout?.with).toMatchObject({ 'fetch-depth': 0, 'persist-credentials': false })
    expect(source).toContain('git show "${trusted_base}:scaffolds/shared/validation/impact-classifier.mjs"')
    expect(source).toContain('TRUSTED_CLASSIFIER_UNAVAILABLE_FULL')
    expect(source).toContain('--range-mode "$RANGE_MODE"')
  })

  it('keeps draft runs visible while deferring every expensive lane', () => {
    expect(source).toContain('if [[ "$PR_DRAFT" == "true" ]]; then deferred="true"; fi')
    expect(source).toContain('mode="deferred"')
    expect(source).toContain('execute="false"')
    expect(source).toContain('selected="false"')
  })

  it('forces the release, scheduled and manually requested surfaces through the full matrix', () => {
    expect(source).toContain('refs/heads/master')
    expect(source).toContain('refs/heads/rc-*')
    expect(source).toContain('refs/tags/v*')
    expect(source).toContain('refs/tags/rc-*')
    expect(source).toContain('schedule|workflow_dispatch)')
    expect(source).toContain('force_full="true"')
  })

  it('publishes one stable required gate that rejects missing, extra, failed or malformed execution', () => {
    const gate = workflow.jobs.required_gate
    expect(gate.if).toBe('always()')
    expect(gate.needs).toEqual(['classify', 'guards', 'docs', 'unit', 'integration', 'e2e', 'lint_build', 'coverage', 'lifecycle_prepare', 'lifecycle'])
    expect(source).toContain('if [[ "$actual" != "$wanted" ]]; then failed=1; fi')
    expect(source).toContain('if [[ "$CONTRACT_VERSION" != "1" ]]')
    expect(source).toContain('Malformed boolean output')
  })

  it('keeps local validation commands data-only and argument-vector based', () => {
    const config = JSON.parse(readFileSync(VALIDATION_PATH, 'utf8')) as {
      version: number
      profile: string
      commands: Record<string, string[][]>
    }
    expect(config).toMatchObject({ version: 1, profile: 'saasfoundry' })
    expect(config.commands).toHaveProperty('guards')
    expect(config.commands).toHaveProperty('docs')
    expect(config.commands).toHaveProperty('frontend')
    expect(config.commands).toHaveProperty('backend')
    expect(config.commands).toHaveProperty('shared')
    expect(config.commands).toHaveProperty('harnessScaffold')
    expect(config.commands).toHaveProperty('lifecycle')
    expect(config.commands).toHaveProperty('full')
    for (const commands of Object.values(config.commands)) {
      for (const command of commands) expect(command.every((part) => typeof part === 'string')).toBe(true)
    }
  })
})
