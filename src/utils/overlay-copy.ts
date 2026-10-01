import { copy, move, pathExists } from 'fs-extra'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

/**
 * Files npm never publishes under their real name, mapped to the name they ship under.
 *
 * `npm pack` drops every `.gitignore`, even inside a `files` entry, so the 1.0.0 package
 * carried none: projects generated from npm had no `.gitignore` at all, and `sf update`
 * read the project's own one as removed from the templates (#875). The templates keep
 * the packaged name in the repository and get their real name back when deposited.
 */
export const PACKAGED_DOTFILES: Readonly<Record<string, string>> = { gitignore: '.gitignore' }

/** Paths, relative to `source`, of every template stored under a packaged name. */
async function packagedDotfilesIn(source: string): Promise<string[]> {
  const entries = await readdir(source, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name in PACKAGED_DOTFILES).map((entry) => relative(source, join(entry.parentPath, entry.name)))
}

/**
 * Copy a scaffold overlay onto a target, overwriting, and restore the real name of every
 * packaged dotfile it carries. Only files the overlay itself ships are renamed — a file of
 * the same name already in the target and absent from the overlay is left alone.
 */
export async function copyOverlay(source: string, target: string): Promise<void> {
  await copy(source, target, { overwrite: true })
  for (const packaged of await packagedDotfilesIn(source)) {
    const from = join(target, packaged)
    if (!(await pathExists(from))) continue
    await move(from, join(target, dirname(packaged), PACKAGED_DOTFILES[basename(packaged)]), { overwrite: true })
  }
}
