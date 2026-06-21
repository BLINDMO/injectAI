"""The operational shell: the attacker-style command line the operator drives.

This interprets the declarative model in :mod:`model`/:mod:`world` to simulate
reconnaissance, exploitation and privilege escalation. Tool output mimics the
real utilities (nmap, curl, gobuster, hydra, ssh, sudo) closely enough to teach
the workflow without ever touching a real network.
"""
from __future__ import annotations

import shlex

from . import ui
from .game import GameState
from .model import Host, Service, node_path, resolve

# Passwords the simulated online brute-force will actually try.
_BRUTE_WORDLIST = [
    "123456", "password", "admin", "letmein", "summer2023", "winter2024",
    "root", "toor", "changeme", "qwerty", "P@ssw0rd", "Relay!ng-Ph4ros",
]


class LeaveShell(Exception):
    """Raised to return control to the meta console."""


class OperationalShell:
    def __init__(self, state: GameState):
        self.state = state
        self._cap: list[str] | None = None
        self.commands = {
            "help": self._help, "?": self._help, "man": self._man,
            "clear": self._clear, "back": self._back, "exit": self._exit,
            "loot": self._loot, "status": self._status, "sessions": self._sessions,
            # local recon / shell
            "whoami": self._whoami, "id": self._id, "hostname": self._hostname,
            "pwd": self._pwd, "ls": self._ls, "cd": self._cd, "cat": self._cat,
            "echo": self._echo, "find": self._find, "grep": self._grep,
            "ifconfig": self._ifconfig, "ip": self._ifconfig, "netstat": self._netstat,
            # network tooling
            "nmap": self._nmap, "ping": self._ping, "curl": self._curl,
            "wget": self._curl, "gobuster": self._gobuster, "dirb": self._gobuster,
            "searchsploit": self._searchsploit, "hydra": self._hydra,
            "ftp": self._ftp, "ssh": self._ssh, "sudo": self._sudo,
        }

    # -- output sink ------------------------------------------------------
    def emit(self, text: str = "") -> None:
        if self._cap is not None:
            self._cap.append(text)
        else:
            ui.write(text)

    # -- prompt -----------------------------------------------------------
    def prompt(self) -> str:
        s = self.state.session
        user, host = s.user, s.host
        cwd = node_path(s.cwd)
        home = s.home_path()
        if cwd == home:
            cwd = "~"
        elif cwd.startswith(home + "/"):
            cwd = "~" + cwd[len(home):]
        is_root = user == "root"
        usercol = "brightred" if is_root else "brightblue"
        sym = "#" if is_root else "$"
        line1 = (ui.c("┌──(", "grey") + ui.c(user, usercol, "bold") +
                 ui.c("㉿", "grey") + ui.c(host.hostname, "brightgreen") +
                 ui.c(")-[", "grey") + ui.c(cwd, "white") + ui.c("]", "grey"))
        line2 = ui.c("└─", "grey") + ui.c(sym + " ", usercol, "bold")
        return line1 + "\n" + line2

    # -- dispatch ---------------------------------------------------------
    def run_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        if self.state.on_command:
            # training hook observes raw input before execution
            try:
                self.state.on_command(line, self.state)
            except Exception:
                pass
        try:
            parts = shlex.split(line)
        except ValueError:
            self.emit("syntax error: unbalanced quotes")
            return
        name, args = parts[0], parts[1:]
        fn = self.commands.get(name)
        if not fn:
            self.emit(f"{name}: command not found")
            return
        fn(args, line)

    def _exec_capture(self, host: Host, user: str, command: str) -> str:
        """Run a restricted command as ``user`` on ``host`` and capture output.

        Used to model remote code execution: the attacker controls a command
        line that runs in the target's context. Only read-style commands are
        honoured to keep the simulation bounded.
        """
        from .game import GameState as _GS  # local import avoids cycle at top
        sub = OperationalShell(self.state)
        sub._cap = []
        # temporary session for the RCE context
        home = self.state._resolve_home(host, user)
        from .game import Session
        sub.state = self.state
        saved = self.state.sessions
        self.state.sessions = saved + [Session(host, user, home, "rce")]
        allowed = {"cat", "ls", "id", "whoami", "pwd", "echo", "find", "hostname"}
        try:
            name = (shlex.split(command) or [""])[0]
            if name not in allowed:
                sub.emit(f"{name}: not permitted in this execution context")
            else:
                sub.run_line(command)
        finally:
            self.state.sessions = saved
        return "\n".join(sub._cap)

    # ===================================================================
    # meta / help
    # ===================================================================
    def _help(self, args, line):
        rows = [
            ("Recon", "nmap, ping, ifconfig, netstat"),
            ("Web", "curl, wget, gobuster/dirb"),
            ("Intel", "searchsploit, man <tool>"),
            ("Access", "hydra, ftp, ssh"),
            ("Local", "ls cd cat pwd whoami id find grep echo sudo"),
            ("Session", "loot, status, sessions, clear, back/exit"),
        ]
        ui.write()
        for k, v in rows:
            self.emit("  " + ui.c(k.ljust(9), "cyan", "bold") + ui.c(v, "white"))
        self.emit("")
        self.emit(ui.c("  man <tool> shows usage. `back` returns to the console.", "grey"))
        self.emit("")

    def _man(self, args, line):
        pages = {
            "nmap": "nmap [-sV] [-p-] <host>      port/service discovery",
            "curl": "curl [-u u:p] [-d data] <url>   HTTP/FTP client",
            "gobuster": "gobuster dir -u <url>        content/path discovery",
            "hydra": "hydra -l <user> -P <list> ssh://<host>   online password attack",
            "ssh": "ssh [-i <keyid>] <user>@<host>   remote login",
            "ftp": "ftp <host>                   inspect an FTP service",
            "sudo": "sudo -l ; sudo <command>     run as another user",
            "searchsploit": "searchsploit <term>          search local exploit notes",
        }
        if not args:
            self.emit("usage: man <tool>; pages: " + ", ".join(sorted(pages)))
            return
        self.emit(pages.get(args[0], f"No manual entry for {args[0]}"))

    def _clear(self, args, line):
        ui.clear()

    def _back(self, args, line):
        raise LeaveShell()

    def _exit(self, args, line):
        if self.state.pop_session():
            self.emit(ui.c("logout", "grey"))
        else:
            raise LeaveShell()

    def _sessions(self, args, line):
        self.emit(ui.c("active sessions (most recent last):", "cyan"))
        for i, s in enumerate(self.state.sessions):
            tag = "local" if i == 0 else s.label
            self.emit(f"  [{i}] {s.user}@{s.host.hostname}  ({tag})")

    def _loot(self, args, line):
        loot = self.state.loot
        if not (loot.credentials or loot.keys):
            self.emit(ui.c("loot store empty.", "grey"))
            return
        if loot.credentials:
            self.emit(ui.c("credentials:", "cyan", "bold"))
            for label, user, secret in loot.credentials:
                self.emit(f"  {label}: {ui.c(user, 'yellow')} / {ui.c(secret, 'yellow')}")
        if loot.keys:
            self.emit(ui.c("private keys:", "cyan", "bold"))
            for kid, owner in loot.keys.items():
                self.emit(f"  {ui.c(kid, 'yellow')}  ({owner})  -> ssh -i {kid} {owner}")

    def _status(self, args, line):
        net = self.state.network
        self.emit(ui.c(f"engagement: {net.title if net else '-'}  [{net.difficulty if net else ''}]", "cyan"))
        self.emit("discovered hosts:")
        for ip in sorted(self.state.discovered_hosts):
            h = self.state.reachable_host(ip)
            ports = sorted(self.state.scanned.get(ip, []))
            pinfo = ",".join(str(p) for p in ports) if ports else "unscanned"
            self.emit(f"  {ip:<15} {h.hostname if h else '?':<28} [{pinfo}]")

    # ===================================================================
    # local shell builtins
    # ===================================================================
    def _whoami(self, args, line):
        self.emit(self.state.session.user)

    def _id(self, args, line):
        s = self.state.session
        u = s.host.users.get(s.user)
        uid = u.uid if u else 0
        groups = u.groups if u else [s.user]
        gtxt = ",".join(f"{1000 + i}({g})" for i, g in enumerate(groups))
        self.emit(f"uid={uid}({s.user}) gid={uid}({s.user}) groups={gtxt}")

    def _hostname(self, args, line):
        self.emit(self.state.session.host.hostname)

    def _pwd(self, args, line):
        self.emit(node_path(self.state.session.cwd))

    def _ifconfig(self, args, line):
        s = self.state.session
        ip = s.host.ip
        self.emit(f"eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500")
        self.emit(f"        inet {ip}  netmask 255.255.255.0")
        self.emit(f"        ether 02:42:{':'.join(f'{b:02x}' for b in ip.encode()[:4])}")

    def _netstat(self, args, line):
        s = self.state.session
        self.emit("Proto Local Address           State")
        for svc in s.host.open_services():
            self.emit(f"tcp   0.0.0.0:{svc.port:<18} LISTEN")

    def _echo(self, args, line):
        self.emit(" ".join(args))

    def _ls(self, args, line):
        long = False
        paths = []
        for a in args:
            if a.startswith("-"):
                long = long or "l" in a
                if "a" in a:
                    pass
            else:
                paths.append(a)
        s = self.state.session
        target = paths[0] if paths else "."
        node = resolve(s.host.root, s.cwd, target, s.home_path())
        if node is None:
            self.emit(f"ls: cannot access '{target}': No such file or directory")
            return
        if not node.is_dir:
            self._ls_emit(node, long)
            return
        if not node.can_read(s.user):
            self.emit(f"ls: cannot open directory '{target}': Permission denied")
            return
        for child in sorted(node.children.values(), key=lambda n: n.name):
            self._ls_emit(child, long)

    def _ls_emit(self, node, long):
        name = ui.c(node.name + ("/" if node.is_dir else ""),
                    "brightblue" if node.is_dir else
                    ("brightgreen" if node.can_exec(self.state.session.user) else "white"))
        if long:
            suid = "s" if node.suid else node.mode_string()[3]
            mode = node.mode_string()
            size = len(node.content)
            self.emit(f"{mode}  1 {node.owner:<8} {node.group:<8} {size:>6} {name}")
        else:
            self.emit(name)

    def _cd(self, args, line):
        s = self.state.session
        target = args[0] if args else s.home_path()
        node = resolve(s.host.root, s.cwd, target, s.home_path())
        if node is None or not node.is_dir:
            self.emit(f"cd: {target}: No such file or directory")
            return
        if not node.can_exec(s.user):
            self.emit(f"cd: {target}: Permission denied")
            return
        s.cwd = node

    def _cat(self, args, line):
        if not args:
            self.emit("usage: cat <file>")
            return
        s = self.state.session
        for target in args:
            node = resolve(s.host.root, s.cwd, target, s.home_path())
            if node is None:
                self.emit(f"cat: {target}: No such file or directory")
                continue
            if node.is_dir:
                self.emit(f"cat: {target}: Is a directory")
                continue
            if not node.can_read(s.user):
                self.emit(f"cat: {target}: Permission denied")
                continue
            self.emit(node.content.rstrip("\n"))
            self._maybe_loot_file(node)
            self._maybe_objective(node)

    def _find(self, args, line):
        s = self.state.session
        # special-case the classic SUID discovery
        if "-perm" in args and any("4000" in a for a in args):
            paths = s.host.suid_paths
            if paths:
                for p in paths:
                    self.emit(p)
            else:
                self.emit("/usr/bin/sudo\n/usr/bin/passwd")  # benign defaults
            return
        start = next((a for a in args if not a.startswith("-")), ".")
        node = resolve(s.host.root, s.cwd, start, s.home_path())
        if node is None:
            self.emit(f"find: '{start}': No such file or directory")
            return
        name_filter = None
        if "-name" in args:
            try:
                name_filter = args[args.index("-name") + 1]
            except IndexError:
                pass
        self._walk(node, name_filter)

    def _walk(self, node, name_filter):
        path = node_path(node)
        if name_filter is None or _fnmatch(node.name, name_filter):
            self.emit(path)
        if node.is_dir and node.can_read(self.state.session.user):
            for child in sorted(node.children.values(), key=lambda n: n.name):
                self._walk(child, name_filter)

    def _grep(self, args, line):
        if len(args) < 2:
            self.emit("usage: grep <pattern> <file>")
            return
        pattern = args[0]
        s = self.state.session
        for target in args[1:]:
            node = resolve(s.host.root, s.cwd, target, s.home_path())
            if node is None or node.is_dir or not node.can_read(s.user):
                continue
            for ln in node.content.splitlines():
                if pattern in ln:
                    self.emit(ln)

    # ===================================================================
    # network tooling
    # ===================================================================
    def _resolve_target(self, target: str) -> Host | None:
        return self.state.reachable_host(target)

    def _ping(self, args, line):
        target = next((a for a in args if not a.startswith("-")), None)
        host = self._resolve_target(target) if target else None
        if not host:
            self.emit(f"ping: {target}: Name or service not known")
            return
        self.state.discovered_hosts.add(host.ip)
        for i in range(3):
            self.emit(f"64 bytes from {host.ip}: icmp_seq={i+1} ttl=64 time=0.4 ms")
        self.emit(f"--- {host.ip} ping statistics ---")
        self.emit("3 packets transmitted, 3 received, 0% packet loss")

    def _nmap(self, args, line):
        sv = "-sV" in args
        target = next((a for a in args if not a.startswith("-")), None)
        host = self._resolve_target(target) if target else None
        if not host:
            self.emit(f"Failed to resolve \"{target}\".")
            return
        ui.progress("nmap: scanning", total_time=0.7)
        self.state.discovered_hosts.add(host.ip)
        self.state.scanned.setdefault(host.ip, set())
        self.emit(f"Starting Nmap scan against {host.ip} ({host.hostname})")
        self.emit("PORT      STATE     SERVICE" + ("    VERSION" if sv else ""))
        for svc in sorted(host.services.values(), key=lambda x: x.port):
            if svc.state == "closed":
                continue
            self.state.scanned[host.ip].add(svc.port)
            port = f"{svc.port}/{svc.proto}".ljust(9)
            state = svc.state.ljust(9)
            row = f"{port} {state} {svc.name}"
            if sv:
                row = row.ljust(34) + svc.version_str()
            self.emit(row)
        self.emit("")
        if not sv:
            self.emit(ui.c("hint: add -sV to fingerprint service versions.", "grey")
                      if self.state.config.get("hints") else "")

    def _parse_url(self, raw: str):
        u = raw
        proto = "http"
        if "://" in u:
            proto, u = u.split("://", 1)
        if "/" in u:
            hostport, path = u.split("/", 1)
            path = "/" + path
        else:
            hostport, path = u, "/"
        if ":" in hostport:
            host_s, port_s = hostport.rsplit(":", 1)
            port = int(port_s) if port_s.isdigit() else (21 if proto == "ftp" else 80)
        else:
            host_s, port = hostport, (21 if proto == "ftp" else 80)
        return proto, host_s, port, path

    def _curl(self, args, line):
        url = None
        auth = None
        data = None
        i = 0
        while i < len(args):
            a = args[i]
            if a in ("-u", "--user") and i + 1 < len(args):
                auth = args[i + 1]; i += 2; continue
            if a in ("-d", "--data", "--data-urlencode") and i + 1 < len(args):
                data = args[i + 1]; i += 2; continue
            if a in ("-X", "-H", "-o", "-A") and i + 1 < len(args):
                i += 2; continue
            if a.startswith("-"):
                i += 1; continue
            url = a; i += 1
        if not url:
            self.emit("usage: curl [-u user:pass] [-d data] <url>")
            return
        proto, host_s, port, path = self._parse_url(url)
        host = self._resolve_target(host_s)
        if not host:
            self.emit(f"curl: (6) Could not resolve host: {host_s}")
            return
        svc = host.services.get(port)
        if not svc or svc.state != "open":
            self.emit(f"curl: (7) Failed to connect to {host_s} port {port}: Connection refused")
            return
        self.state.discovered_hosts.add(host.ip)
        # ---- authenticated script-console RCE -----------------------------
        if data and svc.rce_endpoint and path.rstrip("/") == svc.rce_endpoint.rstrip("/"):
            if not self._web_authed(svc, auth):
                self.emit("HTTP/1.1 403 Forbidden")
                self.emit("Fableforge: authentication required for the script console")
                return
            command = self._extract_rce_command(data)
            if not command:
                self.emit("Fableforge: empty build step")
                return
            out = self._exec_capture(host, svc.rce_user, command)
            self.emit(ui.c(f"[Fableforge] executing build step as '{svc.rce_user}'", "grey"))
            self.emit(out)
            return
        # ---- auth-gated reads ---------------------------------------------
        if path in svc.requires_auth and not self._web_authed(svc, auth):
            self.emit("HTTP/1.1 403 Forbidden")
            return
        body = svc.web_paths.get(path)
        if body is None and path.endswith("/"):
            body = svc.web_paths.get(path.rstrip("/") + "/")
        if body is None:
            self.emit(f"HTTP/1.1 404 Not Found  ({host_s}:{port}{path})")
            return
        self.emit(body.rstrip("\n"))
        self._maybe_loot_text(body, f"{host.hostname}:{port}")

    def _web_authed(self, svc: Service, auth: str | None) -> bool:
        if not auth or ":" not in auth:
            return False
        user, pw = auth.split(":", 1)
        return svc.web_creds.get(user) == pw

    def _extract_rce_command(self, data: str) -> str:
        d = data.strip()
        for prefix in ("script=", "cmd=", "command="):
            if d.startswith(prefix):
                d = d[len(prefix):]
                break
        # tolerate a groovy-ish wrapper like: 'cat /x'.execute().text
        if ".execute()" in d:
            inner = d.split(".execute()")[0].strip().strip("'\"")
            return inner
        return d.strip().strip("'\"")

    def _gobuster(self, args, line):
        url = None
        for a in args:
            if a.startswith("http") or "/" in a and not a.startswith("-"):
                url = a
            elif not a.startswith("-") and a not in ("dir", "dns"):
                if url is None and (":" in a or "." in a):
                    url = a
        if url is None:
            url = next((a for a in args if not a.startswith("-") and a not in ("dir",)), None)
        if not url:
            self.emit("usage: gobuster dir -u <url>")
            return
        proto, host_s, port, _ = self._parse_url(url)
        host = self._resolve_target(host_s)
        svc = host.services.get(port) if host else None
        if not host or not svc or svc.state != "open":
            self.emit(f"Error: connection refused to {host_s}:{port}")
            return
        ui.progress("gobuster: enumerating", total_time=0.8)
        self.state.discovered_hosts.add(host.ip)
        self.emit(f"===============================================================")
        self.emit(f"Gobuster v3 -> http://{host_s}:{port}")
        self.emit(f"===============================================================")
        found = svc.listed_paths or list(svc.web_paths.keys())
        for p in found:
            status = 200
            if p in svc.requires_auth:
                status = 403
            self.emit(f"{p:<28} (Status: {status})")
        self.emit(f"===============================================================")

    def _searchsploit(self, args, line):
        from .world import EXPLOIT_DB
        term = " ".join(args).lower()
        if not term:
            self.emit("usage: searchsploit <term>")
            return
        self.emit("-" * 70)
        self.emit(f"{'Exploit Title':<52} Path")
        self.emit("-" * 70)
        hits = [(t, p) for t, p in EXPLOIT_DB if all(w in t.lower() for w in term.split())]
        if not hits:
            self.emit("Exploits: No Results")
        for title, path in hits:
            self.emit(f"{title[:51]:<52} {path}")
        self.emit("-" * 70)

    def _hydra(self, args, line):
        user = None
        target = None
        service = "ssh"
        i = 0
        while i < len(args):
            a = args[i]
            if a == "-l" and i + 1 < len(args):
                user = args[i + 1]; i += 2; continue
            if a == "-P" and i + 1 < len(args):
                i += 2; continue  # wordlist accepted, built-in list used
            if "://" in a:
                service, rest = a.split("://", 1)
                target = rest
                i += 1; continue
            if not a.startswith("-"):
                if target is None:
                    target = a
                else:
                    service = a
                i += 1; continue
            i += 1
        host = self._resolve_target(target) if target else None
        if not host or not user:
            self.emit("usage: hydra -l <user> -P <wordlist> ssh://<host>")
            return
        u = host.users.get(user)
        port = 22 if service == "ssh" else next((s.port for s in host.open_services()
                                                 if s.name == service), 22)
        ui.progress(f"hydra: attacking {service}://{host.ip}", total_time=1.0)
        self.emit(f"[DATA] attacking {service}://{host.ip}:{port}/")
        if u and u.weak_password and u.password in _BRUTE_WORDLIST:
            self.emit(ui.c(f"[{port}][{service}] host: {host.ip}   "
                           f"login: {user}   password: {u.password}", "brightgreen", "bold"))
            if self.state.loot.add_cred(f"{host.hostname} {service}", user, u.password):
                self.emit(ui.c("  -> stored in loot (run `loot`)", "grey"))
            self.emit("1 of 1 target successfully completed, 1 valid password found")
        else:
            self.emit("0 valid passwords found")
            self.emit(ui.c("[STATUS] password not in wordlist; this account is "
                           "not online-brute-forceable.", "grey"))

    def _ftp(self, args, line):
        target = next((a for a in args if not a.startswith("-")), None)
        host = self._resolve_target(target) if target else None
        svc = host.services.get(21) if host else None
        if not host or not svc or svc.state != "open":
            self.emit(f"ftp: connect to address {target}: Connection refused")
            return
        self.state.discovered_hosts.add(host.ip)
        self.emit(svc.banner or f"220 {host.hostname} FTP")
        self.emit("Name: anonymous")
        self.emit("230 Anonymous login ok, restrictions apply")
        self.emit("ftp> ls")
        for p in (svc.listed_paths or svc.web_paths.keys()):
            self.emit(p.lstrip("/"))
        self.emit("ftp> (use `curl ftp://%s/<file>` to retrieve a file)" % host.ip)

    def _ssh(self, args, line):
        keyid = None
        dest = None
        i = 0
        while i < len(args):
            a = args[i]
            if a == "-i" and i + 1 < len(args):
                keyid = args[i + 1]; i += 2; continue
            if a in ("-p", "-o", "-l") and i + 1 < len(args):
                i += 2; continue
            if a.startswith("-"):
                i += 1; continue
            dest = a; i += 1
        if not dest:
            self.emit("usage: ssh [-i keyid] user@host")
            return
        if "@" in dest:
            user, hoststr = dest.split("@", 1)
        else:
            user, hoststr = self.state.session.user, dest
        host = self._resolve_target(hoststr)
        if not host:
            self.emit(f"ssh: Could not resolve hostname {hoststr}: Name or service not known")
            return
        svc = host.services.get(22)
        if not svc or svc.state != "open":
            self.emit(f"ssh: connect to host {hoststr} port 22: Connection refused")
            return
        target_user = host.users.get(user)
        if not target_user:
            self.emit(ui.c(f"{user}@{host.ip}: Permission denied (publickey,password).", "red"))
            return
        # key-based auth
        if keyid:
            owns = self.state.loot.keys.get(keyid)
            if target_user.ssh_key_id and target_user.ssh_key_id == keyid:
                return self._ssh_success(host, user, f"ssh key:{keyid}")
            self.emit(ui.c(f"{user}@{host.ip}: Permission denied (publickey).", "red"))
            self.emit(ui.c("  (the key does not authenticate this account)", "grey"))
            return
        # password auth
        if not target_user.password:
            self.emit(ui.c(f"{user}@{host.ip}: Permission denied (publickey,password).", "red"))
            self.emit(ui.c("  (no password set; this account likely needs a key)", "grey"))
            return
        try:
            pw = input(f"{user}@{host.ip}'s password: ")
        except (EOFError, KeyboardInterrupt):
            self.emit("")
            return
        if pw == target_user.password:
            self._ssh_success(host, user, "ssh password")
        else:
            self.emit(ui.c("Permission denied, please try again.", "red"))

    def _ssh_success(self, host: Host, user: str, label: str):
        self.emit(ui.c(f"Welcome to {host.os_name} ({host.hostname})", "brightgreen"))
        self.emit(ui.c(f"Last login: from {self.state.session.host.ip}", "grey"))
        self.state.push_session(host, user, label)
        self.state.discovered_hosts.add(host.ip)

    # ===================================================================
    # privilege escalation
    # ===================================================================
    def _sudo(self, args, line):
        s = self.state.session
        rules = s.host.sudo_rules.get(s.user, [])
        if args and args[0] in ("-l", "--list"):
            if not rules:
                self.emit(f"Sorry, user {s.user} may not run sudo on {s.host.hostname}.")
                return
            self.emit(f"Matching Defaults entries for {s.user} on {s.host.hostname}:")
            self.emit("    env_reset, secure_path=/usr/local/sbin\\:/usr/bin")
            self.emit(f"\nUser {s.user} may run the following commands on {s.host.hostname}:")
            for r in rules:
                tag = "NOPASSWD: " if r.nopasswd else ""
                self.emit(f"    ({r.runas}) {tag}{r.command}")
            return
        if not args:
            self.emit("usage: sudo -l | sudo <command>")
            return
        binary = args[0]
        argline = " ".join(args[1:])
        match = self._match_sudo(rules, binary)
        if not match:
            self.emit(ui.c(f"Sorry, user {s.user} is not allowed to execute "
                           f"'{binary}' as root on {s.host.hostname}.", "red"))
            return
        if not match.nopasswd:
            try:
                pw = input(f"[sudo] password for {s.user}: ")
            except (EOFError, KeyboardInterrupt):
                self.emit(""); return
            real = s.host.users.get(s.user)
            if not real or pw != real.password:
                self.emit(ui.c("sudo: incorrect password", "red"))
                return
        if _gtfo_root(binary, argline):
            self.emit(ui.c(f"[+] interpreter/escape via {binary.split('/')[-1]} -> uid 0", "brightgreen"))
            self.state.push_session(s.host, "root", f"sudo {binary.split('/')[-1]}")
            self.emit(ui.c("root@%s:# id" % s.host.hostname, "grey"))
            self.emit("uid=0(root) gid=0(root) groups=0(root)")
        else:
            ran = f"{binary} {argline}".strip()
            self.emit(ui.c(f"(ran '{ran}' as root, but it returned "
                           "no interactive shell)", "grey"))
            if self.state.config.get("hints"):
                self.emit(ui.c("hint: a permitted binary is only useful if it can spawn or "
                               "read as root. Check GTFOBins-style escapes (e.g. an "
                               "interpreter with a shell payload, or -exec).", "grey"))

    def _match_sudo(self, rules, binary):
        base = binary.split("/")[-1]
        for r in rules:
            if r.command == "ALL":
                return r
            if r.command == binary or r.command.split("/")[-1] == base:
                return r
        return None

    # ===================================================================
    # loot detection
    # ===================================================================
    def _maybe_loot_file(self, node):
        # stealing a private key file
        if node.name == "id_rsa" or "PRIVATE KEY" in node.content:
            s = self.state.session
            owner = node.owner
            keyid = owner  # key id == owning user for simplicity
            host_user = s.host.users.get(owner)
            if host_user and host_user.ssh_key_id:
                keyid = host_user.ssh_key_id
            if self.state.loot.add_key(keyid, f"{owner}@{s.host.hostname}"):
                self.emit(ui.c(f"\n[+] private key recovered -> loot (id '{keyid}'). "
                               f"Try: ssh -i {keyid} {owner}@{s.host.ip}", "brightgreen"))

    def _maybe_loot_text(self, text: str, source: str):
        # scrape simple "key = value" credential pairs from disclosed config
        import re
        creds = {}
        for m in re.finditer(r"(?im)^\s*ci_user\s*=\s*(\S+)", text):
            creds["user"] = m.group(1)
        for m in re.finditer(r"(?im)^\s*ci_pass\s*=\s*(\S+)", text):
            creds["pass"] = m.group(1)
        if "user" in creds and "pass" in creds:
            if self.state.loot.add_cred(f"web:{source}", creds["user"], creds["pass"]):
                self.emit(ui.c(f"[+] credentials disclosed -> loot: "
                               f"{creds['user']} / {creds['pass']}", "brightgreen"))

    def _maybe_objective(self, node):
        s = self.state.session
        net = self.state.network
        if not net:
            return
        is_obj = s.host.ip == net.objective_host
        if is_obj and s.user == "root" and node.name in ("proof.txt", "flag.txt"):
            if self.state.mark_rooted(net.code):
                self.emit("")
                self.emit(ui.c("  [+] objective artefact recovered on the in-scope host.", "brightgreen", "bold"))
                self.emit(ui.c("      root access on %s confirmed and logged." % s.host.hostname, "green"))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _fnmatch(name: str, pattern: str) -> bool:
    import fnmatch
    return fnmatch.fnmatch(name, pattern)


