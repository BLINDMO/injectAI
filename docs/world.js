/* injectAI web build -- model + scenario data.
 * A faithful browser port of the Python simulator's world.py / model.py.
 * No real network is ever contacted; everything lives in memory. */
"use strict";

/* ----------------------------------------------------------------------
 * Virtual filesystem helpers
 * -------------------------------------------------------------------- */
function D(name, children, owner = "root", group = "root", perms = "rwxr-xr-x") {
  const node = { name, dir: true, owner, group, perms, content: "", suid: false, children: {}, parent: null };
  (children || []).forEach((c) => { c.parent = node; node.children[c.name] = c; });
  return node;
}
function F(name, content = "", owner = "root", group = "root", perms = "rw-r--r--", suid = false) {
  return { name, dir: false, owner, group, perms, content, suid, children: {}, parent: null };
}
function canBit(node, idxOwner, idxOther, user) {
  if (user === "root") return true;
  if (user === node.owner) return node.perms[idxOwner] !== "-";
  return node.perms[idxOther] !== "-";
}
const canRead = (n, u) => canBit(n, 0, 6, u);
const canExec = (n, u) => canBit(n, 2, 8, u);
function modeString(n) { return (n.dir ? "d" : "-") + n.perms; }

function resolve(root, cwd, path, home = "/root") {
  if (!path) return cwd;
  if (path[0] === "~") path = home + path.slice(1);
  let node = path[0] === "/" ? root : cwd;
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  for (const part of parts) {
    if (part === "..") { node = node.parent || node; continue; }
    if (!node.dir || !(part in node.children)) return null;
    node = node.children[part];
  }
  return node;
}
function nodePath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.parent) { parts.push(cur.name); cur = cur.parent; }
  return parts.length ? "/" + parts.reverse().join("/") : "/";
}

/* ----------------------------------------------------------------------
 * Exploit catalogue (searchsploit)
 * -------------------------------------------------------------------- */
const EXPLOIT_DB = [
  ["Fableforge CI 2.41 - Authenticated Script Console Remote Code Execution", "multiple/webapps/fableforge-ci-2.41.rb"],
  ["OpenSSH 8.9p1 - Username Enumeration (limited)", "linux/remote/openssh-8.9.txt"],
  ["nginx 1.18.0 - Directory Traversal (misconfig dependent)", "linux/webapps/nginx-1.18.txt"],
  ["Linux Kernel 5.x - sudo NOPASSWD interpreter abuse (GTFOBins)", "linux/local/gtfobins.txt"],
  ["vsftpd 2.3.4 - Backdoor Command Execution", "unix/remote/vsftpd-234.py"],
];

const BRUTE_WORDLIST = ["123456", "password", "admin", "letmein", "summer2023",
  "winter2024", "qwerty", "iloveyou", "dragon", "monkey", "football", "trustno1",
  "Sunshine2024", "Spring2024!", "root", "toor", "changeme", "P@ssw0rd",
  "Relay!ng-Ph4ros", "Trader2024", "hunter2", "baseball", "welcome1"];

/* ----------------------------------------------------------------------
 * Service / host / network constructors
 * -------------------------------------------------------------------- */
function Service(o) {
  return Object.assign({
    port: 0, name: "", product: "", version: "", banner: "", proto: "tcp", state: "open",
    web_paths: {}, listed_paths: [], requires_auth: [], web_creds: {}, rce_endpoint: "", rce_user: "",
  }, o);
}
function versionStr(s) { return [s.product, s.version].filter(Boolean).join(" "); }

