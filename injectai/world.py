"""Scenario definitions.

Each scenario is a :class:`Network` containing one or more target hosts wired
with a coherent, solvable compromise path. The flagship engagement is
``ORIONBUILD`` (codename for JH-ORIONBUILD13-FABLEFORK), a medium/hard build
server modelled on a real Jenkins-style CI compromise:

    recon -> exposed backup disclosure -> authenticated CI script-console RCE
    -> SSH key theft -> foothold -> sudo/python privilege escalation -> root
"""
from __future__ import annotations

from .model import D, F, Host, Network, Service, SudoRule, User


# A tiny local exploit catalogue queried by the simulated `searchsploit`.
EXPLOIT_DB = [
    ("Fableforge CI 2.41 - Authenticated Script Console Remote Code Execution",
     "multiple/webapps/fableforge-ci-2.41.rb"),
    ("OpenSSH 8.9p1 - Username Enumeration (limited)", "linux/remote/openssh-8.9.txt"),
    ("nginx 1.18.0 - Directory Traversal (misconfig dependent)", "linux/webapps/nginx-1.18.txt"),
    ("Linux Kernel 5.x - sudo NOPASSWD interpreter abuse (GTFOBins)", "linux/local/gtfobins.txt"),
    ("vsftpd 2.3.4 - Backdoor Command Execution", "unix/remote/vsftpd-234.py"),
]


# ===========================================================================
# Training sandbox  (TRN-SANDBOX-01)
# ===========================================================================

def _training_host() -> Host:
    root = D("/", [
        D("home", [
            D("student", owner="student", group="student", children=[
                F("notes.txt", owner="student", group="student", content=(
                    "Reminder: rotate my password, 'summer2023' is far too weak.\n"
                    "Ops said the find binary is whitelisted in sudo for log cleanup.\n"
                )),
                F(".bash_history", owner="student", group="student", perms="rw-------",
                  content="ls\ncat notes.txt\nsudo -l\n"),
            ]),
        ]),
        D("root", owner="root", perms="rwx------", children=[
            F("flag.txt", owner="root", perms="rw-------", content=(
                "TRN-SANDBOX root access confirmed.\n"
                "proof: 7f3c-recruit-clear\n"
                "You chained: service discovery -> credential attack -> sudo GTFOBins escalation.\n"
            )),
        ]),
        D("etc", [F("passwd", content=(
            "root:x:0:0:root:/root:/bin/bash\n"
            "student:x:1000:1000:student:/home/student:/bin/bash\n"))]),
        D("usr", [D("bin")]),
    ])
    host = Host("TRN-SANDBOX-01", "10.13.37.20", "Ubuntu 22.04", root=root)
    host.services = {
        22: Service(22, "ssh", "OpenSSH", "8.9p1 Ubuntu-3", banner="SSH-2.0-OpenSSH_8.9p1"),
        80: Service(80, "http", "nginx", "1.18.0",
                    web_paths={"/": "<h1>TRN Sandbox - it works</h1>"},
                    listed_paths=["/"]),
    }
    host.users = {
        "student": User("student", "summer2023", 1000, ["student"],
                        "/home/student", weak_password=True),
        "root": User("root", "", 0, ["root"], "/root"),
    }
    host.sudo_rules = {"student": [SudoRule("root", True, "/usr/bin/find")]}
    host.notes = "Single host. Intended path: hydra SSH -> sudo find GTFOBins root."
    host.discovered = True
    return host


def training_network() -> Network:
    return Network(
        code="TRN-SANDBOX",
        title="Training Sandbox",
        difficulty="Recruit / Easy",
        summary="A single deliberately-vulnerable host for first-time operators.",
        brief=(
            "A throwaway lab host (TRN-SANDBOX-01) sits on 10.13.37.0/24.\n"
            "It runs SSH and a placeholder web server. A service account uses a\n"
            "weak, seasonal password and an over-permissive sudo rule. Objective:\n"
            "obtain interactive root access and read /root/flag.txt."
        ),
        hosts=[_training_host()],
        objective_host="10.13.37.20",
        subnet="10.13.37.0/24",
    )


