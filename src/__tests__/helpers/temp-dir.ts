import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Creates a unique temp directory, runs the callback inside it, then cleans up.
 * Saves and restores process.cwd() to prevent leaking state between tests.
 */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const originalCwd = process.cwd()
  const dir = await mkdtemp(join(tmpdir(), 'sf-test-'))

  try {
    process.chdir(dir)
    await fn(dir)
  } finally {
    process.chdir(originalCwd)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Creates a unique temp directory without changing cwd.
 * Returns a cleanup function. Useful for tests that don't need chdir.
 */
export async function createTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'sf-test-'))
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
