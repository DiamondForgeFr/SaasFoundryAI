import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { isNpmEnvironmentFailure, NPM_ENVIRONMENT_FAILURE_MARKER, NPM_NETWORK_RETRY_ENV } from '../../../../tests/docker/lifecycle/npm-network'

// #1198 — `sf new` runs `npm install` inside the CLI, out of reach of the lane's npm settings:
// registry resets failed the lane and a stalled install held it until the 1800 s budget.
// The lifecycle image puts this wrapper first on PATH.
const LANE_DIR = resolve('tests/docker/lifecycle/npm-lane')
const LAUNCHER = join(LANE_DIR, 'npm')
const lane = require(join(LANE_DIR, 'npm-lane.cjs')) as {
  LANE_NPM_ENV: Readonly<Record<string, string>>
  ENVIRONMENT_FAILURE_MARKER: string
  npmCommand: (args: readonly string[]) => string | undefined
  resolveRealNpm: (env: NodeJS.ProcessEnv, ownDir: string) => string | undefined
  laneEnvironment: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
}

interface Outcome {
  status: number | null
  stdout: string
  stderr: string
  durationMs: number
}

/** Async on purpose: the fake registry below answers from this same process. */
function runLane(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Outcome> {
  const started = Date.now()
  return new Promise((done, fail) => {
    const child = spawn(LAUNCHER, [...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', fail)
    child.once('close', (status) => done({ status, stdout, stderr, durationMs: Date.now() - started }))
  })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('lifecycle npm lane wrapper', () => {
  let root: string
  let fakeNpm: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sf-npm-lane-'))
    fakeNpm = join(root, 'fake-npm')
    // A stand-in for npm whose behaviour each test picks through FAKE_MODE.
    writeFileSync(
      fakeNpm,
      `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const mode = process.env.FAKE_MODE
appendFileSync(process.env.FAKE_CALLS, process.argv.slice(2).join(' ') + '\\n')
const calls = readFileSync(process.env.FAKE_CALLS, 'utf8').trim().split('\\n').length
if (mode === 'env') {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('npm_config_')))))
} else if (mode === 'stall') {
  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' })
  writeFileSync(process.env.FAKE_PID, String(sleeper.pid))
  setInterval(() => {}, 1000)
} else if (mode === 'slow') {
  setTimeout(() => process.exit(0), 800)
} else if (mode === 'reset-once') {
  if (calls === 1) { console.error('npm error code ECONNRESET\\nnpm error network aborted'); process.exit(1) }
} else if (mode === 'eresolve') {
  console.error('npm error code ERESOLVE'); process.exit(1)
}
`
    )
    chmodSync(fakeNpm, 0o755)
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const fakeEnv = (mode: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
    const calls = join(root, `calls-${mode}-${Date.now()}-${Math.random()}`)
    writeFileSync(calls, '')
    return { PATH: process.env.PATH, HOME: process.env.HOME, SF_LANE_REAL_NPM: fakeNpm, FAKE_MODE: mode, FAKE_CALLS: calls, FAKE_PID: join(root, `pid-${mode}`), ...extra }
  }
  const callCount = (env: NodeJS.ProcessEnv) => readFileSync(env.FAKE_CALLS!, 'utf8').trim().split('\n').filter(Boolean).length

  it('applies the same fetch settings as the lane, and npm-network.ts reports its marker', () => {
    expect(lane.LANE_NPM_ENV).toEqual(NPM_NETWORK_RETRY_ENV)
    expect(lane.ENVIRONMENT_FAILURE_MARKER).toBe(NPM_ENVIRONMENT_FAILURE_MARKER)
    expect(Number(lane.LANE_NPM_ENV.npm_config_fetch_retries)).toBeGreaterThan(2)
    // npm's default fetch-timeout is 300000: one dead socket held an attempt for five minutes
    expect(Number(lane.LANE_NPM_ENV.npm_config_fetch_timeout)).toBeLessThan(300_000)
  })

  it('is first on the lifecycle image PATH, after the tests are copied, and executable', () => {
    const dockerfile = readFileSync(resolve('Dockerfile.test'), 'utf8')
    const copy = dockerfile.indexOf('COPY tests/docker/ /workspace/')
    const path = dockerfile.indexOf('ENV PATH="/workspace/lifecycle/npm-lane:${PATH}"')
    expect(copy).toBeGreaterThan(-1)
    expect(path).toBeGreaterThan(copy)
    expect(dockerfile).toContain('RUN chmod 0755 /workspace/lifecycle/npm-lane/npm')
    expect(statSync(LAUNCHER).mode & 0o111).not.toBe(0)
  })

  it('reads the npm command past leading options', () => {
    expect(lane.npmCommand(['install'])).toBe('install')
    expect(lane.npmCommand(['--silent', 'ci', '--ignore-scripts'])).toBe('ci')
    expect(lane.npmCommand(['run', 'build'])).toBe('run')
  })

  it('finds the real npm on PATH past its own directory', () => {
    const other = join(root, 'bin')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'npm'), '#!/bin/sh\n')
    chmodSync(join(other, 'npm'), 0o755)
    expect(lane.resolveRealNpm({ PATH: [LANE_DIR, other].join(delimiter) }, LANE_DIR)).toBe(join(other, 'npm'))
  })

  it('passes the lane settings to npm, and keeps a value the caller set', async () => {
    const env = fakeEnv('env', { npm_config_fetch_retries: '9' })
    const outcome = await runLane(['config', 'list'], env, root)
    expect(outcome.status).toBe(0)
    const seen = JSON.parse(outcome.stdout) as Record<string, string>
    expect(seen).toMatchObject({ ...NPM_NETWORK_RETRY_ENV, npm_config_fetch_retries: '9' })
  })

  // The stall the lane saw on 2026-11-08 was this postinstall downloading 183 MiB of browsers
  it.each(['scaffolds/overlays/monorepo/web/package.json', 'scaffolds/overlays/multirepo/web/package.json'])(
    'keeps the generated web postinstall in %s from installing browsers in the lane, and only in the lane',
    (manifest) => {
      const postinstall = (JSON.parse(readFileSync(resolve(manifest), 'utf8')) as { scripts: Record<string, string> }).scripts.postinstall
      const bin = join(root, 'fake-npx-bin')
      mkdirSync(bin, { recursive: true })
      const calls = join(root, 'npx-calls')
      writeFileSync(join(bin, 'npx'), `#!/bin/sh\necho "$@" >> "${calls}"\n`)
      chmodSync(join(bin, 'npx'), 0o755)
      const base = { PATH: [bin, process.env.PATH].join(delimiter), CI: 'true', HUSKY: '0', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
      const project = mkdtempSync(join(root, 'web-'))

      writeFileSync(calls, '')
      expect(spawnSync('sh', ['-c', postinstall], { cwd: project, env: lane.laneEnvironment(base) }).status).toBe(0)
      expect(readFileSync(calls, 'utf8')).toBe('')

      // Without the lane, a CI install still installs them: the lane changes nothing generated projects do
      expect(spawnSync('sh', ['-c', postinstall], { cwd: project, env: base }).status).toBe(0)
      expect(readFileSync(calls, 'utf8')).toContain('playwright install --with-deps')
    }
  )

  it('stops a stalled install at its budget, with its whole process group, and names it an environment failure', async () => {
    const env = fakeEnv('stall', { SF_LANE_NPM_INSTALL_TIMEOUT_MS: '400' })
    const outcome = await runLane(['install'], env, root)
    expect(outcome.status).toBe(124)
    expect(outcome.stderr).toContain(NPM_ENVIRONMENT_FAILURE_MARKER)
    expect(outcome.stderr).toContain('did not finish within')
    expect(isNpmEnvironmentFailure(outcome.stderr)).toBe(true)
    expect(outcome.durationMs).toBeLessThan(10_000)
    expect(callCount(env)).toBe(1)
    const sleeper = Number(readFileSync(env.FAKE_PID!, 'utf8'))
    for (let waited = 0; isAlive(sleeper) && waited < 2_000; waited += 50) await new Promise((wake) => setTimeout(wake, 50))
    expect(isAlive(sleeper)).toBe(false)
  })

  it('does not put a budget on commands other than install and ci', async () => {
    const env = fakeEnv('slow', { SF_LANE_NPM_INSTALL_TIMEOUT_MS: '100' })
    const outcome = await runLane(['run', 'build'], env, root)
    expect(outcome.status).toBe(0)
  })

  it('runs an install again after a transient network error', async () => {
    const env = fakeEnv('reset-once')
    const outcome = await runLane(['install'], env, root)
    expect(outcome.status).toBe(0)
    expect(callCount(env)).toBe(2)
    expect(outcome.stderr).toContain('running it again')
  })

  it('fails a product error at once, without running it again', async () => {
    const env = fakeEnv('eresolve')
    const outcome = await runLane(['ci'], env, root)
    expect(outcome.status).toBe(1)
    expect(callCount(env)).toBe(1)
    expect(isNpmEnvironmentFailure(outcome.stderr)).toBe(false)
  })
})

describe('lifecycle npm lane against a registry that resets connections', () => {
  const PACKAGE = 'sf-lane-fixture'
  let root: string
  let server: Server
  let registry: string
  let resetsLeft = 0
  let resets = 0

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'sf-npm-lane-registry-'))
    mkdirSync(join(root, 'src', 'package'), { recursive: true })
    writeFileSync(join(root, 'src', 'package', 'package.json'), JSON.stringify({ name: PACKAGE, version: '1.0.0' }))
    const tarball = join(root, 'fixture.tgz')
    expect(spawnSync('tar', ['-czf', tarball, '-C', join(root, 'src'), 'package']).status).toBe(0)
    const bytes = readFileSync(tarball)
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`

    server = createServer((request, response) => {
      if (resetsLeft > 0) {
        resetsLeft--
        resets++
        request.socket.destroy()
        return
      }
      if (request.url === `/${PACKAGE}`) {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            name: PACKAGE,
            'dist-tags': { latest: '1.0.0' },
            versions: { '1.0.0': { name: PACKAGE, version: '1.0.0', dist: { tarball: `${registry}/${PACKAGE}/-/${PACKAGE}-1.0.0.tgz`, integrity } } }
          })
        )
        return
      }
      if (request.url === `/${PACKAGE}/-/${PACKAGE}-1.0.0.tgz`) {
        response.setHeader('content-type', 'application/octet-stream')
        response.end(bytes)
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
    registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((closed) => server.close(closed))
    rmSync(root, { recursive: true, force: true })
  })

  const project = (name: string): string => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true }))
    writeFileSync(join(dir, '.npmrc-empty'), '')
    return dir
  }
  const installEnv = (dir: string, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
    PATH: [LANE_DIR, process.env.PATH].join(delimiter),
    HOME: process.env.HOME,
    npm_config_registry: `${registry}/`,
    npm_config_cache: join(dir, '.cache'),
    npm_config_userconfig: join(dir, '.npmrc-empty'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_loglevel: 'error',
    // Retry quickly: the count is under test here, not npm's back-off.
    npm_config_fetch_retry_mintimeout: '20',
    npm_config_fetch_retry_maxtimeout: '100',
    ...extra
  })

  it('fails on the resets with npm alone, and the lane reads it as an environment failure', async () => {
    const dir = project('without-lane-retries')
    resetsLeft = 3
    resets = 0
    const outcome = await runLane(['install', PACKAGE], installEnv(dir, { npm_config_fetch_retries: '0', SF_LANE_NPM_INSTALL_ATTEMPTS: '1' }), dir)
    expect(outcome.status).not.toBe(0)
    expect(outcome.stderr).toMatch(/ECONNRESET|network/)
    expect(isNpmEnvironmentFailure(outcome.stderr)).toBe(true)
    expect(existsSync(join(dir, 'node_modules', PACKAGE, 'package.json'))).toBe(false)
  }, 60_000)

  it('installs through the same resets with the lane settings', async () => {
    const dir = project('with-lane-retries')
    resetsLeft = 3
    resets = 0
    const outcome = await runLane(['install', PACKAGE], installEnv(dir, {}), dir)
    expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: expect.any(String) })
    expect(resets).toBe(3)
    expect(existsSync(join(dir, 'node_modules', PACKAGE, 'package.json'))).toBe(true)
  }, 60_000)
})
