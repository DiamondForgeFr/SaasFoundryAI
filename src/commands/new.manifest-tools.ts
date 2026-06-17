import { Answers, SrsToolConfig, ToolsConfig } from '../types'

/**
 * Assemble the manifest `tools` block from the SRS bootstrap result and the
 * tools-first selections (FR-CONFIG-ENGINE-04). Returns `undefined` when no
 * tool is configured so the manifest omits the block entirely — byte-identical
 * to the previous `srsTools ? { srs } : undefined` when no selection was made.
 */
export function buildManifestTools(srsTools: SrsToolConfig | undefined, answers: Answers): ToolsConfig | undefined {
  const tools: ToolsConfig = {}
  if (srsTools) tools.srs = srsTools
  const selections = answers.toolSelections
  if (selections?.tracker?.name) tools.tracker = selections.tracker
  if (selections?.docs?.name) tools.docs = selections.docs
  if (selections?.design?.length) tools.design = selections.design
  return Object.keys(tools).length > 0 ? tools : undefined
}
