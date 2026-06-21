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
  "winter2024", "root", "toor", "changeme", "qwerty", "P@ssw0rd", "Relay!ng-Ph4ros"];

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

/* ===================== ORIONBUILD (flagship) ======================== */
const CI_USER = "forge";
const CI_PASS = "Sp1n-The-F0rge-2o24";
const CONFIG_BAK =
  "# fableforge-ci config backup -- DO NOT COMMIT (oops)\n" +
  "[server]\nurl = http://localhost:8080/\nnode = JH-ORIONBUILD13-FABLEFORK\n\n" +
  "[credentials]\n# console operator used by the deploy bot\n" +
  "ci_user = " + CI_USER + "\nci_pass = " + CI_PASS + "\n\n" +
  "[database]\ndb_host = 127.0.0.1\ndb_user = forge_ro\ndb_pass = readonly-not-secret\n";
const ID_RSA =
  "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n" +
  "QyNTUxOQAAACDFableforgeCIdeploybotkeyDONOTSHAREaaaaaaaaaaaaaaaaaaaaAAAA\n" +
  "KFsorageyORIONBUILD13fableforkkeymaterialsimulatednotarealkeyAAAAtzc2gt\n" +
  "[ ... simulated ed25519 private key, truncated for display ... ]\n" +
  "-----END OPENSSH PRIVATE KEY-----";
const CI_API_JSON =
  '{\n  "mode": "EXCLUSIVE",\n  "nodeName": "JH-ORIONBUILD13-FABLEFORK",\n' +
  '  "numExecutors": 4,\n  "description": "Fableforge CI - FableFork release pipeline",\n' +
  '  "useSecurity": true,\n  "views": [{"name": "release-fablefork"}, {"name": "nightly"}],\n' +
  '  "_hint": "anonymous read is enabled; the script console requires an operator login"\n}';

