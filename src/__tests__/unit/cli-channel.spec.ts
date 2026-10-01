import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describeCliVersion, resolveCliChannel } from '../../cli-channel'

describe('CLI channel (#859)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-cli-channel-'))
    await mkdir(join(root, 'dist'), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads a published package — no git metadata, no sources — as the package channel', () => {
    expect(resolveCliChannel(root)).toEqual({ channel: 'package' })
    expect(describeCliVersion('1.0.0', resolveCliChannel(root))).toBe('1.0.0')
  })

  it('does not take a package that merely ships a src folder for a checkout', async () => {
    await mkdir(join(root, 'src'))
    expect(resolveCliChannel(root)).toEqual({ channel: 'package' })
  })

  it('names a linked development checkout, with its path and commit', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'index.ts'), '\n')
    execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root })
    execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

    const channel = resolveCliChannel(root)

    expect(channel).toEqual({ channel: 'checkout', path: root, commit })
    expect(describeCliVersion('1.0.0', channel)).toBe(`1.0.0 (development checkout: ${root} @ ${commit})`)
  })

  it('keeps the version as the first word, so anything reading `sf --version` still finds it', () => {
    expect(describeCliVersion('1.0.0', { channel: 'checkout', path: '/x' }).split(' ')[0]).toBe('1.0.0')
  })

  it('recognizes this repository as a checkout', () => {
    expect(resolveCliChannel(resolve(__dirname, '../../..')).channel).toBe('checkout')
  })
})
