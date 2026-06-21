"""Guided training modules.

The same operational shell and the deliberately-vulnerable TRN-SANDBOX host are
used at every tier; the only thing that changes with difficulty is how much
guidance is surfaced:

    Easy    -- the exact command for each objective is shown.
    Medium  -- a conceptual hint (the technique, not the keystrokes).
    Hard    -- objectives only; you are on your own.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from . import ui
from .shell import LeaveShell, OperationalShell
from .world import training_network

TARGET = "10.13.37.20"


@dataclass
class Task:
    objective: str
    check: Callable
    command: str       # exact command (Easy)
    hint: str          # conceptual hint (Medium)


def _has_cred(state, user):
    return any(u == user for _, u, _ in state.loot.credentials)


def _has_session(state, ip, user):
    return any(s.host.ip == ip and s.user == user for s in state.sessions)


def _tasks() -> list[Task]:
    return [
        Task(
            "Identify which services the host exposes and their versions.",
            lambda st: 22 in st.scanned.get(TARGET, set()),
            f"nmap -sV {TARGET}",
            "Fingerprint the host with a version scan before anything else.",
        ),
        Task(
            "Recover a valid login for the 'student' service account.",
            lambda st: _has_cred(st, "student"),
            f"hydra -l student -P wordlists/common.txt ssh://{TARGET}",
            "The account uses a weak seasonal password. An online dictionary "
            "attack against SSH will find it.",
        ),
        Task(
            "Use the recovered credential to obtain an interactive foothold.",
            lambda st: _has_session(st, TARGET, "student"),
            f"ssh student@{TARGET}      (password from the previous step)",
            "Log in over SSH as the account whose password you just cracked.",
        ),
        Task(
            "Enumerate the account's sudo rights and abuse them to reach root.",
            lambda st: _has_session(st, TARGET, "root"),
            "sudo -l         then:    sudo find . -exec /bin/bash \\; -quit",
            "Check `sudo -l`. A whitelisted binary that can run other programs "
            "(GTFOBins) is a direct path to a root shell.",
        ),
        Task(
            "Recover the proof artefact from the root account.",
            lambda st: "TRN-SANDBOX" in st.config.get("completed", []),
            "cat /root/flag.txt",
            "Read root's proof file now that you are uid 0.",
        ),
    ]


def _guidance(task: Task, difficulty: str) -> None:
    if difficulty == "easy":
        ui.write(ui.c("    run: ", "grey") + ui.c(task.command, "brightyellow"))
    elif difficulty == "medium":
        ui.write(ui.c("    hint: " + task.hint, "grey"))
    # hard: nothing


def run_training(state, difficulty: str) -> None:
    difficulty = difficulty.lower()
    tier = {"easy": "Easy / Recruit", "medium": "Medium / Operator",
            "hard": "Hard / Specialist"}.get(difficulty, "Easy / Recruit")
    state.load_network(training_network())
    shell = OperationalShell(state)
    tasks = _tasks()
    idx = 0

    ui.clear()
    ui.box("TRAINING MODULE  ::  " + tier, [
        ui.c("Lab host: TRN-SANDBOX-01 (10.13.37.20)", "white"),
        ui.c("This is the live operator shell. Tooling is identical to a real", "grey"),
        ui.c("engagement; objectives below track your progress.", "grey"),
        "",
        ui.c("Type `objective` to repeat the current goal, `back` to leave.", "grey"),
    ], width=66)
    ui.write()

    def show_objective():
        if idx >= len(tasks):
            return
        ui.write(ui.c(f"  OBJECTIVE {idx + 1}/{len(tasks)}: ", "cyan", "bold")
                 + ui.c(tasks[idx].objective, "white"))
        _guidance(tasks[idx], difficulty)
        ui.write()

    show_objective()

    while True:
        if idx >= len(tasks):
            ui.write()
            ui.box("MODULE COMPLETE", [
                ui.c("All objectives met. You chained service discovery, a", "white"),
                ui.c("credential attack, a foothold and a sudo/GTFOBins escalation", "white"),
                ui.c("into full root access -- a complete real-world kill chain.", "white"),
            ], width=66, colour="green")
            best = state.config.get("training_best", "")
            order = {"easy": 1, "medium": 2, "hard": 3}
            if order.get(difficulty, 0) >= order.get(best, 0):
                state.config["training_best"] = difficulty
                from .game import save_config
                save_config(state.config)
            ui.write()
            return

        try:
            raw = input(shell.prompt())
        except (EOFError, KeyboardInterrupt):
            ui.write()
            return
        cmd = raw.strip()
        if cmd in ("objective", "objectives", "goal"):
            show_objective()
            continue
        if cmd in ("hint", "?hint"):
            ui.write(ui.c("    hint: " + tasks[idx].hint, "grey"))
            continue
        try:
            shell.run_line(raw)
        except LeaveShell:
            ui.write(ui.c("leaving training module.", "grey"))
            return

        # advance through any objectives now satisfied
        advanced = False
        while idx < len(tasks) and tasks[idx].check(state):
            ui.write()
            ui.write(ui.c(f"  [✓] objective {idx + 1} complete: ", "brightgreen", "bold")
                     + ui.c(tasks[idx].objective, "green"))
            idx += 1
            advanced = True
        if advanced and idx < len(tasks):
            ui.write()
            show_objective()
