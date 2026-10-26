#!/usr/bin/env python3
"""Drive the real Remy chat in a pseudo-terminal and check what lands on screen.

It types messages, waits for each turn to finish, then replays every byte the chat wrote into a
headless terminal (pyte) to rebuild scrollback plus the final screen. That is what a person
would see, so duplicated replies, tool lines or user messages show up here and not in unit tests.

Needs: python3, `pip install pyte`, and a model key in the environment (never in this file).

  OPENAI_API_KEY=... REMY_PROFILE=openai REMY_MODEL=gpt-5-nano \\
    python3 apps/cli/scripts/pty-smoke.py [--cols 100] [--rows 30] [--turn "message" ...]

Exit code 0 when the checks pass, 1 when they fail.
"""

import argparse
import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time

try:
    import pyte
except ImportError:
    sys.exit("pyte is missing: pip install pyte")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
APPROVAL_KEYS = ("y", "n", "e", "v")
DEFAULT_TURNS = ["hello", "Research what happened to the Golden Hind in 3 bullets"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cols", type=int, default=100)
    ap.add_argument("--rows", type=int, default=30)
    ap.add_argument("--timeout", type=int, default=180, help="seconds to wait per turn")
    ap.add_argument("--turn", action="append", help="a message to send (repeatable)")
    ap.add_argument("--raw", help="write the raw bytes to this file")
    ap.add_argument("--env-file", help="a file with KEY=<openai key>, used when OPENAI_API_KEY is unset")
    args = ap.parse_args()
    turns = args.turn or DEFAULT_TURNS

    if args.env_file and not os.environ.get("OPENAI_API_KEY"):
        for row in open(args.env_file):
            if row.startswith("KEY="):
                os.environ["OPENAI_API_KEY"] = row.strip().split("=", 1)[1]
    if not os.environ.get("OPENAI_API_KEY") and not os.environ.get("OPENROUTER_API_KEY"):
        print("note: no model key in the environment; the chat will refuse to start", file=sys.stderr)

    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))
    home = tempfile.mkdtemp(prefix="remy-smoke-")
    env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", REMY_HOME=home)
    env.setdefault("REMY_PROFILE", "openai")
    env.setdefault("REMY_MODEL", "gpt-5-nano")
    proc = subprocess.Popen(
        ["node", "--conditions=@remy/source", "apps/cli/src/main.ts"],
        cwd=ROOT, env=env, stdin=slave, stdout=slave, stderr=slave, close_fds=True,
    )
    os.close(slave)

    screen = pyte.HistoryScreen(args.cols, args.rows, history=10000, ratio=0.5)
    stream = pyte.ByteStream(screen)
    raw = bytearray()

    def pump(seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([master], [], [], 0.05)
            if not r:
                continue
            try:
                data = os.read(master, 65536)
            except OSError:
                return
            if not data:
                return
            raw.extend(data)
            stream.feed(data)

    def last_line() -> str:
        rows = [l.rstrip() for l in screen.display if l.strip()]
        return rows[-1] if rows else ""

    def wait_for(word: str, timeout: float, *more: str) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            pump(0.2)
            if any(w in last_line() for w in (word, *more)):
                return True
            if proc.poll() is not None:
                return False
        return False

    def send(text: str) -> None:
        for ch in text:
            os.write(master, ch.encode())
            pump(0.01)
        pump(0.1)
        # Approval keys act on their own; Enter after them would only prove it does nothing.
        if text not in APPROVAL_KEYS:
            os.write(master, b"\r")

    ok = wait_for("ready", 30)
    if not ok:
        print("the chat did not become ready; screen:\n" + "\n".join(screen.display))
        proc.kill()
        return 1
    for t in turns:
        send(t)
        pump(1.5)  # let the turn begin
        # A turn is over once the chat waits on the user again.
        if not wait_for("ready", args.timeout, "needs approval", "needs your answer"):
            print(f"timed out waiting for the turn to finish: {t!r}")
            ok = False
            break
        pump(0.3)
    send("/exit")
    pump(2.0)
    if proc.poll() is None:
        proc.terminate()
    pump(0.3)

    if args.raw:
        with open(args.raw, "wb") as f:
            f.write(raw)

    def text(line) -> str:  # a pyte history line is a dict of column -> Char
        if isinstance(line, dict):
            return "".join(line[i].data if i in line else " " for i in range(args.cols)).rstrip()
        return line.rstrip()

    history = [text(l) for l in screen.history.top]
    final = [l.rstrip() for l in screen.display]
    lines = history + final
    while lines and not lines[-1]:
        lines.pop()
    print("\n".join(lines))
    print("\n--- checks ---")

    failures = []
    for t in turns:
        if t in APPROVAL_KEYS:  # approval keys, not chat messages
            continue
        n = sum(1 for l in lines if re.fullmatch(r"\s*› " + re.escape(t), l))
        print(f"user line {t[:30]!r}: {n}")
        if n != 1:
            failures.append(f"user message {t!r} appears {n} times")
    tool_lines = [l.strip() for l in lines if re.match(r"\s*[✓✗–] ", l)]
    dupes = {l for l in tool_lines if tool_lines.count(l) > 1 and "×" not in l}
    print(f"tool lines: {len(tool_lines)}, repeated: {len(dupes)}")
    for d in sorted(dupes):
        failures.append(f"tool line repeated: {d}")
    # A reply bullet must not be printed twice.
    bullets = [l.strip() for l in lines if re.match(r"\s*[•-] .{20,}", l)]
    rep = {b for b in bullets if bullets.count(b) > 1}
    for b in sorted(rep):
        failures.append(f"line repeated: {b[:60]}")
    # The narration row lives in the live area only; it must never reach scrollback.
    narr = re.compile(r"^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏·] .+ · \d+s$")
    stray = [l.strip() for l in history if narr.match(l)]
    print(f"narration rows in scrollback: {len(stray)}")
    for l in stray[:3]:
        failures.append(f"narration in scrollback: {l}")
    plans = sum(1 for l in lines if re.match(r"\s*Plan \d+/\d+", l))
    print(f"plan headers: {plans}")
    for f in failures:
        print("FAIL:", f)
    print("clean" if not failures and ok else "NOT CLEAN")
    return 0 if not failures and ok else 1


if __name__ == "__main__":
    sys.exit(main())
