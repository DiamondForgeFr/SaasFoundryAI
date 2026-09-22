import { parseLiveSuiteContract } from '../../../../tests/docker/e2e/contracts'

function contract(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    topology: 'monorepo',
    phase: 'creation',
    depth: 'smoke',
    projectRoot: '/tmp/project',
    webUrl: 'http://127.0.0.1:5173',
    apiUrl: 'http://localhost:3500',
    databaseUrl: 'postgresql://user:password@127.0.0.1:55432/database',
    mailboxUrl: 'http://127.0.0.1:54321',
    mailboxCapability: 'a'.repeat(64),
    outputDir: '/tmp/results',
    resultPath: '/tmp/results/result.json',
    deadline: Date.now() + 60_000,
    ...overrides
  })
}

describe('live generated-product contract', () => {
  it('accepts only the versioned loopback contract and freezes it', () => {
    const parsed = parseLiveSuiteContract(contract())

    expect(parsed).toMatchObject({ schemaVersion: 1, topology: 'monorepo', phase: 'creation', depth: 'smoke' })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it.each([
    [{ schemaVersion: 2 }, /schemaVersion/],
    [{ apiUrl: 'http://api.example.com' }, /loopback/],
    [{ apiUrl: 'http://127.attacker.example' }, /loopback/],
    [{ databaseUrl: 'postgresql://user:password@127.attacker.example/database' }, /loopback/],
    [{ webUrl: 'http://user:password@127.0.0.1:5173' }, /credentials/],
    [{ databaseUrl: 'postgresql://db.example.com/database' }, /loopback/],
    [{ resultPath: '/tmp/escaped.json' }, /inside outputDir/],
    [{ mailboxCapability: 'short' }, /at least 32/],
    [{ deadline: Date.now() - 1 }, /future Unix timestamp/]
  ])('rejects an unsafe contract fragment', (overrides, expected) => {
    expect(() => parseLiveSuiteContract(contract(overrides))).toThrow(expected)
  })
})
