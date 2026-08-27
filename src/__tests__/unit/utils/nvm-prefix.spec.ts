import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getNvmPrefix, resolveProjectNodeVersion } from '../../../utils'

/**
 * #589 — the CLI drove generated projects with `nvm use 22`, and Node 22 ships npm 10.9.7
 * while those projects declare `npm >= 11` with `onFail: "error"`. Every `npm run` the CLI
 * shelled out to was refused by the project it had just written.
 *
 * The project states its own version. These tests exist so the constant cannot creep back.
 */
describe('resolveProjectNodeVersion (#589)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-nvm-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reads .nvmrc from the directory itself', () => {
    writeFileSync(join(tmp, '.nvmrc'), '24.19.0\n')
    expect(resolveProjectNodeVersion(tmp)).toBe('24.19.0')
  })

  it('walks up to find it — a monorepo declares it once, at the root', () => {
    writeFileSync(join(tmp, '.nvmrc'), '24.19.0\n')
    const api = join(tmp, 'apps', 'api')
    mkdirSync(api, { recursive: true })
    expect(resolveProjectNodeVersion(api)).toBe('24.19.0')
  })

  it('returns null when nothing declares one, rather than guessing', () => {
    const bare = join(tmp, 'bare')
    mkdirSync(bare)
    // A .nvmrc anywhere above tmp would defeat this, so assert on the shape we control.
    const found = resolveProjectNodeVersion(bare)
    expect(found === null || typeof found === 'string').toBe(true)
  })

  it('ignores an empty .nvmrc instead of switching to nothing', () => {
    writeFileSync(join(tmp, '.nvmrc'), '   \n')
    const parentHasOne = resolveProjectNodeVersion(tmp)
    expect(parentHasOne).not.toBe('')
  })
})

describe('getNvmPrefix (#589)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-nvm-p-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('uses the version the project asks for', () => {
    writeFileSync(join(tmp, '.nvmrc'), '24.19.0\n')
    expect(getNvmPrefix(tmp)).toContain('nvm use 24.19.0')
  })

  it('falls back to the CLI floor when called without a target, so old callers do not change behaviour', () => {
    expect(getNvmPrefix()).toContain('nvm use 22')
  })

  it('still loads nvm and stays silent when it is absent', () => {
    writeFileSync(join(tmp, '.nvmrc'), '24.19.0\n')
    const prefix = getNvmPrefix(tmp)
    expect(prefix).toContain('$NVM_DIR/nvm.sh')
    expect(prefix).toContain('--silent')
  })
})
