import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { parseSetLocalCiArgs } from '../../commands/workflow'
import { AGENT_LOCAL_CI_CONTEXT, localCiGateSummary, moltenPublishesToGithub, moltenStatusContexts, resolveLocalCiGate } from '../../local-ci-gate'
import type { SaaSFoundryManifest } from '../../types'

// #1104 — the commit statuses a pull request needs come from one resolver, in this order: the manifest list, the
// jobs of .molten/project.json published as local-<job>, and otherwise the status the agent publishes. The shell
// resolver of github-projects-cli.sh reads the same three sources; this is the reading `sf workflow` and `sf status` use.
describe('local CI gate: the statuses a pull request requires', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sf-local-ci-gate-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const manifest = (requiredStatuses?: unknown) =>
    ({ workflow: { tool: 'github-projects', ...(requiredStatuses === undefined ? {} : { localCi: { requiredStatuses } }) } }) as unknown as SaaSFoundryManifest
  const molten = (content: unknown) => {
    mkdirSync(path.join(root, '.molten'), { recursive: true })
    writeFileSync(path.join(root, '.molten', 'project.json'), typeof content === 'string' ? content : JSON.stringify(content))
  }

  describe('resolveLocalCiGate', () => {
    it('takes the manifest list as it is, and it wins over a Molten pipeline', () => {
      molten({ ci: { statuses: 'github', jobs: [{ name: 'unit' }] } })
      expect(resolveLocalCiGate(root, manifest(['custom-ci']))).toEqual({ source: 'manifest', requiredStatuses: ['custom-ci'] })
    })

    it('reads an empty list as a deliberate "no local CI"', () => {
      expect(resolveLocalCiGate(root, manifest([]))).toEqual({ source: 'manifest-none', requiredStatuses: [] })
    })

    it.each([['local-check'], [['ok', '']], [[1]]])('refuses a list that is not a list of contexts: %j', (declared) => {
      expect(resolveLocalCiGate(root, manifest(declared))).toEqual({ error: 'workflow.localCi.requiredStatuses must be a list of commit status contexts (strings)' })
    })

    it('derives local-<job> for every job of a pipeline that publishes to GitHub', () => {
      molten({ name: 'sample', ci: { statuses: 'github', jobs: [{ name: 'unit' }, { name: 'lint', title: 'Lint' }] } })
      expect(resolveLocalCiGate(root, manifest())).toEqual({ source: 'molten', requiredStatuses: ['local-unit', 'local-lint'] })
    })

    it('ignores a job without a name, like the pipeline reading of #1155', () => {
      molten({ ci: { statuses: 'github', jobs: [{ name: 'unit' }, { title: 'no name' }, { name: '  ' }, 'x'] } })
      expect(resolveLocalCiGate(root, manifest())).toEqual({ source: 'molten', requiredStatuses: ['local-unit'] })
    })

    it('falls to the agent status when the pipeline declares no job', () => {
      molten({ name: 'sample', ci: { statuses: 'github', jobs: [] } })
      expect(resolveLocalCiGate(root, manifest())).toEqual({ source: 'agent', requiredStatuses: [AGENT_LOCAL_CI_CONTEXT] })
    })

    it('falls to the agent status, with a note, when the pipeline does not publish to GitHub', () => {
      molten({ ci: { jobs: [{ name: 'unit' }] } })
      const gate = resolveLocalCiGate(root, manifest())
      expect(gate).toMatchObject({ source: 'agent', requiredStatuses: [AGENT_LOCAL_CI_CONTEXT] })
      expect((gate as { moltenNote?: string }).moltenNote).toContain('"statuses": "github"')
    })

    it('requires the agent status for a project that declares nothing', () => {
      expect(resolveLocalCiGate(root, manifest())).toEqual({ source: 'agent', requiredStatuses: [AGENT_LOCAL_CI_CONTEXT] })
      expect(resolveLocalCiGate(root, null)).toEqual({ source: 'agent', requiredStatuses: [AGENT_LOCAL_CI_CONTEXT] })
    })

    it.each([['{ "ci": '], ['[]'], ['"text"']])('refuses a Molten file that cannot be read instead of falling back: %s', (content) => {
      molten(content)
      const gate = resolveLocalCiGate(root, manifest())
      expect(gate).toHaveProperty('error')
      expect((gate as { error: string }).error).toContain('Could not read .molten/project.json')
    })

    it('does not read a broken Molten file when the manifest declares the list', () => {
      molten('{ "ci": ')
      expect(resolveLocalCiGate(root, manifest(['custom-ci']))).toMatchObject({ source: 'manifest' })
    })
  })

  describe('the Molten reading', () => {
    it.each([
      [{ ci: { statuses: 'github' } }, true],
      [{ ci: { statuses: 'local' } }, false],
      [{ ci: {} }, false],
      [{}, false],
      [null, false]
    ])('publishes to GitHub for %j: %s', (project, expected) => {
      expect(moltenPublishesToGithub(project)).toBe(expected)
    })

    it('names the status of every job', () => {
      expect(moltenStatusContexts({ ci: { jobs: [{ name: 'a' }, { name: 'b' }] } })).toEqual(['local-a', 'local-b'])
    })
  })

  describe('localCiGateSummary', () => {
    it.each([
      [{ source: 'manifest', requiredStatuses: ['a', 'b'] }, '2 statuses from workflow.localCi.requiredStatuses'],
      [{ source: 'manifest', requiredStatuses: ['a'] }, '1 status from workflow.localCi.requiredStatuses'],
      [{ source: 'manifest-none', requiredStatuses: [] }, 'none: workflow.localCi.requiredStatuses is an empty list'],
      [{ source: 'molten', requiredStatuses: ['local-a', 'local-b'] }, '2 local-<job> statuses derived from .molten/project.json'],
      [{ source: 'agent', requiredStatuses: [AGENT_LOCAL_CI_CONTEXT] }, 'AI testing / Local CI, published by ai-status'],
      [{ error: 'boom' }, 'unreadable (boom)']
    ] as const)('says where %j comes from', (gate, expected) => {
      expect(localCiGateSummary(gate as never)).toContain(expected)
    })
  })

  describe('parseSetLocalCiArgs', () => {
    it('reads a list of contexts', () => {
      expect(parseSetLocalCiArgs(['local-unit', 'local-lint'])).toEqual({ kind: 'list', contexts: ['local-unit', 'local-lint'] })
    })

    it.each([
      ['--from-molten', 'from-molten'],
      ['--none', 'none'],
      ['--clear', 'clear']
    ])('reads %s', (flag, kind) => {
      expect(parseSetLocalCiArgs([flag])).toEqual({ kind })
    })

    it.each([
      [[], 'Name the commit status contexts'],
      [['a', 'a'], 'listed twice: a'],
      [['a', ' '], 'cannot be blank'],
      [['--none', 'a'], '--none takes no status context'],
      [['--none', '--clear'], 'are exclusive'],
      [['--wat'], 'Unknown option for `sf workflow set-local-ci`: --wat']
    ])('refuses %j', (args, message) => {
      expect(() => parseSetLocalCiArgs(args)).toThrow(message)
    })
  })
})
