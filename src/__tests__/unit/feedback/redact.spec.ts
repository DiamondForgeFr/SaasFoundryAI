import { spawnSync } from 'child_process'
import path from 'path'

import { isSensitiveKey, redactText } from '../../../feedback/redact'

const SKILL_SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-feedback-bug.js')

// Secrets are built by concatenation so a secret scanner does not flag the literals; at run time they are what the rules match.
const JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'c2lnbmF0dXJlLXNpZ25hdHVyZQ'
const GITHUB = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const GITHUB_PAT = 'github_pat_' + '11ABCDEFG0123456789_abcdefghij'
const OPENAI = 'sk-' + 'abcdefghij0123456789ABCDEF'
const STRIPE = 'sk_live_' + '0123456789abcdef0123456789abcdef'
const SLACK = 'xoxb-' + '1234567890-abcdefghijkl'
const BEARER = 'abcdefghijklmnop.qrstuvwxyz012345'
const BASIC = 'dXNlcjpwYXNzd29yZA=='

/** What the skill's own stderr redaction covers: every sample here must also be hidden by the repro's. */
const SKILL_COVERED: { sample: string; secret: string }[] = [
  { sample: `token ${JWT} rejected`, secret: JWT },
  { sample: `remote: ${GITHUB}`, secret: GITHUB },
  { sample: `pat ${GITHUB_PAT}`, secret: GITHUB_PAT },
  { sample: `OPENAI_KEY is ${OPENAI}`, secret: OPENAI },
  { sample: `charge failed with ${STRIPE}`, secret: STRIPE },
  { sample: `slack ${SLACK}`, secret: SLACK },
  { sample: `Authorization: Bearer ${BEARER}`, secret: BEARER },
  { sample: `Authorization: Basic ${BASIC}`, secret: BASIC },
  { sample: 'ran sf --token=SECRETVALUE123 against it', secret: 'SECRETVALUE123' },
  { sample: 'DATABASE_PASSWORD=hunter2hunter2', secret: 'hunter2hunter2' },
  { sample: 'GET /cb?api_key=abc123def456&x=1', secret: 'abc123def456' },
  { sample: 'reply to jane.doe@example.com please', secret: 'jane.doe' },
  { sample: 'at /Users/janedoe/project/a.ts:4', secret: 'janedoe' },
  { sample: 'at /home/janedoe/project/a.ts:4', secret: 'janedoe' },
  { sample: 'at C:\\Users\\janedoe\\project\\a.ts:4', secret: 'janedoe' }
]

/** What the repro adds on top of the skill. */
const REPRO_ONLY: { sample: string; secret: string; marker: string }[] = [
  { sample: 'key AKIA' + 'IOSFODNN7EXAMPLE', secret: 'AKIA' + 'IOSFODNN7EXAMPLE', marker: '<aws-key>' },
  { sample: 'key AIza' + 'SyA1234567890abcdefghijklmnopqrstuv', secret: 'SyA1234567890abcdefghijklmnopqrstuv', marker: '<google-key>' },
  { sample: 'mail mlsn.' + 'a1b2c3d4e5f6a1b2c3d4e5f6', secret: 'a1b2c3d4e5f6a1b2c3d4e5f6', marker: '<mailersend-token>' },
  { sample: 'notion ' + 'secret_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123', secret: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123', marker: '<notion-token>' },
  { sample: 'clone https://deploy-user:p4ssw0rd-canary@git.example.com/org/repo', secret: 'p4ssw0rd-canary', marker: 'https://<redacted>@git.example.com' },
  { sample: 'clone https://' + GITHUB + '@github.com/org/repo', secret: GITHUB, marker: 'https://<redacted>@github.com' },
  { sample: 'at D:\\Users\\janedoe\\project', secret: 'janedoe', marker: 'D:\\Users\\<user>' },
  { sample: '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END ' + 'PRIVATE KEY-----', secret: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', marker: '<private-key>' },
  { sample: 'token sk-' + 'proj-abcdefghij0123456789ABCDEF', secret: 'abcdefghij0123456789ABCDEF', marker: '<api-key>' }
]

describe('feedback/redact', () => {
  describe('against the redaction of the tool-saasfoundry skill', () => {
    function skillRedaction(lines: string[]): string[] {
      const run = spawnSync(process.execPath, [SKILL_SCRIPT], {
        input: JSON.stringify({ source: 'manual', title: 'parity', stderr: lines.join('\n'), userConfirmed: false }),
        encoding: 'utf8'
      })
      expect(run.status).toBe(0)
      return (JSON.parse(run.stdout) as { redactedStderr: string }).redactedStderr.split('\n')
    }

    it('hides every secret the skill hides, and changes every line the skill changes', () => {
      const lines = SKILL_COVERED.map((entry) => entry.sample)
      const skill = skillRedaction(lines)
      SKILL_COVERED.forEach(({ sample, secret }, index) => {
        // The corpus really is something the skill covers...
        expect(skill[index]).not.toContain(secret)
        // ...and the repro is at least as strict.
        const ours = redactText(sample)
        expect(ours).not.toContain(secret)
        expect(ours).not.toBe(sample)
      })
    })

    it('keeps the triage signal around a redacted home path, as the skill does', () => {
      expect(redactText('TypeError at /Users/janedoe/app/src/a.ts:4:11')).toBe('TypeError at /Users/<user>/app/src/a.ts:4:11')
    })
  })

  describe('beyond the skill', () => {
    it.each(REPRO_ONLY)('hides $marker', ({ sample, secret, marker }) => {
      const out = redactText(sample)
      expect(out).not.toContain(secret)
      expect(out).toContain(marker)
    })
  })

  it('leaves plain text, versions and module names alone', () => {
    const plain = 'sf 1.0.1 monorepo mailersend docker SaaSFoundry Solo feature/{N}-{description} <type>(#<ticket>): <description>'
    expect(redactText(plain)).toBe(plain)
  })

  describe('isSensitiveKey', () => {
    it.each(['apiKey', 'api_key', 'API-KEY', 'accessToken', 'client_secret', 'password', 'dbPassword', 'credentials', 'privateKey', 'Authorization', 'cookie'])('flags %s', (key) => {
      expect(isSensitiveKey(key)).toBe(true)
    })

    it.each(['version', 'provider', 'agents', 'ticketDelivery', 'shellShape', 'tier', 'model', 'effort', 'managed'])('does not flag %s', (key) => {
      expect(isSensitiveKey(key)).toBe(false)
    })
  })
})
