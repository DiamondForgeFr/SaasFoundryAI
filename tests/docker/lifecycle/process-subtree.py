#!/usr/bin/env python3
"""Linux child subreaper used by the lifecycle process supervisor."""

from __future__ import annotations

import ctypes
import errno
import os
import signal
import subprocess
import sys
import time


PR_SET_CHILD_SUBREAPER = 36
POLL_SECONDS = 0.01


def fail(message: str, status: int = 125) -> "None":
    print(f"lifecycle subreaper: {message}", file=sys.stderr, flush=True)
    raise SystemExit(status)


def enable_subreaper() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        code = ctypes.get_errno()
        fail(f"prctl(PR_SET_CHILD_SUBREAPER) failed: {os.strerror(code)}")


def direct_children(pid: int) -> list[int]:
    try:
        with open(f"/proc/{pid}/task/{pid}/children", encoding="ascii") as stream:
            return [int(value) for value in stream.read().split()]
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as error:
        fail(f"could not inspect /proc descendants: {error}")


def descendants(root: int) -> list[int]:
    found: list[int] = []
    pending = direct_children(root)
    seen: set[int] = set()
    while pending:
        pid = pending.pop()
        if pid in seen:
            continue
        seen.add(pid)
        found.append(pid)
        pending.extend(direct_children(pid))
    return found


def signal_descendants(pids: list[int], requested: int) -> None:
    for pid in reversed(pids):
        try:
            os.kill(pid, requested)
        except ProcessLookupError:
            pass
        except PermissionError as error:
            fail(f"could not signal descendant {pid}: {error}")


def reap_adopted_children() -> None:
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


def exit_like_child(returncode: int) -> "None":
    if returncode >= 0:
        raise SystemExit(min(returncode, 255))
    requested = -returncode
    if requested not in (signal.SIGKILL, signal.SIGSTOP):
        signal.signal(requested, signal.SIG_DFL)
    os.kill(os.getpid(), requested)
    raise SystemExit(128 + requested)


def main() -> None:
    if len(sys.argv) < 3:
        fail("expected TERM grace milliseconds and a command argv")
    try:
        grace_seconds = max(0.01, int(sys.argv[1]) / 1000)
    except ValueError:
        fail("TERM grace must be an integer")

    enable_subreaper()
    requested_signal = 0
    force_kill = False

    def request_shutdown(signum: int, _frame: object) -> None:
        nonlocal requested_signal
        if requested_signal == 0:
            requested_signal = signum

    def request_kill(_signum: int, _frame: object) -> None:
        nonlocal requested_signal, force_kill
        requested_signal = signal.SIGKILL
        force_kill = True

    for handled in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(handled, request_shutdown)
    signal.signal(signal.SIGUSR1, request_kill)

    try:
        child = subprocess.Popen(sys.argv[2:])
    except OSError as error:
        if error.errno == errno.ENOENT:
            fail(f"command not found: {sys.argv[2]}", 127)
        fail(f"command spawn failed: {error}", 126)

    child_returncode: int | None = None
    cleanup_started: float | None = None
    escalated = False

    while True:
        if child_returncode is None:
            child_returncode = child.poll()
        if child_returncode is not None:
            reap_adopted_children()

        remaining = descendants(os.getpid())
        should_cleanup = requested_signal != 0 or child_returncode is not None
        if should_cleanup and remaining and force_kill:
            escalated = True
            signal_descendants(remaining, signal.SIGKILL)
        elif should_cleanup and remaining and cleanup_started is None:
            cleanup_started = time.monotonic()
            signal_descendants(remaining, signal.SIGTERM)
        elif should_cleanup and remaining and not escalated and cleanup_started is not None and time.monotonic() - cleanup_started >= grace_seconds:
            escalated = True
            signal_descendants(remaining, signal.SIGKILL)
        elif should_cleanup and remaining and escalated:
            signal_descendants(remaining, signal.SIGKILL)

        if child_returncode is not None and not remaining:
            reap_adopted_children()
            if not descendants(os.getpid()):
                exit_like_child(child_returncode)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
