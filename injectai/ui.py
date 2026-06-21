"""Terminal presentation helpers: colour, typed output, banners and boxes.

Nothing in here knows anything about the simulation; it only deals with how
text is rendered to the operator's screen.
"""
from __future__ import annotations

import os
import sys
import time

# ---------------------------------------------------------------------------
# ANSI colour handling
# ---------------------------------------------------------------------------

_CODES = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "italic": "\033[3m",
    "underline": "\033[4m",
    "black": "\033[30m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "magenta": "\033[35m",
    "cyan": "\033[36m",
    "white": "\033[37m",
    "grey": "\033[90m",
    "brightred": "\033[91m",
    "brightgreen": "\033[92m",
    "brightyellow": "\033[93m",
    "brightblue": "\033[94m",
    "brightcyan": "\033[96m",
}


class Style:
    """Holds the runtime presentation preferences."""

    def __init__(self, colour: bool = True, typing: bool = False, speed: float = 1.0):
        self.colour = colour and _supports_colour()
        self.typing = typing
        self.speed = speed  # multiplier; higher == faster

    def c(self, text: str, *names: str) -> str:
        if not self.colour or not names:
            return text
        prefix = "".join(_CODES.get(n, "") for n in names)
        return f"{prefix}{text}{_CODES['reset']}"


def _supports_colour() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("INJECTAI_FORCE_COLOR"):
        return True
    return sys.stdout.isatty()


# A module level default so simple call sites do not have to thread Style
# everywhere. The console replaces this with the user-configured instance.
STYLE = Style()


def set_style(style: Style) -> None:
    global STYLE
    STYLE = style


# ---------------------------------------------------------------------------
# Output primitives
# ---------------------------------------------------------------------------

def write(text: str = "", end: str = "\n", typed: bool | None = None) -> None:
    """Write text to the screen, optionally with a per-character typing effect."""
    use_typed = STYLE.typing if typed is None else typed
    if use_typed and STYLE.speed > 0 and sys.stdout.isatty():
        delay = 0.006 / max(STYLE.speed, 0.1)
        for ch in text:
            sys.stdout.write(ch)
            sys.stdout.flush()
            if ch not in " \t":
                time.sleep(delay)
        sys.stdout.write(end)
    else:
        sys.stdout.write(text + end)
    sys.stdout.flush()


def c(text: str, *names: str) -> str:
    return STYLE.c(text, *names)


def hr(width: int = 64, ch: str = "─") -> None:
    write(c(ch * width, "grey"))


def box(title: str, lines: list[str], width: int = 64, colour: str = "cyan") -> None:
    top = "┌" + "─" * (width - 2) + "┐"
    bottom = "└" + "─" * (width - 2) + "┘"
    write(c(top, colour))
    if title:
        write(c("│ ", colour) + c(title.ljust(width - 4), "bold") + c(" │", colour))
        write(c("├" + "─" * (width - 2) + "┤", colour))
    for ln in lines:
        # strip ANSI for length accounting is overkill; assume caller passes plain
        visible = _visible_len(ln)
        pad = max(0, width - 4 - visible)
        write(c("│ ", colour) + ln + " " * pad + c(" │", colour))
    write(c(bottom, colour))


def _visible_len(text: str) -> int:
    out = 0
    i = 0
    while i < len(text):
        if text[i] == "\033":
            while i < len(text) and text[i] != "m":
                i += 1
            i += 1
            continue
        out += 1
        i += 1
    return out


def clear() -> None:
    if sys.stdout.isatty():
        os.system("clear" if os.name != "nt" else "cls")
    else:
        write("\n" * 3)


def progress(label: str, steps: int = 20, total_time: float = 0.6) -> None:
    """A short faux progress bar used for scans and exploit launches."""
    if not sys.stdout.isatty():
        write(f"{label} ... done")
        return
    delay = total_time / max(steps, 1) / max(STYLE.speed, 0.1)
    for i in range(steps + 1):
        filled = int((i / steps) * 24)
        bar = "█" * filled + "·" * (24 - filled)
        pct = int((i / steps) * 100)
        sys.stdout.write(f"\r{label} [{c(bar, 'green')}] {pct:3d}%")
        sys.stdout.flush()
        time.sleep(delay)
    sys.stdout.write("\n")
    sys.stdout.flush()
