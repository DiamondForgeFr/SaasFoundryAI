import { Answers } from '../types'

/**
 * Accumulated session state — a partial view of the final validated config.
 * Steps read it to gate applicability and compute defaults; the session owns
 * all mutations.
 */
export type ConfigState = Partial<Answers>

/**
 * The single object handed to the execution phase (builders / installers /
 * runners). Collection produces it, execution consumes it — nothing prompts
 * past this boundary.
 */
export type ValidatedConfig = Answers

export interface FieldChoice {
  name: string
  value: unknown
  checked?: boolean
}

/**
 * Renderer-agnostic question description. Structurally compatible with
 * Inquirer's question shape so existing prompts move verbatim, but steps never
 * import Inquirer — only a renderer knows how to materialise a field.
 */
export interface FieldDefinition {
  type: 'input' | 'list' | 'confirm' | 'checkbox' | 'password'
  name: string
  message: string
  choices?: FieldChoice[]
  default?: unknown
  validate?: (input: string) => boolean | string
  when?: (current: ConfigState) => boolean
}

/**
 * Values derived from earlier answers and exposed to downstream steps, so the
 * same question is never asked twice. Rules live in `derivations.ts`.
 */
export interface DerivedContext {
  /** Workflow tool driving downstream behaviour (`'none'` when no workflow was configured). */
  workflowTool?: string
  /** Advanced skills to pre-select based on the chosen workflow tool and design tools. */
  suggestedSkills?: string[]
  /** Tracker chosen in the tools-first step — drives the workflow step (no re-ask). */
  selectedTracker?: string
  /** Docs/SRS backend chosen in the tools-first step. */
  selectedDocs?: string
  /** Design tools chosen in the tools-first step. */
  selectedDesign?: string[]
}

export interface SessionContext {
  prefill: ConfigState
  nonInteractive: boolean
  derived: DerivedContext
}

export interface StepContext extends SessionContext {
  state: ConfigState
  /**
   * Render fields through the session renderer with the accumulated state
   * merged into the prefill. Returns whatever the renderer collected — the
   * step decides what gets merged into the session state.
   */
  render: (fields: FieldDefinition[]) => Promise<ConfigState>
}

/** One recap line — a decision the user (or a flag) made during the session. */
export interface RecapDecision {
  stepId: string
  name: string
  value: unknown
}

export interface StepDefinition {
  id: string
  title: string
  /**
   * External side effects this step may trigger (browser opens, GitHub API
   * calls, …). Documentation for renderers and future cleanup work — the
   * engine does not interpret it.
   */
  effects?: string[]
  /** Skip the whole step when this returns false. Defaults to applicable. */
  appliesTo?: (state: ConfigState, ctx: SessionContext) => boolean
  /** Declarative questions rendered by the session before `collect` runs. */
  fields?: FieldDefinition[]
  /** Imperative collection for flows that need branching or wrapped legacy prompts. */
  collect?: (ctx: StepContext) => Promise<ConfigState>
  /** Override the recap entries for this step (defaults to collected field values). */
  decisions?: (collected: ConfigState, state: ConfigState) => RecapDecision[]
}

/**
 * A renderer materialises fields for one medium (Inquirer today; TUI stepper
 * and web GUI are future renderers on the same step definitions).
 */
export interface Renderer {
  render: (fields: FieldDefinition[], options: { prefill: ConfigState; nonInteractive: boolean }) => Promise<ConfigState>
}
