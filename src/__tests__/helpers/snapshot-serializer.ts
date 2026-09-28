/**
 * Custom Jest snapshot serializer that normalizes dynamic values
 * (timestamps, JWT secrets, hex hashes) so snapshots stay stable.
 */
export const snapshotSerializer: jest.SnapshotSerializerPlugin = {
  test(val: unknown): boolean {
    return (
      typeof val === 'string' &&
      // ISO timestamps
      (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val) ||
        // Hex strings that look like JWT secrets (64+ chars)
        /[a-f0-9]{64,}/.test(val))
    )
  },
  serialize(val: string): string {
    let normalized = val
    // Normalize ISO timestamps
    normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<<TIMESTAMP>>')
    // Normalize long hex strings (JWT secrets, hashes)
    normalized = normalized.replace(/[a-f0-9]{64,}/g, '<<HEX_SECRET>>')
    return `"${normalized}"`
  }
}
