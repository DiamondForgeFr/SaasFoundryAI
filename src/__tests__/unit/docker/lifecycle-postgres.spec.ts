import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { startPrivatePostgres, type LifecycleProcessApi } from '../../../../tests/docker/lifecycle/postgres'
import type { SupervisedCommandSpec, SupervisedProcessHandle, SupervisedProcessResult } from '../../../../tests/docker/lifecycle/types'

function result(label: string, stdout = ''): SupervisedProcessResult {
  return { label, pid: 42, status: 0, signal: null, stdout, stderr: '', outputBytes: 0, outputTruncated: false, fatalEvents: [], startedAt: '', finishedAt: '' }
}

describe('private lifecycle PostgreSQL', () => {
  it('initializes and serves one loopback-only cluster through literal argv', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sf-postgres-test-'))
    const specs: SupervisedCommandSpec[] = []
    let stopped = 0
    const api: LifecycleProcessApi = {
      run: jest.fn(async (spec) => {
        specs.push(spec)
        return result(spec.label, spec.label === 'verify' ? 'ok\n' : '')
      }),
      start: jest.fn(async (spec) => {
        specs.push(spec)
        return {
          label: spec.label,
          pid: 42,
          child: {} as never,
          exited: new Promise(() => undefined),
          wait: async () => result(spec.label),
          stop: async () => {
            stopped += 1
            return result(spec.label)
          }
        } satisfies SupervisedProcessHandle
      })
    }
    try {
      const postgres = await startPrivatePostgres({ workspace, deadline: Date.now() + 10_000, port: 55439, bindir: '/pg/bin', osUser: null, processApi: api })
      expect(postgres.databaseUrl).toBe('postgresql://sf_lifecycle@127.0.0.1:55439/sf_lifecycle')
      await postgres.executeSql('select 1;', 'verify')
      const sqlFile = join(workspace, 'fixture.sql')
      await writeFile(sqlFile, 'select 2;\n')
      await postgres.runSqlFile(sqlFile, 'fixture file')
      await postgres.stop()

      expect(specs.find((spec) => spec.label === 'private postgres')).toMatchObject({
        executable: '/pg/bin/postgres',
        args: expect.arrayContaining(['-h', '127.0.0.1', '-p', '55439']),
        ports: [55439]
      })
      expect(specs.find((spec) => spec.label === 'postgres initdb')?.args).toContain('--auth-host=trust')
      expect(specs.find((spec) => spec.label === 'verify')?.args).toEqual(['-v', 'ON_ERROR_STOP=1', '-At', '-d', postgres.databaseUrl, '-c', 'select 1;'])
      expect(specs.find((spec) => spec.label === 'fixture file')).toMatchObject({
        args: ['-v', 'ON_ERROR_STOP=1', '-d', postgres.databaseUrl, '-f', '-'],
        stdin: Buffer.from('select 2;\n')
      })
      expect(stopped).toBe(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
