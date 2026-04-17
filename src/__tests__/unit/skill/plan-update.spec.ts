import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-update.sh')
const BASH = '/bin/bash'

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function runWithIntent(intent: unknown): Promise<ExecResult> {
  const child = execFile(BASH, [SCRIPT])
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => stdoutChunks.push(c))
  child.stderr?.on('data', (c: string) => stderrChunks.push(c))
  child.stdin?.write(typeof intent === 'string' ? intent : JSON.stringify(intent))
  child.stdin?.end()
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    code
  }
}

describe('skill/plan-update', () => {
  describe('Guided/Express — minimal add', () => {
    it('builds the minimal command with just a single module addition', async () => {
      const { stdout, code } = await runWithIntent({ addModules: ['email'] })
      expect(code).toBe(0)
      expect(stdout.trim()).toBe('sf update --non-interactive --add-modules email')
    })
  })

  describe('Express — full plan with credentials and dry-run', () => {
    it('emits flags in manifest order with CSV unquoted and dry-run set', async () => {
      const { stdout, code } = await runWithIntent({
        addModules: ['email', 'storage'],
        dryRun: true,
        conflictStrategy: 'save-new',
        mailersendApiKey: 'ms_live_abc',
        mailersendSenderEmail: 'noreply@example.com',
        s3Setup: 'docker'
      })
      expect(code).toBe(0)
      expect(stdout.trim()).toBe(
        [
          'sf update',
          '--non-interactive',
          '--add-modules email,storage',
          '--dry-run',
          '--conflict-strategy save-new',
          '--mailersend-api-key ms_live_abc',
          '--mailersend-sender-email noreply@example.com',
          '--s3-setup docker'
        ].join(' ')
      )
    })
  })

  describe('Catalogue-awareness — already installed collision', () => {
    it('rejects a module that is already in alreadyInstalled', async () => {
      const { code, stderr } = await runWithIntent({
        addModules: ['email', 'storage'],
        alreadyInstalled: ['email']
      })
      expect(code).toBe(2)
      expect(stderr).toMatch(/module "email" is already installed; drop it from addModules/)
    })

    it('accepts additions when alreadyInstalled is disjoint', async () => {
      const { stdout, code } = await runWithIntent({
        addModules: ['storage'],
        alreadyInstalled: ['email', 'analytics']
      })
      expect(code).toBe(0)
      expect(stdout.trim()).toBe('sf update --non-interactive --add-modules storage')
    })
  })

  describe('Validation — bad enum', () => {
    it('exits 2 when conflictStrategy is not in the allowed set', async () => {
      const { code, stderr } = await runWithIntent({
        addModules: ['email'],
        conflictStrategy: 'overwrite-everything'
      })
      expect(code).toBe(2)
      expect(stderr).toMatch(
        /invalid value "overwrite-everything" for conflictStrategy; expected one of keep, replace, save-new/
      )
    })
  })

  describe('Validation — unknown module', () => {
    it('rejects addModules values not listed in the manifest', async () => {
      const { code, stderr } = await runWithIntent({
        addModules: ['email', 'not-a-real-module']
      })
      expect(code).toBe(2)
      expect(stderr).toMatch(/invalid value "not-a-real-module" in addModules/)
    })
  })

  describe('Validation — malformed JSON', () => {
    it('exits 2 on non-JSON input', async () => {
      const { code, stderr } = await runWithIntent('not json at all')
      expect(code).toBe(2)
      expect(stderr).toMatch(/invalid JSON on stdin/)
    })

    it('exits 2 on empty stdin', async () => {
      const { code, stderr } = await runWithIntent('')
      expect(code).toBe(2)
      expect(stderr).toMatch(/empty intent on stdin/)
    })

    it('exits 2 on a JSON array at top level', async () => {
      const { code, stderr } = await runWithIntent([])
      expect(code).toBe(2)
      expect(stderr).toMatch(/intent must be a JSON object/)
    })
  })

  describe('Expert — credentials with risky characters', () => {
    it('shell-quotes values containing spaces and quotes', async () => {
      const { stdout, code } = await runWithIntent({
        addModules: ['email'],
        mailersendSenderName: "Acme's Support Team"
      })
      expect(code).toBe(0)
      expect(stdout).toContain('--add-modules email')
      expect(stdout).toContain("--mailersend-sender-name 'Acme'\\''s Support Team'")
    })
  })

  describe('Boolean emission', () => {
    it('omits dry-run flag when dryRun is false', async () => {
      const { stdout, code } = await runWithIntent({
        addModules: ['analytics'],
        dryRun: false
      })
      expect(code).toBe(0)
      expect(stdout).not.toContain('--dry-run')
      expect(stdout.trim()).toBe('sf update --non-interactive --add-modules analytics')
    })
  })
})
