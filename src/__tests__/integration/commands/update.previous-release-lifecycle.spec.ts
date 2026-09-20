import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { runPreviousReleaseUpdateLifecycle } from '../../../../tests/docker/update-previous-release'

const ROOT = resolve(__dirname, '../../../..')
const FIXTURE = join(ROOT, 'tests/docker/fixtures/previous-release/1.0.0-beta/multirepo.fixture.json.gz')
const CLI = join(ROOT, 'bin/sf.js')

jest.setTimeout(180_000)

// #790 owns the dedicated CI lane. Keeping this opt-in prevents the expensive
// historical lifecycle from running twice in the general integration/coverage
// jobs while preserving one exact test entrypoint for that lane.
const describeLifecycle = process.env.SF_PREVIOUS_RELEASE_LIFECYCLE === '1' ? describe : describe.skip

describeLifecycle('the complete previous-release update state machine', () => {
  let temporaryRoot: string

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'sf-previous-release-lifecycle-'))
  })

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('adds every required late capability through the real CLI and is byte-idempotent', async () => {
    if (process.platform === 'win32') return

    const fakeBin = join(temporaryRoot, 'bin')
    const home = join(temporaryRoot, 'home')
    const workspace = join(temporaryRoot, 'workspace')
    await Promise.all([mkdir(fakeBin), mkdir(home), mkdir(workspace)])

    // Late stack modules invoke npm after depositing their package changes. The
    // lifecycle state machine is the subject of this focused integration test;
    // real dependency installation and application boot are supplied by #788.
    // A no-op executable keeps this test deterministic and network-independent.
    const fakeNpm = join(fakeBin, 'npm')
    await writeFile(fakeNpm, '#!/usr/bin/env sh\nexit 0\n')
    await chmod(fakeNpm, 0o755)

    const result = await runPreviousReleaseUpdateLifecycle({
      fixture: await readFile(FIXTURE),
      workspace,
      cliEntry: CLI,
      env: {
        HOME: home,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`
      }
    })

    expect(result.adoptionFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(result.stableDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(result.manifest).toMatchObject({
      structure: 'multirepo',
      modules: {
        harness: { managed: true },
        email: { provider: 'mailersend' },
        s3Setup: 'docker',
        includeAnalytics: true,
        pwa: { version: 1 },
        advancedSkills: expect.arrayContaining(['context7'])
      },
      adoption: { refreshPending: false }
    })
  })
})
