#!/usr/bin/env python3
"""Launcher for the injectAI operations console.

    python3 play.py
    python3 play.py engage ORIONBUILD
    python3 play.py training easy

Equivalent to `python3 -m injectai`.
"""
from injectai.app import main

if __name__ == "__main__":
    raise SystemExit(main())
