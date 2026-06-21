/* injectAI web build -- terminal engine, tooling and REPL loops.
 * Browser port of app.py / console.py / shell.py / training.py. */
"use strict";

const W = window.WORLD;
const $out = document.getElementById("out");
const $input = document.getElementById("cmd");
const $prompt = document.getElementById("prompt");
const $screen = document.getElementById("screen");

/* ----------------------------------------------------------------------
 * Output + colour
 * -------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function c(text, ...cls) {
  return '<span class="' + cls.join(" ") + '">' + escapeHtml(text) + "</span>";
}
function writeLine(html) {
  const div = document.createElement("div");
  div.className = "line";
  div.innerHTML = html === "" ? "&nbsp;" : html;
  $out.appendChild(div);
}
function write(html) {
  String(html).split("\n").forEach(writeLine);
  $screen.scrollTop = $screen.scrollHeight;
}
function hr(n = 60) { write(c("─".repeat(n), "grey")); }
function box(title, lines, width = 66, col = "cyan") {
  write(c("┌" + "─".repeat(width - 2) + "┐", col));
  if (title) {
    write(c("│ ", col) + c(title.padEnd(width - 4), "bold") + c(" │", col));
    write(c("├" + "─".repeat(width - 2) + "┤", col));
  }
  lines.forEach((ln) => {
    const pad = Math.max(0, width - 4 - visibleLen(ln));
    write(c("│ ", col) + ln + " ".repeat(pad) + c(" │", col));
  });
  write(c("└" + "─".repeat(width - 2) + "┘", col));
}
function visibleLen(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").length;
}
function clearScreen() { $out.innerHTML = ""; }

async function progress(label, ms = 600) {
  const div = document.createElement("div");
  div.className = "line";
  $out.appendChild(div);
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const filled = Math.round((i / steps) * 24);
    const bar = "█".repeat(filled) + "·".repeat(24 - filled);
    const pct = Math.round((i / steps) * 100);
    div.innerHTML = escapeHtml(label) + " [" + c(bar, "green") + "] " +
      String(pct).padStart(3) + "%";
    $screen.scrollTop = $screen.scrollHeight;
    await sleep(ms / steps);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------------
 * Line input (promise based)
 * -------------------------------------------------------------------- */
let pendingResolve = null;
const history = [];
let histIdx = 0;

function readLine(promptObj) {
  // promptObj: string | {pre:[html...], inline:html, mask:bool}
  let pre = [], inline = "", mask = false;
  if (typeof promptObj === "string") inline = promptObj;
  else { pre = promptObj.pre || []; inline = promptObj.inline || ""; mask = !!promptObj.mask; }
  pre.forEach(write);
  $prompt.innerHTML = inline;
  $input.type = mask ? "password" : "text";
  $input.value = "";
  $input.focus();
  return new Promise((resolve) => {
    pendingResolve = (val) => {
      writeLine(inline + (mask ? "" : escapeHtml(val)));
      $screen.scrollTop = $screen.scrollHeight;
      resolve(val);
    };
  });
}

$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = $input.value;
    if (val.trim() && !$input.type.includes("password")) {
      history.push(val); histIdx = history.length;
    }
    const r = pendingResolve; pendingResolve = null;
    $input.value = "";
    if (r) r(val);
  } else if (e.key === "ArrowUp") {
    if (histIdx > 0) { histIdx--; $input.value = history[histIdx] || ""; }
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    if (histIdx < history.length) { histIdx++; $input.value = history[histIdx] || ""; }
    e.preventDefault();
  } else if (e.key === "l" && e.ctrlKey) {
    clearScreen(); e.preventDefault();
  }
});
document.addEventListener("click", () => $input.focus());

/* simple shell-style tokeniser (handles quotes) */
function tokenize(line) {
  const out = [];
  let cur = "", q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === " " || ch === "\t") { if (cur !== "") { out.push(cur); cur = ""; } }
    else cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out;
}

/* ----------------------------------------------------------------------
 * Config persistence
 * -------------------------------------------------------------------- */
const DEFAULT_CONFIG = { colour: true, hints: true, operator: "operator", completed: [], training_best: "" };
function loadConfig() {
  try { return Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem("injectai_state") || "{}")); }
  catch (e) { return Object.assign({}, DEFAULT_CONFIG); }
}
function saveConfig(cfg) {
  try { localStorage.setItem("injectai_state", JSON.stringify(cfg)); } catch (e) {}
}

