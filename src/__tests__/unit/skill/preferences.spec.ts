import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

import { DEFAULT_PREFERENCES, readPreferences, updatePreferences, writePreferences } from '../../../skill/preferences'
import { createTempDir } from '../../helpers/temp-dir'

describe('skill/preferences', () => {
  let originalHome: string | undefined
  let tempHome: string
  let cleanupHome: () => Promise<void>

  beforeEach(async () => {
    originalHome = process.env.HOME
    const { dir, cleanup } = await createTempDir()
    tempHome = dir
    cleanupHome = cleanup
    process.env.HOME = tempHome
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await cleanupHome()
  })

  it('returns defaults when the preferences file does not exist', async () => {
    const prefs = await readPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
  })

  it('round-trips writePreferences + readPreferences', async () => {
    const input = {
      skillPromptAnswered: true,
      skillInstallOptIn: true,
      cliGlobalInstalled: true,
      votingOptIn: 'never' as const,
      lastVoteSurveyAt: '2026-04-17T00:00:00.000Z',
      filedRequests: [{ issueNumber: 42, repoUrl: 'https://github.com/DiamondForgeFr/SaaSFoundryAI/issues/42', title: 'Add Stripe', openedAt: '2026-04-17T10:00:00.000Z' }],
      votesCast: [{ issueNumber: 99, direction: 'up' as const, castAt: '2026-04-17T11:00:00.000Z' }]
    }
    await writePreferences(input)
    const read = await readPreferences()
    expect(read).toEqual(input)
  })

  it('creates the ~/.saasfoundry directory automatically on write', async () => {
    await writePreferences(DEFAULT_PREFERENCES)
    const filePath = path.join(tempHome, '.saasfoundry', 'preferences.json')
    const prefs = await readPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(filePath.startsWith(tmpdir()) || filePath.startsWith('/tmp') || filePath.startsWith('/private/tmp')).toBe(true)
  })

  it('merges partial preference files against defaults', async () => {
    const prefsPath = path.join(tempHome, '.saasfoundry', 'preferences.json')
    await writePreferences(DEFAULT_PREFERENCES)
    await writeFile(prefsPath, JSON.stringify({ skillInstallOptIn: true, votingOptIn: 'always' }), 'utf8')
    const prefs = await readPreferences()
    expect(prefs).toEqual({
      ...DEFAULT_PREFERENCES,
      skillInstallOptIn: true,
      votingOptIn: 'always'
    })
  })

  it('falls back to defaults for malformed JSON', async () => {
    await writePreferences(DEFAULT_PREFERENCES)
    const filePath = path.join(tempHome, '.saasfoundry', 'preferences.json')
    await writeFile(filePath, 'not-json', 'utf8')
    const prefs = await readPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
  })

  it('drops invalid entries in filedRequests / votesCast', async () => {
    const prefsPath = path.join(tempHome, '.saasfoundry', 'preferences.json')
    await writePreferences(DEFAULT_PREFERENCES)
    await writeFile(
      prefsPath,
      JSON.stringify({
        filedRequests: [{ issueNumber: 1, repoUrl: 'u', title: 't', openedAt: 'ts' }, { garbage: true }, 'not-an-object'],
        votesCast: [
          { issueNumber: 9, direction: 'up', castAt: 'ts' },
          { issueNumber: 10, direction: 'sideways', castAt: 'ts' }
        ]
      }),
      'utf8'
    )
    const prefs = await readPreferences()
    expect(prefs.filedRequests).toEqual([{ issueNumber: 1, repoUrl: 'u', title: 't', openedAt: 'ts' }])
    expect(prefs.votesCast).toEqual([{ issueNumber: 9, direction: 'up', castAt: 'ts' }])
  })

  it('updatePreferences merges a patch into existing prefs', async () => {
    await writePreferences(DEFAULT_PREFERENCES)
    const next = await updatePreferences({ cliGlobalInstalled: true })
    expect(next.cliGlobalInstalled).toBe(true)
    expect(next.skillInstallOptIn).toBe(DEFAULT_PREFERENCES.skillInstallOptIn)
    const reread = await readPreferences()
    expect(reread).toEqual(next)
  })
})
