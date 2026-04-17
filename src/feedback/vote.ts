import { ensureGhAuth, ghAddReaction, ghIssueComment, ghIssueSearch, type GhIssue } from './gh'
import { readFeedbackRepo, type FeedbackRepo } from './repo'
import { readPreferences, writePreferences } from '../skill/preferences'

export type VoteAction = 'up' | 'down' | 'comment'

export interface ListVotableOptions {
  stackFilter?: string
  limit?: number
}

export interface ListVotableResult {
  repo: FeedbackRepo
  issues: RankedIssue[]
}

export interface RankedIssue {
  issue: GhIssue
  thumbsUp: number
  thumbsDown: number
}

export interface CastVoteInput {
  issueNumber: number
  action: VoteAction
  comment?: string
}

export interface CastVoteResult {
  repo: FeedbackRepo
  action: VoteAction
  issueNumber: number
}

export async function listVotable(opts: ListVotableOptions = {}): Promise<ListVotableResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()
  const limit = opts.limit ?? 10
  const raw = await ghIssueSearch({
    repo: repo.slug,
    labels: ['module-request'],
    state: 'open',
    search: opts.stackFilter,
    limit: 100
  })

  const ranked = raw.map((issue) => ({
    issue,
    thumbsUp: countReaction(issue, 'THUMBS_UP'),
    thumbsDown: countReaction(issue, 'THUMBS_DOWN')
  }))

  ranked.sort((a, b) => b.thumbsUp - a.thumbsUp || a.issue.number - b.issue.number)
  return { repo, issues: ranked.slice(0, limit) }
}

export async function castVote(input: CastVoteInput): Promise<CastVoteResult> {
  await ensureGhAuth()
  const repo = await readFeedbackRepo()

  if (input.action === 'up' || input.action === 'down') {
    await ghAddReaction({
      repo: repo.slug,
      issueNumber: input.issueNumber,
      content: input.action === 'up' ? '+1' : '-1'
    })
    await recordVote(input.issueNumber, input.action === 'up' ? 'up' : 'down')
  } else {
    const body = (input.comment ?? '').trim()
    if (!body) throw new Error('sf feedback vote comment: --comment body cannot be empty')
    await ghIssueComment(repo.slug, input.issueNumber, body)
  }

  return { repo, action: input.action, issueNumber: input.issueNumber }
}

export function countReaction(issue: GhIssue, content: string): number {
  if (!issue.reactionGroups) return 0
  for (const g of issue.reactionGroups) {
    if (g.content === content) return g.users.totalCount
  }
  return 0
}

async function recordVote(issueNumber: number, direction: 'up' | 'down'): Promise<void> {
  const prefs = await readPreferences()
  await writePreferences({
    ...prefs,
    votesCast: [
      ...prefs.votesCast,
      {
        issueNumber,
        direction,
        castAt: new Date().toISOString()
      }
    ]
  })
}