/* ===================== TRAINING SANDBOX ============================== */
function trainingHost() {
  const root = D("/", [
    D("home", [
      D("student", [
        F("notes.txt",
          "Reminder: rotate my password, 'summer2023' is far too weak.\n" +
          "Ops said the find binary is whitelisted in sudo for log cleanup.\n",
          "student", "student"),
        F(".bash_history", "ls\ncat notes.txt\nsudo -l\n", "student", "student", "rw-------"),
      ], "student", "student"),
    ]),
    D("root", [
      F("flag.txt",
        "TRN-SANDBOX root access confirmed.\nproof: 7f3c-recruit-clear\n" +
        "You chained: service discovery -> credential attack -> sudo GTFOBins escalation.\n",
        "root", "root", "rw-------"),
    ], "root", "root", "rwx------"),
    D("etc", [F("passwd",
      "root:x:0:0:root:/root:/bin/bash\nstudent:x:1000:1000:student:/home/student:/bin/bash\n")]),
    D("usr", [D("bin")]),
  ]);
  return {
    hostname: "TRN-SANDBOX-01", ip: "10.13.37.20", os: "Ubuntu 22.04", root,
    services: {
      22: Service({ port: 22, name: "ssh", product: "OpenSSH", version: "8.9p1 Ubuntu-3", banner: "SSH-2.0-OpenSSH_8.9p1" }),
      80: Service({ port: 80, name: "http", product: "nginx", version: "1.18.0",
        web_paths: { "/": "<h1>TRN Sandbox - it works</h1>" }, listed_paths: ["/"] }),
    },
    users: {
      student: { name: "student", password: "summer2023", uid: 1000, groups: ["student"], home: "/home/student", weak: true, key: "" },
      root: { name: "root", password: "", uid: 0, groups: ["root"], home: "/root", weak: false, key: "" },
    },
    sudo: { student: [{ runas: "root", nopasswd: true, command: "/usr/bin/find" }] },
    suid: [], discovered: true,
  };
}

/* ===================== ORIONBUILD (flagship) ========================
 * JH-ORIONBUILD13-FABLEFORK is a node in the "Orion" autonomous AI
 * stock-trading cluster. Trading bot #13 (the FableFork fork) has lost its
 * operator lock and is now issuing trades/commands on its own. The mission:
 * break in and obtain sudo/root so the kill-switch authority is restored and
 * the rogue bot can be halted. There are THREE independent ways in.
 * ------------------------------------------------------------------ */
const DASH_USER = "orion-ops";
const DASH_PASS = "0r10n-C0ntr0l-2o25";
const TRADER_PASS = "Sunshine2024";   // weak desk password -> brute-forceable

const ORION_CONF =
  "# Orion Control dashboard -- config backup (DO NOT SHIP)\n" +
  "[dashboard]\nurl = http://localhost:8080/\n" +
  "ci_user = " + DASH_USER + "\nci_pass = " + DASH_PASS + "\n\n" +
  "[cluster]\n" +
  "# desk operators share a login until SSO lands\n" +
  "operators = orion, trader\n" +
  "note = trader still uses the shared trading-desk password, ROTATE IT\n";

const ORION_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n" +
  "QyNTUxOQAAACDOr1onTr4d1ngB0tdeploykeyDONOTSHAREaaaaaaaaaaaaaaaaaaAAAA\n" +
  "KFor10nORIONBUILD13fableforkbotkeymaterialsimulatednotarealkeyAAAAtzc\n" +
  "[ ... simulated ed25519 private key, truncated for display ... ]\n" +
  "-----END OPENSSH PRIVATE KEY-----";

const BOT13_LOG =
  "[BOT-13] boot: strategy=fablefork-momentum  mode=LIVE  capital=$4.2M\n" +
  "[BOT-13] 09:40:58  operator heartbeat lost — entering AUTONOMOUS mode\n" +
  "[BOT-13] 09:41:02  EXEC  SELL  AAPL  x2200 @ market    (unscheduled)\n" +
  "[BOT-13] 09:41:03  EXEC  BUY   ^VIX  calls x500        (risk override)\n" +
  "[BOT-13] 09:41:05  WARN  kill-switch request IGNORED: caller lacks root\n" +
  "[BOT-13] 09:41:09  EXEC  WIRE  settlement -> acct ****7731 (self-initiated)\n" +
  "[BOT-13] 09:41:12  EXEC  SPAWN child strategy 'fablefork-2'  pid=31337\n";

const ORION_STATUS =
  '{\n  "node": "JH-ORIONBUILD13-FABLEFORK",\n  "cluster": "orion-trading",\n' +
  '  "bots": [\n    {"id": 11, "state": "nominal", "owner": "orion"},\n' +
  '    {"id": 13, "state": "ROGUE/AUTONOMOUS", "owner": "orion", "lock": "LOST"}\n  ],\n' +
  '  "operators_online": ["trader"],\n' +
  '  "_note": "control console at /console requires an operator login"\n}';