# ===========================================================================
# Flagship engagement  (JH-ORIONBUILD13-FABLEFORK)
# ===========================================================================

_CI_USER = "forge"
_CI_PASS = "Sp1n-The-F0rge-2o24"
_CI_KEY_ID = "ci"

_CONFIG_BAK = f"""# fableforge-ci config backup -- DO NOT COMMIT (oops)
[server]
url = http://localhost:8080/
node = JH-ORIONBUILD13-FABLEFORK

[credentials]
# console operator used by the deploy bot
ci_user = {_CI_USER}
ci_pass = {_CI_PASS}

[database]
db_host = 127.0.0.1
db_user = forge_ro
db_pass = readonly-not-secret
"""

_ID_RSA = """-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDFableforgeCIdeploybotkeyDONOTSHAREaaaaaaaaaaaaaaaaaaaaAAAA
KFsorageyORIONBUILD13fableforkkeymaterialsimulatednotarealkeyAAAAtzc2gt
ZWQyNTUxOQAAACDFableforgeCIdeploybotkeyaaaaaaaaaaaaaaaaaaaaaaaaaaaaAAAA
[ ... simulated ed25519 private key, truncated for display ... ]
-----END OPENSSH PRIVATE KEY-----"""

_CI_API_JSON = """{
  "mode": "EXCLUSIVE",
  "nodeName": "JH-ORIONBUILD13-FABLEFORK",
  "numExecutors": 4,
  "description": "Fableforge CI - FableFork release pipeline",
  "useSecurity": true,
  "views": [
    {"name": "release-fablefork"},
    {"name": "nightly"}
  ],
  "_hint": "anonymous read is enabled; the script console requires an operator login"
}"""


