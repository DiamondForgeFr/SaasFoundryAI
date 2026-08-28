import { labelColumn, projectUrlLines } from '../../../commands/new.summary'
import { ResolvedPorts } from '../../../ports'

/**
 * #585 — the closing summary printed `http://localhost:5173` and `http://localhost:3500`
 * as literals. That was right only because nothing could change those ports; the moment
 * #584 could choose one, the last screen a user reads before opening a browser lied.
 *
 * Every case below uses **non-default** ports, which is the case that was wrong and that
 * nothing exercised.
 */

const moved: ResolvedPorts = {
  db: { port: 5436, movedFrom: 5435 },
  api: { port: 3501, movedFrom: 3500 },
  web: { port: 5174, movedFrom: 5173 }
}

const settled: ResolvedPorts = { db: { port: 5435 }, api: { port: 3500 }, web: { port: 5173 } }

const lines = (overrides: Partial<Parameters<typeof projectUrlLines>[0]> = {}) => projectUrlLines({ ports: moved, s3Setup: 'manual', dbSetup: 'docker', ...overrides })

const find = (label: string, from = lines()) => from.find((l) => l.label === label)

describe('the summary reports the ports that were resolved', () => {
  it('points the app and the API at the ports they actually run on', () => {
    expect(find('Frontend App')?.url).toBe('http://localhost:5174')
    expect(find('Backend API')?.url).toBe('http://localhost:3501')
  })

  it('derives the docs URL from the same API port', () => {
    expect(find('API Documentation')?.url).toBe('http://localhost:3501/api/docs')
  })

  it('never emits a default that was moved away from', () => {
    const urls = lines()
      .map((l) => l.url)
      .join(' ')

    expect(urls).not.toContain('5173')
    expect(urls).not.toContain('3500')
    expect(urls).not.toContain('5435')
  })
})

describe('a port that moved says so', () => {
  it('names the default it was pushed off', () => {
    expect(find('Frontend App')?.note).toBe('5173 was taken')
    expect(find('Backend API')?.note).toBe('3500 was taken')
    expect(find('Database')?.note).toBe('5435 was taken')
  })

  it('says nothing when nothing moved', () => {
    for (const line of lines({ ports: settled })) {
      expect(line.note).toBeUndefined()
    }
  })

  it('does not repeat the move on the docs line — it is the same port, one line up', () => {
    expect(find('API Documentation')?.note).toBeUndefined()
  })
})

describe('the database line', () => {
  it('is shown, which it never was before', () => {
    expect(find('Database')?.url).toBe('postgresql://localhost:5436')
  })

  it('points at the host the project was given, not at localhost by assumption', () => {
    const remote = lines({
      dbSetup: 'credentials',
      dbCredentials: { host: 'db.example.com', port: '6543', user: 'u', password: 'p', database: 'd', dbType: 'postgresql' }
    })

    expect(find('Database', remote)?.url).toBe('postgresql://db.example.com:5436')
  })

  it('is left out for a database the CLI knows nothing about', () => {
    expect(find('Database', lines({ dbSetup: 'manual' }))).toBeUndefined()
  })

  it('uses the scheme of the database that was chosen', () => {
    const sql = lines({ dbCredentials: { host: 'localhost', port: '1433', user: 'u', password: 'p', database: 'd', dbType: 'sql' } })

    expect(find('Database', sql)?.url).toBe('sqlserver://localhost:5436')
  })
})

describe('the optional lines', () => {
  it('shows the MinIO console only when storage runs in docker', () => {
    expect(find('MinIO Console', lines({ s3Setup: 'docker' }))?.url).toBe('http://localhost:9001')
    expect(find('MinIO Console', lines({ s3Setup: 'credentials' }))).toBeUndefined()
  })

  it('shows the board only when a workflow is configured', () => {
    expect(find('Project Board', lines({ projectUrl: 'https://github.com/orgs/x/projects/1' }))?.url).toBe('https://github.com/orgs/x/projects/1?layout=board')
    expect(find('Project Board')).toBeUndefined()
  })
})

describe('the label column', () => {
  it('lines the URLs up against the longest label present', () => {
    const rendered = lines()
    const column = labelColumn(rendered)
    const widths = rendered.map((l) => column(l).length)

    expect(new Set(widths).size).toBe(1)
    expect(column(rendered[0])).toContain('Frontend App:')
  })
})
