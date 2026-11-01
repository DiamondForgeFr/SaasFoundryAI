import { FrItem } from '../../types'

/**
 * The fields of an FR that can be amended in place (#945), in the order of the Field/Value table
 * of its page. The references (`urRefs`, `dsRefs`, `tcRefs`) are not among them: they are also
 * listed in the tables of the UR, DS and TC, which an amendment does not reach yet.
 */
export const FR_FIELDS = ['title', 'description', 'priority', 'complexity', 'endpoint', 'requestBody', 'securityRationale', 'acceptanceCriteria', 'validationRules'] as const
export type FrField = (typeof FR_FIELDS)[number]

/**
 * The cells an FR's row shows among `fields`, by column header: its title is the Requirement and
 * its priority the Priority, in the Summary table of its page, the FR table of its version and
 * that of its feature alike. The other fields are listed nowhere but on the FR page.
 *
 * The amended values are asserted whether or not they differ from what the FR page held: the
 * tables are compared with the page they are in, so a write that stopped midway is finished by
 * applying the same patch again.
 */
export function listedCells(fr: FrItem, fields: readonly FrField[]): Record<string, string> {
  const cells: Record<string, string> = {}
  if (fields.includes('title')) cells.Requirement = fr.title
  if (fields.includes('priority')) cells.Priority = fr.priority ?? '—'
  return cells
}
