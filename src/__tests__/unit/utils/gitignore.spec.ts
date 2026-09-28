import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureGitignorePatterns } from '../../../utils/gitignore'

describe('utils/gitignore', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sf-gitignore-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('creates the file and appends patterns when missing', () => {
    const gi = join(workDir, '.gitignore')
    const added = ensureGitignorePatterns(gi, ['.env', '.env.local'])
    expect(added).toEqual(['.env', '.env.local'])
    expect(readFileSync(gi, 'utf8')).toBe('.env\n.env.local\n')
  })

  it('appends only missing patterns to an existing file', () => {
    const gi = join(workDir, '.gitignore')
    writeFileSync(gi, 'node_modules\n.env\n', 'utf8')
    const added = ensureGitignorePatterns(gi, ['.env', '.env.local', '.env*.local'])
    expect(added).toEqual(['.env.local', '.env*.local'])
    const content = readFileSync(gi, 'utf8')
    expect(content).toBe('node_modules\n.env\n\n.env.local\n.env*.local\n')
  })

  it('is idempotent when all patterns already present', () => {
    const gi = join(workDir, '.gitignore')
    writeFileSync(gi, 'node_modules\n.env\n.env.local\n', 'utf8')
    const added = ensureGitignorePatterns(gi, ['.env', '.env.local'])
    expect(added).toEqual([])
    expect(readFileSync(gi, 'utf8')).toBe('node_modules\n.env\n.env.local\n')
  })

  it('trims whitespace when comparing patterns', () => {
    const gi = join(workDir, '.gitignore')
    writeFileSync(gi, '  .env  \n', 'utf8')
    const added = ensureGitignorePatterns(gi, ['.env'])
    expect(added).toEqual([])
  })

  it('preserves a trailing blank line separator when appending', () => {
    const gi = join(workDir, '.gitignore')
    writeFileSync(gi, 'node_modules\n', 'utf8')
    ensureGitignorePatterns(gi, ['.env'])
    expect(readFileSync(gi, 'utf8')).toBe('node_modules\n\n.env\n')
  })

  it('creates parent directories if missing', () => {
    const gi = join(workDir, 'deeply', 'nested', '.gitignore')
    const added = ensureGitignorePatterns(gi, ['.env'])
    expect(added).toEqual(['.env'])
    expect(readFileSync(gi, 'utf8')).toBe('.env\n')
  })
})
