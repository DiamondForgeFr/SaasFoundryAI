import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { CI_LANES } from '../../../../tests/docker/ci-lanes'

const ROOT = path.resolve(__dirname, '../../../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/test.yml')
const LIST_SCRIPT = path.join(ROOT, 'tests/docker/list-scenarios.ts')

function listedLane(name: 'normal' | 'full') {
  return JSON.parse(execFileSync('npx', ['tsx', LIST_SCRIPT, '--json', '--lane', name], { cwd: ROOT, encoding: 'utf8' })) as unknown
}

function listedTsv(name: 'normal' | 'full') {
  return execFileSync('npx', ['tsx', LIST_SCRIPT, '--tsv', '--lane', name], { cwd: ROOT, encoding: 'utf8' })
}

describe('typed lifecycle CI lanes', () => {
  it('keeps exactly the three required normal checks', () => {
    expect(CI_LANES.normal.map((entry) => entry.check)).toEqual(['new-monorepo-full', 'new-multirepo-full', 'update-previous-release-smoke'])
    expect(CI_LANES.normal).toHaveLength(3)
  })

  it('keeps exhaustive fresh and update coverage for both topologies', () => {
    expect(CI_LANES.full.map((entry) => entry.check)).toEqual(['new-monorepo-full', 'new-multirepo-full', 'update-previous-release-full', 'update-current-monorepo-full'])
    expect(CI_LANES.full).toHaveLength(4)
  })

  it('renders the CLI from the same typed source', () => {
    expect(listedLane('normal')).toEqual(CI_LANES.normal)
    expect(listedLane('full')).toEqual(CI_LANES.full)
  })

  it('terminates every TSV lane entry so Bash consumes the final scenario', () => {
    const output = listedTsv('normal')
    expect(output.endsWith('\n')).toBe(true)
    expect(output.trimEnd().split('\n')).toHaveLength(CI_LANES.normal.length)
    expect(output).toContain('update-previous-release-smoke\tupdate-previous-release\tsmoke\n')
  })
})

describe('lifecycle workflow contract', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')

  it('builds and writes the cache exactly once', () => {
    expect(workflow.match(/docker\/build-push-action@v6/g)).toHaveLength(1)
    expect(workflow.match(/cache-to:/g)).toHaveLength(1)
    expect(workflow).toContain('outputs: type=docker,dest=${{ runner.temp }}/sf-test.tar')
    expect(workflow).toContain('docker load --input')
  })

  it('takes the lifecycle lane from the classifier and forces release surfaces to full', () => {
    expect(workflow).toContain('LIFECYCLE_LANE: ${{ needs.classify.outputs.lifecycle_lane }}')
    expect(workflow).toContain('--lane "$LIFECYCLE_LANE"')
    expect(workflow).toContain("tags: ['v*', 'rc-*']")
    expect(workflow).toContain("branches: [master, develop, 'rc-*']")
    expect(workflow).toContain('schedule:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('"$REF" == refs/heads/rc-*')
    expect(workflow).toContain('"$REF" == refs/tags/v*')
    expect(workflow).toContain('"$REF" == refs/tags/rc-*')
  })

  it('uses exact matrix check names and the isolated Docker/artifact contract', () => {
    expect(workflow).toContain('name: ${{ matrix.check }}')
    expect(workflow).toContain('docker run --rm --init --ipc=host')
    expect(workflow).toContain('target=/artifacts')
    expect(workflow).toContain('SF_TEST_ARTIFACTS_DIR=/artifacts')
    expect(workflow).not.toContain('/var/run/docker.sock')
  })

  it('always verifies timings and retains diagnostics only on failure', () => {
    expect(workflow).toMatch(/name: Verify timing evidence\n\s+if: always\(\)/)
    expect(workflow).toMatch(/name: Upload lifecycle timing\n\s+if: always\(\)/)
    expect(workflow).toMatch(/name: Upload lifecycle failure diagnostics\n\s+if: failure\(\)/)
  })
})
