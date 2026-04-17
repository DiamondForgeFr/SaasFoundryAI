import { ensureGhAuth, ghCurrentUser, ghIssueSearch, type GhIssue } from './gh'
import { readFeedbackRepo, type FeedbackRepo } from './repo'

export type ListStatus = 'open' | 'closed' | 'all'

export const FEEDBACK_LABELS = ['module-request', 'cli-bug', 'scaffold-bug'] as const

export interface ListFeedbackOptions {
  status?: ListStatus
  mine?: boolean
  limit?: number
}

export interface ListFeedbackResult {
  repo: FeedbackRepo
  issues: GhIssue[]
}

export async function listFeedback(opts: ListFeedbackOptions = {}): Promise<ListFeedbackResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const state: ListStatus = opts.status ?? 'open'
  const limit = opts.limit ?? 50
  const author = opts.mine ? await ghCurrentUser() : undefined

  const perLabelLimit = Math.max(1, Math.ceil(limit / FEEDBACK_LABELS.length))
  const results: GhIssue[] = []
  const seen = new Set<number>()

  for (const label of FEEDBACK_LABELS) {
    const batch = await ghIssueSearch({
      repo: repo.slug,
      labels: [label],
      state,
      author,
      limit: perLabelLimit
    })
    for (const issue of batch) {
      if (seen.has(issue.number)) continue
      seen.add(issue.number)
      results.push(issue)
    }
  }

  results.sort((a, b) => b.number - a.number)
  return { repo, issues: results.slice(0, limit) }
}

export function classifyIssue(issue: GhIssue): 'module-request' | 'cli-bug' | 'scaffold-bug' | 'other' {
  const names = issue.labels.map((l) => l.name)
  if (names.includes('module-request')) return 'module-request'
  if (names.includes('cli-bug')) return 'cli-bug'
  if (names.includes('scaffold-bug')) return 'scaffold-bug'
  return 'other'
}
