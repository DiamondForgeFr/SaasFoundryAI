import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../../../..')

/** Workflow templates the CLI deposits into generated projects. */
const GENERATED_WORKFLOWS = ['scaffolds/skills-templates/workflow/github/pr-review-sync.yml', 'scaffolds/shared/validation/test.workflow.yml']

/**
 * First major of each action that runs on Node.js 24, read from its `action.yml`
 * (`runs.using`). Older majors run on Node.js 20, which GitHub deprecated: every run
 * warns, and the runner forces them onto Node.js 24 (#848).
 */
const FIRST_NODE24_MAJOR: Record<string, number> = {
  'actions/checkout': 5,
  'actions/setup-node': 5,
  'actions/github-script': 8,
  'docker/setup-buildx-action': 4,
  'docker/login-action': 4,
  'docker/metadata-action': 6,
  'docker/build-push-action': 7
}

const usesOf = (file: string): string[] => [...readFileSync(resolve(ROOT, file), 'utf8').matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map((match) => match[1].trim())

describe.each(GENERATED_WORKFLOWS)('action pins in %s (#848)', (file) => {
  const uses = usesOf(file)

  it('uses at least one action', () => {
    expect(uses.length).toBeGreaterThan(0)
  })

  it.each(uses)('pins %s to a commit of a Node.js 24 release', (reference) => {
    const pin = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # v(\d+)(?:\.\d+){0,2}$/.exec(reference)
    expect(pin).not.toBeNull()
    const [, action, , major] = pin!
    expect(FIRST_NODE24_MAJOR).toHaveProperty([action])
    expect(Number(major)).toBeGreaterThanOrEqual(FIRST_NODE24_MAJOR[action])
  })
})
