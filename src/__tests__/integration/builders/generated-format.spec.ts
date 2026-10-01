import childProcess from 'node:child_process'
import { globSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import shelljs from 'shelljs'

import { createApiApp } from '../../../builders/api.builder'
import { createMonorepoRoot } from '../../../builders/monorepo.builder'
import { createWebApp } from '../../../builders/web.builder'
import { apiParams, monorepoRootParams, webParams } from '../../helpers/fixtures'

const SHORT = 'zz9'
const LONG = 'acme-compliance-platform-for-regulated-industries'

const mask = (content: string, projectName: string): string => content.replaceAll(projectName, '<project>').replaceAll(projectName.toUpperCase(), '<PROJECT>')

/**
 * Render a monorepo under `projectName`, then format it with prettier. Returns what
 * prettier changed in the files that name the project, with the name masked.
 */
async function prettierChanges(projectName: string): Promise<Record<string, { rendered: string; formatted: string }>> {
  const dir = join(tmpdir(), `sf-generated-format-${projectName}-${Date.now()}`)
  const cwd = process.cwd()
  await mkdir(join(dir, 'apps'), { recursive: true })
  process.chdir(dir)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any)
  const spawnSpy = jest.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0, stdout: '', stderr: '' } as never)
  try {
    await createApiApp(apiParams({ isMonorepo: true, projectName }))
    await createWebApp(webParams({ isMonorepo: true, projectName }))
    await createMonorepoRoot(monorepoRootParams({ projectName }))
  } finally {
    shellSpy.mockRestore()
    spawnSpy.mockRestore()
    process.chdir(cwd)
  }

  const rendered = new Map<string, string>()
  for (const file of globSync('**/*.{ts,tsx,md,json,yml,yaml}', { cwd: dir, exclude: (path) => path.includes('node_modules') })) {
    const content = await readFile(join(dir, file), 'utf8')
    if (content.includes(projectName) || content.includes(projectName.toUpperCase())) rendered.set(file, content)
  }
  // The project's .prettierrc, .prettierignore and .gitignore apply, as in `npm run format:check`
  const write = childProcess.spawnSync(process.execPath, [require.resolve('prettier/bin/prettier.cjs'), '--write', '--log-level', 'warn', '.'], { cwd: dir, encoding: 'utf8' })
  expect(write.stderr).toBe('')

  const changes: Record<string, { rendered: string; formatted: string }> = {}
  for (const [file, before] of rendered) {
    const after = await readFile(join(dir, file), 'utf8')
    if (after !== before) changes[file] = { rendered: mask(before, projectName), formatted: mask(after, projectName) }
  }
  await rm(dir, { recursive: true, force: true })
  return changes
}

/**
 * #867 — the generated projects' prettier wraps at 200 columns, and the CLI writes the
 * project name into lines near that width: the web app's imports rewritten to
 * `@<project>/ui-primitives/…`, the email sentences, README paragraphs naming a package.
 * Whichever layout the template fixed, `npm run format:check` then failed for some names.
 *
 * Rendered under a short and a long name, prettier must find the same thing to change:
 * nothing, once the CLI lays those lines out itself. The CLI's prettier is not the one the
 * projects install, so its own opinions on a template show up under both names alike and
 * cancel out; a line whose layout depends on the name does not. (That the tree is clean under
 * the projects' own prettier is the Docker boot scenario's assertion.)
 */
describe('generated monorepo formatting (#867)', () => {
  it('does not depend on the length of the project name', async () => {
    const short = await prettierChanges(SHORT)
    const long = await prettierChanges(LONG)

    const files = [...new Set([...Object.keys(short), ...Object.keys(long)])].sort()
    expect(files.filter((file) => JSON.stringify(short[file]) !== JSON.stringify(long[file]))).toEqual([])
  }, 240_000)
})
