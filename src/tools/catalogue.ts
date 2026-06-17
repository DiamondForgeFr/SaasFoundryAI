/**
 * Declarative catalogue of the entry-point tools the config engine can wire
 * up, grouped by category. This is the single source of truth consumed by the
 * tools-first step (FR-CONFIG-ENGINE-04): the step renders one selection per
 * category and runs a connection check per chosen tool.
 *
 * The catalogue is intentionally additive and renderer-agnostic — it carries
 * no Inquirer/UI concern, only what a tool *is* and where its credentials live.
 */

export type ToolCategory = 'tracker' | 'docs' | 'design'

export interface ToolDescriptor {
  /** Canonical tool id persisted in the manifest `tools.<category>` registry. */
  name: string
  category: ToolCategory
  /** Human-facing label for selection UIs. */
  displayName: string
  /**
   * Credential bucket under `~/.claude/credentials/<credentialTool>/` — several
   * tools share one bucket (Jira + Confluence → `atlassian`). Left undefined
   * when the tool needs no stored credential:
   *  - `github-projects` authenticates through the `gh` CLI
   *  - `local-markdown` is on-disk, no remote to reach
   */
  credentialTool?: string
}

/**
 * Categories that accept at most one selection. `design` is multi-select; the
 * step enforces single-selection for the categories listed here.
 */
export const SINGLE_SELECT_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>(['tracker', 'docs'])

/**
 * Supported tools. `name` is unique *within* a category but not across them
 * (Notion is both a tracker and a docs backend) — always resolve by
 * `(category, name)` via {@link findTool}.
 *
 * Scope note: ClickUp and other new trackers are deferred — they land with
 * their own tool skills (see Epic exclusions). Connection checks here cover
 * only the tools that already have a credential path or a `gh`/local backend.
 */
export const TOOL_CATALOGUE: readonly ToolDescriptor[] = [
  // ── tracker ──────────────────────────────────────────────────────────────
  { name: 'github-projects', category: 'tracker', displayName: 'GitHub Projects' },
  { name: 'jira', category: 'tracker', displayName: 'Jira (Atlassian)', credentialTool: 'atlassian' },
  { name: 'notion', category: 'tracker', displayName: 'Notion', credentialTool: 'notion' },
  { name: 'linear', category: 'tracker', displayName: 'Linear', credentialTool: 'linear' },
  // ── docs / SRS ───────────────────────────────────────────────────────────
  { name: 'notion', category: 'docs', displayName: 'Notion', credentialTool: 'notion' },
  { name: 'confluence', category: 'docs', displayName: 'Confluence (Atlassian)', credentialTool: 'atlassian' },
  { name: 'local-markdown', category: 'docs', displayName: 'Local markdown (no remote)' },
  // ── design ───────────────────────────────────────────────────────────────
  { name: 'figma', category: 'design', displayName: 'Figma', credentialTool: 'figma' },
  { name: 'miro', category: 'design', displayName: 'Miro', credentialTool: 'miro' }
]

/** All tools in a category, in catalogue (display) order. */
export function toolsByCategory(category: ToolCategory): ToolDescriptor[] {
  return TOOL_CATALOGUE.filter((tool) => tool.category === category)
}

/** Resolve a descriptor by its `(category, name)` pair, or `undefined`. */
export function findTool(category: ToolCategory, name: string): ToolDescriptor | undefined {
  return TOOL_CATALOGUE.find((tool) => tool.category === category && tool.name === name)
}

/** The ordered list of categories the tools-first step walks through. */
export const TOOL_CATEGORIES: readonly ToolCategory[] = ['tracker', 'docs', 'design']
