import { parseGitHubUrl, readFeedbackRepo } from '../../../feedback/repo'

describe('feedback/repo.parseGitHubUrl', () => {
  it.each([
    ['git+https://github.com/DiamondForgeFr/SaaSFoundry.git', 'DiamondForgeFr', 'SaaSFoundry'],
    ['https://github.com/DiamondForgeFr/SaaSFoundry.git', 'DiamondForgeFr', 'SaaSFoundry'],
    ['https://github.com/DiamondForgeFr/SaaSFoundry', 'DiamondForgeFr', 'SaaSFoundry'],
    ['git@github.com:DiamondForgeFr/SaaSFoundry.git', 'DiamondForgeFr', 'SaaSFoundry'],
    ['DiamondForgeFr/SaaSFoundry', 'DiamondForgeFr', 'SaaSFoundry']
  ])('parses %s', (input, owner, repo) => {
    const result = parseGitHubUrl(input)
    expect(result).not.toBeNull()
    expect(result!.owner).toBe(owner)
    expect(result!.repo).toBe(repo)
    expect(result!.slug).toBe(`${owner}/${repo}`)
    expect(result!.httpsUrl).toBe(`https://github.com/${owner}/${repo}`)
  })

  it('returns null for unrecognized urls', () => {
    expect(parseGitHubUrl('https://gitlab.com/foo/bar')).toBeNull()
    expect(parseGitHubUrl('not-a-url')).toBeNull()
    expect(parseGitHubUrl('')).toBeNull()
  })
})

describe('feedback/repo.readFeedbackRepo', () => {
  it('reads the CLI package.json#repository.url', async () => {
    const repo = await readFeedbackRepo()
    expect(repo.owner).toBe('DiamondForgeFr')
    expect(repo.repo).toBe('SaaSFoundry')
    expect(repo.slug).toBe('DiamondForgeFr/SaaSFoundry')
    expect(repo.httpsUrl).toBe('https://github.com/DiamondForgeFr/SaaSFoundry')
  })
})
