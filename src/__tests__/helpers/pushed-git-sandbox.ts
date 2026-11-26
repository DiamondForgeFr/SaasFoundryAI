import childProcess from 'child_process'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import path from 'path'

import { boundedOptions, execFileSync } from './bounded-child'

/**
 * The environment git commands of a sandbox run in. A test that runs inside a commit hook inherits
 * `GIT_INDEX_FILE`, `GIT_DIR` and friends from the real repository: left in place they would make a
 * sandbox's `git status` read the wrong index. Everything `GIT_*` is dropped, the identity and the
 * configuration are the sandbox's own.
 */
export function sandboxGitEnv(base: NodeJS.ProcessEnv = process.env, { identity = true }: { identity?: boolean } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (!key.startsWith('GIT_')) env[key] = value
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    ...(identity
      ? { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
      : // No identity, and no guessing one from the account and the host either, which some machines can
        { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' })
  }
}

export interface SpawnedGitSandbox {
  /** Puts the real `spawnSync` back: call it in `afterAll`. */
  restore: () => void
  /** Runs `run`, and awaits it when it is async, with the sandbox's Git identity withdrawn: for the commit that has to fail for want of one. */
  withoutIdentity: <T>(run: () => T) => T
}

/**
 * Runs the `git` that the code under test starts through `spawnSync` (`sf new` does, whatever its caller's
 * environment is) in `sandboxGitEnv()`: an identity and a configuration of its own, no `GIT_*` inherited.
 *
 * Setting the variables on `process.env` cannot do it. Jest hands every test file a copy of `process.env`, and
 * a child process started without an `env` option inherits the real one: the commit then found the identity of
 * whoever ran the suite, and failed on a CI runner that has none (#969). The call is bounded like a spec's own (#1344).
 */
export function sandboxSpawnedGit(): SpawnedGitSandbox {
  const real = childProcess.spawnSync
  let identity = true
  const spy = jest
    .spyOn(childProcess, 'spawnSync')
    .mockImplementation(((command: string, args?: readonly string[], options?: childProcess.SpawnSyncOptions) =>
      real(command, args, boundedOptions({ ...options, env: sandboxGitEnv(options?.env ?? process.env, { identity }) }))) as never)
  return {
    restore: () => spy.mockRestore(),
    withoutIdentity: <T>(run: () => T): T => {
      identity = false
      let result: T
      try {
        result = run()
      } catch (error) {
        identity = true
        throw error
      }
      if (result && typeof (result as { then?: unknown }).then === 'function') return (result as unknown as Promise<unknown>).finally(() => (identity = true)) as unknown as T
      identity = true
      return result
    }
  }
}

export interface PushedRepo {
  /** The working checkout: on the ticket branch, clean and pushed. */
  dir: string
  /** The bare repository standing for `origin`, next to the checkout. */
  originDir: string
  /** The branch the checkout is on. */
  branch: string
  /** Runs git in `cwd` (the checkout by default) and returns its trimmed output. */
  git: (args: string[], cwd?: string) => string
  /** Commits a file with `content` in `cwd` (the checkout by default). */
  commit: (file: string, content?: string, cwd?: string) => string
  /** Removes the checkout's companions: the bare origin, and any worktree added with `addWorktree`. */
  cleanup: () => void
  /** Adds a worktree on `branch` and returns its path. */
  addWorktree: (branch: string) => string
}

/**
 * A real repository for the guards that read git: `dir` becomes a checkout on `branch` (a ticket branch by
 * default), with one commit of work on it, pushed to a bare `origin` that sits next to it. What the guards
 * see is what a delegated agent leaves behind when it has done its job: nothing to commit, nothing to push.
 * A test then undoes one of the two. Files the sandbox itself needs (the tool shim, the manifest) are kept out
 * of the repository with `.git/info/exclude`, so that "untracked" means what the test says it means.
 */
export function initPushedRepo(dir: string, branch = 'feature/42-add-stuff'): PushedRepo {
  const env = sandboxGitEnv()
  const originDir = `${dir}-origin.git`
  const worktrees: string[] = []
  const git = (args: string[], cwd: string = dir): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (file: string, content = `${file}\n`, cwd: string = dir): string => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    writeFileSync(path.join(cwd, file), content)
    git(['add', file], cwd)
    git(['commit', '-m', `chore: ${file}`], cwd)
    return git(['rev-parse', 'HEAD'], cwd)
  }

  execFileSync('git', ['init', '--bare', '-b', 'develop', originDir], { env, stdio: 'ignore' })
  git(['init', '-b', 'develop'])
  mkdirSync(path.join(dir, '.git', 'info'), { recursive: true })
  writeFileSync(path.join(dir, '.git', 'info', 'exclude'), ['.claude/', 'bin/', '.saasfoundry.json', 'tool-calls.log', 'gh-calls.log', 'srs-calls.log', ''].join('\n'))
  commit('README.md', 'sandbox\n')
  git(['remote', 'add', 'origin', originDir])
  git(['push', 'origin', 'develop'])
  git(['checkout', '-b', branch])
  commit('work.txt')
  git(['push', '-u', 'origin', branch])

  return {
    dir,
    originDir,
    branch,
    git,
    commit,
    addWorktree: (name: string) => {
      const target = `${dir}-wt-${worktrees.length}`
      worktrees.push(target)
      git(['worktree', 'add', target, name])
      // git reports the real path (/private/var/… for a macOS temp directory): that is the path a message can name
      return realpathSync(target)
    },
    cleanup: () => {
      rmSync(originDir, { recursive: true, force: true })
      for (const target of worktrees) rmSync(target, { recursive: true, force: true })
    }
  }
}