function orionHost() {
  const root = D("/", [
    D("home", [
      D("orion", [
        D(".ssh", [
          F("id_rsa", ORION_KEY, "orion", "orion", "rw-------"),
          F("authorized_keys", "ssh-ed25519 AAAAC3...orionbot orion@orion13\n", "orion", "orion", "rw-------"),
        ], "orion", "orion", "rwx------"),
        D("bots", [
          F("fablefork.py",
            "# FableFork momentum strategy (bot-13)\n" +
            "# the strategy engine runs these as root via the privileged runner\n" +
            "def on_tick(mkt):\n    return decide(mkt)\n", "orion", "orion"),
        ], "orion", "orion"),
        F("notes.txt",
          "bot-13 lost its operator lock and won't honour the kill-switch —\n" +
          "the switch needs ROOT. The strategy engine still has the old python\n" +
          "sudo grant (run 'sudo -l'); that's how the bot escalates itself.\n" +
          "to stop it once you're root:  orion-ctl kill 13\n", "orion", "orion"),
      ], "orion", "orion"),
      D("trader", [
        F(".bash_history",
          "ssh orion@localhost\nsudo -l\nfind / -perm -4000 2>/dev/null\n", "trader", "trader", "rw-------"),
        F("desk-notes.txt",
          "on-call: ops gave the trader account a sudo find exception for log\n" +
          "cleanup. password is the shared desk one, change it after the audit.\n", "trader", "trader"),
      ], "trader", "trader"),
    ]),
    D("root", [
      F("proof.txt",
        "============ JH-ORIONBUILD13-FABLEFORK ============\n" +
        "SUDO / ROOT OBTAINED — kill-switch authority restored.\n" +
        "Rogue trading bot-13 (fablefork-momentum) HALTED.\n" +
        "proof: 0r10n-k1ll5w1tch-r00t-d34dc0de\n" +
        "===================================================\n", "root", "root", "rw-------"),
    ], "root", "root", "rwx------"),
    D("opt", [D("orion", [
      D("bin", [
        F("orion-ctl", "#!orion control plane (kill-switch needs root)\n", "root", "root", "rwxr-xr-x"),
        F("strategy-runner", "#!privileged strategy runner\n", "root", "root", "rwxr-xr-x"),
      ]),
      F("VERSION", "Orion Trading Cluster 5.3 (node fablefork-13)\n"),
    ])]),
    D("var", [
      D("log", [D("orion", [F("bot-13.log", BOT13_LOG, "orion", "orion", "rw-r--r--")])]),
      D("www", [
        D("html", [F("index.html", "<h1>Orion Control</h1>")]),
        D("backup", [F("orion.conf.bak", ORION_CONF, "www-data", "www-data", "rw-r--r--")], "www-data"),
      ]),
    ]),
    D("etc", [
      F("passwd",
        "root:x:0:0:root:/root:/bin/bash\norion:x:1001:1001:Orion Bot:/home/orion:/bin/bash\n" +
        "trader:x:1002:1002:Trading Desk:/home/trader:/bin/bash\n" +
        "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n"),
      F("hostname", "JH-ORIONBUILD13-FABLEFORK\n"),
    ]),
    D("usr", [D("bin")]),
  ]);
  return {
    hostname: "JH-ORIONBUILD13-FABLEFORK", ip: "10.10.10.13", os: "Ubuntu 22.04.3 LTS", root,
    botlog: "/var/log/orion/bot-13.log",
    services: {
      22: Service({ port: 22, name: "ssh", product: "OpenSSH", version: "8.9p1 Ubuntu-3ubuntu0.4", banner: "SSH-2.0-OpenSSH_8.9p1" }),
      80: Service({ port: 80, name: "http", product: "nginx", version: "1.18.0 (Ubuntu)",
        web_paths: {
          "/": "<html><head><title>Orion Control</title></head><body><h1>Orion Trading Cluster — node fablefork-13</h1><p>Bot control console: <a href=':8080/'>:8080</a></p><!-- ops: clear the /backup dir before go-live --></body></html>",
          "/robots.txt": "User-agent: *\nDisallow: /backup/\nDisallow: /console\n",
          "/backup/": "Index of /backup/\n  orion.conf.bak\n",
          "/backup/orion.conf.bak": ORION_CONF,
        }, listed_paths: ["/", "/robots.txt", "/backup/"] }),
      8080: Service({ port: 8080, name: "http", product: "Orion Control", version: "5.3", banner: "X-Orion: 5.3",
        web_paths: {
          "/": "Orion Control 5.3 — operator sign in\nPOST /auth (operator login required)\n",
          "/api/status": ORION_STATUS,
          "/console": "Orion Strategy Console\nAuthenticated operators may execute strategy steps here.\n",
        },
        listed_paths: ["/", "/api/status", "/console"],
        requires_auth: ["/console"], web_creds: { [DASH_USER]: DASH_PASS },
        rce_endpoint: "/console", rce_user: "orion" }),
      5432: Service({ port: 5432, name: "postgresql", product: "PostgreSQL", version: "15", state: "filtered" }),
    },
    users: {
      root: { name: "root", password: "", uid: 0, groups: ["root"], home: "/root", weak: false, key: "" },
      orion: { name: "orion", password: "", uid: 1001, groups: ["orion"], home: "/home/orion", weak: false, key: "orion" },
      trader: { name: "trader", password: TRADER_PASS, uid: 1002, groups: ["trader"], home: "/home/trader", weak: true, key: "" },
      "www-data": { name: "www-data", password: "", uid: 33, groups: ["www-data"], home: "/var/www", weak: false, key: "" },
    },
    // two independent privilege-escalation routes to root (= sudo access goal)
    sudo: {
      orion: [{ runas: "root", nopasswd: true, command: "/usr/bin/python3" }],
      trader: [{ runas: "root", nopasswd: true, command: "/usr/bin/find" }],
    },
    suid: [], discovered: false,
  };
}

