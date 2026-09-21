import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export type LifecyclePhase = 'creation' | 'before-update' | 'after-update'

export type LifecycleFailureCode =
  | 'aborted'
  | 'artifact-limit'
  | 'artifact-unsafe'
  | 'browser'
  | 'database'
  | 'deadline'
  | 'fatal-log'
  | 'install'
  | 'network'
  | 'output-limit'
  | 'process-exit'
  | 'process-spawn'
  | 'readiness'
  | 'teardown'

export type LifecycleStream = 'stdout' | 'stderr'

export interface LifecycleFatalEvent {
  process: string
  stream: LifecycleStream
  pattern: string
  line: string
  observedAt: string
}

export interface SupervisedCommandSpec {
  /** Diagnostic label only. It is never interpreted as an executable or path. */
  label: string
  executable: string
  /** Literal argv. The process supervisor never invokes a shell. */
  args: readonly string[]
  /** Optional bounded stdin payload, written directly without shell interpolation. */
  stdin?: string | Buffer
  cwd: string
  /** Explicit child-only values. These are allowed in addition to inheritedEnvironment. */
  env?: Readonly<NodeJS.ProcessEnv>
  /** Ambient keys which may be copied into the child. Defaults to a small portability allowlist. */
  inheritedEnvironment?: readonly string[]
  deadline: number
  signal?: AbortSignal
  maxOutputBytes?: number
  termGraceMs?: number
  killGraceMs?: number
  verificationTimeoutMs?: number
  /** Ports which must be closed after stop. */
  ports?: readonly number[]
  /** Narrow, caller-owned fatal log expressions. Matches stop the complete process group. */
  fatalPatterns?: readonly RegExp[]
  secrets?: readonly string[]
}

export interface SupervisedProcessResult {
  label: string
  pid: number
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  outputBytes: number
  outputTruncated: boolean
  fatalEvents: readonly LifecycleFatalEvent[]
  startedAt: string
  finishedAt: string
}

export interface SupervisedProcessHandle {
  readonly label: string
  readonly pid: number
  readonly child: ChildProcessWithoutNullStreams
  /** Resolves only after the child's close event. It never hides a non-zero exit. */
  readonly exited: Promise<SupervisedProcessResult>
  /** Wait for ordinary completion and reject on non-zero exit, abort, deadline, output cap, or fatal output. */
  wait(): Promise<SupervisedProcessResult>
  /** Idempotently stop the full process tree and verify process and listener release. */
  stop(primaryFailure?: unknown): Promise<SupervisedProcessResult>
}

export type ArtifactSensitivity = 'diagnostic' | 'browser-capture'

export interface LifecycleArtifactDescriptor {
  path: string
  bytes: number
  sha256: string
  mediaType: string
  sensitivity: ArtifactSensitivity
}

export interface LifecycleArtifactLimits {
  maxFiles: number
  maxFileBytes: number
  maxAggregateBytes: number
}

export interface ArtifactWriteOptions {
  mediaType: string
  sensitivity?: ArtifactSensitivity
}

export interface LifecycleArtifactSink {
  readonly root: string
  writeText(path: string, value: string, options?: Partial<ArtifactWriteOptions>): Promise<LifecycleArtifactDescriptor>
  writeBinary(path: string, value: Buffer, options: ArtifactWriteOptions): Promise<LifecycleArtifactDescriptor>
  descriptors(): readonly LifecycleArtifactDescriptor[]
  writeManifest(): Promise<LifecycleArtifactDescriptor>
}

export class LifecycleRuntimeError extends Error {
  constructor(
    readonly code: LifecycleFailureCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message)
    this.name = 'LifecycleRuntimeError'
    if (options && 'cause' in options) (this as Error & { cause?: unknown }).cause = options.cause
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function combinePrimaryAndCleanup(primary: unknown, cleanup: unknown, message = 'Lifecycle operation and cleanup both failed.'): Error {
  if (primary === undefined) return cleanup instanceof Error ? cleanup : new Error(String(cleanup))
  return new AggregateError([primary, cleanup], message)
}
