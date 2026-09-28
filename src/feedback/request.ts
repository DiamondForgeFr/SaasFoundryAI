import { ensureGhAuth, ghIssueCreate, ghIssueSearch, type GhIssue } from './gh'
import { readFeedbackRepo, type FeedbackRepo } from './repo'
import { readPreferences, writePreferences } from '../skill/preferences'

export interface FileRequestInput {
  name: string
  description: string
  cliVersion: string
  forceCreate?: boolean
}

export interface DedupResult {
  repo: FeedbackRepo
  matches: GhIssue[]
}

export interface FileRequestResult {
  repo: FeedbackRepo
  issue: GhIssue
}

export async function searchExistingRequests(name: string): Promise<DedupResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const matches = await ghIssueSearch({
    repo: repo.slug,
    labels: ['module-request'],
    state: 'all',
    search: name,
    limit: 10
  })
  return { repo, matches }
}

export async function fileRequest(input: FileRequestInput): Promise<FileRequestResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const title = formatRequestTitle(input.name)
  const body = formatRequestBody(input)
  const issue = await ghIssueCreate({
    repo: repo.slug,
    title,
    body,
    labels: ['module-request']
  })
  const prefs = await readPreferences()
  await writePreferences({
    ...prefs,
    filedRequests: [
      ...prefs.filedRequests,
      {
        issueNumber: issue.number,
        repoUrl: issue.url,
        title,
        openedAt: new Date().toISOString()
      }
    ]
  })
  return { repo, issue }
}

export function formatRequestTitle(name: string): string {
  return `Module request: ${name.trim()}`
}

export function formatRequestBody(input: FileRequestInput): string {
  const lines = [
    '## Request',
    '',
    input.description.trim() || '_(no description provided)_',
    '',
    '---',
    '',
    `**CLI version:** ${input.cliVersion}`,
    `**Platform:** ${process.platform} (${process.arch})`,
    `**Node:** ${process.version}`,
    '',
    '_Filed via `sf feedback request`._'
  ]
  return lines.join('\n')
}
