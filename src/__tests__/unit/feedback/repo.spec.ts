import { parseGitHubUrl, readFeedbackRepo } from '../../../feedback/repo'

describe('feedback/repo.parseGitHubUrl', () => {
  it.each([
    ['git+https://github.com/DiamondForgeFr/SaaSFoundryAI.git', 'DiamondForgeFr', 'SaaSFoundryAI'],
    ['https://github.com/DiamondForgeFr/SaaSFoundryAI.git', 'DiamondForgeFr', 'SaaSFoundryAI'],
    ['https://github.com/DiamondForgeFr/SaaSFoundryAI', 'DiamondForgeFr', 'SaaSFoundryAI'],
    ['git@github.com:DiamondForgeFr/SaaSFoundryAI.git', 'DiamondForgeFr', 'SaaSFoundryAI'],
    ['DiamondForgeFr/SaaSFoundryAI', 'DiamondForgeFr', 'SaaSFoundryAI']
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
    expect(repo.repo).toBe('SaaSFoundryAI')
    expect(repo.slug).toBe('DiamondForgeFr/SaaSFoundryAI')
    expect(repo.httpsUrl).toBe('https://github.com/DiamondForgeFr/SaaSFoundryAI')
  })
})
