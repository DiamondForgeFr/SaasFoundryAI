import { getAvailableModules } from '../../../prompts/update.prompts'
import { manifestFixture } from '../../helpers/fixtures'

describe('getAvailableModules', () => {
  it('should return all modules when nothing is installed', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: false,
        advancedSkills: []
      }
    })

    const available = getAvailableModules(manifest)

    // 4 modules (email, storage, analytics, srs) + 4 skills = 8 total
    expect(available).toHaveLength(8)
    expect(available.map((m) => m.value)).toEqual(expect.arrayContaining(['email', 'storage', 'analytics', 'srs', 'sf-skill-context7', 'sf-skill-atlassian', 'sf-skill-notion', 'sf-skill-figma']))
  })

  it('should exclude email when mailersend is already installed', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'mailersend', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: false,
        advancedSkills: []
      }
    })

    const available = getAvailableModules(manifest)

    expect(available.find((m) => m.value === 'email')).toBeUndefined()
  })

  it('should exclude storage when s3Setup is not manual', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'docker',
        dbSetup: 'docker',
        includeAnalytics: false,
        advancedSkills: []
      }
    })

    const available = getAvailableModules(manifest)

    expect(available.find((m) => m.value === 'storage')).toBeUndefined()
  })

  it('should also exclude storage when s3Setup is credentials', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'credentials',
        dbSetup: 'docker',
        includeAnalytics: false,
        advancedSkills: []
      }
    })

    const available = getAvailableModules(manifest)

    expect(available.find((m) => m.value === 'storage')).toBeUndefined()
  })

  it('should exclude analytics when already enabled', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: true,
        advancedSkills: []
      }
    })

    const available = getAvailableModules(manifest)

    expect(available.find((m) => m.value === 'analytics')).toBeUndefined()
  })

  it('should exclude installed advanced skills', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: false,
        advancedSkills: ['context7', 'figma']
      }
    })

    const available = getAvailableModules(manifest)

    expect(available.find((m) => m.value === 'sf-skill-context7')).toBeUndefined()
    expect(available.find((m) => m.value === 'sf-skill-figma')).toBeUndefined()
    expect(available.find((m) => m.value === 'sf-skill-atlassian')).toBeDefined()
    expect(available.find((m) => m.value === 'sf-skill-notion')).toBeDefined()
  })

  it('should exclude srs when already enabled in the manifest', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: false,
        advancedSkills: []
      },
      tools: { srs: { enabled: true, backend: 'notion' } }
    })

    const available = getAvailableModules(manifest)

    expect(available.find((m) => m.value === 'srs')).toBeUndefined()
  })

  it('should return empty array when everything is installed', () => {
    const manifest = manifestFixture({
      modules: {
        email: { provider: 'mailersend', version: 1 },
        s3Setup: 'docker',
        dbSetup: 'docker',
        includeAnalytics: true,
        advancedSkills: ['context7', 'atlassian', 'notion', 'figma']
      },
      tools: { srs: { enabled: true, backend: 'notion' } }
    })

    const available = getAvailableModules(manifest)

    expect(available).toHaveLength(0)
  })

  it('should include correct descriptions for skills', () => {
    const manifest = manifestFixture()

    const available = getAvailableModules(manifest)

    const context7 = available.find((m) => m.value === 'sf-skill-context7')
    expect(context7?.description).toContain('free')
    expect(context7?.name).toBe('Advanced Skill: Context7')
  })

  it('should offer only srs + skill modules when manifest has no modules block (cli-structure dogfood)', () => {
    const manifest = manifestFixture({ structure: 'cli', modules: undefined })

    const available = getAvailableModules(manifest)

    const values = available.map((m) => m.value)
    expect(values).toEqual(expect.arrayContaining(['srs', 'sf-skill-context7', 'sf-skill-atlassian', 'sf-skill-notion', 'sf-skill-figma']))
    expect(values).not.toContain('email')
    expect(values).not.toContain('storage')
    expect(values).not.toContain('analytics')
  })
})
