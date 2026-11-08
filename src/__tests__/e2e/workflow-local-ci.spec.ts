import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { workflowConfigFromPreset } from '../../prompts/workflow.prompts'
import { writeManifest } from '../../utils'

const CLI_ROOT = resolve(__dirname, '../../..')
const schema = JSON.parse(readFileSync(join(CLI_ROOT, 'schemas/saasfoundry-manifest.schema.json'), 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)

// #1104 — the local CI gate reads workflow.localCi.requiredStatuses; the CLI is how the list is written
describe('sf workflow set-local-ci through the compiled CLI', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sf-workflow-local-ci-'))
    const { workflow, aiRules } = workflowConfigFromPreset('solo', 'github-projects')
    await writeManifest(tempDir, { version: '1.0.0', generatedAt: new Date().toISOString(), structure: 'cli', projectName: 'external', workflow, aiRules })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const workflowCommand = (...args: string[]) =>
    spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'workflow', ...args], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })
  const manifest = async () => JSON.parse(await readFile(join(tempDir, '.saasfoundry.json'), 'utf8'))
  const moltenFile = async (content: unknown) => {
    await mkdir(join(tempDir, '.molten'), { recursive: true })
    await writeFile(join(tempDir, '.molten', 'project.json'), typeof content === 'string' ? content : JSON.stringify(content))
  }

  it('records an explicit list, in the order given, and the manifest still validates against the schema', async () => {
    const run = workflowCommand('set-local-ci', 'local-unit', 'local-e2e')

    expect(run.status).toBe(0)
    expect((await manifest()).workflow.localCi).toEqual({ requiredStatuses: ['local-unit', 'local-e2e'] })
    expect(run.stdout).toContain('local-unit')
    expect(run.stdout).toContain('local-e2e')
    expect(validate(await manifest())).toBe(true)
  })

  it('derives the list of a Molten pipeline that publishes to GitHub with --from-molten, and says it is pinned', async () => {
    await moltenFile({ name: 'sample', ci: { statuses: 'github', jobs: [{ name: 'unit' }, { name: 'lint' }] } })
    const run = workflowCommand('set-local-ci', '--from-molten')

    expect(run.status).toBe(0)
    expect((await manifest()).workflow.localCi).toEqual({ requiredStatuses: ['local-unit', 'local-lint'] })
    expect(run.stdout).toContain('pinned')
    expect(validate(await manifest())).toBe(true)
  })

  it.each([
    ['there is no pipeline file', undefined, 'the file does not exist'],
    ['the pipeline declares no job', { name: 'sample', ci: { statuses: 'github', jobs: [] } }, 'declares no job'],
    ['the pipeline does not publish to GitHub', { ci: { jobs: [{ name: 'unit' }] } }, '"ci": { "statuses": "github" }'],
    ['the pipeline file is malformed', '{ "ci": ', 'Could not read .molten/project.json']
  ])('refuses --from-molten when %s, and leaves the manifest unchanged', async (_why, content, message) => {
    if (content !== undefined) await moltenFile(content)
    const before = await readFile(join(tempDir, '.saasfoundry.json'), 'utf8')
    const run = workflowCommand('set-local-ci', '--from-molten')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain(message)
    expect(await readFile(join(tempDir, '.saasfoundry.json'), 'utf8')).toBe(before)
  })

  it('records a deliberate "no local CI" with --none: an empty list that validates', async () => {
    const run = workflowCommand('set-local-ci', '--none')

    expect(run.status).toBe(0)
    expect((await manifest()).workflow.localCi).toEqual({ requiredStatuses: [] })
    expect(run.stdout).toContain('declares no local CI')
    expect(validate(await manifest())).toBe(true)
  })

  it('removes the key with --clear, which hands the list back to the derivation', async () => {
    workflowCommand('set-local-ci', 'local-unit')
    const run = workflowCommand('set-local-ci', '--clear')

    expect(run.status).toBe(0)
    expect((await manifest()).workflow).not.toHaveProperty('localCi')
    expect(run.stdout).toContain('derives its list again')
  })

  it.each([
    [[], 'Name the commit status contexts'],
    [['local-unit', 'local-unit'], 'listed twice: local-unit'],
    [['local-unit', ' '], 'cannot be blank'],
    [['--none', 'local-unit'], '--none takes no status context'],
    [['--none', '--clear'], 'are exclusive'],
    [['--wat'], 'Unknown option for `sf workflow set-local-ci`: --wat']
  ])('refuses %j and leaves the manifest unchanged', async (args, message) => {
    const before = await readFile(join(tempDir, '.saasfoundry.json'), 'utf8')
    const run = workflowCommand('set-local-ci', ...args)

    expect(run.status).toBe(1)
    expect(run.stderr).toContain(message)
    expect(await readFile(join(tempDir, '.saasfoundry.json'), 'utf8')).toBe(before)
  })

  it('shows the effective list and where it comes from with `show`', async () => {
    expect(workflowCommand('show').stdout).toContain('AI testing / Local CI, published by ai-status')

    workflowCommand('set-local-ci', 'local-unit')
    const recorded = workflowCommand('show').stdout
    expect(recorded).toContain('1 status from workflow.localCi.requiredStatuses')
    expect(recorded).toContain('- local-unit')

    await moltenFile({ ci: { statuses: 'github', jobs: [{ name: 'unit' }, { name: 'lint' }] } })
    workflowCommand('set-local-ci', '--clear')
    expect(workflowCommand('show').stdout).toContain('2 local-<job> statuses derived from .molten/project.json')
  })

  it('reports the gate in sf status, in the text and in the JSON', async () => {
    workflowCommand('set-local-ci', 'local-unit', 'local-e2e')
    const text = spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'status', '--agent-friendly', '--no-network'], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, SF_SKILL_NO_WARN: '1' }
    })
    expect(text.stdout).toContain('- local-ci-gate: 2 statuses from workflow.localCi.requiredStatuses')

    const json = spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'status', '--json', '--no-network'], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })
    expect(JSON.parse(json.stdout).localCiGate).toEqual({ source: 'manifest', requiredStatuses: ['local-unit', 'local-e2e'] })
  })
})
