import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { LABEL_READ_TIMEOUT_MS, readTicketLabels, resolveRouteFacts, type LabelExec } from '../../../harness/ticket-labels'

const CLI = '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'

describe('reading the labels of a ticket (#1105)', () => {
  let root: string
  const put = async (path: string, content: string, mode = 0o644) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content, { mode })
    await chmod(join(root, path), mode)
  }
  const manifest = (tool: unknown = 'github-projects') => put('.saasfoundry.json', JSON.stringify({ version: 'test', projectName: 'labels-demo', structure: 'cli', workflow: { tool } }))
  /** An exec that answers with `stdout`, and remembers how it was called. */
  const answering = (stdout: string) => jest.fn<ReturnType<LabelExec>, Parameters<LabelExec>>(async () => stdout)
  const failing = (error: object) =>
    jest.fn<ReturnType<LabelExec>, Parameters<LabelExec>>(async () => {
      throw Object.assign(new Error('failed'), error)
    })

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-ticket-labels-')))
    await manifest()
    await put(CLI, '#!/usr/bin/env bash\n')
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('readTicketLabels', () => {
    it('runs get-labels of the configured tool CLI from the project, with a bounded wait, and reads the complexity and the nature', async () => {
      const exec = answering('bug\ncomplexity: medium\nnature:internal\nsf-task\n')
      expect(await readTicketLabels(root, 1105, { exec })).toEqual({ ok: true, complexity: 'medium', nature: 'internal' })
      expect(exec).toHaveBeenCalledTimes(1)
      expect(exec).toHaveBeenCalledWith('bash', [CLI, 'get-labels', '1105'], { cwd: root, timeout: LABEL_READ_TIMEOUT_MS })
    })

    it('finds the tool CLI among the shared skills when only those are projected (a Codex-only project)', async () => {
      await rm(join(root, '.claude'), { recursive: true })
      await put('.agents/skills/sf-tool-github-projects/github-projects-cli.sh', '#!/usr/bin/env bash\n')
      const exec = answering('complexity: low\n')
      expect(await readTicketLabels(root, 7, { exec })).toMatchObject({ ok: true, complexity: 'low', nature: null })
      expect(exec.mock.calls[0][1][0]).toBe('.agents/skills/sf-tool-github-projects/github-projects-cli.sh')
    })

    it('reads a ticket that has none of the labels as a ticket with nothing to say', async () => {
      expect(await readTicketLabels(root, 1, { exec: answering('') })).toEqual({ ok: true, complexity: null, nature: null })
      expect(await readTicketLabels(root, 1, { exec: answering('bug\nenhancement\n') })).toEqual({ ok: true, complexity: null, nature: null })
    })

    it.each([
      ['no space after the colon', 'complexity:medium'],
      ['another case', 'Complexity: medium'],
      ['a level it does not know', 'complexity: huge'],
      ['text around the label', 'a complexity: medium label'],
      ['a nature it does not know', 'nature:external'],
      ['a prefix of another label', 'xnature:internal']
    ])('does not read %s as a label', async (_, label) => {
      expect(await readTicketLabels(root, 1, { exec: answering(`${label}\n`) })).toEqual({ ok: true, complexity: null, nature: null })
    })

    it('takes the first complexity label and the first nature label when a ticket carries several', async () => {
      expect(await readTicketLabels(root, 1, { exec: answering('complexity: high\ncomplexity: low\ncomplexity: bug\nnature:bundled-pr\nnature:internal\n') })).toEqual({
        ok: true,
        complexity: 'low',
        nature: 'bundled-pr'
      })
    })

    it.each<[string, () => Promise<void>, string]>([
      ['no manifest', () => rm(join(root, '.saasfoundry.json')), 'no workflow tool is configured'],
      ['no workflow tool', () => manifest(null), 'no workflow tool is configured'],
      ['the none tool', () => manifest('none'), 'no workflow tool is configured'],
      ['a tool name that is a path', () => manifest('../../etc'), 'is not a tool name'],
      ['a tool with no CLI deposited', () => manifest('jira'), 'the jira tool CLI was not found at .claude/skills/sf-tool-jira/jira-cli.sh']
    ])('says why it cannot read when there is %s, and runs nothing', async (_, setup, reason) => {
      await setup()
      const exec = answering('complexity: low\n')
      const result = await readTicketLabels(root, 1, { exec })
      expect(result).toEqual({ ok: false, reason: expect.stringContaining(reason) })
      expect(exec).not.toHaveBeenCalled()
    })

    it.each([
      ['exits with a code (offline, a tool without get-labels)', { code: 1 }, `${CLI} get-labels 9 exited with code 1`],
      ['does not answer in time', { killed: true, signal: 'SIGTERM' }, `${CLI} get-labels 9 did not answer within 10 s`],
      ['cannot be started', { code: 'ENOENT' }, `${CLI} get-labels 9 could not be started`],
      ['fails some other way', {}, `${CLI} get-labels 9 failed`]
    ])('says so when the CLI %s, and does not throw', async (_, error, reason) => {
      expect(await readTicketLabels(root, 9, { exec: failing(error) })).toEqual({ ok: false, reason })
    })

    it('runs the real CLI file through bash, reading its standard output (no mock)', async () => {
      await put(CLI, '#!/usr/bin/env bash\n[ "$1" = get-labels ] && printf "bug\\ncomplexity: complex\\nnature:user-facing\\n"\n')
      expect(await readTicketLabels(root, 5)).toEqual({ ok: true, complexity: 'complex', nature: 'user-facing' })
      await put(CLI, '#!/usr/bin/env bash\necho "Unknown command: $1" >&2\nexit 1\n')
      expect(await readTicketLabels(root, 5)).toEqual({ ok: false, reason: `${CLI} get-labels 5 exited with code 1` })
    })
  })

  describe('resolveRouteFacts', () => {
    it('reads the complexity and the nature of the ticket when the flags give none', async () => {
      const exec = answering('complexity: medium\nnature:bundled-pr\n')
      expect(await resolveRouteFacts(root, { ticket: 1105 }, { exec })).toEqual({
        complexity: 'medium',
        complexitySource: 'label',
        nature: 'bundled-pr',
        natureSource: 'label',
        warnings: []
      })
      expect(exec).toHaveBeenCalledTimes(1)
    })

    it('lets the flags win, and does not ask the ticket when it is told everything', async () => {
      const exec = answering('complexity: low\nnature:internal\n')
      expect(await resolveRouteFacts(root, { ticket: 1105, complexity: 'complex', nature: 'user-facing' }, { exec })).toEqual({
        complexity: 'complex',
        complexitySource: 'flag',
        nature: 'user-facing',
        natureSource: 'flag',
        warnings: []
      })
      expect(exec).not.toHaveBeenCalled()
    })

    it('asks only for what is missing: a given complexity wins over the label, the nature comes from it', async () => {
      const exec = answering('complexity: low\nnature:internal\n')
      expect(await resolveRouteFacts(root, { ticket: 1105, complexity: 'bug' }, { exec })).toMatchObject({
        complexity: 'bug',
        complexitySource: 'flag',
        nature: 'internal',
        natureSource: 'label',
        warnings: []
      })
      expect(await resolveRouteFacts(root, { ticket: 1105, nature: 'user-facing' }, { exec })).toMatchObject({
        complexity: 'low',
        complexitySource: 'label',
        nature: 'user-facing',
        natureSource: 'flag'
      })
      expect(exec).toHaveBeenCalledTimes(2)
    })

    it('reads nothing without a ticket, and records what the flags say', async () => {
      const exec = answering('complexity: low\n')
      expect(await resolveRouteFacts(root, { ticket: null }, { exec })).toEqual({ complexity: null, complexitySource: null, nature: null, natureSource: null, warnings: [] })
      expect(await resolveRouteFacts(root, { ticket: null, complexity: 'medium' }, { exec })).toMatchObject({ complexity: 'medium', complexitySource: 'flag', warnings: [] })
      expect(exec).not.toHaveBeenCalled()
    })

    it('records no complexity and warns once, with what to do, when the read fails', async () => {
      const facts = await resolveRouteFacts(root, { ticket: 1105 }, { exec: failing({ code: 4 }) })
      expect(facts).toMatchObject({ complexity: null, complexitySource: null, nature: null, natureSource: null })
      expect(facts.warnings).toEqual([`the complexity of #1105 could not be read (${CLI} get-labels 1105 exited with code 4): the route record carries none; pass --complexity <level>`])
    })

    it('warns the same way for a tool whose CLI has no get-labels, and for a project without a workflow tool', async () => {
      await put('.claude/skills/sf-tool-jira/jira-cli.sh', '#!/usr/bin/env bash\necho "Unknown command" >&2\nexit 1\n')
      await manifest('jira')
      const jira = await resolveRouteFacts(root, { ticket: 3 })
      expect(jira.complexity).toBeNull()
      expect(jira.warnings).toEqual([expect.stringContaining('the complexity of #3 could not be read (.claude/skills/sf-tool-jira/jira-cli.sh get-labels 3 exited with code 1)')])
      await rm(join(root, '.saasfoundry.json'))
      expect((await resolveRouteFacts(root, { ticket: 3 })).warnings).toEqual([expect.stringContaining('no workflow tool is configured')])
    })

    it('warns when the ticket has no complexity label, and still records its nature', async () => {
      const facts = await resolveRouteFacts(root, { ticket: 8 }, { exec: answering('nature:internal\n') })
      expect(facts).toMatchObject({ complexity: null, nature: 'internal', natureSource: 'label' })
      expect(facts.warnings).toEqual(['the complexity of #8 could not be read (the ticket has no complexity label): the route record carries none; pass --complexity <level>'])
    })

    it('says nothing about a nature it could not find, and nothing about a failed read when the complexity was given', async () => {
      expect(await resolveRouteFacts(root, { ticket: 8, complexity: 'low' }, { exec: failing({ code: 1 }) })).toMatchObject({ complexity: 'low', nature: null, warnings: [] })
      expect(await resolveRouteFacts(root, { ticket: 8, complexity: 'low' }, { exec: answering('bug\n') })).toMatchObject({ complexity: 'low', nature: null, warnings: [] })
    })
  })
})