/* ----------------------------------------------------------------------
 * Game state
 * -------------------------------------------------------------------- */
function buildOperatorHost(operator) {
  const home = W.D(operator, [
    W.F("README.txt",
      "injectAI operator workstation.\nRecon and tooling run from here. `help` lists utilities.\n" +
      "Loot you recover (keys, credentials) lands in ./loot.\n", operator, operator),
    W.D("loot", [], operator, operator),
    W.D("wordlists", [
      W.F("common.txt",
        "123456\npassword\nadmin\nletmein\nsummer2023\nwinter2024\nroot\ntoor\nchangeme\nqwerty\nP@ssw0rd\n",
        operator, operator),
    ], operator, operator),
  ], operator, operator);
  const root = W.D("/", [W.D("home", [home]), W.D("etc"), W.D("usr", [W.D("bin")])]);
  return {
    hostname: "injectai", ip: "10.10.0.5", os: "Kali-style operator box", root,
    services: {}, sudo: {}, suid: [], discovered: true,
    users: { [operator]: { name: operator, password: "", uid: 1000, groups: [operator, "sudo"], home: "/home/" + operator, weak: false, key: "" } },
  };
}

class GameState {
  constructor(cfg) {
    this.config = cfg;
    this.operator = cfg.operator || "operator";
    this.operatorHost = buildOperatorHost(this.operator);
    this.network = null;
    this.loot = { creds: [], keys: {} };
    this.discovered = new Set();
    this.scanned = {};
    this.sessions = [{ host: this.operatorHost, user: this.operator, cwd: this.homeNode(this.operatorHost, this.operator), label: "local" }];
  }
  homeNode(host, user) {
    const u = host.users[user];
    const home = u ? u.home : "/root";
    return W.resolve(host.root, host.root, home) || host.root;
  }
  get session() { return this.sessions[this.sessions.length - 1]; }
  push(host, user, label) {
    this.sessions.push({ host, user, cwd: this.homeNode(host, user), label });
  }
  pop() { if (this.sessions.length > 1) { this.sessions.pop(); return true; } return false; }
  loadNetwork(n) {
    this.network = n;
    this.loot = { creds: [], keys: {} };
    this.discovered = new Set();
    this.scanned = {};
    this.sessions = [{ host: this.operatorHost, user: this.operator, cwd: this.homeNode(this.operatorHost, this.operator), label: "local" }];
    n.hosts.forEach((h) => { if (h.discovered) this.discovered.add(h.ip); });
  }
  reachable(t) {
    if (t === this.operatorHost.ip || t === this.operatorHost.hostname) return this.operatorHost;
    return this.network ? this.network.find(t) : null;
  }
  addCred(label, user, secret) {
    if (!this.loot.creds.some((x) => x[0] === label && x[1] === user && x[2] === secret)) {
      this.loot.creds.push([label, user, secret]); return true;
    }
    return false;
  }
  addKey(id, owner) { if (!(id in this.loot.keys)) { this.loot.keys[id] = owner; return true; } return false; }
  markRooted(code) {
    if (!this.config.completed.includes(code)) { this.config.completed.push(code); saveConfig(this.config); return true; }
    return false;
  }
}

/* ----------------------------------------------------------------------
 * Operational shell
 * -------------------------------------------------------------------- */
class Shell {
  constructor(state) { this.state = state; this._cap = null; }
  emit(text = "") { if (this._cap !== null) this._cap.push(text); else write(text); }

  prompt() {
    const s = this.state.session, user = s.user, host = s.host;
    let cwd = W.nodePath(s.cwd);
    const u = host.users[user];
    const home = u ? u.home : (user === "root" ? "/root" : "/home/" + user);
    if (cwd === home) cwd = "~";
    else if (cwd.startsWith(home + "/")) cwd = "~" + cwd.slice(home.length);
    const isRoot = user === "root";
    const usercol = isRoot ? "brightred" : "brightblue";
    const sym = isRoot ? "#" : "$";
    const line1 = c("┌──(", "grey") + c(user, usercol, "bold") + c("㉿", "grey") +
      c(host.hostname, "brightgreen") + c(")-[", "grey") + c(cwd, "white") + c("]", "grey");
    const inline = c("└─", "grey") + c(sym + " ", usercol, "bold");
    return { pre: [line1], inline };
  }

