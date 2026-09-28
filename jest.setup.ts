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
const configured = (globalThis as { TEST_TIMEOUT?: number }).TEST_TIMEOUT

if (typeof configured === 'number') {
  jest.setTimeout(configured)
}