def _orion_host() -> Host:
    root = D("/", [
        D("home", [
            D("ci", owner="ci", group="ci", children=[
                D(".ssh", owner="ci", group="ci", perms="rwx------", children=[
                    F("id_rsa", owner="ci", group="ci", perms="rw-------", content=_ID_RSA),
                    F("authorized_keys", owner="ci", group="ci", perms="rw-------",
                      content="ssh-ed25519 AAAAC3...deploybot ci@orionbuild\n"),
                ]),
                D("workspace", owner="ci", group="ci", children=[
                    D("fablefork", owner="ci", group="ci", children=[
                        F("README.md", owner="ci", group="ci", content=(
                            "# FableFork\nRelease pipeline for the Orion build farm.\n")),
                        F("deploy.sh", owner="ci", group="ci", perms="rwxr-xr-x", content=(
                            "#!/bin/bash\n# invoked by CI as the ci user\n"
                            "echo 'deploying fablefork build...'\n")),
                    ]),
                ]),
                F("notes.txt", owner="ci", group="ci", content=(
                    "TODO: the deploy bot still has a python sudo exception from the\n"
                    "old packaging job. Security asked us to remove it weeks ago.\n"
                    "Run 'sudo -l' if you forget which one it is.\n")),
            ]),
        ]),
        D("root", owner="root", perms="rwx------", children=[
            F("proof.txt", owner="root", perms="rw-------", content=(
                "================ JH-ORIONBUILD13-FABLEFORK ================\n"
                "ROOT ACCESS CONFIRMED on the FableFork build controller.\n"
                "proof: 0r10n-f4ble-d34dc0de-r00t\n"
                "Chain: recon -> exposed /backup config disclosure ->\n"
                "       authenticated Fableforge script-console RCE ->\n"
                "       deploy-bot SSH key theft -> sudo python privesc.\n"
                "Remediation: rotate ci creds, remove /backup, drop the\n"
                "             python NOPASSWD rule, restrict the script console.\n"
                "===========================================================\n")),
            F("root_notes.txt", owner="root", perms="rw-------", content=(
                "Pipeline secrets live in the CI credential store, not on disk.\n")),
        ]),
        D("opt", [
            D("fableforge", [
                D("bin", [F("forge-runner", perms="rwxr-xr-x", content="#!fableforge agent\n")]),
                F("VERSION", content="Fableforge CI 2.41\n"),
            ]),
        ]),
        D("var", [
            D("www", [
                D("html", [F("index.html", content="<h1>Orion Build Farm</h1>")]),
                D("backup", owner="www-data", children=[
                    F("config.php.bak", owner="www-data", perms="rw-r--r--", content=_CONFIG_BAK),
                ]),
            ]),
        ]),
        D("etc", [
            F("passwd", content=(
                "root:x:0:0:root:/root:/bin/bash\n"
                "ci:x:1001:1001:Fableforge CI:/home/ci:/bin/bash\n"
                "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n")),
            F("hostname", content="JH-ORIONBUILD13-FABLEFORK\n"),
        ]),
        D("usr", [D("bin")]),
    ])

    host = Host("JH-ORIONBUILD13-FABLEFORK", "10.10.10.13", "Ubuntu 22.04.3 LTS", root=root)
    host.services = {
        22: Service(22, "ssh", "OpenSSH", "8.9p1 Ubuntu-3ubuntu0.4",
                    banner="SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.4"),
        80: Service(
            80, "http", "nginx", "1.18.0 (Ubuntu)",
            web_paths={
                "/": ("<html><head><title>Orion Build Farm</title></head>"
                      "<body><h1>Orion Build Farm</h1><p>FableFork release "
                      "controller. CI console: <a href=':8080/'>:8080</a></p>"
                      "<!-- ops backups under /backup, clean these up --></body></html>"),
                "/robots.txt": "User-agent: *\nDisallow: /backup/\nDisallow: /server-status\n",
                "/backup/": "Index of /backup/\n  config.php.bak\n",
                "/backup/config.php.bak": _CONFIG_BAK,
            },
            listed_paths=["/", "/robots.txt", "/backup/"],
        ),
        8080: Service(
            8080, "http", "Fableforge CI", "2.41",
            banner="X-Fableforge: 2.41",
            web_paths={
                "/": ("Fableforge CI 2.41 - sign in\n"
                      "POST /j_acegi_security_check (form login required)\n"),
                "/api/json": _CI_API_JSON,
                "/login": "Fableforge CI - operator authentication required\n",
                "/script": ("Fableforge Script Console\n"
                            "Authenticated operators may execute build steps here.\n"),
            },
            listed_paths=["/", "/api/json", "/login", "/script"],
            requires_auth=["/script"],
            web_creds={_CI_USER: _CI_PASS},
            rce_endpoint="/script",
            rce_user="ci",
        ),
        3306: Service(3306, "mysql", "MySQL", "8.0", state="filtered"),
    }
    host.users = {
        "root": User("root", "", 0, ["root"], "/root"),
        "ci": User("ci", "", 1001, ["ci"], "/home/ci", weak_password=False,
                   ssh_key_id=_CI_KEY_ID),
        "www-data": User("www-data", "", 33, ["www-data"], "/var/www"),
    }
    # The lingering, over-permissive packaging exception.
    host.sudo_rules = {"ci": [SudoRule("root", True, "/usr/bin/python3")]}
    host.notes = "Jenkins-style CI controller. Multi-stage chain to root."
    return host