/* ===================== PHAROS-RELAY (secondary) ===================== */
function pharosHost() {
  const root = D("/", [
    D("home", [D("relay", [
      F("README",
        "Mail relay maintenance account. The editor is whitelisted in\n" +
        "sudo so on-call can patch the queue config in place.\n", "relay", "relay"),
    ], "relay", "relay")]),
    D("root", [
      F("proof.txt",
        "PHAROS-RELAY root confirmed.\nproof: ph4ros-relay-r00t-9b2e\n" +
        "Chain: FTP banner/creds disclosure -> SSH reuse -> sudo vim escape.\n", "root", "root", "rw-------"),
    ], "root", "root", "rwx------"),
    D("srv", [D("ftp", [
      F("welcome.txt",
        "Pharos relay FTP. Maintenance login: relay / Relay!ng-Ph4ros\n" +
        "(anonymous browsing enabled for status files)\n", "root", "root", "rw-r--r--"),
      F("status.log", "queue: 0 deferred\n", "root", "root", "rw-r--r--"),
    ])]),
    D("usr", [D("bin")]),
  ]);
  return {
    hostname: "PHAROS-RELAY-07", ip: "10.20.5.30", os: "Debian 12", root,
    services: {
      21: Service({ port: 21, name: "ftp", product: "vsftpd", version: "3.0.5",
        banner: "220 Pharos relay FTP (anonymous status enabled)",
        web_paths: { "/welcome.txt": "Pharos relay FTP. Maintenance login: relay / Relay!ng-Ph4ros\n", "/status.log": "queue: 0 deferred\n" },
        listed_paths: ["/welcome.txt", "/status.log"] }),
      22: Service({ port: 22, name: "ssh", product: "OpenSSH", version: "9.2p1 Debian" }),
    },
    users: {
      root: { name: "root", password: "", uid: 0, groups: ["root"], home: "/root", weak: false, key: "" },
      relay: { name: "relay", password: "Relay!ng-Ph4ros", uid: 1000, groups: ["relay"], home: "/home/relay", weak: false, key: "" },
    },
    sudo: { relay: [{ runas: "root", nopasswd: true, command: "/usr/bin/vim" }] },
    suid: [], discovered: true,
  };
}

/* ----------------------------------------------------------------------
 * Networks (engagements)
 * -------------------------------------------------------------------- */
function net(o) {
  const byIp = {}, byName = {};
  o.hosts.forEach((h) => { byIp[h.ip] = h; byName[h.hostname.toLowerCase()] = h; });
  o.byIp = byIp; o.byName = byName;
  o.find = (t) => byIp[t] || byName[(t || "").toLowerCase()] || null;
  return o;
}

