import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import ignore, { Ignore } from 'ignore'

import { docsScanner } from '../scanners/docs.scanner'
import { nestjsScanner } from '../scanners/nestjs.scanner'
import { resolveScannerRoots } from '../scanners/paths'
import { prismaScanner } from '../scanners/prisma.scanner'
import { reactScanner } from '../scanners/react.scanner'
import { testsScanner } from '../scanners/tests.scanner'
import { CodebaseScanner, CodebaseScannerContext, ScannerFinding } from '../scanners/types'

const HARD_EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.vitepress/cache'])
const HARD_EXCLUDE_DIR_SEGMENTS = ['node_modules', 'dist', 'coverage', '.git']
const HARD_EXCLUDE_PATH_FRAGMENTS = ['.vitepress/cache']

const SCANNERS: CodebaseScanner[] = [nestjsScanner, reactScanner, prismaScanner, testsScanner, docsScanner]

export interface ScanExclusions {
  exclude?: string[]
}

function addGitignore(ig: Ignore, scanRoot: string): void {
  const gitignorePath = join(scanRoot, '.gitignore')
  if (existsSync(gitignorePath)) {
    try {
      ig.add(readFileSync(gitignorePath, 'utf8'))
    } catch {
      // unreadable — fall through with hard excludes only
    }
  }
}

function addSrsIgnore(ig: Ignore, scanRoot: string): void {
  const srsignorePath = join(scanRoot, '.srsignore')
  if (existsSync(srsignorePath)) {
    try {
      ig.add(readFileSync(srsignorePath, 'utf8'))
    } catch {
      // unreadable — fall through
    }
  }
}

function buildIgnore(scanRoot: string, exclusions?: ScanExclusions): Ignore {
  const ig = ignore()
  addGitignore(ig, scanRoot)
  addSrsIgnore(ig, scanRoot)
  if (exclusions?.exclude && exclusions.exclude.length > 0) {
    ig.add(exclusions.exclude)
  }
  return ig
}

function isHardExcluded(relPath: string): boolean {
  const segments = relPath.split('/')
  if (segments.some((seg) => HARD_EXCLUDE_DIR_SEGMENTS.includes(seg))) return true
  return HARD_EXCLUDE_PATH_FRAGMENTS.some((fragment) => relPath.includes(fragment))
}

export function collectFiles(scanRoot: string, exclusions?: ScanExclusions): string[] {
  const ig = buildIgnore(scanRoot, exclusions)
  const results: string[] = []

  const walk = (absDir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(absDir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (HARD_EXCLUDE_DIRS.has(entry)) continue
      const absChild = join(absDir, entry)
      const relChild = relative(scanRoot, absChild)
      if (relChild.length === 0) continue
      if (isHardExcluded(relChild)) continue
      const relForIgnore = relChild.split('\\').join('/')
      let stat
      try {
        stat = statSync(absChild)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        if (ig.ignores(`${relForIgnore}/`)) continue
        walk(absChild)
      } else if (stat.isFile()) {
        if (ig.ignores(relForIgnore)) continue
        results.push(relForIgnore)
      }
    }
  }

  walk(scanRoot)
  return results.sort()
}

export async function collectFindings(scanRoot: string, structure?: 'monorepo' | 'multirepo', exclusions?: ScanExclusions): Promise<ScannerFinding[]> {
  const files = collectFiles(scanRoot, exclusions)
  const roots = resolveScannerRoots(scanRoot, structure)
  const context: CodebaseScannerContext = {
    scanRoot,
    files,
    structure,
    apiRoot: roots.apiRoot,
    webRoot: roots.webRoot
  }
  const findings: ScannerFinding[] = []
  for (const scanner of SCANNERS) {
    const batch = await scanner.collect(context)
    findings.push(...batch)
  }
  return findings
}