function orionHost() {
  const root = D("/", [
    D("home", [
      D("ci", [
        D(".ssh", [
          F("id_rsa", ID_RSA, "ci", "ci", "rw-------"),
          F("authorized_keys", "ssh-ed25519 AAAAC3...deploybot ci@orionbuild\n", "ci", "ci", "rw-------"),
        ], "ci", "ci", "rwx------"),
        D("workspace", [
          D("fablefork", [
            F("README.md", "# FableFork\nRelease pipeline for the Orion build farm.\n", "ci", "ci"),
            F("deploy.sh", "#!/bin/bash\n# invoked by CI as the ci user\necho 'deploying fablefork build...'\n", "ci", "ci", "rwxr-xr-x"),
          ], "ci", "ci"),
        ], "ci", "ci"),
        F("notes.txt",
          "TODO: the deploy bot still has a python sudo exception from the\n" +
          "old packaging job. Security asked us to remove it weeks ago.\n" +
          "Run 'sudo -l' if you forget which one it is.\n", "ci", "ci"),
      ], "ci", "ci"),
    ]),
    D("root", [
      F("proof.txt",
        "================ JH-ORIONBUILD13-FABLEFORK ================\n" +
        "ROOT ACCESS CONFIRMED on the FableFork build controller.\n" +
        "proof: 0r10n-f4ble-d34dc0de-r00t\n" +
        "Chain: recon -> exposed /backup config disclosure ->\n" +
        "       authenticated Fableforge script-console RCE ->\n" +
        "       deploy-bot SSH key theft -> sudo python privesc.\n" +
        "Remediation: rotate ci creds, remove /backup, drop the\n" +
        "             python NOPASSWD rule, restrict the script console.\n" +
        "===========================================================\n", "root", "root", "rw-------"),
      F("root_notes.txt", "Pipeline secrets live in the CI credential store, not on disk.\n", "root", "root", "rw-------"),
    ], "root", "root", "rwx------"),
    D("opt", [D("fableforge", [
      D("bin", [F("forge-runner", "#!fableforge agent\n", "root", "root", "rwxr-xr-x")]),
      F("VERSION", "Fableforge CI 2.41\n"),
    ])]),
    D("var", [D("www", [
      D("html", [F("index.html", "<h1>Orion Build Farm</h1>")]),
      D("backup", [F("config.php.bak", CONFIG_BAK, "www-data", "www-data", "rw-r--r--")], "www-data"),
    ])]),
    D("etc", [
      F("passwd",
        "root:x:0:0:root:/root:/bin/bash\nci:x:1001:1001:Fableforge CI:/home/ci:/bin/bash\n" +
        "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n"),
      F("hostname", "JH-ORIONBUILD13-FABLEFORK\n"),
    ]),
    D("usr", [D("bin")]),
  ]);
  return {
    hostname: "JH-ORIONBUILD13-FABLEFORK", ip: "10.10.10.13", os: "Ubuntu 22.04.3 LTS", root,
    services: {
      22: Service({ port: 22, name: "ssh", product: "OpenSSH", version: "8.9p1 Ubuntu-3ubuntu0.4", banner: "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.4" }),
      80: Service({ port: 80, name: "http", product: "nginx", version: "1.18.0 (Ubuntu)",
        web_paths: {
          "/": "<html><head><title>Orion Build Farm</title></head><body><h1>Orion Build Farm</h1><p>FableFork release controller. CI console: <a href=':8080/'>:8080</a></p><!-- ops backups under /backup, clean these up --></body></html>",
          "/robots.txt": "User-agent: *\nDisallow: /backup/\nDisallow: /server-status\n",
          "/backup/": "Index of /backup/\n  config.php.bak\n",
          "/backup/config.php.bak": CONFIG_BAK,
        }, listed_paths: ["/", "/robots.txt", "/backup/"] }),
      8080: Service({ port: 8080, name: "http", product: "Fableforge CI", version: "2.41", banner: "X-Fableforge: 2.41",
        web_paths: {
          "/": "Fableforge CI 2.41 - sign in\nPOST /j_acegi_security_check (form login required)\n",
          "/api/json": CI_API_JSON,
          "/login": "Fableforge CI - operator authentication required\n",
          "/script": "Fableforge Script Console\nAuthenticated operators may execute build steps here.\n",
        },
        listed_paths: ["/", "/api/json", "/login", "/script"],
        requires_auth: ["/script"], web_creds: { [CI_USER]: CI_PASS },
        rce_endpoint: "/script", rce_user: "ci" }),
      3306: Service({ port: 3306, name: "mysql", product: "MySQL", version: "8.0", state: "filtered" }),
    },
    users: {
      root: { name: "root", password: "", uid: 0, groups: ["root"], home: "/root", weak: false, key: "" },
      ci: { name: "ci", password: "", uid: 1001, groups: ["ci"], home: "/home/ci", weak: false, key: "ci" },
      "www-data": { name: "www-data", password: "", uid: 33, groups: ["www-data"], home: "/var/www", weak: false, key: "" },
    },
    sudo: { ci: [{ runas: "root", nopasswd: true, command: "/usr/bin/python3" }] },
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
    code: "ORIONBUILD", title: "JH-ORIONBUILD13-FABLEFORK", difficulty: "Operator / Medium-Hard",
    summary: "Internet-facing CI/build controller for the FableFork pipeline.",
    brief:
      "TARGET   JH-ORIONBUILD13-FABLEFORK  (10.10.10.13)\n" +
      "SCOPE    10.10.10.0/24, single in-scope host\n" +
      "CONTEXT  A build controller (Fableforge CI) drives the FableFork\n" +
      "         release pipeline. Asset owners report 'it's locked down'.\n\n" +
      "OBJECTIVE\n" +
      "  Establish a foothold and escalate to root on the controller.\n" +
      "  Confirmation artefact: /root/proof.txt\n\n" +
      "NOTES\n" +
      "  * No published credentials. The login is not brute-forceable in a\n" +
      "    reasonable window -- look for what the operators left exposed.\n" +
      "  * CI servers run code by design; a console is only as safe as its\n" +
      "    weakest authenticated path.\n" +
      "  * Treat anything the build agent can touch as in play.",
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
