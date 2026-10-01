import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { copyOverlay, PACKAGED_DOTFILES } from '../../../utils/overlay-copy'

describe('copyOverlay (#875)', () => {
  let root: string
  let source: string
  let target: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-overlay-copy-'))
    source = join(root, 'overlay')
    target = join(root, 'project')
    await mkdir(join(source, 'nested'), { recursive: true })
    await mkdir(target, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('restores the real name of a packaged dotfile, at the root and nested', async () => {
    await writeFile(join(source, 'gitignore'), 'node_modules\n')
    await writeFile(join(source, 'nested', 'gitignore'), 'dist\n')
    await writeFile(join(source, 'README.md'), '# overlay\n')

    await copyOverlay(source, target)

    expect(await readFile(join(target, '.gitignore'), 'utf8')).toBe('node_modules\n')
    expect(await readFile(join(target, 'nested', '.gitignore'), 'utf8')).toBe('dist\n')
    expect((await readdir(target)).sort()).toEqual(['.gitignore', 'README.md', 'nested'])
    expect(await readdir(join(target, 'nested'))).toEqual(['.gitignore'])
  })

  it('overwrites an existing .gitignore, as the plain overlay copy always did', async () => {
    await writeFile(join(source, 'gitignore'), 'template\n')
    await writeFile(join(target, '.gitignore'), 'previous\n')

    await copyOverlay(source, target)

    expect(await readFile(join(target, '.gitignore'), 'utf8')).toBe('template\n')
  })

  it('leaves a target file named like a packaged dotfile alone when the overlay ships none', async () => {
    await writeFile(join(source, 'README.md'), '# overlay\n')
    await writeFile(join(target, 'gitignore'), 'user-owned\n')

    await copyOverlay(source, target)

    expect(await readFile(join(target, 'gitignore'), 'utf8')).toBe('user-owned\n')
    expect(await readdir(target)).not.toContain('.gitignore')
  })
})

describe('scaffold files npm would not publish (#875)', () => {
  // Names npm drops or rewrites when it packs, whatever the `files` field says.
  const NPM_DROPPED = new Set(['.gitignore', '.npmignore', '.npmrc', '.DS_Store'])
  const tracked = execFileSync('git', ['ls-files', 'scaffolds'], { cwd: resolve(__dirname, '../../../..'), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

  it('finds the tracked scaffold tree, so an empty listing cannot pass', () => {
    expect(tracked.length).toBeGreaterThan(500)
  })

  it('stores no template under a name npm drops — they ship under a packaged name instead', () => {
    expect(tracked.filter((path) => NPM_DROPPED.has(basename(path)))).toEqual([])
  })

  it('maps every packaged name back to a name npm drops', () => {
    for (const real of Object.values(PACKAGED_DOTFILES)) expect(NPM_DROPPED.has(real)).toBe(true)
  })
})
