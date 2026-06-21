"""The meta console: the operator's home prompt.

This is the layer the operator lands in before/after engagements. It exposes the
engagement catalogue, the training modules, settings and progress. Selecting an
engagement drops into the live :class:`OperationalShell`.
"""
from __future__ import annotations

from . import ui
from .game import GameState, save_config
from .shell import LeaveShell, OperationalShell
from .training import run_training
from .world import all_scenarios


class Console:
    def __init__(self, state: GameState):
        self.state = state
        self.scenarios = all_scenarios()
        self.commands = {
            "help": self._help, "?": self._help,
            "scenarios": self._scenarios, "targets": self._scenarios,
            "engagements": self._scenarios, "ls": self._scenarios,
            "brief": self._brief, "info": self._brief,
            "engage": self._engage, "connect": self._engage, "start": self._engage,
            "training": self._training, "train": self._training, "learn": self._training,
            "settings": self._settings, "config": self._settings,
            "status": self._status, "progress": self._status,
            "whoami": self._whoami, "clear": self._clear,
            "exit": self._quit, "quit": self._quit, "logout": self._quit,
        }

    # -- prompt -----------------------------------------------------------
    def prompt(self) -> str:
        op = self.state.operator
        return (ui.c(op, "brightcyan", "bold") + ui.c("@", "grey")
                + ui.c("injectai", "cyan") + ui.c(" > ", "grey"))

    # -- main loop --------------------------------------------------------
    def loop(self) -> None:
        while True:
            try:
                raw = input(self.prompt())
            except EOFError:
                ui.write()
                return
            except KeyboardInterrupt:
                ui.write("\n" + ui.c("(type 'exit' to quit)", "grey"))
                continue
            line = raw.strip()
            if not line:
                continue
            parts = line.split()
            fn = self.commands.get(parts[0].lower())
            if not fn:
                ui.write(ui.c(f"{parts[0]}: unknown command. Type `help`.", "red"))
                continue
            try:
                if fn(parts[1:]) == "QUIT":
                    return
            except LeaveShell:
                pass

    # -- commands ---------------------------------------------------------
    def _help(self, args):
        ui.write()
        rows = [
            ("scenarios", "list available engagements / targets"),
            ("brief <code>", "read the briefing for an engagement"),
            ("engage <code>", "deploy into the engagement's operator shell"),
            ("training [tier]", "guided modules (easy | medium | hard)"),
            ("status", "your progress and recovered objectives"),
            ("settings", "display & interaction preferences"),
            ("clear", "clear the screen"),
            ("exit", "close the console"),
        ]
        for k, v in rows:
            ui.write("  " + ui.c(k.ljust(16), "cyan", "bold") + ui.c(v, "white"))
        ui.write()

    def _scenarios(self, args):
        ui.write()
        ui.write(ui.c("  AVAILABLE ENGAGEMENTS", "cyan", "bold"))
        ui.hr(60)
        completed = self.state.config.get("completed", [])
        for code, net in self.scenarios.items():
            done = ui.c(" [resolved]", "brightgreen") if code in completed else ""
            ui.write("  " + ui.c(code.ljust(12), "brightyellow", "bold")
                     + ui.c(net.difficulty.ljust(24), "grey") + done)
            ui.write("    " + ui.c(net.title, "white"))
            ui.write("    " + ui.c(net.summary, "grey"))
            ui.write()
        ui.write(ui.c("  brief <code> for details, engage <code> to deploy.", "grey"))
        ui.write()

    def _brief(self, args):
        if not args:
            ui.write(ui.c("usage: brief <code>  (see `scenarios`)", "red"))
            return
        net = self.scenarios.get(args[0].upper())
        if not net:
            ui.write(ui.c(f"no engagement '{args[0]}'.", "red"))
            return
        ui.write()
        ui.box(f"{net.code}  ::  {net.difficulty}", [], width=66)
        ui.write(ui.c(net.title, "brightyellow", "bold"))
        ui.write()
        for ln in net.brief.splitlines():
            ui.write("  " + ln)
        ui.write()
        ui.write(ui.c(f"  engage {net.code}   to begin.", "cyan"))
        ui.write()

    def _engage(self, args):
        if not args:
            ui.write(ui.c("usage: engage <code>  (see `scenarios`)", "red"))
            return
        net = self.scenarios.get(args[0].upper())
        if not net:
            ui.write(ui.c(f"no engagement '{args[0]}'.", "red"))
            return
        self.state.load_network(net)
        self._enter_shell(net)

    def _enter_shell(self, net):
        ui.clear()
        ui.box("ENGAGEMENT ACTIVE  ::  " + net.code, [
            ui.c(net.title, "white"),
            ui.c("Scope: " + net.subnet, "grey"),
            "",
            ui.c("Your operator workstation is " + self.state.operator_host.ip + ".", "grey"),
            ui.c("`help` lists tooling, `status` tracks progress, `back` exits.", "grey"),
        ], width=66)
        ui.write()
        if self.state.config.get("hints"):
            ui.write(ui.c("  starting point: in-scope host(s) are reachable; begin "
                          "with recon (nmap).", "grey"))
            ui.write()
        shell = OperationalShell(self.state)
        while True:
            try:
                raw = input(shell.prompt())
            except EOFError:
                ui.write()
                return
            except KeyboardInterrupt:
                ui.write("\n" + ui.c("(type 'back' to return to the console)", "grey"))
                continue
            try:
                shell.run_line(raw)
            except LeaveShell:
                ui.write(ui.c("disengaged. returning to console.", "grey"))
                return

    def _training(self, args):
        tier = args[0].lower() if args else None
        if tier not in ("easy", "medium", "hard"):
            ui.write()
            ui.write(ui.c("  TRAINING MODULES", "cyan", "bold"))
            ui.hr(48)
            ui.write("  " + ui.c("easy".ljust(8), "brightgreen", "bold")
                     + ui.c("full command walkthrough", "white"))
            ui.write("  " + ui.c("medium".ljust(8), "brightyellow", "bold")
                     + ui.c("conceptual hints only", "white"))
            ui.write("  " + ui.c("hard".ljust(8), "brightred", "bold")
                     + ui.c("objectives only -- no guidance", "white"))
            ui.write()
            try:
                tier = input(ui.c("  select tier (easy/medium/hard): ", "cyan")).strip().lower()
            except (EOFError, KeyboardInterrupt):
                ui.write()
                return
            if tier not in ("easy", "medium", "hard"):
                ui.write(ui.c("  cancelled.", "grey"))
                return
        run_training(self.state, tier)

    def _settings(self, args):
        cfg = self.state.config
        if args and len(args) >= 2:
            key, val = args[0].lower(), args[1].lower()
            self._set(key, val)
            return
        ui.write()
        ui.write(ui.c("  SETTINGS", "cyan", "bold"))
        ui.hr(48)
        items = [
            ("colour", cfg.get("colour"), "ANSI colour output"),
            ("typing", cfg.get("typing"), "per-character typing effect"),
            ("speed", cfg.get("speed"), "effect/animation speed multiplier"),
            ("hints", cfg.get("hints"), "inline tactical hints"),
            ("operator", cfg.get("operator"), "operator handle (prompt name)"),
        ]
        for k, v, desc in items:
            ui.write("  " + ui.c(k.ljust(10), "brightyellow")
                     + ui.c(str(v).ljust(10), "white") + ui.c(desc, "grey"))
        ui.write()
        ui.write(ui.c("  change with: settings <key> <value>", "grey"))
        ui.write(ui.c("  e.g. settings typing on   |   settings operator ghost", "grey"))
        ui.write()

    def _set(self, key, val):
        cfg = self.state.config
        bools = {"on": True, "off": False, "true": True, "false": False,
                 "yes": True, "no": False, "1": True, "0": False}
        if key in ("colour", "color", "typing", "hints"):
            k = "colour" if key in ("colour", "color") else key
            if val not in bools:
                ui.write(ui.c("  value must be on/off.", "red")); return
            cfg[k] = bools[val]
        elif key == "speed":
            try:
                cfg["speed"] = max(0.1, float(val))
            except ValueError:
                ui.write(ui.c("  speed must be a number.", "red")); return
        elif key == "operator":
            from .game import build_operator_host
            cfg["operator"] = val
            self.state.operator = val
            self.state.operator_host = build_operator_host(val)
        else:
            ui.write(ui.c(f"  unknown setting '{key}'.", "red")); return
        save_config(cfg)
        # re-apply presentation prefs live
        ui.set_style(ui.Style(cfg.get("colour", True), cfg.get("typing", False),
                              cfg.get("speed", 1.0)))
        ui.write(ui.c(f"  {key} = {val}", "brightgreen"))

    def _status(self, args):
        cfg = self.state.config
        completed = cfg.get("completed", [])
        ui.write()
        ui.box("OPERATOR STATUS", [
            ui.c("handle:        " + self.state.operator, "white"),
            ui.c("training best: " + (cfg.get("training_best") or "none"), "white"),
            ui.c("engagements resolved: %d / %d" % (len(completed), len(self.scenarios)), "white"),
        ], width=60)
        for code, net in self.scenarios.items():
            mark = ui.c("✓", "brightgreen") if code in completed else ui.c("·", "grey")
            ui.write(f"   {mark} {code.ljust(12)} {ui.c(net.title, 'grey')}")
        ui.write()

    def _whoami(self, args):
        ui.write(self.state.operator + "@injectai")

    def _clear(self, args):
        ui.clear()

    def _quit(self, args):
        ui.write(ui.c("session closed.", "grey"))
        return "QUIT"
