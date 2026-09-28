import { readFile } from 'fs/promises'
import path from 'path'

import { fileExists } from '../utils'
import { ensureGhAuth, ghIssueCreate, ghIssueSearch, type GhIssue } from './gh'
import { readFeedbackRepo, type FeedbackRepo } from './repo'

export type BugSource = 'cli' | 'scaffold'

export interface BugReproContext {
  cliVersion: string
  nodeVersion: string
  platform: string
  arch: string
  saasfoundryJson: string | null
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
    saasfoundryJson: await readSaasFoundryJson(cwd)
  }
}

export async function fileBug(input: FileBugInput): Promise<FileBugResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const repro = input.includeRepro ? await collectReproContext(input.cliVersion, input.cwd) : null
  const body = formatBugBody(input, repro)
  const issue = await ghIssueCreate({
    repo: repo.slug,
    title: input.title,
    body,
    labels: [bugLabel(input.source)]
  })
  return { repo, issue }
}

export function formatBugBody(input: FileBugInput, repro: BugReproContext | null): string {
  const lines = ['## Bug', '', input.description.trim() || '_(no description provided)_', '', '---', '', `**Source:** ${input.source}`]
  if (repro) {
    lines.push(`**CLI version:** ${repro.cliVersion}`)
    lines.push(`**Node:** ${repro.nodeVersion}`)
    lines.push(`**Platform:** ${repro.platform} (${repro.arch})`)
    lines.push('')
    if (repro.saasfoundryJson) {
      lines.push('<details>')
      lines.push('<summary>.saasfoundry.json</summary>')
      lines.push('')
      lines.push('```json')
      lines.push(repro.saasfoundryJson)
      lines.push('```')
      lines.push('</details>')
    } else {
      lines.push('_(no .saasfoundry.json found in cwd)_')
    }
  } else {
    lines.push(`**CLI version:** ${input.cliVersion}`)
  }
  lines.push('')
  lines.push('_Filed via `sf feedback bug`._')
  return lines.join('\n')
}

async function readSaasFoundryJson(cwd: string): Promise<string | null> {
  const filePath = path.join(cwd, '.saasfoundry.json')
  if (!(await fileExists(filePath))) return null
  try {
    return (await readFile(filePath, 'utf8')).trim()
  } catch {
    return null
  }
}