  async runLine(line) {
    line = line.trim();
    if (!line) return null;
    const parts = tokenize(line);
    const name = parts[0], args = parts.slice(1);
    const fn = this.CMD[name];
    if (!fn) { this.emit(name + ": command not found"); return null; }
    return await fn.call(this, args, line);
  }

  homePath() {
    const s = this.state.session, u = s.host.users[s.user];
    return u ? u.home : (s.user === "root" ? "/root" : "/home/" + s.user);
  }

  async execCapture(host, user, command) {
    const allowed = new Set(["cat", "ls", "id", "whoami", "pwd", "echo", "find", "hostname"]);
    const sub = new Shell(this.state);
    sub._cap = [];
    const saved = this.state.sessions;
    this.state.sessions = saved.concat([{ host, user, cwd: this.state.homeNode(host, user), label: "rce" }]);
    try {
      const nm = (tokenize(command)[0] || "");
      if (!allowed.has(nm)) sub.emit(nm + ": not permitted in this execution context");
      else await sub.runLine(command);
    } finally { this.state.sessions = saved; }
    return sub._cap.join("\n");
  }

  resolveTarget(t) { return this.state.reachable(t); }

  parseUrl(raw) {
    let u = raw, proto = "http";
    if (u.includes("://")) { [proto, u] = u.split("://"); u = u; }
    let hostport, path;
    const slash = u.indexOf("/");
    if (slash >= 0) { hostport = u.slice(0, slash); path = u.slice(slash); }
    else { hostport = u; path = "/"; }
    let host, port;
    if (hostport.includes(":")) {
      const i = hostport.lastIndexOf(":");
      host = hostport.slice(0, i);
      const ps = hostport.slice(i + 1);
      port = /^\d+$/.test(ps) ? parseInt(ps) : (proto === "ftp" ? 21 : 80);
    } else { host = hostport; port = proto === "ftp" ? 21 : 80; }
    return { proto, host, port, path };
  }
}

/* ---- command implementations ---------------------------------------- */
Shell.prototype.CMD = {};
const CMD = Shell.prototype.CMD;

CMD.help = function () {
  const rows = [
    ["Recon", "nmap, ping, ifconfig, netstat"],
    ["Web", "curl, wget, gobuster/dirb"],
    ["Intel", "searchsploit, man <tool>"],
    ["Access", "hydra, ftp, ssh"],
    ["Local", "ls cd cat pwd whoami id find grep echo sudo"],
    ["Session", "loot, status, sessions, clear, back/exit"],
  ];
  write("");
  rows.forEach(([k, v]) => this.emit("  " + c(k.padEnd(9), "cyan", "bold") + c(v, "white")));
  this.emit("");
  this.emit(c("  man <tool> shows usage. `back` returns to the console.", "grey"));
  this.emit("");
};
CMD["?"] = CMD.help;
CMD.man = function (args) {
  const pages = {
    nmap: "nmap [-sV] [-p-] <host>      port/service discovery",
    curl: "curl [-u u:p] [-d data] <url>   HTTP/FTP client",
    gobuster: "gobuster dir -u <url>        content/path discovery",
    hydra: "hydra -l <user> -P <list> ssh://<host>   online password attack",
    ssh: "ssh [-i <keyid>] <user>@<host>   remote login",
    ftp: "ftp <host>                   inspect an FTP service",
    sudo: "sudo -l ; sudo <command>     run as another user",
    searchsploit: "searchsploit <term>          search local exploit notes",
  };
  if (!args.length) { this.emit("usage: man <tool>; pages: " + Object.keys(pages).sort().join(", ")); return; }
  this.emit(pages[args[0]] || ("No manual entry for " + args[0]));
};
CMD.clear = function () { clearScreen(); };
CMD.back = function () { return "BACK"; };
CMD.exit = function () { if (this.state.pop()) this.emit(c("logout", "grey")); else return "BACK"; };
CMD.sessions = function () {
  this.emit(c("active sessions (most recent last):", "cyan"));
  this.state.sessions.forEach((s, i) => {
    const tag = i === 0 ? "local" : s.label;
    this.emit("  [" + i + "] " + s.user + "@" + s.host.hostname + "  (" + tag + ")");
  });
};
CMD.loot = function () {
  const loot = this.state.loot;
  if (!loot.creds.length && !Object.keys(loot.keys).length) { this.emit(c("loot store empty.", "grey")); return; }
  if (loot.creds.length) {
    this.emit(c("credentials:", "cyan", "bold"));
    loot.creds.forEach(([label, user, secret]) =>
      this.emit("  " + label + ": " + c(user, "yellow") + " / " + c(secret, "yellow")));
  }
  if (Object.keys(loot.keys).length) {
    this.emit(c("private keys:", "cyan", "bold"));
    for (const kid in loot.keys)
      this.emit("  " + c(kid, "yellow") + "  (" + loot.keys[kid] + ")  -> ssh -i " + kid + " " + loot.keys[kid]);
  }
};
CMD.status = function () {
  const net = this.state.network;
  this.emit(c("engagement: " + (net ? net.title : "-") + "  [" + (net ? net.difficulty : "") + "]", "cyan"));
  this.emit("discovered hosts:");
  Array.from(this.state.discovered).sort().forEach((ip) => {
    const h = this.state.reachable(ip);
    const ports = Array.from(this.state.scanned[ip] || []).sort((a, b) => a - b);
    const pinfo = ports.length ? ports.join(",") : "unscanned";
    this.emit("  " + ip.padEnd(15) + " " + (h ? h.hostname : "?").padEnd(28) + " [" + pinfo + "]");
  });
};

