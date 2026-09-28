import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #590 — `sf new` printed "successfully set up" with clickable URLs and returned 0 after a
 * step had failed.
 *
 * `servicesOk` lived inside the post-setup block and gated exactly one thing: whether to
 * offer starting the apps. It never reached the closing banner, and never reached the exit
 * code — which, for anything driving this command, is the whole signal.
 *
 * Running the real command needs Docker and several minutes, so these assert the contract
 * on the source. The behaviour itself was verified by hand on both paths: a taken port
 * gives exit 1 and the warning banner, a clean run gives exit 0 and the celebration.
 */

const NEW_TS = resolve(__dirname, '../../../commands/new.ts')
const source = readFileSync(NEW_TS, 'utf8')

describe('sf new exit code follows the outcome (#590)', () => {
  it('records a failed step rather than only flipping a local flag', () => {
    expect(source).toContain('failedSteps.push(')
    // Every post-setup step that can fail must record — not just the database. Asserting the
    // set rather than a count: a new failable step should have to name itself here, not make
    // an unrelated number go stale. Starting the apps joined in #621, which is exactly the
    // case a hardcoded `2` would have flagged as a regression.
    const steps = [...source.matchAll(/failedSteps\.push\(\{\s*step: '([^']+)'/g)].map((m) => m[1])
    expect(steps).toEqual(expect.arrayContaining(['Database initialization', 'MinIO S3 storage', 'Starting the apps']))
  })

  it('sets a non-zero exit code when a step failed', () => {
    expect(source).toContain('process.exitCode = 1')
  })

  it('keeps the two failures apart: scaffolding dead vs services incomplete', () => {
    // A scaffolding failure means nothing usable exists — process.exit(1) is right there.
    // A post-setup failure means the project is real and one step short, so the run must
    // finish printing and only set the code. Truncating stdout mid-flush would hide the
    // remediation that is the whole point.
    const branch = source.slice(source.indexOf('if (failedSteps.length > 0)'), source.indexOf('Congratulations!'))
    expect(branch).toContain('process.exitCode = 1')
    expect(branch).not.toContain('process.exit(')
  })

  it('guards the celebration behind the absence of failures', () => {
    const banner = source.indexOf('Congratulations!')
    const guard = source.indexOf('if (failedSteps.length > 0)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(banner)
  })

  it('every recorded failure carries a command that finishes the job', () => {
    // A remediation an agent cannot run is not a remediation — the old message said
    // "docker compose -f <other-project>/…" with a placeholder nobody could resolve.
    const pushes = source.match(/failedSteps\.push\(\{[\s\S]*?\}\)/g) ?? []
    expect(pushes.length).toBeGreaterThanOrEqual(3)
    for (const push of pushes) {
      expect(push).toContain('step:')
      expect(push).toContain('fix:')
      expect(push).not.toContain('<other-project>')
    }
  })
})