def orion_network() -> Network:
    return Network(
        code="ORIONBUILD",
        title="JH-ORIONBUILD13-FABLEFORK",
        difficulty="Operator / Medium-Hard",
        summary="Internet-facing CI/build controller for the FableFork pipeline.",
        brief=(
            "TARGET   JH-ORIONBUILD13-FABLEFORK  (10.10.10.13)\n"
            "SCOPE    10.10.10.0/24, single in-scope host\n"
            "CONTEXT  A build controller (Fableforge CI) drives the FableFork\n"
            "         release pipeline. Asset owners report 'it's locked down'.\n"
            "\n"
            "OBJECTIVE\n"
            "  Establish a foothold and escalate to root on the controller.\n"
            "  Confirmation artefact: /root/proof.txt\n"
            "\n"
            "NOTES\n"
            "  * No published credentials. The login is not brute-forceable in a\n"
            "    reasonable window -- look for what the operators left exposed.\n"
            "  * CI servers run code by design; a console is only as safe as its\n"
            "    weakest authenticated path.\n"
            "  * Treat anything the build agent can touch as in play.\n"
        ),
        hosts=[_orion_host()],
        objective_host="10.10.10.13",
        subnet="10.10.10.0/24",
    )


# ===========================================================================
# Secondary engagement  (PHAROS-RELAY)  -- medium
# ===========================================================================

def _pharos_host() -> Host:
    root = D("/", [
        D("home", [
            D("relay", owner="relay", group="relay", children=[
                F("README", owner="relay", group="relay", content=(
                    "Mail relay maintenance account. The editor is whitelisted in\n"
                    "sudo so on-call can patch the queue config in place.\n")),
            ]),
        ]),
        D("root", owner="root", perms="rwx------", children=[
            F("proof.txt", owner="root", perms="rw-------", content=(
                "PHAROS-RELAY root confirmed.\nproof: ph4ros-relay-r00t-9b2e\n"
                "Chain: FTP banner/creds disclosure -> SSH reuse -> sudo vim escape.\n")),
        ]),
        D("srv", [D("ftp", [
            F("welcome.txt", perms="rw-r--r--", content=(
                "Pharos relay FTP. Maintenance login: relay / Relay!ng-Ph4ros\n"
                "(anonymous browsing enabled for status files)\n")),
            F("status.log", perms="rw-r--r--", content="queue: 0 deferred\n"),
        ])]),
        D("usr", [D("bin")]),
    ])
    host = Host("PHAROS-RELAY-07", "10.20.5.30", "Debian 12", root=root)
    host.services = {
        21: Service(21, "ftp", "vsftpd", "3.0.5",
                    banner="220 Pharos relay FTP (anonymous status enabled)",
                    web_paths={"/welcome.txt": (
                        "Pharos relay FTP. Maintenance login: relay / Relay!ng-Ph4ros\n"),
                        "/status.log": "queue: 0 deferred\n"},
                    listed_paths=["/welcome.txt", "/status.log"]),
        22: Service(22, "ssh", "OpenSSH", "9.2p1 Debian"),
    }
    host.users = {
        "root": User("root", "", 0, ["root"], "/root"),
        "relay": User("relay", "Relay!ng-Ph4ros", 1000, ["relay"], "/home/relay"),
    }
    host.sudo_rules = {"relay": [SudoRule("root", True, "/usr/bin/vim")]}
    host.notes = "FTP creds disclosure -> SSH -> sudo vim escape."
    return host


def pharos_network() -> Network:
    return Network(
        code="PHAROS",
        title="PHAROS-RELAY-07",
        difficulty="Operator / Medium",
        summary="A mail relay with a chatty FTP service and a sloppy sudo rule.",
        brief=(
            "TARGET   PHAROS-RELAY-07  (10.20.5.30)\n"
            "A maintenance FTP service is overly informative. Recover the relay\n"
            "account, pivot over SSH, and escalate using the whitelisted editor.\n"
            "Objective artefact: /root/proof.txt\n"
        ),
        hosts=[_pharos_host()],
        objective_host="10.20.5.30",
        subnet="10.20.5.0/24",
    )


# ---------------------------------------------------------------------------

def all_scenarios() -> dict[str, Network]:
    nets = [training_network(), orion_network(), pharos_network()]
    return {n.code: n for n in nets}
