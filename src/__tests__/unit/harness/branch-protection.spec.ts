import { delegationCommitAdvice, readBranchProtection, type GhRunner } from '../../../harness/branch-protection'

/** A stubbed `gh`: answers each `gh api <path>` from the table, fails on any other path. */
function stubGh(answers: Record<string, unknown>): GhRunner & { calls: string[] } {
  const calls: string[] = []
  const gh = async (args: string[]) => {
    const path = args[1]
    calls.push(path)
    if (!(path in answers)) throw new Error(`gh: HTTP 404 for ${path}`)
    return JSON.stringify(answers[path])
  }
  return Object.assign(gh, { calls })
}

const RULES = 'repos/{owner}/{repo}/rules/branches/develop'
const BRANCH = 'repos/{owner}/{repo}/branches/develop'
const PROTECTION = 'repos/{owner}/{repo}/branches/develop/protection'

describe('working branch protection for the delegation consent (#1124)', () => {
  const read = (answers: Record<string, unknown>) => readBranchProtection({ targetPath: '/project', branch: 'develop', gh: stubGh(answers) })

  it('is protected when a ruleset requires a status check or a pull request', async () => {
    await expect(read({ [RULES]: [{ type: 'required_status_checks', ruleset_id: 1 }] })).resolves.toBe('protected')
    await expect(read({ [RULES]: [{ type: 'deletion' }, { type: 'pull_request' }] })).resolves.toBe('protected')
  })

  it('is protected when classic protection enforces required status checks', async () => {
    await expect(read({ [RULES]: [], [BRANCH]: { protected: true, protection: { required_status_checks: { enforcement_level: 'everyone', contexts: ['Required gate'] } } } })).resolves.toBe(
      'protected'
    )
  })

  it('reads the admin protection when the summary does not say, and is protected by a required review', async () => {
    const branch = { protected: true, protection: { required_status_checks: { enforcement_level: 'off', contexts: [] } } }
    await expect(read({ [RULES]: [], [BRANCH]: branch, [PROTECTION]: { required_pull_request_reviews: { required_approving_review_count: 1 } } })).resolves.toBe('protected')
    await expect(read({ [RULES]: [], [BRANCH]: branch, [PROTECTION]: { allow_force_pushes: { enabled: false } } })).resolves.toBe('unprotected')
  })

  it('is unprotected when neither a ruleset nor classic protection applies', async () => {
    await expect(read({ [RULES]: [{ type: 'deletion' }], [BRANCH]: { protected: false } })).resolves.toBe('unprotected')
  })

  it('is unknown when any answer cannot be read, or when no working branch is declared', async () => {
    await expect(read({})).resolves.toBe('unknown')
    await expect(read({ [RULES]: [], [BRANCH]: { protected: true, protection: {} } })).resolves.toBe('unknown')
    const gh = stubGh({})
    await expect(readBranchProtection({ targetPath: '/project', branch: undefined, gh })).resolves.toBe('unknown')
    expect(gh.calls).toEqual([])
  })

  it('encodes a branch name with a slash', async () => {
    const gh = stubGh({ 'repos/{owner}/{repo}/rules/branches/release%2Fnext': [], 'repos/{owner}/{repo}/branches/release%2Fnext': { protected: false } })
    await expect(readBranchProtection({ targetPath: '/project', branch: 'release/next', gh })).resolves.toBe('unprotected')
  })

  it('names only the ticket branch or a pull request on a protected working branch', () => {
    const advice = delegationCommitAdvice('protected', 'develop')
    expect(advice).toContain("commit it with the current ticket's branch, or through a pull request")
    expect(advice).toContain('the working branch (develop) requires a status check or a pull request')
    expect(advice).not.toContain('chore commit')
  })

  it('names only the ticket branch or a pull request when the protection could not be read', () => {
    const advice = delegationCommitAdvice('unknown', 'develop')
    expect(advice).toContain('could not be read')
    expect(advice).not.toContain('chore commit')
  })

  it('keeps both options on an unprotected working branch', () => {
    expect(delegationCommitAdvice('unprotected', 'develop')).toBe("commit it with the current ticket's branch, or in a chore commit on the working branch (develop).")
  })
})
