import { migration001 } from './001-add-schema-url'
import { migration002 } from './002-restructure-email'
import type { ManifestMigration } from './types'

/**
 * Ordered registry of every manifest migration shipped by the CLI.
 *
 * To add a new migration:
 * 1. Create `NNN-<name>.ts` in this folder, exporting a `ManifestMigration`
 *    with `from = N - 1`, `to = N`.
 * 2. Append it here in order. The dispatcher validates contiguity at runtime —
 *    a gap or duplicate `to` value throws before any user manifest is touched.
 */
export const manifestMigrations: ManifestMigration[] = [migration001, migration002]
