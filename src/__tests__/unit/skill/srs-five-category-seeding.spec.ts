import { readFileSync } from 'fs'
import path from 'path'

// Regression guard for #247: the sf-srs SKILL.md must teach the AI agent how to
// seed DS / TC / NFR items from scanner findings (five-category completeness:
// UR + FR + DS + TC + NFR). Without this guidance the drafter silently produces
// UR+FR only and the generated SRS can't pass a real audit. The byte-equality
// drift guard (tool-skill-drift.spec.ts) ensures the scaffolded copy stays in
// sync — this spec pins the *content* so a refactor can't accidentally strip
// the sections.
const SKILL_PATHS = [path.resolve(__dirname, '../../../../.claude/skills/sf-srs/SKILL.md'), path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/SKILL.md')]

const REQUIRED_HEADINGS = [
  /### Seeding DS \/ TC \/ NFR \(five-category completeness\)/,
  /#### DS items \(Design Specifications\)/,
  /#### TC items \(Test Cases\)/,
  /#### NFR items \(Non-Functional Requirements\)/,
  /#### Coverage table \(pre-accept\)/
]

const REQUIRED_MAPPINGS = [
  /entity.*Data model/,
  /API contract.*METHOD/,
  /UI form/,
  /test\.cases\[i\]\.title/,
  /hasTests=false/,
  /TODO.*TC/,
  /JWT access token expiry/,
  /refresh token rotation/,
  /i18n.*translated/,
  /deletedAt/,
  /proposed — needs human validation/
]

describe('sf-srs five-category seeding guidance (#247)', () => {
  it.each(SKILL_PATHS)('%s declares all DS/TC/NFR seeding headings', (file) => {
    const content = readFileSync(file, 'utf8')
    for (const pattern of REQUIRED_HEADINGS) {
      expect(content).toMatch(pattern)
    }
  })

  it.each(SKILL_PATHS)('%s carries the scanner-finding → section mapping signals', (file) => {
    const content = readFileSync(file, 'utf8')
    for (const pattern of REQUIRED_MAPPINGS) {
      expect(content).toMatch(pattern)
    }
  })

  it.each(SKILL_PATHS)('%s tells the agent to emit a five-category coverage table', (file) => {
    const content = readFileSync(file, 'utf8')
    expect(content).toMatch(/SRS coverage for Epic/)
    expect(content).toMatch(/Items proposed/)
  })
})
