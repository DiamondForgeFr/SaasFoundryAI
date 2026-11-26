/**
 * The bounds of a synchronous, read-only local probe of the CLI (`git rev-parse`, `git status`, `docker --version`): it
 * answers in milliseconds, and its caller already falls back when it fails. Without a bound, a process that never returns
 * (a stuck git lock, a machine that slept) blocks the CLI for good, and with it the session-start hook that runs
 * `sf status` (#1344). SIGKILL, because a process can ignore SIGTERM and the synchronous call then still waits for it.
 *
 * Network commands (`git push`, `gh`) and installs are not probes: their duration is not bounded here.
 */
export const LOCAL_PROBE_BOUNDS = { timeout: 30_000, killSignal: 'SIGKILL' } as const
