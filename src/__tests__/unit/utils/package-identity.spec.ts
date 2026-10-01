import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyPackageIdentity, knownRepositoryUrl, readLivePackageIdentity } from '../../../utils/package-identity'

/** The identity block every template package.json ships with. */
const templatePackage = (): Record<string, unknown> => ({
  name: 'saasfoundry-api',
  version: '1.0.0',
  description: 'Backend API for SaaSFoundryAI',
  repository: { type: 'git', url: 'https://github.com/agachet/saasfoundry/apps/api' },
  homepage: 'https://github.com/agachet/saasfoundry/#readme',
  bugs: { url: 'https://github.com/agachet/saasfoundry/issues' },
  keywords: ['saasfoundry']
})

const identity = { name: 'acme-api', description: 'Acme compliance API', keywords: ['acme', 'saasfoundry'] }

describe('applyPackageIdentity (#858)', () => {
  it.each([
    ['https://github.com/acme/platform.git', 'https://github.com/acme/platform'],
    ['https://github.com/acme/platform', 'https://github.com/acme/platform'],
    ['git@github.com:acme/platform.git', 'https://github.com/acme/platform'],
    ['ssh://git@gitlab.example.com:2222/team/platform.git', 'https://gitlab.example.com/team/platform']
  ])('derives repository, homepage and bugs from %s', (url, web) => {
    const result = applyPackageIdentity(templatePackage(), { ...identity, repositoryUrl: url })

    expect(result).toMatchObject({
      name: 'acme-api',
      description: 'Acme compliance API',
      keywords: ['acme', 'saasfoundry'],
      repository: { type: 'git', url },
      homepage: `${web}#readme`,
      bugs: { url: `${web}/issues` }
    })
  })

  it.each([undefined, '', '   ', 'https://github.com/agachet/saasfoundry.git', 'https://github.com/agachet/saasfoundry/apps/web'])(
    'removes the repository block instead of advertising the template author when the URL is %p',
    (url) => {
      const result = applyPackageIdentity(templatePackage(), { ...identity, repositoryUrl: url })

      expect(result).not.toHaveProperty('repository')
      expect(result).not.toHaveProperty('homepage')
      expect(result).not.toHaveProperty('bugs')
      expect(JSON.stringify(result)).not.toContain('agachet')
    }
  )

  it('keeps the remaining keys in their template order', () => {
    const result = applyPackageIdentity(templatePackage(), { ...identity, repositoryUrl: 'git@github.com:acme/platform.git' })

    expect(Object.keys(result)).toEqual(['name', 'version', 'description', 'repository', 'homepage', 'bugs', 'keywords'])
  })

  it('keeps a non-browsable repository URL without inventing a homepage', () => {
    const result = applyPackageIdentity(templatePackage(), { ...identity, repositoryUrl: '/srv/git/platform.git' })

    expect(result.repository).toEqual({ type: 'git', url: '/srv/git/platform.git' })
    expect(result).not.toHaveProperty('homepage')
    expect(result).not.toHaveProperty('bugs')
  })
})

describe('knownRepositoryUrl', () => {
  it('treats the template placeholder repositories as unknown, whatever their suffix', () => {
    expect(knownRepositoryUrl('https://github.com/agachet/saasfoundry')).toBeUndefined()
    expect(knownRepositoryUrl('https://github.com/agachet/saasfoundry/#readme')).toBeUndefined()
    expect(knownRepositoryUrl('git@github.com:agachet/saasfoundry.git')).toBeUndefined()
  })

  it('does not mistake a project whose name merely starts like the placeholder', () => {
    expect(knownRepositoryUrl('https://github.com/agachet/saasfoundry-pilot.git')).toBe('https://github.com/agachet/saasfoundry-pilot.git')
  })
})

describe('readLivePackageIdentity', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-package-identity-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the description and repository URL a project gave its package', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ description: 'Acme', repository: { type: 'git', url: 'git@github.com:acme/platform.git' } }))

    await expect(readLivePackageIdentity(dir)).resolves.toEqual({ description: 'Acme', repositoryUrl: 'git@github.com:acme/platform.git' })
  })

  it('accepts the string shorthand npm allows for repository', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'https://github.com/acme/platform' }))

    await expect(readLivePackageIdentity(dir)).resolves.toEqual({ description: undefined, repositoryUrl: 'https://github.com/acme/platform' })
  })

  it('reports a placeholder repository as unknown', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ description: '', repository: { url: 'https://github.com/agachet/saasfoundry.git' } }))

    await expect(readLivePackageIdentity(dir)).resolves.toEqual({ description: '', repositoryUrl: undefined })
  })

  it('returns nothing for a missing or unreadable package file', async () => {
    await expect(readLivePackageIdentity(join(dir, 'absent'))).resolves.toEqual({})
    await writeFile(join(dir, 'package.json'), '{ not json')
    await expect(readLivePackageIdentity(dir)).resolves.toEqual({})
  })
})
