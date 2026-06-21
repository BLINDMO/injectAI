"""Application entry point: boot sequence and console launch."""
from __future__ import annotations

import sys
import time

from . import ui
from .console import Console
from .game import GameState, load_config


BANNER = r"""
   _      _           _      _    ___
  (_)__  (_)__ ____  / /_   / |  /  _/
 / / _ \/ / -_) __/ /_  _/ /  _|_/ /
/_/_//_/_/\__/\__/   /_/  /_/ |_/___/
"""


def _boot(cfg):
    ui.clear()
    ui.write(ui.c(BANNER, "brightcyan"))
    ui.write(ui.c("  injectAI  ", "brightcyan", "bold")
             + ui.c("offensive security operations console", "grey"))
    ui.write(ui.c("  ────────────────────────────────────────────────", "grey"))
    seq = [
        "loading tooling profiles",
        "mounting engagement catalogue",
        "initialising virtual network fabric",
        "operator workstation online",
    ]
    fast = not sys.stdout.isatty() or cfg.get("speed", 1.0) >= 4
    for line in seq:
        if fast:
            ui.write(ui.c("  [ok] ", "brightgreen") + ui.c(line, "grey"))
        else:
            ui.write(ui.c("  [..] ", "yellow") + ui.c(line, "grey"), end="")
            time.sleep(0.18 / max(cfg.get("speed", 1.0), 0.1))
            ui.write("\r" + ui.c("  [ok] ", "brightgreen") + ui.c(line, "grey"))
    ui.write()
    ui.write(ui.c("  Authorised simulation environment. No real systems are", "grey"))
    ui.write(ui.c("  contacted. Type `help` to begin, `scenarios` to list targets.", "grey"))
    ui.write()


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cfg = load_config()
    if "--no-color" in argv:
        cfg["colour"] = False
    ui.set_style(ui.Style(cfg.get("colour", True), cfg.get("typing", False),
                          cfg.get("speed", 1.0)))
    state = GameState(cfg)

    _boot(cfg)
    console = Console(state)

    # allow `injectai engage ORIONBUILD` style direct launch
    if argv:
        a0 = argv[0].lower()
        if a0 in ("engage", "connect", "brief", "training", "scenarios"):
            try:
                console.commands[a0](argv[1:])
            except Exception:
                pass

    try:
        console.loop()
    except (KeyboardInterrupt, EOFError):
        ui.write()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
