import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { runPreviousReleaseUpdateLifecycle } from '../../../../tests/docker/update-previous-release'

const ROOT = resolve(__dirname, '../../../..')
const FIXTURE = join(ROOT, 'tests/docker/fixtures/previous-release/1.0.0-beta/multirepo.fixture.json.gz')
const CLI = join(ROOT, 'bin/sf.js')

jest.setTimeout(180_000)

/**
 * An offline npm that keeps the file effects `sf update` verifies, and nothing else.
 *
 * `install` writes a package-lock.json derived from package.json (deterministic, so the
 * byte-idempotence check still compares two identical runs); `install` without
 * `--package-lock-only` and `ci` leave a node_modules directory; `ci` refuses a missing lock,
 * as real npm does. Every other command is a no-op.
 */
const FAKE_NPM_SCRIPT = `'use strict'
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const command = args.find((arg) => !arg.startsWith('-'))
const writesLock = command === 'install' || command === 'i'
const installsModules = command === 'ci' || (writesLock && !args.includes('--package-lock-only'))
if (command === 'ci' && !existsSync('package-lock.json')) {
  process.stderr.write('fake npm: npm ci requires an existing package-lock.json\\n')
  process.exit(1)
}
if (writesLock && existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const root = { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': root } }
  writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\\n')
}
if (installsModules) mkdirSync('node_modules', { recursive: true })
`

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

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
    // An offline fake keeps this test deterministic and network-independent, but
    // it must keep the file contract `sf update` checks after each npm call: the
    // lock refresh removes package-lock.json and requires `npm install
    // --package-lock-only` to write it back, then requires `npm ci` to leave a
    // node_modules directory (#1080). A bare `exit 0` wrote neither.
    const fakeNpmScript = join(fakeBin, 'fake-npm.js')
    await writeFile(fakeNpmScript, FAKE_NPM_SCRIPT)
    const fakeNpm = join(fakeBin, 'npm')
    await writeFile(fakeNpm, `#!/usr/bin/env sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fakeNpmScript)} "$@"\n`)
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
