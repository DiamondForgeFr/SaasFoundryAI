import { readFile } from 'fs/promises'
import path from 'path'

import { fileExists } from '../utils'
import { countCharacters, GITHUB_ISSUE_BODY_LIMIT, IssueBodyTooLargeError } from './body-limit'
import { ensureGhAuth, ghIssueCreate, ghIssueSearch, type GhIssue } from './gh'
import { readFeedbackRepo, type FeedbackRepo } from './repo'
import { renderManifestRepro, summarizeManifest, type ManifestRepro } from './repro'

export type BugSource = 'cli' | 'scaffold'

export interface BugReproContext {
  cliVersion: string
  nodeVersion: string
  platform: string
  arch: string
  /** What was found at `<cwd>/.saasfoundry.json`: a bounded, redacted summary, never the file itself (#972). */
  manifest: ManifestRepro
}

export interface FileBugInput {
  title: string
  description: string
  source: BugSource
  cliVersion: string
  includeRepro: boolean
  cwd?: string
}

export interface BugSearchResult {
  repo: FeedbackRepo
  matches: GhIssue[]
}

export interface FileBugResult {
  repo: FeedbackRepo
  issue: GhIssue
}

export function bugLabel(source: BugSource): string {
  return source === 'cli' ? 'cli-bug' : 'scaffold-bug'
}

export async function searchExistingBugs(source: BugSource, title: string): Promise<BugSearchResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const matches = await ghIssueSearch({
    repo: repo.slug,
    labels: [bugLabel(source)],
    state: 'all',
    search: title,
    limit: 10
  })
  return { repo, matches }
}

export async function collectReproContext(cliVersion: string, cwd: string = process.cwd()): Promise<BugReproContext> {
  return {
    cliVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    manifest: await readManifestRepro(cwd)
  }
}

export async function fileBug(input: FileBugInput): Promise<FileBugResult> {
  // The body is built and measured first, from local data only: a report GitHub would refuse for its length
  // fails here, in words of ours, before any call to `gh` (#972).
  const repro = input.includeRepro ? await collectReproContext(input.cliVersion, input.cwd) : null
  const body = formatBugBody(input, repro)
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const issue = await ghIssueCreate({
    repo: repo.slug,
    title: input.title,
    body,
    labels: [bugLabel(input.source)]
  })
  return { repo, issue }
}

/**
 * The issue body. It is guaranteed to fit GitHub's limit or this throws {@link IssueBodyTooLargeError}:
 * the manifest excerpt is bounded on its own, shrinks to its core fields when the description leaves it no
 * room, and the whole body is measured before it is returned.
 */
export function formatBugBody(input: FileBugInput, repro: BugReproContext | null): string {
  const full = assembleBody(input, repro, 'full')
  const fullLength = countCharacters(full)
  if (fullLength <= GITHUB_ISSUE_BODY_LIMIT) return full

  if (repro?.manifest.status === 'summarized') {
    const reduced = assembleBody(input, repro, 'core')
    if (countCharacters(reduced) <= GITHUB_ISSUE_BODY_LIMIT) return reduced
  }

  const bareLength = countCharacters(assembleBody(input, null, 'full'))
  const excerpt = repro ? fullLength - bareLength : 0
  const advice = bareLength > GITHUB_ISSUE_BODY_LIMIT || !repro ? 'Shorten --description.' : 'Shorten --description or drop --auto-repro.'
  throw new IssueBodyTooLargeError(
    `The bug report would be ${fullLength} characters long, above the ${GITHUB_ISSUE_BODY_LIMIT} GitHub accepts for an issue body (over by ${fullLength - GITHUB_ISSUE_BODY_LIMIT}). ` +
      `The description alone is ${countCharacters(input.description)} characters${repro ? ` and the --auto-repro excerpt adds about ${excerpt}` : ''}. ${advice} Nothing was sent to GitHub.`,
    fullLength
  )
}

function assembleBody(input: FileBugInput, repro: BugReproContext | null, level: 'full' | 'core'): string {
  const lines = ['## Bug', '', input.description.trim() || '_(no description provided)_', '', '---', '', `**Source:** ${input.source}`]
  if (repro) {
    lines.push(`**CLI version:** ${repro.cliVersion}`)
    lines.push(`**Node:** ${repro.nodeVersion}`)
    lines.push(`**Platform:** ${repro.platform} (${repro.arch})`)
    lines.push('')
    lines.push(...renderManifestRepro(repro.manifest, level))
  } else {
    lines.push(`**CLI version:** ${input.cliVersion}`)
  }
  lines.push('')
  lines.push('_Filed via `sf feedback bug`._')
  return lines.join('\n')
}

async function readManifestRepro(cwd: string): Promise<ManifestRepro> {
  const filePath = path.join(cwd, '.saasfoundry.json')
  if (!(await fileExists(filePath))) return { status: 'absent' }
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return { status: 'unreadable' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // The parser's message quotes a fragment of the file: it is not repeated, because the file is not trusted to be free of secrets.
    return { status: 'invalid', rawLength: raw.length }
  }
  const summary = summarizeManifest(parsed)
  return summary ? { status: 'summarized', rawLength: raw.length, summary } : { status: 'invalid', rawLength: raw.length }
}
