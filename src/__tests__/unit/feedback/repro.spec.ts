import { writeFile } from 'fs/promises'
import path from 'path'

import { collectReproContext, formatBugBody, type FileBugInput } from '../../../feedback/bug'
import { GITHUB_ISSUE_BODY_LIMIT, IssueBodyTooLargeError, countCharacters } from '../../../feedback/body-limit'
import { REPRO_MANIFEST_BUDGET, coreSummary, renderManifestRepro, summarizeManifest } from '../../../feedback/repro'
import { FULL_MANIFEST_FILE_COUNT, fullManifestFixture } from '../../helpers/full-manifest'
import { createTempDir } from '../../helpers/temp-dir'

const INPUT: FileBugInput = { title: 'sf feedback bug --auto-repro fails', description: 'It fails on a fresh full project.', source: 'cli', cliVersion: '1.0.1', includeRepro: true }

// Built by concatenation so a secret scanner does not flag the literals; at run time they match the redaction rules.
const GITHUB_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const STRIPE_KEY = 'sk_live_' + '0123456789abcdef0123456789abcdef'
const EMAIL = 'founder@private-startup.example'
const HOME = '/Users/anthony.gachet'

async function bodyFor(manifest: unknown, input: FileBugInput = INPUT): Promise<string> {
  const { dir, cleanup } = await createTempDir()
  try {
    await writeFile(path.join(dir, '.saasfoundry.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2), 'utf8')
    return formatBugBody(input, await collectReproContext(input.cliVersion, dir))
  } finally {
    await cleanup()
  }
}

/** A parsed excerpt, typed loosely on purpose: every level is read by key, and a missing one fails the assertion that reads it. */
type Excerpt = { [key: string]: Excerpt }

/** The JSON block of the excerpt, parsed: what a maintainer reads when they open the issue. */
function excerptOf(body: string): Excerpt {
  const match = body.match(/(`{3,})json\n([\s\S]*?)\n\1\n<\/details>/)
  if (!match) throw new Error(`no manifest excerpt in the body:\n${body}`)
  return JSON.parse(match[2]) as Excerpt
}

describe('feedback/repro: the auto-repro excerpt of a real-sized full manifest (#972)', () => {
  it('starts from a manifest that cannot be pasted whole: the fixture is past GitHub limit on its own', () => {
    const manifest = fullManifestFixture()
    expect(Object.keys(manifest.fileHashes as object)).toHaveLength(FULL_MANIFEST_FILE_COUNT)
    expect(countCharacters(JSON.stringify(manifest, null, 2))).toBeGreaterThan(GITHUB_ISSUE_BODY_LIMIT)
  })

  it('builds a body under the limit, nowhere near it, from the full manifest', async () => {
    const body = await bodyFor(fullManifestFixture())
    expect(countCharacters(body)).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT)
    expect(countCharacters(body)).toBeLessThan(REPRO_MANIFEST_BUDGET)
  })

  it('keeps what a reproduction needs: profile, structure, versions, modules, workflow, language and SRS flags', async () => {
    const excerpt = excerptOf(await bodyFor(fullManifestFixture()))

    expect(excerpt.capabilities).toEqual({ profile: 'full', technicalStack: 'present', collaborationHarness: 'managed' })
    expect(excerpt).toMatchObject({ version: '1.0.1', manifestVersion: 4, structure: 'monorepo', projectName: 'diamondforge', mainBranch: 'main' })
    expect(excerpt.ports).toEqual({ db: 5436, api: 3501, web: 5174, s3: 9000, s3Console: 9001 })
    expect(excerpt.language).toEqual({ srs: 'fr', tickets: 'fr', codeComments: 'en' })

    // Every module, with its version and its choices.
    expect(excerpt.modules).toMatchObject({
      email: { provider: 'mailersend', version: 1 },
      s3Setup: 'docker',
      dbSetup: 'docker',
      includeAnalytics: true,
      advancedSkills: ['docs', 'e2e'],
      pwa: { version: 1 },
      harness: { version: 5, managed: true, agents: ['claude-code', 'codex'], guard: { shellShape: 'refuse' }, delegation: { ticketDelivery: 'allowed' } }
    })
    expect(excerpt.modules.harness.routing.kinds).toEqual({ 'bug-fix': { tier: 'fix' } })
    expect(excerpt.modules.harness.routing.tiers.fix['claude-code']).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })

    expect(excerpt.workflow).toMatchObject({
      tool: 'github-projects',
      template: 'SaaSFoundry Solo',
      workingBranch: 'develop',
      prTargetBranch: 'develop',
      statuses: ['Backlog', 'In progress', 'AI testing', 'In review', 'Done'],
      issueTypes: ['sf-epic', 'sf-story', 'sf-task', 'sf-issue'],
      localCi: { requiredStatuses: ['local-format', 'local-lint', 'local-build', 'local-unit'] }
    })
    expect(excerpt.aiRules).toMatchObject({ alwaysCreateBranchFromWorking: true, requireHumanCheckOnPushedBranch: false })
    expect(excerpt.tools.srs).toEqual({ enabled: true, backend: 'notion', hasRootPage: true, pendingIngestion: true, scanExcludeCount: 2 })
    expect(excerpt.tools.tracker).toEqual({ name: 'github-projects' })
    expect(excerpt.tools.docs).toEqual({ name: 'notion' })
    expect(excerpt.tools.design).toEqual(['figma'])
  })

  it('counts fileHashes instead of copying them, and says what was left out', async () => {
    const body = await bodyFor(fullManifestFixture())
    const excerpt = excerptOf(body)
    expect(excerpt.fileHashes).toEqual({ count: FULL_MANIFEST_FILE_COUNT })
    expect(body).not.toMatch(/\b[a-f0-9]{64}\b/)
    expect(body).not.toContain('feature-0001')
    expect(body).toContain(`${JSON.stringify(fullManifestFixture(), null, 2).length}-character manifest`)
    expect(body).toContain('Counted, not copied')
  })

  it('is still the same size for a manifest with ten times the hashes', async () => {
    const manifest = fullManifestFixture()
    const hashes = manifest.fileHashes as Record<string, string>
    for (let i = 0; i < FULL_MANIFEST_FILE_COUNT * 10; i++) hashes[`extra/file-${i}.ts`] = 'f'.repeat(64)
    const body = await bodyFor(manifest)
    expect(excerptOf(body).fileHashes).toEqual({ count: FULL_MANIFEST_FILE_COUNT * 11 })
    expect(countCharacters(body)).toBeLessThan(REPRO_MANIFEST_BUDGET)
  })
})

describe('feedback/repro: nothing sensitive is included (#972)', () => {
  function manifestWithCanaries(): Record<string, unknown> {
    const manifest = fullManifestFixture()
    const workflow = manifest['workflow'] as Record<string, unknown>
    const tools = manifest['tools'] as Record<string, unknown>
    const modules = manifest['modules'] as Record<string, unknown>
    return {
      ...manifest,
      $schema: 'https://example.invalid/schema-canary.json',
      projectName: `app-${EMAIL}`,
      language: { srs: `fr ${HOME}/notes`, tickets: 'fr', codeComments: 'en' },
      skillsAccounts: { notion: EMAIL, github: 'personal-account-canary' },
      adoption: {
        kind: 'legacy',
        sourcePackage: `${HOME}/Downloads/saasfoundryai-cli-canary.tgz`,
        sourceVersion: '0.9.0',
        sourceIntegrity: 'sha512-' + 'Zm9vYmFy'.repeat(10),
        layout: 'monorepo',
        planFingerprint: 'ab'.repeat(32),
        refreshPending: true
      },
      projection: { kind: 'multirepo-child', rootProjectName: 'PrivateRootCanary', app: 'api' },
      unmanagedPaths: [`${HOME}/secret-project-canary/notes.md`],
      internalNotes: { password: 'hunter2-canary' },
      futureField: 'LEAK-CANARY',
      modules: {
        ...modules,
        futureModule: { version: 1, apiKey: STRIPE_KEY, accessToken: GITHUB_TOKEN, note: `contact ${EMAIL} at ${HOME}/x`, nested: { client_secret: 'plain-secret-canary', label: 'ok' } }
      },
      workflow: {
        ...workflow,
        template: `Solo ${GITHUB_TOKEN}`,
        projectUrl: 'https://github.com/orgs/PrivateOrgCanary/projects/42',
        statuses: [{ name: `Backlog ${EMAIL}`, description: `desc ${HOME}` }]
      },
      tools: {
        ...tools,
        srs: {
          ...(tools['srs'] as Record<string, unknown>),
          rootPage: { id: 'root-page-id-canary', url: 'https://app.notion.com/p/PrivateWorkspaceCanary', name: 'PrivateWorkspaceCanary' },
          scan: { exclude: ['private-dir-canary/'] }
        },
        tracker: { name: 'github-projects', account: EMAIL },
        futureTool: { token: 'tool-token-canary' }
      },
      fileHashes: { [`${HOME}/hash-path-canary.ts`]: 'cd'.repeat(32) }
    }
  }

  const CANARIES = [
    GITHUB_TOKEN,
    STRIPE_KEY,
    EMAIL,
    'anthony.gachet',
    'personal-account-canary',
    'work-account',
    'design-account',
    'schema-canary',
    'saasfoundryai-cli-canary',
    'Zm9vYmFy',
    'abababab',
    'PrivateRootCanary',
    'secret-project-canary',
    'hunter2-canary',
    'LEAK-CANARY',
    'plain-secret-canary',
    'PrivateOrgCanary',
    'root-page-id-canary',
    'PrivateWorkspaceCanary',
    'private-dir-canary',
    'tool-token-canary',
    'hash-path-canary',
    'cdcdcdcd',
    '34ba31bb',
    '11111111-2222',
    'https://'
  ]

  it('carries none of the planted secrets, paths, accounts, URLs or hashes', async () => {
    const body = await bodyFor(manifestWithCanaries())
    for (const canary of CANARIES) expect(body).not.toContain(canary)
  })

  it('scrubs a credential, an e-mail address or a home path inside a field it does keep', async () => {
    const excerpt = excerptOf(await bodyFor(manifestWithCanaries()))
    expect(excerpt.workflow.template).toBe('Solo <github-token>')
    expect(excerpt.workflow.statuses).toEqual(['Backlog <email>'])
    // The local part of an address takes the hyphen with it: the whole address goes, never half of it.
    expect(excerpt.projectName).toBe('<email>')
    expect(excerpt.language.srs).toBe('fr /Users/<user>/notes')
  })

  it('withholds the value of a key named like a credential, wherever it sits in a module block', async () => {
    const excerpt = excerptOf(await bodyFor(manifestWithCanaries()))
    expect(excerpt.modules.futureModule.apiKey).toBe('<redacted>')
    expect(excerpt.modules.futureModule.accessToken).toBe('<redacted>')
    expect(excerpt.modules.futureModule.nested).toEqual({ client_secret: '<redacted>', label: 'ok' })
    expect(excerpt.modules.futureModule.note).toBe('contact <email> at /Users/<user>/x')
    // ...while a module this code has never heard of is still reported.
    expect(excerpt.modules.futureModule.version).toBe(1)
  })

  it('lists a field it does not know by name only, never by value', async () => {
    const excerpt = excerptOf(await bodyFor(manifestWithCanaries()))
    expect(excerpt.unlistedKeys).toEqual(['internalNotes', 'futureField'])
    expect(excerpt.tools.unlistedKeys).toEqual(['futureTool'])
  })

  it('counts the paths and accounts it leaves out instead of copying them', async () => {
    const excerpt = excerptOf(await bodyFor(manifestWithCanaries()))
    expect(excerpt.unmanagedPaths).toEqual({ count: 1 })
    expect(excerpt.fileHashes).toEqual({ count: 1 })
    expect(excerpt.skillsAccounts).toEqual({ skills: ['notion', 'github'] })
    expect(excerpt.adoption).toEqual({ kind: 'legacy', sourceVersion: '0.9.0', layout: 'monorepo', refreshPending: true })
    expect(excerpt.projection).toEqual({ kind: 'multirepo-child', app: 'api' })
    expect(excerpt.workflow.hasProjectUrl).toBe(true)
  })

  it('does not echo the parser message of a manifest that is not JSON, since it quotes the file', async () => {
    const body = await bodyFor(`{ "token": "${GITHUB_TOKEN}", oops }`)
    expect(body).toContain('is not a valid JSON object; no excerpt attached')
    expect(body).not.toContain(GITHUB_TOKEN)
    expect(body).not.toContain('oops')
  })

  it('treats JSON that is not an object as not valid, without throwing', async () => {
    expect(await bodyFor('["a", "b"]')).toContain('is not a valid JSON object; no excerpt attached')
    expect(await bodyFor('"just a string"')).toContain('is not a valid JSON object; no excerpt attached')
  })

  it('cannot be made to write markdown into the issue through a backtick run in a manifest string', async () => {
    const manifest = { ...fullManifestFixture(), projectName: 'x```\n@everyone look here' }
    const body = await bodyFor(manifest)
    const open = body.match(/(`{3,})json\n/)
    expect(open).not.toBeNull()
    // The fence is longer than any run of backticks in what it wraps, so the string stays inside the block.
    expect((open as RegExpMatchArray)[1].length).toBeGreaterThan(3)
    expect(excerptOf(body).projectName).toBe('x```\n@everyone look here')
  })

  it('does not let a key named __proto__ touch a prototype', () => {
    const summary = summarizeManifest(JSON.parse('{"version":"1","structure":"monorepo","projectName":"p","modules":{"__proto__":{"polluted":true}}}'))
    expect(summary).not.toBeNull()
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('feedback/repro: the excerpt is bounded whatever the manifest holds (#972)', () => {
  function pathologicalModules(): Record<string, unknown> {
    const wide: Record<string, unknown> = {}
    for (let a = 0; a < 60; a++) {
      const level: Record<string, unknown> = {}
      for (let b = 0; b < 60; b++) level[`key-${b}`] = { text: 'x'.repeat(5000), list: Array.from({ length: 80 }, (_, i) => `item-${i}`) }
      wide[`module-${a}`] = level
    }
    return wide
  }

  it('caps strings, lists and keys, and falls back to the core fields when it is still over budget', async () => {
    const manifest = { ...fullManifestFixture(), modules: pathologicalModules() }
    const body = await bodyFor(manifest)
    expect(countCharacters(body)).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT)
    expect(countCharacters(body)).toBeLessThan(REPRO_MANIFEST_BUDGET)
    expect(body).toContain('(core fields only)')
    const excerpt = excerptOf(body)
    expect(excerpt.capabilities.profile).not.toBeUndefined()
    expect(excerpt.structure).toBe('monorepo')
    expect(Object.keys(excerpt.modules)).toEqual(['keys'])
  })

  it('keeps the core summary small by construction', () => {
    const summary = summarizeManifest({ ...fullManifestFixture(), modules: pathologicalModules(), projectName: 'p'.repeat(100_000) })
    expect(summary).not.toBeNull()
    const core = coreSummary(summary as NonNullable<typeof summary>)
    expect(JSON.stringify(core, null, 2).length).toBeLessThan(3000)
  })

  it('does not hang or throw on a string of several megabytes', () => {
    const started = Date.now()
    const summary = summarizeManifest({ version: '1', structure: 'monorepo', projectName: 'a'.repeat(5_000_000) })
    expect(Date.now() - started).toBeLessThan(2000)
    expect((summary as { projectName: string }).projectName.length).toBeLessThanOrEqual(201)
  })
})

describe('feedback/bug: the whole body is measured before GitHub is called (#972)', () => {
  it('shrinks the excerpt to its core fields when the description leaves no room for the rest', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify(fullManifestFixture()))
      const repro = await collectReproContext('1.0.1', dir)
      const bareOverhead = countCharacters(formatBugBody({ ...INPUT, description: '' }, null))
      const fullBlock = countCharacters(renderManifestRepro(repro.manifest, 'full').join('\n'))
      const coreBlock = countCharacters(renderManifestRepro(repro.manifest, 'core').join('\n'))
      expect(fullBlock).toBeGreaterThan(coreBlock + 1000)
      // A description sized so that the room left is midway between the two excerpts: the full one overflows, the core one fits.
      const room = Math.floor((fullBlock + coreBlock) / 2)
      const description = 'd'.repeat(GITHUB_ISSUE_BODY_LIMIT - bareOverhead - room - 200)
      expect(() => formatBugBody({ ...INPUT, description }, repro)).not.toThrow()
      const body = formatBugBody({ ...INPUT, description }, repro)
      expect(countCharacters(body)).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT)
      expect(body).toContain('(core fields only)')
    } finally {
      await cleanup()
    }
  })

  it('fails with the numbers, and without the body, when the description alone is too long', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify(fullManifestFixture()))
      const repro = await collectReproContext('1.0.1', dir)
      const description = 'secret-looking-stack-trace '.repeat(4000)
      let error: unknown
      try {
        formatBugBody({ ...INPUT, description }, repro)
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(IssueBodyTooLargeError)
      const message = (error as IssueBodyTooLargeError).message
      expect(message).toMatch(/would be \d+ characters long, above the 65536 GitHub accepts/)
      expect(message).toContain(`The description alone is ${description.length} characters`)
      expect(message).toContain('Shorten --description.')
      expect(message).toContain('Nothing was sent to GitHub.')
      expect(message).not.toContain('secret-looking-stack-trace')
      expect(message.length).toBeLessThan(600)
    } finally {
      await cleanup()
    }
  })

  it('suggests dropping --auto-repro only when the excerpt is what tips an otherwise valid body over', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify(fullManifestFixture()))
      const repro = await collectReproContext('1.0.1', dir)
      const bareOverhead = countCharacters(formatBugBody({ ...INPUT, description: '' }, null))
      // Fits without the excerpt, overflows with either excerpt: nothing smaller than the core fields is left to try.
      const description = 'd'.repeat(GITHUB_ISSUE_BODY_LIMIT - bareOverhead - 40)
      expect(() => formatBugBody({ ...INPUT, description }, null)).not.toThrow()
      expect(() => formatBugBody({ ...INPUT, description }, repro)).toThrow(/Shorten --description or drop --auto-repro\./)
    } finally {
      await cleanup()
    }
  })
})
