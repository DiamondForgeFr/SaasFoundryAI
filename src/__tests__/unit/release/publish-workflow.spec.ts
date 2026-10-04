import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { load } from 'js-yaml'

const root = resolve(__dirname, '../../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

interface Step {
  name?: string
  uses?: string
  run?: string
}
interface Job {
  if?: string
  needs?: string
  environment?: string
  permissions?: Record<string, string>
  steps: Step[]
}
interface Workflow {
  on: { push?: { tags?: string[] }; workflow_dispatch?: { inputs?: Record<string, unknown> } }
  permissions: Record<string, string>
  jobs: Record<string, Job>
}

const source = read('.github/workflows/publish-stable.yml')
const workflow = load(source) as Workflow
const runOf = (job: string) => workflow.jobs[job].steps.map((step) => step.run ?? '').join('\n')

// #904 — publication used a stored granular NPM_TOKEN that expires, and a manual dispatch
// after waiting for the tag CI by hand
describe('publish-stable workflow (#904)', () => {
  it('starts on a stable tag push, and keeps a manual dispatch for a retry', () => {
    expect(workflow.on.push?.tags).toEqual(['v[0-9]+.[0-9]+.[0-9]+'])
    expect(workflow.on.workflow_dispatch?.inputs).toHaveProperty('tag')
    expect(read('.github/workflows/test.yml')).toMatch(/tags: \[[^\]]*'v\*'/)
  })

  it("publishes only after the tag's own Tests run succeeded", () => {
    expect(workflow.jobs['wait-for-ci'].if).toBe("github.event_name == 'push'")
    expect(workflow.jobs['wait-for-ci'].permissions).toEqual({ actions: 'read', contents: 'read' })
    const wait = runOf('wait-for-ci')
    expect(wait).toContain('gh run list --workflow test.yml --event push --commit "$TAG_SHA"')
    expect(wait).toContain('select(.headBranch == \\"$RELEASE_TAG\\")')
    expect(wait).toContain('"$conclusion" == "success"')
    expect(workflow.jobs.publish.needs).toBe('wait-for-ci')
    expect(workflow.jobs.publish.if).toContain("needs.wait-for-ci.result == 'success'")
    expect(workflow.jobs.publish.if).toContain("github.event_name == 'workflow_dispatch' && needs.wait-for-ci.result == 'skipped'")
  })

  it('authenticates through trusted publishing: OIDC, the protected environment, and no stored token', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.publish.environment).toBe('npm-production')
    expect(workflow.jobs.publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' })
    expect(source).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/)
  })

  it('publishes with an npm that supports trusted publishing (>= 11.5.1)', () => {
    const pinned = /npm install -g npm@(\d+)\.(\d+)\.(\d+)/.exec(runOf('publish'))
    expect(pinned).not.toBeNull()
    const [major, minor, patch] = pinned!.slice(1).map(Number)
    expect(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)))).toBe(true)
  })

  it('verifies the tag, the version, the changelog and the package before publishing', () => {
    const names = workflow.jobs.publish.steps.map((step) => step.name)
    const order = [
      'Use an npm that supports trusted publishing',
      'Verify stable tag and package identity',
      'Verify the changelog has this version',
      'Verify package boundary',
      'Publish through trusted publishing (no stored token)'
    ]
    expect(order.map((name) => names.indexOf(name))).toEqual([...order.map((name) => names.indexOf(name))].sort((a, b) => a - b))
    expect(order.every((name) => names.includes(name))).toBe(true)
    const publish = runOf('publish')
    expect(publish).toContain('refs/tags/$RELEASE_TAG')
    expect(publish).toContain('git tag --points-at HEAD')
    expect(publish).toContain('already exists; refusing to overwrite it')
    expect(publish).toContain('npm publish --provenance --access public --tag latest')
  })

  it('creates the GitHub Release from the changelog after the publish, and never twice', () => {
    expect(workflow.jobs.release.needs).toBe('publish')
    expect(workflow.jobs.release.permissions).toEqual({ contents: 'write' })
    const release = runOf('release')
    expect(release).toContain('node scripts/release-notes.mjs "${RELEASE_TAG#v}"')
    expect(release).toContain('gh release create "$RELEASE_TAG" --verify-tag')
    expect(release).toContain('already exists; it is left as it is')
  })

  it('pins every action to a commit', () => {
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.uses).filter((value): value is string => Boolean(value)))
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/)
  })
})

describe('scripts/release-notes.mjs (#904)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-release-notes-'))
    mkdirSync(join(dir, 'scripts'))
    mkdirSync(join(dir, 'docs'))
    copyFileSync(resolve(root, 'scripts/release-notes.mjs'), join(dir, 'scripts/release-notes.mjs'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'saasfoundryai-cli', repository: { type: 'git', url: 'git+https://github.com/DiamondForgeFr/SaasFoundryAI.git' } }))
    writeFileSync(
      join(dir, 'docs/changelog.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.0.1] - 2026-10-10\n\n### Fixed\n\n- Setup works without a token.\n\n## [1.0.0] - 2026-09-27\n\n### Added\n\n- First release.\n\n## [0.9.0]\n'
    )
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const notes = (version: string) => spawnSync(process.execPath, [join(dir, 'scripts/release-notes.mjs'), version], { encoding: 'utf8' })

  it('prints the version section, the install command and the changelog link', () => {
    const run = notes('1.0.1')

    expect(run.status).toBe(0)
    expect(run.stdout).toBe(
      '### Fixed\n\n- Setup works without a token.\n\nInstall: `npm install -g saasfoundryai-cli@1.0.1`\n\nSee the [changelog](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/v1.0.1/docs/changelog.md) for every release.\n'
    )
    expect(notes('1.0.0').stdout).toContain('- First release.')
    expect(notes('1.0.0').stdout).not.toContain('0.9.0')
  })

  it('refuses a version without a section, or with an empty one, before anything is published', () => {
    expect(notes('2.0.0')).toMatchObject({ status: 1, stderr: expect.stringContaining('has no "## [2.0.0]" section') })
    expect(notes('0.9.0')).toMatchObject({ status: 1, stderr: expect.stringContaining('is empty') })
    expect(notes('v1.0.1')).toMatchObject({ status: 2 })
  })

  it('finds the section of the release this repository has shipped', () => {
    const run = spawnSync(process.execPath, [resolve(root, 'scripts/release-notes.mjs'), '1.0.0'], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Install: `npm install -g saasfoundryai-cli@1.0.0`')
  })
})
