"""Core simulation model: virtual filesystems, services and hosts.

These objects are intentionally inert data containers. All behaviour (scanning,
exploiting, privilege escalation) lives in the shell layer which interprets this
data. Keeping the model declarative makes the scenario files in ``world.py`` read
like configuration rather than code.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Virtual filesystem
# ---------------------------------------------------------------------------

class FSNode:
    """A file or directory on a simulated host."""

    def __init__(
        self,
        name: str,
        is_dir: bool,
        owner: str = "root",
        group: str = "root",
        perms: str = "rw-r--r--",
        content: str = "",
        suid: bool = False,
    ):
        self.name = name
        self.is_dir = is_dir
        self.owner = owner
        self.group = group
        self.perms = perms  # 9 chars: owner rwx, group rwx, other rwx
        self.content = content
        self.suid = suid
        self.children: dict[str, "FSNode"] = {}
        self.parent: Optional["FSNode"] = None

    # -- permission helpers (group bits are treated as world for simplicity) --
    def _bit(self, idx_owner: int, idx_other: int, user: str) -> bool:
        if user == "root":
            return True
        if user == self.owner:
            return self.perms[idx_owner] != "-"
        return self.perms[idx_other] != "-"

    def can_read(self, user: str) -> bool:
        return self._bit(0, 6, user)

    def can_write(self, user: str) -> bool:
        return self._bit(1, 7, user)

    def can_exec(self, user: str) -> bool:
        return self._bit(2, 8, user)

    def mode_string(self) -> str:
        return ("d" if self.is_dir else "-") + self.perms

    def add(self, *nodes: "FSNode") -> "FSNode":
        for n in nodes:
            n.parent = self
            self.children[n.name] = n
        return self


def D(name: str, children: Optional[list] = None, owner: str = "root",
      group: str = "root", perms: str = "rwxr-xr-x") -> FSNode:
    node = FSNode(name, True, owner, group, perms)
    if children:
        node.add(*children)
    return node


def F(name: str, content: str = "", owner: str = "root", group: str = "root",
      perms: str = "rw-r--r--", suid: bool = False) -> FSNode:
    return FSNode(name, False, owner, group, perms, content, suid)


def resolve(root: FSNode, cwd: FSNode, path: str, home: str = "/root") -> Optional[FSNode]:
    """Resolve a path string to a node, or ``None`` if it does not exist."""
    if not path:
        return cwd
    if path.startswith("~"):
        path = home + path[1:]
    node = root if path.startswith("/") else cwd
    parts = [p for p in path.split("/") if p not in ("", ".")]
    for part in parts:
        if part == "..":
            node = node.parent or node
            continue
        if not node.is_dir or part not in node.children:
            return None
        node = node.children[part]
    return node


def node_path(node: FSNode) -> str:
    parts = []
    cur: Optional[FSNode] = node
    while cur is not None and cur.parent is not None:
        parts.append(cur.name)
        cur = cur.parent
    return "/" + "/".join(reversed(parts)) if parts else "/"


# ---------------------------------------------------------------------------
# Network services
# ---------------------------------------------------------------------------

@dataclass
class Service:
    port: int
    name: str                       # nmap service name, e.g. "ssh", "http"
    product: str = ""               # e.g. "OpenSSH"
    version: str = ""               # e.g. "8.9p1 Ubuntu"
    banner: str = ""
    proto: str = "tcp"
    state: str = "open"             # open | filtered | closed
    # HTTP specifics ------------------------------------------------------
    web_paths: dict = field(default_factory=dict)   # path -> body
    listed_paths: list = field(default_factory=list)  # discoverable via gobuster
    requires_auth: list = field(default_factory=list)  # paths needing -u creds
    web_creds: dict = field(default_factory=dict)   # user -> password (web login)
    rce_endpoint: str = ""          # path that executes shell when authed (Jenkins-like)
    rce_user: str = ""              # OS user RCE runs as

    def version_str(self) -> str:
        bits = [b for b in (self.product, self.version) if b]
        return " ".join(bits)


@dataclass
class SudoRule:
    runas: str = "root"
    nopasswd: bool = True
    command: str = "ALL"            # binary path or "ALL"


@dataclass
class User:
    name: str
    password: str = ""
    uid: int = 1000
    groups: list = field(default_factory=list)
    home: str = "/home"
    weak_password: bool = False     # discoverable by online brute force
    ssh_key_id: str = ""            # named private key that authenticates this user


class Host:
    def __init__(
        self,
        hostname: str,
        ip: str,
        os_name: str = "Linux",
        services: Optional[dict] = None,
        users: Optional[dict] = None,
        root: Optional[FSNode] = None,
    ):
        self.hostname = hostname
        self.ip = ip
        self.os_name = os_name
        self.services: dict[int, Service] = services or {}
        self.users: dict[str, User] = users or {}
        self.root: FSNode = root or D("/")
        self.sudo_rules: dict[str, list[SudoRule]] = {}
        self.suid_paths: list[str] = []     # absolute paths flagged SUID-root
        self.discovered = False             # has the operator found this host?
        self.notes = ""

    def open_services(self) -> list[Service]:
        return [s for s in sorted(self.services.values(), key=lambda x: x.port)
                if s.state != "closed"]


class Network:
    """A scenario: an attacker foothold plus a set of reachable target hosts."""

    def __init__(self, code: str, title: str, difficulty: str, summary: str,
                 brief: str, hosts: list[Host], objective_host: str,
                 subnet: str = "10.10.10.0/24"):
        self.code = code
        self.title = title
        self.difficulty = difficulty
        self.summary = summary
        self.brief = brief
        self.subnet = subnet
        self.hosts = {h.ip: h for h in hosts}
        self.by_name = {h.hostname.lower(): h for h in hosts}
        self.objective_host = objective_host

    def find(self, target: str) -> Optional[Host]:
        if target in self.hosts:
            return self.hosts[target]
        return self.by_name.get(target.lower())
