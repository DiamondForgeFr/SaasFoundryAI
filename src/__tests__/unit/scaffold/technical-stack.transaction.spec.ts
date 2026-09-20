import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { planTechnicalStackAdoption, sha256, technicalOwnershipHashes } from '../../../scaffold/technical-stack.planner'
import {
  applyTechnicalStackTransition,
  recoverTechnicalStackTransition,
  TECHNICAL_TRANSITION_JOURNAL,
  TECHNICAL_TRANSITION_LOCK,
  TECHNICAL_TRANSITION_RECOVERY_LOCK,
  TechnicalStackRecoveryError
} from '../../../scaffold/technical-stack.transaction'

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  const target = join(root, ...path.split('/'))
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content)
}

describe('recoverable technical stack transaction', () => {
  let sandbox: string
  let projectRoot: string
  let candidateRoot: string
  let beforeManifest: Buffer

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'sf-adoption-transaction-'))
    projectRoot = join(sandbox, 'project')
    candidateRoot = join(sandbox, 'candidate')
    await Promise.all([mkdir(projectRoot), mkdir(candidateRoot)])
    beforeManifest = Buffer.from('{"version":"before"}\n')
    await writeFile(join(projectRoot, '.saasfoundry.json'), beforeManifest)
  })

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  async function prepared(files: Record<string, string>): Promise<{ plan: Awaited<ReturnType<typeof planTechnicalStackAdoption>>; afterManifest: Buffer }> {
    for (const [path, content] of Object.entries(files)) await put(candidateRoot, path, content)
    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })
    const afterManifest = Buffer.from(`${JSON.stringify({ version: 'after', fileHashes: technicalOwnershipHashes(plan) })}\n`)
    return { plan, afterManifest }
  }

  it('creates files exclusively and keeps the manifest as the last commit marker', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/src/main.ts': 'api', 'apps/web/src/main.tsx': 'web' })
    const observed: string[] = []

    const result = await applyTechnicalStackTransition({
      projectRoot,
      candidateRoot,
      approvedPlan: plan,
      expectedManifest: beforeManifest,
      nextManifest: afterManifest,
      onPhase: async (phase, path) => {
        if (phase === 'after-file' || phase === 'before-manifest') {
          expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
          observed.push(path ?? phase)
        }
      }
    })

    expect(result).toMatchObject({ mutated: true, created: ['apps/api/src/main.ts', 'apps/web/src/main.tsx'], recoveredCommittedTransaction: false })
    expect(observed).toHaveLength(3)
    expect(await readFile(join(projectRoot, 'apps/api/src/main.ts'), 'utf8')).toBe('api')
    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(afterManifest)
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_LOCK))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back created identities in reverse after a caught mid-apply failure', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/a.ts': 'a', 'apps/api/b.ts': 'b' })

    await expect(
      applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: afterManifest,
        onPhase: (phase, path) => {
          if (phase === 'after-file' && path === 'apps/api/a.ts') throw new Error('injected failure')
        }
      })
    ).rejects.toThrow('injected failure')

    await expect(lstat(join(projectRoot, 'apps'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves the project byte-for-byte unchanged when failure is injected before the first file', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })

    await expect(
      applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: afterManifest,
        onPhase: (phase) => {
          if (phase === 'after-journal') throw new Error('injected pre-mutation failure')
        }
      })
    ).rejects.toThrow('injected pre-mutation failure')

    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
    await expect(lstat(join(projectRoot, 'apps'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_LOCK))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never deletes an external file created after planning', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })

    await expect(
      applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: afterManifest,
        onPhase: async (phase) => {
          if (phase === 'after-journal') await put(projectRoot, 'apps/api/main.ts', 'external')
        }
      })
    ).rejects.toBeInstanceOf(AggregateError)

    expect(await readFile(join(projectRoot, 'apps/api/main.ts'), 'utf8')).toBe('external')
    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
    expect(JSON.parse(await readFile(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL), 'utf8'))).toMatchObject({
      state: 'rollback-needed',
      unresolved: expect.arrayContaining(['apps/api/main.ts'])
    })
  })

  it('preserves a modified created file and retains a recoverable journal', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })

    await expect(
      applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: afterManifest,
        onPhase: async (phase, path) => {
          if (phase === 'after-file' && path === 'apps/api/main.ts') {
            await writeFile(join(projectRoot, path), 'user changed it')
            throw new Error('injected failure')
          }
        }
      })
    ).rejects.toBeInstanceOf(AggregateError)

    expect(await readFile(join(projectRoot, 'apps/api/main.ts'), 'utf8')).toBe('user changed it')
    const journal = JSON.parse(await readFile(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL), 'utf8'))
    expect(journal).toMatchObject({ state: 'rollback-needed', unresolved: expect.arrayContaining(['apps/api/main.ts']) })
    await expect(recoverTechnicalStackTransition(projectRoot)).rejects.toBeInstanceOf(TechnicalStackRecoveryError)

    await writeFile(join(projectRoot, 'apps/api/main.ts'), 'candidate')
    await expect(recoverTechnicalStackTransition(projectRoot)).resolves.toEqual({ status: 'rolled-back', unresolved: [] })
    await expect(lstat(join(projectRoot, 'apps'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects recovery records that are not bound to the original plan', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })

    await expect(
      applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: afterManifest,
        onPhase: async (phase, path) => {
          if (phase === 'after-file' && path === 'apps/api/main.ts') {
            await writeFile(join(projectRoot, path), 'user changed it')
            throw new Error('retain journal')
          }
        }
      })
    ).rejects.toBeInstanceOf(AggregateError)

    const journal = JSON.parse(await readFile(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL), 'utf8'))
    const forgedRecord = `.saasfoundry-transition.${journal.transactionId}.999.created.json`
    await writeFile(
      join(projectRoot, forgedRecord),
      `${JSON.stringify({
        version: 1,
        transactionId: journal.transactionId,
        entry: {
          path: '.saasfoundry.json',
          temporaryPath: '.saasfoundry.json.forged.tmp',
          sha256: sha256(beforeManifest),
          recordPath: forgedRecord,
          identity: { dev: '1', ino: '1' }
        }
      })}\n`
    )

    await expect(recoverTechnicalStackTransition(projectRoot)).rejects.toThrow(`Damaged technical transition recovery record: ${forgedRecord}`)
    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
  })

  it('revalidates every created file immediately before committing the manifest', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })

    await expect(
      applyTechnicalStackTransition({
        projectRoot,
        candidateRoot,
        approvedPlan: plan,
        expectedManifest: beforeManifest,
        nextManifest: afterManifest,
        onPhase: async (phase) => {
          if (phase === 'before-manifest') await writeFile(join(projectRoot, 'apps/api/main.ts'), 'changed concurrently')
        }
      })
    ).rejects.toBeInstanceOf(AggregateError)

    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
    expect(await readFile(join(projectRoot, 'apps/api/main.ts'), 'utf8')).toBe('changed concurrently')
  })

  it('binds technical ownership in the next manifest to the approved plan', async () => {
    const { plan } = await prepared({ 'apps/api/main.ts': 'candidate' })
    const invalid = Buffer.from('{"version":"after","fileHashes":{}}\n')

    await expect(applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: plan, expectedManifest: beforeManifest, nextManifest: invalid })).rejects.toThrow(
      'missing ownership evidence'
    )
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects additions when the manifest cannot be an unambiguous commit marker', async () => {
    const { plan } = await prepared({ 'apps/api/main.ts': 'candidate' })
    const same = Buffer.from(`${JSON.stringify({ version: 'same', fileHashes: technicalOwnershipHashes(plan) })}\n`)
    await writeFile(join(projectRoot, '.saasfoundry.json'), same)

    await expect(applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: plan, expectedManifest: same, nextManifest: same })).rejects.toThrow('distinct manifest commit marker')
    await expect(lstat(join(projectRoot, 'apps'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects stale candidate and manifest previews before writing a journal', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })
    await writeFile(join(candidateRoot, 'apps/api/main.ts'), 'changed candidate')

    await expect(applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: plan, expectedManifest: beforeManifest, nextManifest: afterManifest })).rejects.toThrow('plan changed')
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(join(projectRoot, '.saasfoundry.json'), 'changed manifest')
    await expect(applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: plan, expectedManifest: beforeManifest, nextManifest: afterManifest })).rejects.toThrow('manifest changed')
  })

  it('treats the manifest rename as committed even when later cleanup work fails', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })

    const result = await applyTechnicalStackTransition({
      projectRoot,
      candidateRoot,
      approvedPlan: plan,
      expectedManifest: beforeManifest,
      nextManifest: afterManifest,
      onPhase: (phase) => {
        if (phase === 'after-manifest') throw new Error('injected post-commit failure')
      }
    })

    expect(result).toMatchObject({ mutated: true, recoveredCommittedTransaction: true })
    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(afterManifest)
    expect(await readFile(join(projectRoot, 'apps/api/main.ts'), 'utf8')).toBe('candidate')
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is idempotent and leaves compatible pre-existing files untouched', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })
    await applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: plan, expectedManifest: beforeManifest, nextManifest: afterManifest })
    const before = await lstat(join(projectRoot, 'apps/api/main.ts'), { bigint: true })
    const secondPlan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })

    const second = await applyTechnicalStackTransition({
      projectRoot,
      candidateRoot,
      approvedPlan: secondPlan,
      expectedManifest: afterManifest,
      nextManifest: afterManifest
    })

    const after = await lstat(join(projectRoot, 'apps/api/main.ts'), { bigint: true })
    expect(second).toMatchObject({ mutated: false, created: [], compatible: ['apps/api/main.ts'] })
    expect([after.dev, after.ino, after.mtimeNs]).toEqual([before.dev, before.ino, before.mtimeNs])
  })

  it('recovers a same-host lock whose owner is proven dead', async () => {
    await writeFile(join(projectRoot, TECHNICAL_TRANSITION_LOCK), `${JSON.stringify({ version: 1, pid: 2_147_483_647, hostname: hostname(), createdAt: '2026-01-01T00:00:00.000Z' })}\n`)

    await expect(recoverTechnicalStackTransition(projectRoot)).resolves.toEqual({ status: 'none', unresolved: [] })
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_LOCK))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_RECOVERY_LOCK))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never removes a lock owned by a live or unverifiable process', async () => {
    const active = `${JSON.stringify({ version: 1, pid: process.pid, hostname: hostname(), createdAt: '2026-01-01T00:00:00.000Z' })}\n`
    await writeFile(join(projectRoot, TECHNICAL_TRANSITION_LOCK), active)

    await expect(recoverTechnicalStackTransition(projectRoot)).rejects.toThrow('cannot be proven dead')
    expect(await readFile(join(projectRoot, TECHNICAL_TRANSITION_LOCK), 'utf8')).toBe(active)
  })

  it('uses the shared agent coordinator lock for manifest changes', async () => {
    const { plan, afterManifest } = await prepared({ 'apps/api/main.ts': 'candidate' })
    await writeFile(join(projectRoot, '.saasfoundry.agents.lock'), 'agent update')

    await expect(applyTechnicalStackTransition({ projectRoot, candidateRoot, approvedPlan: plan, expectedManifest: beforeManifest, nextManifest: afterManifest })).rejects.toThrow(
      'manifest or agent configuration update'
    )
    await expect(lstat(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('trusts only the manifest hash as the recovery commit marker', async () => {
    const root = await lstat(projectRoot, { bigint: true })
    await writeFile(
      join(projectRoot, TECHNICAL_TRANSITION_JOURNAL),
      `${JSON.stringify({
        version: 1,
        sequence: 0,
        transactionId: '00000000-0000-4000-8000-000000000000',
        planFingerprint: 'test',
        state: 'committed',
        root: { dev: String(root.dev), ino: String(root.ino) },
        manifest: { path: '.saasfoundry.json', beforeSha256: sha256(beforeManifest), afterSha256: sha256(Buffer.from('{"version":"after"}\n')) },
        createdFiles: [],
        createdDirectories: []
      })}\n`
    )

    await expect(recoverTechnicalStackTransition(projectRoot)).resolves.toEqual({ status: 'rolled-back', unresolved: [] })
    expect(await readFile(join(projectRoot, '.saasfoundry.json'))).toEqual(beforeManifest)
  })
})
