import { Client } from 'pg'

import type { LiveSuiteContract } from '../contracts'

export async function queryRows<T extends Record<string, unknown>>(contract: LiveSuiteContract, text: string, values: readonly unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: contract.databaseUrl, statement_timeout: 5_000, query_timeout: 5_000 })
  await client.connect()
  try {
    const result = await client.query<T>(text, [...values])
    return result.rows
  } finally {
    await client.end()
  }
}

export async function expectRowCount(contract: LiveSuiteContract, text: string, values: readonly unknown[], expected: number): Promise<void> {
  const rows = await queryRows<{ count: string }>(contract, text, values)
  const actual = Number(rows[0]?.count ?? Number.NaN)
  if (actual !== expected) throw new Error(`Expected row count ${expected}, received ${String(actual)}.`)
}
