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
    ap.add_argument("--term", default="xterm-256color", help="TERM for the chat (try dumb)")
    ap.add_argument("--no-reply", action="store_true", help="do not answer the terminal probe")
    ap.add_argument("--unfocus", action="store_true", help="send a focus-out report, then expect a bell at approval")
    ap.add_argument("--editing", action="store_true", help="also try a multi-line message, a bracketed paste and the Ctrl+O view")
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
    env = dict(os.environ, TERM=args.term, COLORTERM="truecolor", REMY_HOME=home)
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
            # Answer the probe like a capable terminal: sync supported, dark background.
            if b"\x1b[?2026$p" in data and not args.no_reply:
                os.write(master, b"\x1b[?2026;2$y\x1b]11;rgb:0f0f/0f0f/1010\x07\x1b[?64c")

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

    approval_screens: list[list[str]] = []
    ok = wait_for("ready", 30)
    if not ok:
        print("the chat did not become ready; screen:\n" + "\n".join(screen.display))
        proc.kill()
        return 1
    if args.unfocus:
        os.write(master, b"\x1b[O")
        pump(0.3)
    for t in turns:
        send(t)
        pump(1.5)  # let the turn begin
        # A turn is over once the chat waits on the user again.
        if not wait_for("ready", args.timeout, "needs approval", "needs your answer"):
            print(f"timed out waiting for the turn to finish: {t!r}")
            ok = False
            break
        pump(0.3)
        if "needs approval" in last_line():
            approval_screens.append([l.rstrip() for l in screen.display if l.strip()])
    editing_shots: dict[str, list[str]] = {}
    editing_turns: list[str] = []
    if args.editing and ok:
        def shot() -> list[str]:
            return [l.rstrip() for l in screen.display if l.strip()]

        # A message of two lines: Ctrl+J is not needed, backslash then Enter is the portable way.
        for part in ("Reply with one word, ok.\\", "\r", "Second line of the same message."):
            os.write(master, part.encode())
            pump(0.2)
        editing_shots["typing"] = shot()
        os.write(master, b"\r")
        pump(1.5)
        ok = wait_for("ready", args.timeout) and ok
        editing_turns.append("Second line of the same message.")
        # A bracketed paste of nine lines: one marker, the real text goes to the model.
        body = "\n".join(["Pasted block, reply with one word ok."] + [f"filler row {i}" for i in range(8)])
        os.write(master, b"\x1b[200~" + body.encode() + b"\x1b[201~")
        pump(0.5)
        editing_shots["paste"] = shot()
        os.write(master, b"\r")
        pump(1.5)
        ok = wait_for("ready", args.timeout) and ok
        # The full view, then everything to scrollback.
        os.write(master, b"\x0f")
        pump(0.6)
        editing_shots["view"] = shot()
        os.write(master, b"[")
        pump(0.8)
        editing_shots["after"] = shot()
    if "needs approval" in last_line():
        # Letters typed now would be approval keys; stop the task first.
        os.write(master, b"\x03")
        pump(1.0)
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
    for n, shot in enumerate(approval_screens, 1):
        print(f"\n--- approval screen {n} ---")
        print("\n".join(shot))
    for name, rows_ in editing_shots.items():
        print(f"\n--- editing screen: {name} ---")
        print("\n".join(rows_))
    print("\n--- checks ---")

    failures = []
    for i, t in enumerate(turns):
        if t in APPROVAL_KEYS or t.startswith("/") or (i and turns[i - 1] == "e"):  # keys and notes, not chat messages
            continue
        n = sum(1 for l in lines if re.fullmatch(r"\s*› " + re.escape(t), l))
        print(f"user line {t[:30]!r}: {n}")
        # `[` in the Ctrl+O view writes the whole conversation to scrollback a second time.
        want = 2 if args.editing else 1
        if n != want:
            failures.append(f"user message {t!r} appears {n} times (expected {want})")
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
    # Terminal manners: frames are wrapped only when the terminal answered the probe.
    begins, ends = raw.count(b"\x1b[?2026h"), raw.count(b"\x1b[?2026l")
    capable = args.term != "dumb" and not args.no_reply
    print(f"sync markers: {begins} begin, {ends} end (expected {'some' if capable else 'none'})")
    if capable and (begins == 0 or abs(begins - ends) > 1):
        failures.append("synchronized output markers missing or unbalanced")
    # Ink brackets some frames itself; our probe's own mode set must not leak when gated off.
    if not capable and (begins or ends):
        failures.append("synchronized output markers sent to a terminal that did not confirm")
    if args.term == "dumb" and (b"\x1b[?1004h" in raw or b"\x1b[?2026$p" in raw):
        failures.append("queries sent to a dumb terminal")
    if args.unfocus:
        rings = raw.count(b"\x07")
        print(f"bells while unfocused: {rings}")
        if approval_screens and rings == 0:
            failures.append("no bell at approval while unfocused")
    # The card lives in the live area: once per approval screen, and never left in scrollback.
    for n, shot in enumerate(approval_screens, 1):
        shown = sum(1 for l in shot if "Approval covers exactly this call" in l)
        print(f"approval screen {n}: card shown {shown} time(s)")
        if shown != 1:
            failures.append(f"approval card shown {shown} times on screen {n}")
    left = sum(1 for l in lines if "Approval covers exactly this call" in l)
    print(f"approval cards left in scrollback: {left}")
    if left:
        failures.append("approval card left in scrollback")
    if args.editing:
        joined = "\n".join(lines)
        if not any("Reply with one word, ok." in l for l in editing_shots.get("typing", [])) or not any(
            "Second line of the same message." in l for l in editing_shots.get("typing", [])
        ):
            failures.append("multi-line message not shown on two rows while typing")
        if not any("[Pasted 9 lines]" in l for l in editing_shots.get("paste", [])):
            failures.append("paste marker missing")
        if any("filler row 3" in l for l in editing_shots.get("paste", [])):
            failures.append("pasted text shown in the prompt")
        if not any("q back" in l for l in editing_shots.get("view", [])):
            failures.append("Ctrl+O view did not open")
        if len(editing_shots.get("view", [])) > args.rows - 1:
            failures.append("the view is as tall as the screen")
        if any("q back" in l for l in editing_shots.get("after", [])):
            failures.append("the view stayed open after [")
        if "Pasted block" not in joined or "[Pasted 9 lines]" in joined and "filler row 7" not in joined:
            print("note: the pasted block is in the transcript as its marker or its text")
        print(f"editing checks done ({len(editing_turns)} multi-line turn)")
    for f in failures:
        print("FAIL:", f)
    print("clean" if not failures and ok else "NOT CLEAN")
    return 0 if not failures and ok else 1


if __name__ == "__main__":
    sys.exit(main())
