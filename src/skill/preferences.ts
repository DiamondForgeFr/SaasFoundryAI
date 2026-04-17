import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

import { fileExists } from '../utils'

import { resolvePreferencesPath } from './paths'

export type VotingOptIn = 'never' | 'ask' | 'always'

export interface Preferences {
  skillPromptAnswered: boolean
  skillInstallOptIn: boolean
  cliGlobalInstalled: boolean
  votingOptIn: VotingOptIn
  lastVoteSurveyAt: string | null
}

export const DEFAULT_PREFERENCES: Preferences = {
  skillPromptAnswered: false,
  skillInstallOptIn: false,
  cliGlobalInstalled: false,
  votingOptIn: 'ask',
  lastVoteSurveyAt: null
}

export async function readPreferences(): Promise<Preferences> {
  const filePath = resolvePreferencesPath()
  if (!(await fileExists(filePath))) return { ...DEFAULT_PREFERENCES }
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return mergeWithDefaults(parsed)
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  const filePath = resolvePreferencesPath()
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(prefs, null, 2) + '\n', 'utf8')
}

export async function updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const current = await readPreferences()
  const next = { ...current, ...patch }
  await writePreferences(next)
  return next
}

function mergeWithDefaults(parsed: unknown): Preferences {
  const p = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  return {
    skillPromptAnswered: typeof p.skillPromptAnswered === 'boolean' ? p.skillPromptAnswered : DEFAULT_PREFERENCES.skillPromptAnswered,
    skillInstallOptIn: typeof p.skillInstallOptIn === 'boolean' ? p.skillInstallOptIn : DEFAULT_PREFERENCES.skillInstallOptIn,
    cliGlobalInstalled: typeof p.cliGlobalInstalled === 'boolean' ? p.cliGlobalInstalled : DEFAULT_PREFERENCES.cliGlobalInstalled,
    votingOptIn: p.votingOptIn === 'never' || p.votingOptIn === 'ask' || p.votingOptIn === 'always' ? p.votingOptIn : DEFAULT_PREFERENCES.votingOptIn,
    lastVoteSurveyAt: typeof p.lastVoteSurveyAt === 'string' ? p.lastVoteSurveyAt : DEFAULT_PREFERENCES.lastVoteSurveyAt
  }
}
