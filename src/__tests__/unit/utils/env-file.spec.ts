import fs from 'node:fs'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadEnvFile, upsertEnvKey } from '../../../utils/env-file'

describe('utils/env-file', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sf-envfile-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  describe('upsertEnvKey', () => {
    it('creates the file when missing and appends the key', () => {
      const envPath = join(workDir, '.env')
      upsertEnvKey(envPath, 'NOTION_API_TOKEN', 'secret_abc')
      expect(readFileSync(envPath, 'utf8')).toBe('NOTION_API_TOKEN=secret_abc\n')
    })

    it('appends a new key when the file exists', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, 'EXISTING=1\n', 'utf8')
      upsertEnvKey(envPath, 'NOTION_API_TOKEN', 'secret_abc')
      const content = readFileSync(envPath, 'utf8')
      expect(content).toContain('EXISTING=1')
      expect(content).toContain('NOTION_API_TOKEN=secret_abc')
    })

    it('replaces an existing key without duplicating', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, 'NOTION_API_TOKEN=old_value\nOTHER=keep\n', 'utf8')
      upsertEnvKey(envPath, 'NOTION_API_TOKEN', 'new_value')
      const content = readFileSync(envPath, 'utf8')
      expect(content).toBe('NOTION_API_TOKEN=new_value\nOTHER=keep\n')
      expect(content.match(/NOTION_API_TOKEN=/g)?.length).toBe(1)
    })

    it('quotes values that contain whitespace or special chars', () => {
      const envPath = join(workDir, '.env')
      upsertEnvKey(envPath, 'MSG', 'hello world')
      expect(readFileSync(envPath, 'utf8')).toBe('MSG="hello world"\n')
    })

    it('escapes embedded double quotes and backslashes', () => {
      const envPath = join(workDir, '.env')
      upsertEnvKey(envPath, 'RAW', 'a"b\\c d')
      expect(readFileSync(envPath, 'utf8')).toBe('RAW="a\\"b\\\\c d"\n')
    })

    it('is idempotent for identical values', () => {
      const envPath = join(workDir, '.env')
      upsertEnvKey(envPath, 'KEY', 'value')
      upsertEnvKey(envPath, 'KEY', 'value')
      expect(readFileSync(envPath, 'utf8')).toBe('KEY=value\n')
    })
  })

  describe('loadEnvFile', () => {
    it('does nothing when the file is missing', () => {
      const env: NodeJS.ProcessEnv = {}
      loadEnvFile(join(workDir, '.env'), env)
      expect(env).toEqual({})
    })

    it('parses plain KEY=value lines', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n', 'utf8')
      const env: NodeJS.ProcessEnv = {}
      loadEnvFile(envPath, env)
      expect(env.FOO).toBe('bar')
      expect(env.BAZ).toBe('qux')
    })

    it('unwraps double-quoted values and unescapes', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, 'A="hello world"\nB="a\\"b\\\\c"\n', 'utf8')
      const env: NodeJS.ProcessEnv = {}
      loadEnvFile(envPath, env)
      expect(env.A).toBe('hello world')
      expect(env.B).toBe('a"b\\c')
    })

    it('unwraps single-quoted values literally', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, "A='hello world'\n", 'utf8')
      const env: NodeJS.ProcessEnv = {}
      loadEnvFile(envPath, env)
      expect(env.A).toBe('hello world')
    })

    it('skips comments and empty lines', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, '# this is a comment\n\nFOO=bar\n', 'utf8')
      const env: NodeJS.ProcessEnv = {}
      loadEnvFile(envPath, env)
      expect(env.FOO).toBe('bar')
    })

    it('respects explicit env overrides (does not overwrite)', () => {
      const envPath = join(workDir, '.env')
      writeFileSync(envPath, 'FOO=fromfile\n', 'utf8')
      const env: NodeJS.ProcessEnv = { FOO: 'fromenv' }
      loadEnvFile(envPath, env)
      expect(env.FOO).toBe('fromenv')
    })
  })

  it('round-trips quoted values through upsert + load', () => {
    const envPath = join(workDir, '.env')
    upsertEnvKey(envPath, 'COMPLEX', 'a "quoted" $thing\\')
    const env: NodeJS.ProcessEnv = {}
    loadEnvFile(envPath, env)
    expect(env.COMPLEX).toBe('a "quoted" $thing\\')
  })

  it('fs.existsSync sanity check', () => {
    const envPath = join(workDir, 'missing.env')
    expect(fs.existsSync(envPath)).toBe(false)
  })
})
