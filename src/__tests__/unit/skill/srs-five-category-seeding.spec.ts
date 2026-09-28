import { readFileSync } from 'fs'
import path from 'path'

// Regression guard for #247: the sf-srs skill must teach the AI agent how to
// seed DS / TC / NFR items from scanner findings (five-category completeness:
// UR + FR + DS + TC + NFR). Without this guidance the drafter silently produces
// UR+FR only and the generated SRS can't pass a real audit. The byte-equality
// drift guard (tool-skill-drift.spec.ts) ensures the scaffolded copy stays in
// sync — this spec pins the *content* so a refactor can't accidentally strip
// the sections.
//
// #280 moved the rules from SKILL.md prose to `data/clustering-rules.json`, so
// the content assertions now run against the JSON artefact. The schema below
// mirrors what the agent reads at drafting time.
const RULES_PATHS = [
  path.resolve(__dirname, '../../../../.claude/skills/sf-srs/data/clustering-rules.json'),
  path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/data/clustering-rules.json')
]

const REQUIRED_SEEDING_SECTIONS = ['ds_items', 'tc_items', 'nfr_items']

const REQUIRED_DS_TITLE_PATTERNS = [/Data model — <EntityName>/, /API contract — <METHOD> <path>/, /UI form — <PageName>/]

const REQUIRED_TC_SIGNALS = [/test\.cases\[i\]\.title/, /hasTests=false/, /TODO TC item/]

const REQUIRED_NFR_LAYER1 = [/JWT access token expiry/, /refresh token rotation/, /i18n — all user-facing strings translated/, /deletedAt/]

const REQUIRED_NFR_DISCLAIMER = /proposed — needs human validation/

type ClusteringRules = {
  seeding: {
    ds_items: { mappings: { title: string }[] }
    tc_items: {
      mappings: { source: string }[]
      todo_for_untested_endpoints: { when: string; emit_as: string }
    }
    nfr_items: {
      description: string
      layer1_stack_signals: { seeded_nfrs: string[] }[]
    }
  }
  coverage_table: { template: string[] }
}

describe('sf-srs five-category seeding rules (#247 / #280)', () => {
  it.each(RULES_PATHS)('%s declares DS/TC/NFR seeding sections', (file) => {
    const rules = JSON.parse(readFileSync(file, 'utf8')) as ClusteringRules
    for (const section of REQUIRED_SEEDING_SECTIONS) {
      expect(rules.seeding).toHaveProperty(section)
    }
  })

  it.each(RULES_PATHS)('%s seeds DS items from every scanner-finding shape', (file) => {
    const rules = JSON.parse(readFileSync(file, 'utf8')) as ClusteringRules
    const titles = rules.seeding.ds_items.mappings.map((m) => m.title).join('\n')
    for (const pattern of REQUIRED_DS_TITLE_PATTERNS) {
      expect(titles).toMatch(pattern)
    }
  })

  it.each(RULES_PATHS)('%s carries the test-coverage gap signals', (file) => {
    const rules = JSON.parse(readFileSync(file, 'utf8')) as ClusteringRules
    const tcMappings = rules.seeding.tc_items.mappings.map((m) => m.source).join('\n')
    const todo = JSON.stringify(rules.seeding.tc_items.todo_for_untested_endpoints)
    const joined = `${tcMappings}\n${todo}`
    for (const pattern of REQUIRED_TC_SIGNALS) {
      expect(joined).toMatch(pattern)
    }
  })

  it.each(RULES_PATHS)('%s proposes the standard SaaS NFR catalogue', (file) => {
    const rules = JSON.parse(readFileSync(file, 'utf8')) as ClusteringRules
    const nfrs = rules.seeding.nfr_items.layer1_stack_signals.flatMap((s) => s.seeded_nfrs).join('\n')
    for (const pattern of REQUIRED_NFR_LAYER1) {
      expect(nfrs).toMatch(pattern)
    }
    expect(rules.seeding.nfr_items.description).toMatch(REQUIRED_NFR_DISCLAIMER)
  })

  it.each(RULES_PATHS)('%s defines the five-category coverage table template', (file) => {
    const rules = JSON.parse(readFileSync(file, 'utf8')) as ClusteringRules
    const joined = rules.coverage_table.template.join('\n')
    expect(joined).toMatch(/SRS coverage for Epic/)
    expect(joined).toMatch(/Items proposed/)
    for (const cat of ['UR', 'FR', 'DS', 'TC', 'NFR']) {
      expect(joined).toContain(cat)
    }
  })
})
