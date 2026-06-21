"""Runtime state: operator sessions, loot, progress and persisted config."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

from .model import D, F, FSNode, Host, Network, User


CONFIG_DIR = os.path.expanduser("~/.injectai")
CONFIG_PATH = os.path.join(CONFIG_DIR, "state.json")


# ---------------------------------------------------------------------------
# Persisted settings + progress
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "colour": True,
    "typing": False,
    "speed": 1.0,
    "hints": True,
    "operator": "operator",
    "completed": [],          # scenario codes rooted
    "training_best": "",      # hardest training tier cleared
}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH) as fh:
            cfg.update(json.load(fh))
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg: dict) -> None:
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_PATH, "w") as fh:
            json.dump(cfg, fh, indent=2)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Operator foothold (the attacker's own machine)
# ---------------------------------------------------------------------------

def build_operator_host(operator: str) -> Host:
    home = D(operator, owner=operator, group=operator, children=[
        F("README.txt", owner=operator, group=operator, content=(
            "injectAI operator workstation.\n"
            "Recon and tooling run from here. `help` lists available utilities.\n"
            "Loot you recover (keys, credentials) lands in ./loot.\n")),
        D("loot", owner=operator, group=operator),
        D("wordlists", owner=operator, group=operator, children=[
            F("common.txt", owner=operator, group=operator, content=(
                "123456\npassword\nadmin\nletmein\nsummer2023\nwinter2024\n"
                "root\ntoor\nchangeme\nqwerty\nP@ssw0rd\n")),
        ]),
    ])
    root = D("/", [D("home", [home]), D("etc"), D("usr", [D("bin")])])
    host = Host("injectai", "10.10.0.5", "Kali-style operator box", root=root)
    host.users = {operator: User(operator, "", 1000, [operator, "sudo"], f"/home/{operator}")}
    host.discovered = True
    return host


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@dataclass
class Session:
    host: Host
    user: str
    cwd: FSNode
    label: str = "local"   # "local" for the operator box, else how it was obtained

    def home_path(self) -> str:
        u = self.host.users.get(self.user)
        if u:
            return u.home
        return "/root" if self.user == "root" else f"/home/{self.user}"


# ---------------------------------------------------------------------------
# Whole-session game state
# ---------------------------------------------------------------------------

@dataclass
class Loot:
    credentials: list = field(default_factory=list)   # (label, user, secret)
    keys: dict = field(default_factory=dict)          # key_id -> "owner@host"
    files: dict = field(default_factory=dict)         # name -> content

    def add_cred(self, label: str, user: str, secret: str) -> bool:
        item = (label, user, secret)
        if item not in self.credentials:
            self.credentials.append(item)
            return True
        return False

    def add_key(self, key_id: str, owner: str) -> bool:
        if key_id not in self.keys:
            self.keys[key_id] = owner
            return True
        return False


class GameState:
    def __init__(self, config: dict):
        self.config = config
        self.operator = config.get("operator", "operator")
        self.operator_host = build_operator_host(self.operator)
        self.network: Optional[Network] = None
        self.loot = Loot()
        self.discovered_hosts: set[str] = set()
        self.scanned: dict[str, set] = {}        # ip -> set of known ports
        # session stack; bottom is always the operator box
        op_home = self._resolve_home(self.operator_host, self.operator)
        self.sessions: list[Session] = [Session(self.operator_host, self.operator, op_home)]
        # hooks used by the training driver
        self.on_command = None       # callable(cmd_line, state)
        self.objectives_banner = ""  # rendered above the prompt when set

    @staticmethod
    def _resolve_home(host: Host, user: str) -> FSNode:
        from .model import resolve
        u = host.users.get(user)
        home = u.home if u else "/root"
        node = resolve(host.root, host.root, home)
        return node or host.root

    @property
    def session(self) -> Session:
        return self.sessions[-1]

    def push_session(self, host: Host, user: str, label: str) -> None:
        home = self._resolve_home(host, user)
        self.sessions.append(Session(host, user, home, label))

    def pop_session(self) -> bool:
        if len(self.sessions) > 1:
            self.sessions.pop()
            return True
        return False

    def load_network(self, network: Network) -> None:
        self.network = network
        self.loot = Loot()
        self.discovered_hosts = set()
        self.scanned = {}
        op_home = self._resolve_home(self.operator_host, self.operator)
        self.sessions = [Session(self.operator_host, self.operator, op_home)]
        # pre-discover hosts flagged as already known (e.g. given scope)
        for ip, host in network.hosts.items():
            if host.discovered:
                self.discovered_hosts.add(ip)

    def reachable_host(self, target: str) -> Optional[Host]:
        """A host is reachable if it is the operator box or in the loaded net."""
        if target in (self.operator_host.ip, self.operator_host.hostname):
            return self.operator_host
        if not self.network:
            return None
        return self.network.find(target)

    def mark_rooted(self, code: str) -> bool:
        if code not in self.config.get("completed", []):
            self.config.setdefault("completed", []).append(code)
            save_config(self.config)
            return True
        return False
