import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import Ajv from 'ajv'

// Regression guard for #287: pin the data contracts of the two sf-srs JSON
// artefacts to a published JSON Schema so the agent that reads them can trust
// the shape instead of re-parsing prose. The schemas live under /schemas/ and
// are referenced via `$schema` URLs (same pattern as the manifest schema
// shipped in #286). Drift either way (schema vs data) breaks the eval hook and
// the drafting flow — both are critical surfaces for the SRS module.

const REPO_ROOT = path.resolve(__dirname, '../../../..')

const CLUSTERING_SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/clustering-rules.schema.json')
const EVAL_SIGNALS_SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/detect-eval-signals-rules.schema.json')

const CLUSTERING_DATA_PATHS = [path.join(REPO_ROOT, '.claude/skills/sf-srs/data/clustering-rules.json'), path.join(REPO_ROOT, 'scaffolds/skills-templates/sf-srs/data/clustering-rules.json')]

const EVAL_SIGNALS_SCRIPT_PATHS = [
  path.join(REPO_ROOT, '.claude/skills/sf-srs/scripts/detect-eval-signals.sh'),
  path.join(REPO_ROOT, 'scaffolds/skills-templates/sf-srs/scripts/detect-eval-signals.sh')
]

const newAjv = () => new Ajv({ allErrors: true, strict: false })

describe('clustering-rules.schema.json — canonical shape', () => {
  const schema = JSON.parse(readFileSync(CLUSTERING_SCHEMA_PATH, 'utf8'))
  const validate = newAjv().compile(schema)

  it.each(CLUSTERING_DATA_PATHS)('%s validates against the schema', (file) => {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const ok = validate(data)
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
    expect(ok).toBe(true)
  })

  it('the data file declares the canonical $schema URL', () => {
    for (const file of CLUSTERING_DATA_PATHS) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      expect(data.$schema).toBe('https://raw.githubusercontent.com/DiamondForgeFr/SaaSFoundryAI/master/schemas/clustering-rules.schema.json')
    }
  })
})

describe('clustering-rules.schema.json — rejection cases', () => {
  const schema = JSON.parse(readFileSync(CLUSTERING_SCHEMA_PATH, 'utf8'))
  const validate = newAjv().compile(schema)
  const minimal = JSON.parse(readFileSync(CLUSTERING_DATA_PATHS[0], 'utf8'))

  it('rejects an unknown finding_kinds.kind enum', () => {
    const broken = structuredClone(minimal)
    broken.finding_kinds[0].kind = 'snowflake'
    expect(validate(broken)).toBe(false)
  })

  it('rejects a typo in a top-level field (additionalProperties: false)', () => {
    const broken = structuredClone(minimal)
    broken.seedingg = broken.seeding
    delete broken.seeding
    expect(validate(broken)).toBe(false)
  })

  it('rejects a non-integer version', () => {
    const broken = structuredClone(minimal)
    broken.version = '1'
    expect(validate(broken)).toBe(false)
  })

  it('rejects a missing required seeding section', () => {
    const broken = structuredClone(minimal)
    delete broken.seeding.nfr_items
    expect(validate(broken)).toBe(false)
  })
})

describe('detect-eval-signals-rules.schema.json — canonical shape', () => {
  const schema = JSON.parse(readFileSync(EVAL_SIGNALS_SCHEMA_PATH, 'utf8'))
  const validate = newAjv().compile(schema)

  it.each(EVAL_SIGNALS_SCRIPT_PATHS)('%s --rules output validates against the schema', (script) => {
    const stdout = execFileSync('bash', [script, '--rules'], { encoding: 'utf8' })
    const data = JSON.parse(stdout)
    const ok = validate(data)
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
    expect(ok).toBe(true)
  })

  it('the --rules output declares the canonical $schema URL', () => {
    for (const script of EVAL_SIGNALS_SCRIPT_PATHS) {
      const stdout = execFileSync('bash', [script, '--rules'], { encoding: 'utf8' })
      const data = JSON.parse(stdout)
      expect(data.$schema).toBe('https://raw.githubusercontent.com/DiamondForgeFr/SaaSFoundryAI/master/schemas/detect-eval-signals-rules.schema.json')
    }
  })
})

describe('detect-eval-signals-rules.schema.json — rejection cases', () => {
  const schema = JSON.parse(readFileSync(EVAL_SIGNALS_SCHEMA_PATH, 'utf8'))
  const validate = newAjv().compile(schema)
  const minimal = JSON.parse(execFileSync('bash', [EVAL_SIGNALS_SCRIPT_PATHS[0], '--rules'], { encoding: 'utf8' }))

  it('rejects an unknown signal.id enum', () => {
    const broken = structuredClone(minimal)
    broken.signals[0].id = 'urgent'
    expect(validate(broken)).toBe(false)
  })

  it('rejects an unknown signal.patch_kind enum', () => {
    const broken = structuredClone(minimal)
    broken.signals[0].patch_kind = 'replace-fr'
    expect(validate(broken)).toBe(false)
  })

  it('rejects a missing throttle.max_proposals_per_turn', () => {
    const broken = structuredClone(minimal)
    delete broken.throttle.max_proposals_per_turn
    expect(validate(broken)).toBe(false)
  })

  it('rejects a non-integer throttle.max_proposals_per_turn', () => {
    const broken = structuredClone(minimal)
    broken.throttle.max_proposals_per_turn = 'one'
    expect(validate(broken)).toBe(false)
  })
})
