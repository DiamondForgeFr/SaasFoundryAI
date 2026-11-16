import { readFileSync } from 'fs'
import { resolve } from 'path'

// #1005 — sf-git-fix-pr-comments called `gh pr review list`, which gh does not have, read every inline comment with no
// notion of thread state, and never answered the reviewer. The skill now lists the threads with their state through
// GraphQL, and after the push replies on each one and resolves the ones that are fixed. The GraphQL documents below were
// checked against GitHub's schema by introspection, and the listing against a real PR of this repository, read-only.

const SKILL = readFileSync(resolve(__dirname, '../../../../scaffolds/skills-templates/core/sf-git-fix-pr-comments/SKILL.md'), 'utf8')

/** The fenced GraphQL documents of the skill, whitespace collapsed. */
const documents = [...SKILL.matchAll(/```graphql\n([\s\S]*?)```/g)].map((match) => match[1].replace(/\s+/g, ' ').trim())
const one = (operation: string): string => {
  const found = documents.filter((document) => document.includes(operation))
  expect(found).toHaveLength(1)
  return found[0]
}

/** Position of a numbered step heading, to check their order. */
const step = (title: string): number => {
  const index = SKILL.search(new RegExp(`^\\d+\\. \\*\\*${title}\\*\\*`, 'm'))
  expect(index).toBeGreaterThan(-1)
  return index
}

describe('sf-git-fix-pr-comments', () => {
  it('calls no gh command that does not exist or does not answer what it asks', () => {
    expect(SKILL).not.toMatch(/gh pr review list/)
    expect(SKILL).not.toMatch(/gh pr status --json/)
    expect(SKILL).not.toMatch(/pulls\/\{number\}\/comments/)
    expect(SKILL).toContain('`gh pr view --json number,headRefName,url`')
    expect(SKILL).toContain('`gh pr view <N> --json reviews,comments`')
  })

  it('lists the review threads with their state, every page', () => {
    const query = one('reviewThreads(')
    expect(query).toMatch(/^query \(\$owner: String!, \$repo: String!, \$number: Int!, \$endCursor: String\)/)
    expect(query).toContain('repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 50, after: $endCursor) {')
    expect(query).toContain('pageInfo { hasNextPage endCursor }')
    expect(query).toContain('nodes { id isResolved isOutdated path line comments(first: 50) { nodes { databaseId body author { login } } } }')
    expect(SKILL).toContain(
      "gh api graphql --paginate -F owner='{owner}' -F repo='{repo}' -F number=<N> -F query=@<scratch>/review-threads.graphql --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)'"
    )
  })

  it('replies in each thread and resolves it with the mutations of the schema', () => {
    expect(one('addPullRequestReviewThreadReply')).toBe(
      'mutation ($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { url } } }'
    )
    expect(one('resolveReviewThread')).toBe('mutation ($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } } }')
    expect(SKILL).toContain('gh api graphql -F thread=<thread id> -F body=@<scratch>/reply-<n>.md -F query=@<scratch>/reply-thread.graphql')
    expect(SKILL).toContain('gh api graphql -F thread=<thread id> -F query=@<scratch>/resolve-thread.graphql')
    expect(SKILL).toContain('`gh pr comment <N> --body-file <scratch>/reply-reviews.md`')
  })

  it('replies and resolves after the push, with the commit, in the ticket language', () => {
    expect(step('FETCH COMMENTS')).toBeLessThan(step('COMMIT & PUSH'))
    expect(step('COMMIT & PUSH')).toBeLessThan(step('REPLY & RESOLVE'))
    expect(SKILL).toContain('`git rev-parse --short HEAD`')
    expect(SKILL).toContain(`\`jq -r '.language.tickets // "en"' .saasfoundry.json\``)
    expect(SKILL).toContain('Resolve a thread only when the fix is complete and pushed')
  })

  it('may write the GraphQL documents and reply bodies, and read the manifest', () => {
    expect(SKILL).toMatch(/^allowed-tools: .*Bash\(gh :\*\).*Bash\(jq :\*\).*\bWrite\b/m)
  })

  it('says where it fits in the workflow, and what it never does', () => {
    const text = SKILL.replace(/\s+/g, ' ')
    expect(text).toContain('Answering the reviewer and resolving the conversations is part of **In Review**')
    expect(text).toContain('it never merges, never approves, never takes a PR out of draft (`ready-pr`) and never moves a ticket')
  })
})