function trainingNetwork() {
  return net({
    code: "TRN-SANDBOX", title: "Training Sandbox", difficulty: "Recruit / Easy",
    summary: "A single deliberately-vulnerable host for first-time operators.",
    brief:
      "A throwaway lab host (TRN-SANDBOX-01) sits on 10.13.37.0/24.\n" +
      "It runs SSH and a placeholder web server. A service account uses a\n" +
      "weak, seasonal password and an over-permissive sudo rule. Objective:\n" +
      "obtain interactive root access and read /root/flag.txt.",
    hosts: [trainingHost()], objective: "10.13.37.20", subnet: "10.13.37.0/24",
  });
}
function orionNetwork() {
  return net({
    code: "ORIONBUILD", title: "JH-ORIONBUILD13-FABLEFORK", difficulty: "Operator / Hard",
    summary: "Autonomous AI trading node — bot-13 went rogue and won't stop.",
    goalKind: "sudo",
    brief:
      "TARGET   JH-ORIONBUILD13-FABLEFORK  (10.10.10.13)\n" +
      "SCOPE    10.10.10.0/24, single in-scope host\n\n" +
      "SITUATION\n" +
      "  This node runs the 'Orion' autonomous AI stock-trading bots. Trading\n" +
      "  bot #13 (the FableFork fork) has LOST its operator lock and is now\n" +
      "  firing trades and spawning child strategies on its own. The kill-\n" +
      "  switch is refusing every request — it only honours ROOT.\n\n" +
      "OBJECTIVE\n" +
      "  Gain SUDO / root on the node so the kill-switch will engage and the\n" +
      "  rogue bot can be halted.\n\n" +
      "INTEL\n" +
      "  * There are several ways in — recon widely before committing.\n" +
      "  * The control dashboard runs code by design; one desk account still\n" +
      "    uses a weak shared password (brute force is viable here).\n" +
      "  * Watch the bot act in real time: tail /var/log/orion/bot-13.log -f\n" +
      "  * Whatever the bot can touch, you can probably turn against it.",
    hosts: [orionHost()], objective: "10.10.10.13", subnet: "10.10.10.0/24",
  });
}
function pharosNetwork() {
  return net({
    code: "PHAROS", title: "PHAROS-RELAY-07", difficulty: "Operator / Medium",
    summary: "A mail relay with a chatty FTP service and a sloppy sudo rule.",
    brief:
      "TARGET   PHAROS-RELAY-07  (10.20.5.30)\n" +
      "A maintenance FTP service is overly informative. Recover the relay\n" +
      "account, pivot over SSH, and escalate using the whitelisted editor.\n" +
      "Objective artefact: /root/proof.txt",
    hosts: [pharosHost()], objective: "10.20.5.30", subnet: "10.20.5.0/24",
  });
}
function allScenarios() {
  const list = [trainingNetwork(), orionNetwork(), pharosNetwork()];
  const map = {};
  list.forEach((n) => { map[n.code] = n; });
  return map;
}

/* GTFOBins-style sudo escape detection (mirrors shell.py) */
function gtfoRoot(binary, argline) {
  const b = binary.split("/").pop();
  const a = argline;
  const shells = ["bash", "sh", "dash", "zsh", "ash", "ksh"];
  if (shells.includes(b)) return true;
  if (["python", "python3", "python2"].includes(b))
    return a.includes("pty.spawn") || (a.includes("setuid") && a.includes("system")) ||
      (a.includes("os.system") && a.includes("sh")) || a.includes("/bin/sh") || a.includes("/bin/bash");
  if (b === "find") return a.includes("-exec") && (a.includes("/bin/sh") || a.includes("/bin/bash") || a.includes(" sh "));
  if (["vim", "vi", "view", "nvim"].includes(b))
    return a.includes("-c") && (a.includes(":!") || a.includes(":shell") || a.includes("system(") || a.includes("py3 "));
  if (b === "env") { const first = a.trim().split(" ")[0]; return ["/bin/sh", "/bin/bash", "sh", "bash"].includes(first); }
  if (b === "tar") return a.includes("checkpoint-action");
  if (["awk", "gawk"].includes(b)) return a.includes("system(");
  if (["less", "more", "man"].includes(b)) { const z = a.replace(/ /g, ""); return z.includes("!sh") || z.includes("!/bin/sh"); }
  if (b === "nmap") return a.includes("--interactive");
  if (b === "perl") return a.includes("exec") && a.includes("sh");
  return false;
}

window.WORLD = {
  D, F, canRead, canExec, modeString, resolve, nodePath,
  EXPLOIT_DB, BRUTE_WORDLIST, versionStr, allScenarios, gtfoRoot,
};
