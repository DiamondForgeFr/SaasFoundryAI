import { execFileSync, spawnSync } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join, resolve } from 'path'

import { createDevServicesCompose } from '../../../builders/dev-services.builder'

// `services:up` failed on every fresh project: the dev-services compose file declares the
// project's network `external: true`, and only `sf resume` created it (#978). The generated
// script now creates the external networks before `docker compose up`.

const SCAFFOLDS = resolve(__dirname, '../../../../scaffolds')
const SCRIPT = resolve(SCAFFOLDS, 'blueprints/api/scripts/ensure-docker-networks.mjs')

/**
 * Runs the script with a fake `docker` first on PATH. The fake records every call and answers
 * `network inspect` with success only for the networks listed in FAKE_EXISTING.
 */
function runScript(args: string[], existing: string[] = [], options: { createFails?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-978-'))
  const log = join(dir, 'calls.log')
  const fake = join(dir, 'docker')
  writeFileSync(
    fake,
    [
      '#!/bin/sh',
      'echo "$*" >> "$FAKE_LOG"',
      'if [ "$1 $2" = "network inspect" ]; then',
      '  case " $FAKE_EXISTING " in *" $3 "*) exit 0 ;; esac',
      '  exit 1',
      'fi',
      'if [ "$1 $2" = "network create" ] && [ -n "$FAKE_CREATE_FAILS" ]; then echo "boom" >&2; exit 1; fi',
      'exit 0',
      ''
    ].join('\n')
  )
  chmodSync(fake, 0o755)
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_LOG: log,
      FAKE_EXISTING: existing.join(' '),
      FAKE_CREATE_FAILS: options.createFails ? '1' : ''
    }
  })
  let calls: string[] = []
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    calls = []
  }
  return { dir, result, calls, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function composeIn(dir: string, name: string, content: string): string {
  const file = join(dir, name)
  writeFileSync(file, content)
  return file
}

describe('ensure-docker-networks.mjs (#978)', () => {
  const tmp: string[] = []
  afterAll(() => tmp.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-978-compose-'))
    tmp.push(dir)
    return dir
  }

  it('creates the network of a generated dev-services compose file when it is missing', async () => {
    const apiPath = scratch()
    await createDevServicesCompose({ apiPath, projectName: 'acme', dbSetup: 'docker', s3Setup: 'docker' } as Parameters<typeof createDevServicesCompose>[0])
    const run = runScript([join(apiPath, 'docker-compose.dev-services.yml')])
    try {
      expect(run.result.status).toBe(0)
      expect(run.calls).toEqual(['network inspect acme-network', 'network create acme-network'])
      expect(run.result.stdout).toContain('Created the Docker network acme-network')
    } finally {
      run.cleanup()
    }
  })

  // `sf resume`, another terminal or the API/web containers' compose files may have created it:
  // the projects share it, so an existing network is left as it is.
  it('leaves an existing network untouched', () => {
    const file = composeIn(scratch(), 'compose.yml', 'services:\n  a:\n    image: x\nnetworks:\n  acme-network:\n    external: true\n')
    const run = runScript([file], ['acme-network'])
    try {
      expect(run.result.status).toBe(0)
      expect(run.calls).toEqual(['network inspect acme-network'])
    } finally {
      run.cleanup()
    }
  })

  it('reads every external network, honours `name:`, and ignores networks Compose owns', () => {
    const file = composeIn(
      scratch(),
      'compose.yml',
      [
        'services:',
        '  web:',
        '    networks:',
        '      - inner-not-a-declaration',
        'networks:',
        '  shared:',
        '    external: true # Assuming backend creates this network',
        '  renamed:',
        '    external: true',
        "    name: 'real-name'",
        '  owned:',
        '    driver: bridge',
        'volumes:',
        '  data:',
        '    external: true',
        ''
      ].join('\n')
    )
    const run = runScript([file], ['shared', 'real-name'])
    try {
      expect(run.result.status).toBe(0)
      expect(run.calls).toEqual(['network inspect shared', 'network inspect real-name'])
    } finally {
      run.cleanup()
    }
  })

  it('does nothing for a compose file without external networks', () => {
    const file = composeIn(scratch(), 'compose.yml', 'services:\n  a:\n    image: x\n')
    const run = runScript([file])
    try {
      expect(run.result.status).toBe(0)
      expect(run.calls).toEqual([])
    } finally {
      run.cleanup()
    }
  })

  it('fails, so `docker compose up` does not run, when the network cannot be created', () => {
    const file = composeIn(scratch(), 'compose.yml', 'networks:\n  acme-network:\n    external: true\n')
    const run = runScript([file], [], { createFails: true })
    try {
      expect(run.result.status).toBe(1)
      expect(run.result.stderr).toContain('Could not create the Docker network acme-network')
    } finally {
      run.cleanup()
    }
  })

  it('refuses to run without a compose file', () => {
    const run = runScript([])
    try {
      expect(run.result.status).toBe(2)
    } finally {
      run.cleanup()
    }
  })

  it('is valid ECMAScript the generated API can run with plain node', () => {
    expect(() => execFileSync(process.execPath, ['--check', SCRIPT])).not.toThrow()
  })
})

describe.each(['monorepo', 'multirepo'])('%s API package.json', (topology) => {
  const scripts: Record<string, string> = JSON.parse(readFileSync(resolve(SCAFFOLDS, `overlays/${topology}/api/package.json`), 'utf8')).scripts

  it.each(['services:up', 'services:reset'])('%s creates the external networks before starting the dev services', (name) => {
    const command = scripts[name]
    const ensure = command.indexOf('node scripts/ensure-docker-networks.mjs docker-compose.dev-services.yml')
    expect(ensure).toBeGreaterThanOrEqual(0)
    expect(ensure).toBeLessThan(command.indexOf('up -d'))
  })
})