/* -- local shell builtins -- */
CMD.whoami = function () { this.emit(this.state.session.user); };
CMD.id = function () {
  const s = this.state.session, u = s.host.users[s.user];
  const uid = u ? u.uid : 0, groups = u ? u.groups : [s.user];
  const g = groups.map((gr, i) => (1000 + i) + "(" + gr + ")").join(",");
  this.emit("uid=" + uid + "(" + s.user + ") gid=" + uid + "(" + s.user + ") groups=" + g);
};
CMD.hostname = function () { this.emit(this.state.session.host.hostname); };
CMD.pwd = function () { this.emit(W.nodePath(this.state.session.cwd)); };
CMD.echo = function (args) { this.emit(args.join(" ")); };
CMD.ifconfig = function () {
  const ip = this.state.session.host.ip;
  this.emit("eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500");
  this.emit("        inet " + ip + "  netmask 255.255.255.0");
};
CMD.ip = CMD.ifconfig;
CMD.netstat = function () {
  this.emit("Proto Local Address           State");
  const s = this.state.session;
  Object.values(s.host.services).filter((x) => x.state !== "closed")
    .sort((a, b) => a.port - b.port)
    .forEach((svc) => this.emit("tcp   0.0.0.0:" + String(svc.port).padEnd(18) + " LISTEN"));
};
CMD.ls = function (args) {
  let long = false; const paths = [];
  args.forEach((a) => { if (a.startsWith("-")) { if (a.includes("l")) long = true; } else paths.push(a); });
  const s = this.state.session;
  const target = paths[0] || ".";
  const node = W.resolve(s.host.root, s.cwd, target, this.homePath());
  if (!node) { this.emit("ls: cannot access '" + target + "': No such file or directory"); return; }
  if (!node.dir) { this.lsEmit(node, long); return; }
  if (!W.canRead(node, s.user)) { this.emit("ls: cannot open directory '" + target + "': Permission denied"); return; }
  Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)).forEach((ch) => this.lsEmit(ch, long));
};
Shell.prototype.lsEmit = function (node, long) {
  const u = this.state.session.user;
  const cls = node.dir ? "brightblue" : (W.canExec(node, u) ? "brightgreen" : "white");
  const name = c(node.name + (node.dir ? "/" : ""), cls);
  if (long) {
    this.emit(W.modeString(node) + "  1 " + node.owner.padEnd(8) + " " + node.group.padEnd(8) +
      " " + String(node.content.length).padStart(6) + " " + name);
  } else this.emit(name);
};
CMD.cd = function (args) {
  const s = this.state.session;
  const target = args[0] || this.homePath();
  const node = W.resolve(s.host.root, s.cwd, target, this.homePath());
  if (!node || !node.dir) { this.emit("cd: " + target + ": No such file or directory"); return; }
  if (!W.canExec(node, s.user)) { this.emit("cd: " + target + ": Permission denied"); return; }
  s.cwd = node;
};
CMD.cat = function (args) {
  if (!args.length) { this.emit("usage: cat <file>"); return; }
  const s = this.state.session;
  args.forEach((target) => {
    const node = W.resolve(s.host.root, s.cwd, target, this.homePath());
    if (!node) { this.emit("cat: " + target + ": No such file or directory"); return; }
    if (node.dir) { this.emit("cat: " + target + ": Is a directory"); return; }
    if (!W.canRead(node, s.user)) { this.emit("cat: " + target + ": Permission denied"); return; }
    this.emit(node.content.replace(/\n$/, ""));
    this.maybeLootFile(node);
    this.maybeObjective(node);
  });
};
CMD.find = function (args) {
  const s = this.state.session;
  if (args.includes("-perm") && args.some((a) => a.includes("4000"))) {
    const paths = s.host.suid || [];
    if (paths.length) paths.forEach((p) => this.emit(p));
    else { this.emit("/usr/bin/sudo"); this.emit("/usr/bin/passwd"); }
    return;
  }
  const start = args.find((a) => !a.startsWith("-")) || ".";
  const node = W.resolve(s.host.root, s.cwd, start, this.homePath());
  if (!node) { this.emit("find: '" + start + "': No such file or directory"); return; }
  let nameFilter = null;
  const ni = args.indexOf("-name");
  if (ni >= 0 && ni + 1 < args.length) nameFilter = args[ni + 1];
  this.walk(node, nameFilter);
};
Shell.prototype.walk = function (node, nameFilter) {
  const u = this.state.session.user;
  if (nameFilter === null || fnmatch(node.name, nameFilter)) this.emit(W.nodePath(node));
  if (node.dir && W.canRead(node, u))
    Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)).forEach((ch) => this.walk(ch, nameFilter));
};
CMD.grep = function (args) {
  if (args.length < 2) { this.emit("usage: grep <pattern> <file>"); return; }
  const pattern = args[0], s = this.state.session;
  args.slice(1).forEach((target) => {
    const node = W.resolve(s.host.root, s.cwd, target, this.homePath());
    if (!node || node.dir || !W.canRead(node, s.user)) return;
    node.content.split("\n").forEach((ln) => { if (ln.includes(pattern)) this.emit(ln); });
  });
};

