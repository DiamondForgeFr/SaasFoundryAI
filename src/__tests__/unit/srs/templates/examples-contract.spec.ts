import { readFileSync } from 'fs'
import path from 'path'

const EXAMPLES_DIR = path.resolve(__dirname, '../../../../../.claude/skills/sf-srs/templates/tickets/examples')

type ExampleContract = {
  file: string
  requiredHeadings: string[]
  forbiddenHeadings?: string[]
}

const CONTRACTS: ExampleContract[] = [
  {
    file: 'epic.md',
    requiredHeadings: ['## Goal', '## Business Value', '## Dates', '## Scope', '## Specifications', '## Dependencies', '## Constraints', '## Assumptions', '## Definition of Done'],
    forbiddenHeadings: ['## Acceptance Criteria', '## Completion Criteria', '## Behavior observed']
  },
  {
    file: 'story.md',
    requiredHeadings: [
      '## Objective',
      '## Context (User Requirements)',
      '## Scope (Functional Requirements)',
      '## Acceptance Criteria',
      '## Specifications',
      '## Dependencies',
      '## Constraints',
      '## Design References'
    ],
    forbiddenHeadings: ['## Goal', '## Completion Criteria', '## Behavior observed', '## Definition of Done']
  },
  {
    file: 'task.md',
    requiredHeadings: ['## Objective', '## Context', '## Scope', '## Completion Criteria', '## Specifications', '## Dependencies', '## Constraints'],
    forbiddenHeadings: ['## Goal', '## Acceptance Criteria', '## Behavior observed', '## Design References', '## Definition of Done']
  },
  {
    file: 'issue.md',
    requiredHeadings: ['## Behavior observed', '## Expected Behavior', '## Steps to Reproduce / Trigger Conditions', '## Environment / Configuration', '## Impact / Severity', '## Evidence / Data'],
    forbiddenHeadings: ['## Goal', '## Objective', '## Acceptance Criteria', '## Completion Criteria', '## Definition of Done']
  }
]

describe('sf-srs ticket authoring examples — contract', () => {
  for (const contract of CONTRACTS) {
    describe(contract.file, () => {
      const body = readFileSync(path.join(EXAMPLES_DIR, contract.file), 'utf8')

      it('opens with a "Why this example" HTML-comment preamble', () => {
        expect(body.startsWith('<!--')).toBe(true)
        expect(body).toMatch(/Why this example/)
        expect(body).toMatch(/-->/)
      })

      it.each(contract.requiredHeadings)('contains required heading %s', (heading) => {
        expect(body).toContain(heading)
      })

      if (contract.forbiddenHeadings) {
        it.each(contract.forbiddenHeadings)('does not contain off-contract heading %s', (heading) => {
          const lines = body.split('\n')
          expect(lines.includes(heading)).toBe(false)
        })
      }

      it('headings appear in the documented order', () => {
        const found = (body.match(/^## .+$/gm) ?? []).filter((h) => contract.requiredHeadings.includes(h))
        expect(found).toEqual(contract.requiredHeadings)
      })
    })
  }
})
