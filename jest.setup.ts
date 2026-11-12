/**
 * Per-project test timeout.
 *
 * Jest's `testTimeout` is a **root-level option only**. A project that declares
 * one gets `Validation Warning: Unknown option "testTimeout"` and silently keeps
 * the 5s default — so a config can look budgeted while none of it applies.
 *
 * That is what happened here: three projects declared `globals: { TEST_TIMEOUT }`,
 * which is a plain global variable Jest never reads as a timeout, and nothing in
 * the codebase read it either. All four projects ran on 5s while the config read
 * as though three of them did not. The `unit` job then went red on unrelated PRs
 * whenever the runner was loaded, because 23 of its specs spawn shells.
 *
 * A setup file is the supported way to vary the timeout per project: each project
 * declares its budget through `globals.TEST_TIMEOUT`, and this applies it. The
 * original intent was right; only the wiring was missing.
 */
import { hermeticPath } from './src/__tests__/helpers/hermetic-path'

/**
 * A hermetic PATH (#1128). Every spec that spreads `process.env` into a child, and every probe that
 * reads `PATH` in-process, used to reach the CLI installed on the machine: a global `saasfoundryai`
 * or `sf` 1.1.0 knows `agents outcome capture` and `status-event`, so the workflow-cli and hook
 * specs ran the developer's real CLI and the capture-probe assertion failed. Each directory that
 * carries one is replaced by a copy without it; `node`, `npm`, `git` and the rest stay. The guard
 * in `src/__tests__/unit/ci/hermetic-path.spec.ts` keeps it that way.
 */
process.env.PATH = hermeticPath(process.env.PATH)

const configured = (globalThis as { TEST_TIMEOUT?: number }).TEST_TIMEOUT

if (typeof configured === 'number') {
  jest.setTimeout(configured)
}
