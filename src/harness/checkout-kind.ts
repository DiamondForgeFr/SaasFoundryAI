import { lstatSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

/** Where a directory lies: the primary checkout of a clone, or a worktree linked to it (`git worktree add`). */
export type CheckoutKind = 'primary' | 'linked'

/** The `gitdir:` line of a linked worktree's `.git` file points into `<common-dir>/worktrees/<name>`. */
const LINKED_GIT_DIR = /[\\/]worktrees[\\/][^\\/]+[\\/]?$/

/**
 * Whether `dir` lies in the primary checkout of a clone or in a linked worktree (#1332), read from the `.git` entry
 * nearest to it, walking up: a directory is the primary checkout's own Git directory, a file whose `gitdir:` points
 * into `<common-dir>/worktrees/<name>` is a linked worktree. Anything else (a submodule, no Git checkout, an
 * unreadable entry) is `undefined`, and the guard lets the call through. No `git` process and no dependency: the
 * guard hook pays for it on the calls that reach Node.
 */
export function checkoutKind(dir: string): CheckoutKind | undefined {
  let current = resolve(dir)
  for (;;) {
    const entry = join(current, '.git')
    try {
      const stat = lstatSync(entry)
      if (stat.isDirectory()) return 'primary'
      if (!stat.isFile()) return undefined
      const gitDir = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(entry, 'utf8'))?.[1]
      return gitDir !== undefined && LINKED_GIT_DIR.test(gitDir) ? 'linked' : undefined
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
