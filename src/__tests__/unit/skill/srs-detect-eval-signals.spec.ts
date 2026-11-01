import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Regression guard for #280 (PR #284 code-review follow-up): the conversational
// eval hook relies on this bash classifier as a cheap prefilter. If the signal
// taxonomy or the heuristics drift, the agent either misses real SRS updates
// or spams the user on trivial turns. Each row of REQUIRED_CASES pins one
// (input → signal) expectation from the dogfood checklist declared in the
// script's `--rules` output.
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-srs/scripts/detect-eval-signals.sh')
const BASH = '/bin/bash'

type Signal = 'ur' | 'fr' | 'ds' | 'tc' | 'revision' | 'trivial' | 'none'

async function classify(text: string): Promise<{ signal: Signal; confidence: string; target: string }> {
  const { stdout } = await execFileP(BASH, [CLI, '--classify', text])
  return JSON.parse(stdout)
}

const CASES: { name: string; input: string; expected: Signal }[] = [
  // trivial shortcircuit — acknowledgements
  { name: 'ack-en', input: 'ok thanks', expected: 'trivial' },
  { name: 'ack-fr', input: 'merci', expected: 'trivial' },

  // trivial shortcircuit — read-only requests (EN + FR coverage from B.3)
  { name: 'read-en', input: 'show me the config', expected: 'trivial' },
  { name: 'read-fr-montre', input: 'montre-moi le code', expected: 'trivial' },
  { name: 'read-fr-explique', input: "peux-tu m'expliquer ce module", expected: 'trivial' },

  // TC — acceptance criteria / test language (wins over FR)
  { name: 'tc-en', input: 'we should test that login rejects empty passwords', expected: 'tc' },
  { name: 'tc-fr', input: 'il faut tester le flow de reset password', expected: 'tc' },

  // DS — technical decision markers
  { name: 'ds-en', input: "let's use bcrypt for password hashing", expected: 'ds' },
  { name: 'ds-fr', input: 'on va utiliser argon2 pour les mots de passe', expected: 'ds' },

  // Revision markers
  { name: 'revision-en', input: 'reconsider the session TTL decision', expected: 'revision' },
  { name: 'revision-fr', input: "on change d'avis sur la stack email", expected: 'revision' },

  // FR — feature/rule language
  { name: 'fr-en', input: 'add a feature that allows users to export their data', expected: 'fr' },
  { name: 'fr-fr', input: 'on doit pouvoir exporter les données utilisateur', expected: 'fr' },

  // UR — user-need language
  { name: 'ur-en', input: 'users should be able to reset their password', expected: 'ur' },
  { name: 'ur-fr', input: "l'utilisateur doit pouvoir supprimer son compte", expected: 'ur' },

  // None — empty and unrelated turns
  { name: 'empty', input: '   ', expected: 'none' },
  { name: 'none-generic', input: 'deployed to staging', expected: 'none' }
]

describe('sf-srs detect-eval-signals --classify contract (#280)', () => {
  it.each(CASES)('$name → $expected', async ({ input, expected }) => {
    const result = await classify(input)
    expect(result.signal).toBe(expected)
  })

  it('emits valid JSON on every path (never plain text)', async () => {
    for (const c of CASES) {
      const { stdout } = await execFileP(BASH, [CLI, '--classify', c.input])
      expect(() => JSON.parse(stdout)).not.toThrow()
    }
  })

  it('--rules mode exposes the stable taxonomy', async () => {
    const { stdout } = await execFileP(BASH, [CLI, '--rules'])
    const rules = JSON.parse(stdout)
    expect(rules).toHaveProperty('precondition')
    expect(rules).toHaveProperty('trivial_skip')
    expect(rules).toHaveProperty('signals')
    const signalIds = (rules.signals as { id: string }[]).map((s) => s.id).sort()
    expect(signalIds).toEqual(['ds', 'fr', 'revision', 'tc', 'ur'])
  })

  // #945 — a revision changes the FR in place instead of appending a design item
  it('--rules maps the revision signal to update-fr and documents its patch', async () => {
    const { stdout } = await execFileP(BASH, [CLI, '--rules'])
    const rules = JSON.parse(stdout)
    const kinds = Object.fromEntries((rules.signals as { id: string; patch_kind: string }[]).map((s) => [s.id, s.patch_kind]))

    expect(kinds).toEqual({ ur: 'add-ur', fr: 'add-fr', ds: 'add-ds', tc: 'add-tc', revision: 'update-fr' })
    expect(rules.patch_shape.kind).toContain('update-fr')
    expect(rules.patch_shape.update_fr).toContain('"kind": "update-fr"')
    expect(rules.patch_shape.update_fr).toContain('--dry-run')
    expect(rules.scope_limits_v1.update_fr).toMatch(/#1056/)
    expect(rules.scope_limits_v1.update_fr).toMatch(/#1057/)
    expect(JSON.stringify(rules)).not.toMatch(/ADD-only|Tracked in #945/)
  })

  it('--classify still marks a revision low confidence, so the auto-fire hook stays silent on it', async () => {
    const result = await classify('reconsider the routing rule of FR-AEX-014')

    expect(result).toMatchObject({ signal: 'revision', confidence: 'low' })
    expect(result.target).toContain('update-fr')
  })
})
