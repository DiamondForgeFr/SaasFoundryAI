import { execFile } from 'child_process'

export interface GhIssue {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  url: string
  labels: { name: string }[]
  author: { login: string }
  reactionGroups?: { content: string; users: { totalCount: number } }[]
}

export interface GhIssueSearchOptions {
  repo: string
  labels?: string[]
  state?: 'open' | 'closed' | 'all'
  search?: string
  author?: string
  limit?: number
}

export interface GhIssueCreateOptions {
  repo: string
  title: string
  body: string
  labels?: string[]
}

export interface GhReactionOptions {
  repo: string
  issueNumber: number
  content: '+1' | '-1'
}

/**
 * Thin wrapper around the `gh` CLI. We call it via `execFile` (no shell
 * interpolation) to avoid quoting pitfalls. Callers are expected to check
 * `gh auth status` separately (see {@link ensureGhAuth}).
 */
export async function execGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const stderrText = typeof stderr === 'string' ? stderr : (stderr as Buffer | undefined)?.toString() ?? ''
        reject(new Error(`gh ${args.join(' ')} failed: ${stderrText.trim() || err.message}`))
        return
      }
      resolve(typeof stdout === 'string' ? stdout : (stdout as Buffer).toString())
    })
  })
}

export async function ensureGhAuth(): Promise<void> {
  try {
    await execGh(['auth', 'status'])
  } catch {
    throw new Error('GitHub CLI is not authenticated. Run: gh auth login')
  }
}

export async function ghIssueSearch(opts: GhIssueSearchOptions): Promise<GhIssue[]> {
  const args = ['issue', 'list', '--repo', opts.repo, '--json', 'number,title,state,url,labels,author,reactionGroups']
  if (opts.state) args.push('--state', opts.state)
  if (opts.author) args.push('--author', opts.author)
  if (opts.labels && opts.labels.length > 0) args.push('--label', opts.labels.join(','))
  if (opts.search) args.push('--search', opts.search)
  if (opts.limit) args.push('--limit', String(opts.limit))
  const raw = await execGh(args)
  return JSON.parse(raw) as GhIssue[]
}

export async function ghIssueCreate(opts: GhIssueCreateOptions): Promise<GhIssue> {
  const args = ['issue', 'create', '--repo', opts.repo, '--title', opts.title, '--body', opts.body]
  if (opts.labels && opts.labels.length > 0) args.push('--label', opts.labels.join(','))
  const raw = await execGh(args)
  const url = raw.trim().split('\n').pop()?.trim() ?? ''
  const match = url.match(/\/issues\/(\d+)/)
  const number = match ? Number(match[1]) : 0
  return { number, url, title: opts.title, state: 'OPEN', labels: (opts.labels ?? []).map((name) => ({ name })), author: { login: '' } }
}

export async function ghIssueComment(repo: string, issueNumber: number, body: string): Promise<void> {
  await execGh(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body])
}

export async function ghAddReaction(opts: GhReactionOptions): Promise<void> {
  await execGh(['api', '--method', 'POST', '-H', 'Accept: application/vnd.github+json', `/repos/${opts.repo}/issues/${opts.issueNumber}/reactions`, '-f', `content=${opts.content}`])
}

export async function ghCurrentUser(): Promise<string> {
  const raw = await execGh(['api', 'user', '--jq', '.login'])
  return raw.trim()
}