def _gtfo_root(binary: str, argline: str) -> bool:
    """Return True if ``binary``+``argline`` form a known root-shell escape.

    Modelled on real GTFOBins sudo techniques so the lesson transfers.
    """
    b = binary.split("/")[-1]
    a = argline
    shells = {"bash", "sh", "dash", "zsh", "ash", "ksh"}
    if b in shells:
        return True
    if b in ("python", "python3", "python2"):
        return ("pty.spawn" in a or ("setuid" in a and "system" in a)
                or ("os.system" in a and "sh" in a) or "/bin/sh" in a or "/bin/bash" in a)
    if b in ("find",):
        return "-exec" in a and ("/bin/sh" in a or "/bin/bash" in a or " sh " in a)
    if b in ("vim", "vi", "view", "nvim"):
        return "-c" in a and (":!" in a or ":shell" in a or "system(" in a or "py3 " in a)
    if b in ("env",):
        return a.strip().split(" ")[0] in ("/bin/sh", "/bin/bash", "sh", "bash")
    if b in ("tar",):
        return "checkpoint-action" in a
    if b in ("awk", "gawk"):
        return "system(" in a or "BEGIN{system" in a.replace(" ", "")
    if b in ("less", "more", "man"):
        return "!sh" in a.replace(" ", "") or "!/bin/sh" in a
    if b in ("nmap",):
        return "--interactive" in a
    if b in ("perl",):
        return "exec" in a and ("sh" in a)
    return False