/* -- network tooling -- */
CMD.ping = function (args) {
  const target = args.find((a) => !a.startsWith("-"));
  const host = target ? this.resolveTarget(target) : null;
  if (!host) { this.emit("ping: " + target + ": Name or service not known"); return; }
  this.state.discovered.add(host.ip);
  for (let i = 0; i < 3; i++) this.emit("64 bytes from " + host.ip + ": icmp_seq=" + (i + 1) + " ttl=64 time=0.4 ms");
  this.emit("--- " + host.ip + " ping statistics ---");
  this.emit("3 packets transmitted, 3 received, 0% packet loss");
};
CMD.nmap = async function (args) {
  const sv = args.includes("-sV");
  const target = args.find((a) => !a.startsWith("-"));
  const host = target ? this.resolveTarget(target) : null;
  if (!host) { this.emit('Failed to resolve "' + target + '".'); return; }
  if (this._cap === null) await progress("nmap: scanning", 700);
  this.state.discovered.add(host.ip);
  if (!this.state.scanned[host.ip]) this.state.scanned[host.ip] = new Set();
  this.emit("Starting Nmap scan against " + host.ip + " (" + host.hostname + ")");
  this.emit("PORT      STATE     SERVICE" + (sv ? "    VERSION" : ""));
  Object.values(host.services).sort((a, b) => a.port - b.port).forEach((svc) => {
    if (svc.state === "closed") return;
    this.state.scanned[host.ip].add(svc.port);
    const port = (svc.port + "/" + svc.proto).padEnd(9);
    const state = svc.state.padEnd(9);
    let row = port + " " + state + " " + svc.name;
    if (sv) row = row.padEnd(34) + W.versionStr(svc);
    this.emit(row);
  });
  this.emit("");
  if (!sv && this.state.config.hints) this.emit(c("hint: add -sV to fingerprint service versions.", "grey"));
};
CMD.curl = async function (args) {
  let url = null, auth = null, data = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === "-u" || a === "--user") && i + 1 < args.length) { auth = args[++i]; continue; }
    if ((a === "-d" || a === "--data" || a === "--data-urlencode") && i + 1 < args.length) { data = args[++i]; continue; }
    if (["-X", "-H", "-o", "-A"].includes(a) && i + 1 < args.length) { i++; continue; }
    if (a.startsWith("-")) continue;
    url = a;
  }
  if (!url) { this.emit("usage: curl [-u user:pass] [-d data] <url>"); return; }
  const { proto, host: hs, port, path } = this.parseUrl(url);
  const host = this.resolveTarget(hs);
  if (!host) { this.emit("curl: (6) Could not resolve host: " + hs); return; }
  const svc = host.services[port];
  if (!svc || svc.state !== "open") { this.emit("curl: (7) Failed to connect to " + hs + " port " + port + ": Connection refused"); return; }
  this.state.discovered.add(host.ip);
  if (data && svc.rce_endpoint && path.replace(/\/$/, "") === svc.rce_endpoint.replace(/\/$/, "")) {
    if (!this.webAuthed(svc, auth)) {
      this.emit("HTTP/1.1 403 Forbidden");
      this.emit("Fableforge: authentication required for the script console");
      return;
    }
    const command = this.extractRce(data);
    if (!command) { this.emit("Fableforge: empty build step"); return; }
    const outp = await this.execCapture(host, svc.rce_user, command);
    this.emit(c("[Fableforge] executing build step as '" + svc.rce_user + "'", "grey"));
    this.emit(outp);
    return;
  }
  if (svc.requires_auth.includes(path) && !this.webAuthed(svc, auth)) { this.emit("HTTP/1.1 403 Forbidden"); return; }
  let body = svc.web_paths[path];
  if (body === undefined && path.endsWith("/")) body = svc.web_paths[path.replace(/\/$/, "") + "/"];
  if (body === undefined) { this.emit("HTTP/1.1 404 Not Found  (" + hs + ":" + port + path + ")"); return; }
  this.emit(body.replace(/\n$/, ""));
  this.maybeLootText(body, host.hostname + ":" + port);
};
Shell.prototype.webAuthed = function (svc, auth) {
  if (!auth || !auth.includes(":")) return false;
  const i = auth.indexOf(":");
  return svc.web_creds[auth.slice(0, i)] === auth.slice(i + 1);
};
Shell.prototype.extractRce = function (data) {
  let d = data.trim();
  for (const p of ["script=", "cmd=", "command="]) if (d.startsWith(p)) { d = d.slice(p.length); break; }
  if (d.includes(".execute()")) return d.split(".execute()")[0].trim().replace(/^['"]|['"]$/g, "");
  return d.trim().replace(/^['"]|['"]$/g, "");
};
CMD.wget = CMD.curl;
CMD.gobuster = async function (args) {
  let url = args.find((a) => !a.startsWith("-") && a !== "dir" && a !== "dns" && (a.includes(":") || a.includes(".") || a.startsWith("http")));
  if (!url) url = args.find((a) => !a.startsWith("-") && a !== "dir");
  if (!url) { this.emit("usage: gobuster dir -u <url>"); return; }
  const { host: hs, port } = this.parseUrl(url);
  const host = this.resolveTarget(hs);
  const svc = host ? host.services[port] : null;
  if (!host || !svc || svc.state !== "open") { this.emit("Error: connection refused to " + hs + ":" + port); return; }
  if (this._cap === null) await progress("gobuster: enumerating", 800);
  this.state.discovered.add(host.ip);
  this.emit("===============================================================");
  this.emit("Gobuster v3 -> http://" + hs + ":" + port);
  this.emit("===============================================================");
  const found = svc.listed_paths.length ? svc.listed_paths : Object.keys(svc.web_paths);
  found.forEach((p) => this.emit(p.padEnd(28) + " (Status: " + (svc.requires_auth.includes(p) ? 403 : 200) + ")"));
  this.emit("===============================================================");
};
CMD.dirb = CMD.gobuster;
CMD.searchsploit = function (args) {
  const term = args.join(" ").toLowerCase();
  if (!term) { this.emit("usage: searchsploit <term>"); return; }
  this.emit("-".repeat(70));
  this.emit("Exploit Title".padEnd(52) + " Path");
  this.emit("-".repeat(70));
  const hits = W.EXPLOIT_DB.filter(([t]) => term.split(" ").every((w) => t.toLowerCase().includes(w)));
  if (!hits.length) this.emit("Exploits: No Results");
  hits.forEach(([title, path]) => this.emit(title.slice(0, 51).padEnd(52) + " " + path));
  this.emit("-".repeat(70));
};
CMD.hydra = async function (args) {
  let user = null, target = null, service = "ssh";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-l" && i + 1 < args.length) { user = args[++i]; continue; }
    if (a === "-P" && i + 1 < args.length) { i++; continue; }
    if (a.includes("://")) { const [svc, rest] = a.split("://"); service = svc; target = rest; continue; }
    if (!a.startsWith("-")) { if (target === null) target = a; else service = a; }
  }
  const host = target ? this.resolveTarget(target) : null;
  if (!host || !user) { this.emit("usage: hydra -l <user> -P <wordlist> ssh://<host>"); return; }
  const u = host.users[user];
  const open = Object.values(host.services).filter((s) => s.state !== "closed");
  const port = service === "ssh" ? 22 : (open.find((s) => s.name === service) || { port: 22 }).port;
  if (this._cap === null) await progress("hydra: attacking " + service + "://" + host.ip, 1000);
  this.emit("[DATA] attacking " + service + "://" + host.ip + ":" + port + "/");
  if (u && u.weak && W.BRUTE_WORDLIST.includes(u.password)) {
    this.emit(c("[" + port + "][" + service + "] host: " + host.ip + "   login: " + user + "   password: " + u.password, "brightgreen", "bold"));
    if (this.state.addCred(host.hostname + " " + service, user, u.password)) this.emit(c("  -> stored in loot (run `loot`)", "grey"));
    this.emit("1 of 1 target successfully completed, 1 valid password found");
  } else {
    this.emit("0 valid passwords found");
    this.emit(c("[STATUS] password not in wordlist; this account is not online-brute-forceable.", "grey"));
  }
};
CMD.ftp = function (args) {
  const target = args.find((a) => !a.startsWith("-"));
  const host = target ? this.resolveTarget(target) : null;
  const svc = host ? host.services[21] : null;
  if (!host || !svc || svc.state !== "open") { this.emit("ftp: connect to address " + target + ": Connection refused"); return; }
  this.state.discovered.add(host.ip);
  this.emit(svc.banner || ("220 " + host.hostname + " FTP"));
  this.emit("Name: anonymous");
  this.emit("230 Anonymous login ok, restrictions apply");
  this.emit("ftp> ls");
  (svc.listed_paths.length ? svc.listed_paths : Object.keys(svc.web_paths)).forEach((p) => this.emit(p.replace(/^\//, "")));
  this.emit("ftp> (use `curl ftp://" + host.ip + "/<file>` to retrieve a file)");
};
CMD.ssh = async function (args) {
  let keyid = null, dest = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-i" && i + 1 < args.length) { keyid = args[++i]; continue; }
    if (["-p", "-o", "-l"].includes(a) && i + 1 < args.length) { i++; continue; }
    if (a.startsWith("-")) continue;
    dest = a;
  }
  if (!dest) { this.emit("usage: ssh [-i keyid] user@host"); return; }
  let user, hoststr;
  if (dest.includes("@")) [user, hoststr] = dest.split("@"); else { user = this.state.session.user; hoststr = dest; }
  const host = this.resolveTarget(hoststr);
  if (!host) { this.emit("ssh: Could not resolve hostname " + hoststr + ": Name or service not known"); return; }
  const svc = host.services[22];
  if (!svc || svc.state !== "open") { this.emit("ssh: connect to host " + hoststr + " port 22: Connection refused"); return; }
  const tu = host.users[user];
  if (!tu) { this.emit(c(user + "@" + host.ip + ": Permission denied (publickey,password).", "red")); return; }
  if (keyid) {
    if (tu.key && tu.key === keyid) { this.sshSuccess(host, user, "ssh key:" + keyid); return; }
    this.emit(c(user + "@" + host.ip + ": Permission denied (publickey).", "red"));
    this.emit(c("  (the key does not authenticate this account)", "grey"));
    return;
  }
  if (!tu.password) {
    this.emit(c(user + "@" + host.ip + ": Permission denied (publickey,password).", "red"));
    this.emit(c("  (no password set; this account likely needs a key)", "grey"));
    return;
  }
  const pw = await readLine({ inline: user + "@" + host.ip + "'s password: ", mask: true });
  if (pw === tu.password) this.sshSuccess(host, user, "ssh password");
  else this.emit(c("Permission denied, please try again.", "red"));
};
Shell.prototype.sshSuccess = function (host, user, label) {
  this.emit(c("Welcome to " + host.os + " (" + host.hostname + ")", "brightgreen"));
  this.emit(c("Last login: from " + this.state.session.host.ip, "grey"));
  this.state.push(host, user, label);
  this.state.discovered.add(host.ip);
};
CMD.sudo = async function (args) {
  const s = this.state.session;
  const rules = (s.host.sudo || {})[s.user] || [];
  if (args.length && (args[0] === "-l" || args[0] === "--list")) {
    if (!rules.length) { this.emit("Sorry, user " + s.user + " may not run sudo on " + s.host.hostname + "."); return; }
    this.emit("Matching Defaults entries for " + s.user + " on " + s.host.hostname + ":");
    this.emit("    env_reset, secure_path=/usr/local/sbin\\:/usr/bin");
    this.emit("");
    this.emit("User " + s.user + " may run the following commands on " + s.host.hostname + ":");
    rules.forEach((r) => this.emit("    (" + r.runas + ") " + (r.nopasswd ? "NOPASSWD: " : "") + r.command));
    return;
  }
  if (!args.length) { this.emit("usage: sudo -l | sudo <command>"); return; }
  const binary = args[0], argline = args.slice(1).join(" ");
  const match = this.matchSudo(rules, binary);
  if (!match) { this.emit(c("Sorry, user " + s.user + " is not allowed to execute '" + binary + "' as root on " + s.host.hostname + ".", "red")); return; }
  if (!match.nopasswd) {
    const pw = await readLine({ inline: "[sudo] password for " + s.user + ": ", mask: true });
    const real = s.host.users[s.user];
    if (!real || pw !== real.password) { this.emit(c("sudo: incorrect password", "red")); return; }
  }
  if (W.gtfoRoot(binary, argline)) {
    this.emit(c("[+] interpreter/escape via " + binary.split("/").pop() + " -> uid 0", "brightgreen"));
    this.state.push(s.host, "root", "sudo " + binary.split("/").pop());
    this.emit(c("root@" + s.host.hostname + ":# id", "grey"));
    this.emit("uid=0(root) gid=0(root) groups=0(root)");
  } else {
    const ran = (binary + " " + argline).trim();
    this.emit(c("(ran '" + ran + "' as root, but it returned no interactive shell)", "grey"));
    if (this.state.config.hints)
      this.emit(c("hint: a permitted binary is only useful if it can spawn or read as root. Check GTFOBins-style escapes (e.g. an interpreter with a shell payload, or -exec).", "grey"));
  }
};
Shell.prototype.matchSudo = function (rules, binary) {
  const base = binary.split("/").pop();
  for (const r of rules) {
    if (r.command === "ALL") return r;
    if (r.command === binary || r.command.split("/").pop() === base) return r;
  }
  return null;
};

/* -- loot detection -- */
Shell.prototype.maybeLootFile = function (node) {
  if (node.name === "id_rsa" || node.content.includes("PRIVATE KEY")) {
    const s = this.state.session, owner = node.owner;
    let keyid = owner;
    const hu = s.host.users[owner];
    if (hu && hu.key) keyid = hu.key;
    if (this.state.addKey(keyid, owner + "@" + s.host.hostname))
      this.emit(c("\n[+] private key recovered -> loot (id '" + keyid + "'). Try: ssh -i " + keyid + " " + owner + "@" + s.host.ip, "brightgreen"));
  }
};
Shell.prototype.maybeLootText = function (text, source) {
  const um = text.match(/^\s*ci_user\s*=\s*(\S+)/im);
  const pm = text.match(/^\s*ci_pass\s*=\s*(\S+)/im);
  if (um && pm && this.state.addCred("web:" + source, um[1], pm[1]))
    this.emit(c("[+] credentials disclosed -> loot: " + um[1] + " / " + pm[1], "brightgreen"));
};
Shell.prototype.maybeObjective = function (node) {
  const s = this.state.session, net = this.state.network;
  if (!net) return;
  if (s.host.ip === net.objective && s.user === "root" && (node.name === "proof.txt" || node.name === "flag.txt")) {
    if (this.state.markRooted(net.code)) {
      this.emit("");
      this.emit(c("  [+] objective artefact recovered on the in-scope host.", "brightgreen", "bold"));
      this.emit(c("      root access on " + s.host.hostname + " confirmed and logged.", "green"));
    }
  }
};

function fnmatch(name, pattern) {
  const re = "^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
  return new RegExp(re).test(name);
}

window.SHELL = { Shell, GameState, loadConfig, saveConfig, buildOperatorHost };

/* Shared IO surface consumed by console.js */
window.C = { write, c, hr, box, clear: clearScreen, readLine, sleep, escapeHtml, progress };
