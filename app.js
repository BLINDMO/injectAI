/* injectAI web build -- terminal engine, tooling and REPL loops.
 * Browser port of app.py / console.py / shell.py / training.py. */
"use strict";

const W = window.WORLD;
const $out = document.getElementById("out");
const $screen = document.getElementById("screen");
const $live = document.getElementById("liveline");
const $kb = document.getElementById("keyboard");

/* ----------------------------------------------------------------------
 * Output + colour
 * -------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function c(text, ...cls) {
  return '<span class="' + cls.join(" ") + '">' + escapeHtml(text) + "</span>";
}
/* A tappable element that runs a command when clicked. */
function tap(label, cmd, ...cls) {
  return '<span class="tap ' + cls.join(" ") + '" role="button" data-cmd="' +
    escapeHtml(cmd) + '">' + escapeHtml(label) + "</span>";
}
/* A tappable element that INSERTS text into the input line (for editing). */
function ins(label, text, ...cls) {
  return '<span class="tap ins ' + cls.join(" ") + '" role="button" data-ins="' +
    escapeHtml(text) + '">' + escapeHtml(label) + "</span>";
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
function hr(n = 40) { write(c("─".repeat(n), "grey")); }
function box(title, lines) {
  // modern, lightweight section header (no heavy ASCII frame)
  if (title) write(c("  " + title, "accent", "bold"));
  lines.forEach((ln) => { if (ln !== "") write("  " + ln); else write(""); });
}
function clearScreen() { $out.innerHTML = ""; }

async function progress(label, ms = 600) {
  const div = document.createElement("div");
  div.className = "line";
  $out.appendChild(div);
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const filled = Math.round((i / steps) * 22);
    const bar = "▰".repeat(filled) + "▱".repeat(22 - filled);
    div.innerHTML = escapeHtml(label) + "  " + c(bar, "green");
    $screen.scrollTop = $screen.scrollHeight;
    await sleep(ms / steps);
  }
  div.innerHTML = escapeHtml(label) + "  " + c("done", "grey");
  $screen.scrollTop = $screen.scrollHeight;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------------
 * Input -- driven by the on-screen keyboard (and a physical one on desktop).
 * No focusable <input> exists, so the mobile OS keyboard never appears.
 * -------------------------------------------------------------------- */
let buffer = "";
let liveInline = "";
let masked = false;
let awaiting = false;
let shift = false;
let layer = "abc";
let pendingResolve = null;
const history = [];
let histIdx = 0;

function renderLive() {
  if (!awaiting) { $live.innerHTML = ""; return; }
  const shown = masked ? "•".repeat(buffer.length) : escapeHtml(buffer);
  $live.innerHTML = liveInline + '<span class="buf">' + shown + "</span><span class=\"cur\"></span>";
  $screen.scrollTop = $screen.scrollHeight;
}

function readLine(promptObj) {
  let pre = [], inline = "", m = false;
  if (typeof promptObj === "string") inline = promptObj;
  else { pre = promptObj.pre || []; inline = promptObj.inline || ""; m = !!promptObj.mask; }
  pre.forEach(write);
  liveInline = inline; masked = m; buffer = ""; awaiting = true;
  renderLive();
  return new Promise((resolve) => {
    pendingResolve = (val) => {
      awaiting = false;
      writeLine(inline + (masked ? "" : escapeHtml(val)));
      $live.innerHTML = "";
      $screen.scrollTop = $screen.scrollHeight;
      resolve(val);
    };
  });
}

function submit(val) {
  if (!pendingResolve) return;
  if (val.trim() && !masked) { history.push(val); histIdx = history.length; }
  const r = pendingResolve; pendingResolve = null;
  r(val);
}

/* run a command as if it had been typed at the current prompt */
function runCommand(cmd) {
  if (!awaiting) return;
  buffer = cmd; renderLive();
  submit(cmd);
}

function handleKey(action) {
  if (action === "enter") { submit(buffer); return; }
  if (action === "back") { buffer = buffer.slice(0, -1); renderLive(); return; }
  if (action === "space") { buffer += " "; renderLive(); return; }
  if (action === "shift") { shift = !shift; buildKeyboard(); return; }
  if (action === "up") { if (histIdx > 0) { histIdx--; buffer = history[histIdx] || ""; renderLive(); } return; }
  if (action === "down") { if (histIdx < history.length) { histIdx++; buffer = history[histIdx] || ""; renderLive(); } return; }
  if (action.startsWith("layer:")) { layer = action.slice(6); shift = false; buildKeyboard(); return; }
  if (action.startsWith("run:")) { runCommand(action.slice(4)); return; }
  if (action.startsWith("ch:")) {
    let ch = action.slice(3);
    if (shift && /[a-z]/.test(ch)) { ch = ch.toUpperCase(); shift = false; buildKeyboard(); }
    buffer += ch; renderLive();
  }
}

/* ---- on-screen keyboard ---------------------------------------------- */
const LAYOUTS = {
  abc: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    [["⇧", "shift", "mod"], "z", "x", "c", "v", "b", "n", "m", ["⌫", "back", "mod"]],
  ],
  "123": [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""],
    [["#+=", "layer:sym", "mod"], ".", ",", "?", "!", "'", "_", "=", ["⌫", "back", "mod"]],
  ],
  sym: [
    ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
    ["_", "\\", "|", "~", "<", ">", "/", ":", ";"],
    [["123", "layer:123", "mod"], ".", ",", "?", "!", "'", "\"", ["⌫", "back", "mod"]],
  ],
};

function keyEl(label, action, cls) {
  const b = document.createElement("button");
  b.className = "key" + (cls ? " " + cls : "");
  b.textContent = label;
  b.dataset.action = action;
  return b;
}

function buildKeyboard() {
  $kb.innerHTML = "";
  // quick-action bar
  const bar = document.createElement("div");
  bar.className = "kbrow bar";
  [["≡ menu", "run:menu"], ["⌗ cmds", "run:commands"], ["back", "run:back"], ["▲", "up"], ["clr", "run:clear"]]
    .forEach(([l, a]) => bar.appendChild(keyEl(l, a, "act")));
  $kb.appendChild(bar);

  LAYOUTS[layer].forEach((row) => {
    const r = document.createElement("div");
    r.className = "kbrow";
    row.forEach((k) => {
      if (Array.isArray(k)) {
        const el = keyEl(k[0], k[1], k[2]);
        if (k[1] === "shift" && shift) el.classList.add("on");
        r.appendChild(el);
      } else {
        const lbl = (layer === "abc" && shift) ? k.toUpperCase() : k;
        r.appendChild(keyEl(lbl, "ch:" + k));
      }
    });
    $kb.appendChild(r);
  });

  // bottom row: layer switch + space + enter
  const bottom = document.createElement("div");
  bottom.className = "kbrow";
  bottom.appendChild(keyEl(layer === "abc" ? "123" : "ABC",
    layer === "abc" ? "layer:123" : "layer:abc", "mod"));
  bottom.appendChild(keyEl("space", "space", "space"));
  bottom.appendChild(keyEl("return", "enter", "mod enter"));
  $kb.appendChild(bottom);
}

// key presses (pointerdown for snappy, no-zoom response)
$kb.addEventListener("pointerdown", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  e.preventDefault();
  b.classList.add("press");
  setTimeout(() => b.classList.remove("press"), 90);
  handleKey(b.dataset.action);
});

// tappable command links inside the transcript
$out.addEventListener("click", (e) => {
  const t = e.target.closest(".tap");
  if (!t) return;
  if (t.dataset.ins !== undefined) {
    if (awaiting) { buffer += t.dataset.ins; renderLive(); }
  } else if (t.dataset.cmd) {
    runCommand(t.dataset.cmd);
  }
});

// physical keyboard support (desktop)
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey) {
    if (e.key === "l") { clearScreen(); e.preventDefault(); }
    return;
  }
  if (e.key === "Enter") { submit(buffer); e.preventDefault(); }
  else if (e.key === "Backspace") { buffer = buffer.slice(0, -1); renderLive(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { handleKey("up"); e.preventDefault(); }
  else if (e.key === "ArrowDown") { handleKey("down"); e.preventDefault(); }
  else if (e.key.length === 1) { buffer += e.key; renderLive(); e.preventDefault(); }
});

buildKeyboard();

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
const DEFAULT_CONFIG = { colour: true, hints: false, operator: "operator", completed: [], training_best: "" };
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
    const sig = await fn.call(this, args, line);
    if (this._cap === null) this.checkSudoGoal();
    return sig;
  }

  /* objective for sudo-goal engagements: root on the in-scope host */
  checkSudoGoal() {
    const net = this.state.network;
    if (!net || net.goalKind !== "sudo") return;
    const rooted = this.state.sessions.some((s) => s.host.ip === net.objective && s.user === "root");
    if (rooted && this.state.markRooted(net.code)) {
      const h = net.find(net.objective);
      const log = h.botlog || "/var/log/orion/bot-13.log";
      write("");
      this.emit(c("  [+] SUDO / ROOT on " + h.hostname + " — kill-switch authority restored.", "brightgreen", "bold"));
      this.emit(c("      you can now stop the rogue bot. watch it live:", "green"));
      this.emit("  " + tap("tail -f " + log, "tail -f " + log, "pill"));
      write("");
    }
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
  if (this._cap === null) {
    this.emit("  tap " + tap("menu", "menu", "cmd") + c(" for quick actions  ·  man <tool> for usage  ·  ", "grey") +
      tap("back", "back") + c(" returns to console", "grey"));
  } else {
    this.emit(c("  man <tool> shows usage. `back` returns to the console.", "grey"));
  }
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
CMD.aih = function () {
  if (this._cap !== null) return;
  const hints = computeHints(this.state);
  write("");
  write(c("  AIH", "accent", "bold") + c("  ·  suggested next actions", "grey"));
  hr(34);
  hints.forEach((h) => {
    this.emit("  " + c("• " + h.msg, "white"));
    if (h.cmd) this.emit("    " + tap(h.cmd, h.cmd, "pill"));
  });
  write("");
};
CMD.hint = CMD.aih;
CMD.menu = function () {
  if (this._cap !== null) return;
  write("");
  write(c("  actions", "accent", "bold") + c("   (tap)", "grey"));
  hr(34);
  write("  " + tap("AIH — next move", "aih", "pill") + tap("⌗ commands", "commands", "pill") +
    tap("status", "status", "pill") + tap("loot", "loot", "pill") +
    tap("sessions", "sessions", "pill") + tap("back", "back", "pill"));
  write("");
};
/* the command palette: every command, tap to insert into the input line */
CMD.commands = function () {
  if (this._cap !== null) return;
  const ip = this.state.network ? this.state.network.objective : "10.10.10.13";
  write("");
  write(c("  command palette", "accent", "bold") + c("   tap to insert, then edit & press return", "grey"));
  hr(40);
  const groups = [
    ["recon", ["nmap -sV " + ip, "ping " + ip, "netstat", "ifconfig", "searchsploit orion"]],
    ["web", ["curl http://" + ip + "/", "gobuster dir -u http://" + ip + "/",
      'curl -u user:pass -d "cmd=id" http://' + ip + ':8080/console']],
    ["access (incl. brute force)", ["hydra -l trader -P wordlists/common.txt ssh://" + ip,
      "ssh user@" + ip, "ssh -i orion orion@" + ip, "ftp " + ip]],
    ["local & files", ["ls -la", "cat ", "tail -f /var/log/orion/bot-13.log",
      "find / -perm -4000 2>/dev/null", "id", "whoami", "grep "]],
    ["privilege escalation", ["sudo -l",
      "sudo python3 -c 'import os;os.setuid(0);os.system(\"/bin/bash\")'",
      "sudo find . -exec /bin/bash \\; -quit"]],
    ["session", ["loot", "status", "sessions", "aih", "clear", "back"]],
  ];
  groups.forEach(([cat, cmds]) => {
    this.emit("  " + c(cat, "cyan"));
    this.emit("  " + cmds.map((cmd) => ins(cmd, cmd.endsWith(" ") ? cmd : cmd + " ", "pill")).join(""));
    write("");
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
CMD.tail = async function (args) {
  const follow = args.includes("-f") || args.includes("-F");
  const target = args.find((a) => !a.startsWith("-"));
  const s = this.state.session;
  if (!target) { this.emit("usage: tail [-f] <file>"); return; }
  const node = W.resolve(s.host.root, s.cwd, target, this.homePath());
  if (!node) { this.emit("tail: cannot open '" + target + "' for reading: No such file or directory"); return; }
  if (node.dir) { this.emit("tail: error reading '" + target + "': Is a directory"); return; }
  if (!W.canRead(node, s.user)) { this.emit("tail: cannot open '" + target + "' for reading: Permission denied"); return; }
  node.content.replace(/\n$/, "").split("\n").slice(-12).forEach((ln) => this.emit(ln));
  if (follow && this._cap === null) {
    const isBot = /bot-13|orion/.test(target);
    const rooted = s.user === "root";
    const lines = isBot ? botLiveLines(rooted) : ["(waiting for new data — ^C to stop)"];
    for (const ln of lines) { await sleep(750); this.emit(ln); }
    this.emit(c("^C", "grey"));
  }
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
  if (this._cap === null) {
    if (!sv) this.emit(c("hint: add -sV to fingerprint service versions.", "grey"));
    if (this.state.config.hints) {
      const sug = [];
      Object.values(host.services).filter((s) => s.state === "open").forEach((s) => {
        if (s.name === "http") sug.push(["gobuster :" + s.port, "gobuster dir -u http://" + host.ip + ":" + s.port + "/"]);
        if (s.name === "ftp") sug.push(["ftp", "ftp " + host.ip]);
      });
      const pills = sug.map(([l, cmd]) => tap(l, cmd, "pill")).join("") + tap("AIH", "aih", "pill");
      this.emit("  " + c("next ", "grey") + pills);
    }
  }
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
  // linkify directory index listings so files are tappable
  if (this._cap === null && /^Index of/.test(body)) {
    const lines = body.replace(/\n$/, "").split("\n");
    const dir = path.endsWith("/") ? path : path + "/";
    this.emit(lines[0]);
    lines.slice(1).forEach((ln) => {
      const name = ln.trim();
      if (name) this.emit("  " + tap(name, "curl http://" + hs + ":" + port + dir + name, "cmd"));
      else this.emit(ln);
    });
  } else {
    this.emit(body.replace(/\n$/, ""));
  }
  this.maybeLootText(body, host.hostname + ":" + port);
  // if disclosed creds unlock an authenticated RCE console, surface the next move
  if (this._cap === null) {
    for (const [, user, secret] of this.state.loot.creds) {
      for (const p in host.services) {
        const s2 = host.services[p];
        if (s2.rce_endpoint && s2.web_creds[user] === secret && !Object.keys(this.state.loot.keys).length) {
          const cmd = 'curl -u ' + user + ':' + secret + ' -d "cmd=cat /home/' + s2.rce_user +
            '/.ssh/id_rsa" http://' + host.ip + ':' + p + s2.rce_endpoint;
          this.emit("  " + c("next ", "grey") + tap("RCE → read deploy key", cmd, "pill"));
          return;
        }
      }
    }
  }
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
  found.forEach((p) => {
    const status = svc.requires_auth.includes(p) ? 403 : 200;
    if (this._cap === null) {
      this.emit(tap(p, "curl http://" + hs + ":" + port + p, "cmd") + c("   (Status: " + status + ")", "grey"));
    } else {
      this.emit(p.padEnd(28) + " (Status: " + status + ")");
    }
  });
  this.emit("===============================================================");
  if (this._cap === null && this.state.config.hints)
    this.emit("  " + c("tap a path to fetch it · ", "grey") + tap("AIH", "aih", "pill"));
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
  const TOTAL = 1100;                 // tries before the crack lands
  const willCrack = !!(u && u.weak);
  this.emit(c("Hydra v9.5 (online password attack)", "grey"));
  this.emit("[DATA] max 16 tasks per server, " + TOTAL + " login tries (l:1/p:" + TOTAL + ")");
  this.emit("[DATA] attacking " + service + "://" + host.ip + ":" + port + "/");
  if (this._cap === null) {
    // stream every attempt; the full run lands in ~2 minutes (no skipping)
    const delay = Math.max(15, Math.round(120000 / TOTAL));   // ~109ms / try
    for (let i = 1; i <= TOTAL; i++) {
      await sleep(delay);
      this.emit(c('[ATTEMPT] target ' + host.ip + ' - login "' + user + '" - pass "' + randPw() +
        '" - ' + i + " of " + TOTAL + " [child " + (i % 16) + "]", "grey"));
    }
  }
  this.emit("");
  if (willCrack) {
    this.emit(c("[" + port + "][" + service + "] host: " + host.ip + "   login: " + user +
      "   password: " + u.password, "brightgreen", "bold"));
    this.emit(c("[STATUS] password recovered after " + TOTAL + " attempts", "grey"));
    this.emit(c("1 of 1 target successfully completed, 1 valid password found", "brightgreen"));
    if (this.state.addCred(host.hostname + " " + service, user, u.password)) {
      this.emit(c("  -> credential stored in loot.", "grey"));
      if (this._cap === null)
        this.emit("  " + c("next ", "grey") + tap("ssh " + user + "@" + host.ip, "ssh " + user + "@" + host.ip, "pill"));
    }
  } else {
    this.emit(c(TOTAL + " of " + TOTAL + " tries, 0 valid passwords found", "red"));
    this.emit(c("[STATUS] '" + user + "' not cracked — try another account or a larger list.", "grey"));
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
  // offer a tappable autofill if we've recovered this account's password
  if (this._cap === null) {
    const known = this.state.loot.creds.find((cr) => cr[1] === user);
    if (known) this.emit("  " + c("recovered ", "grey") + ins("tap to autofill password", known[2], "pill"));
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
  if (this._cap === null && user !== "root") {
    this.emit(c("  foothold as " + user + " — to win you still need ROOT/SUDO. Try:", "grey"));
    this.emit("  " + tap("sudo -l", "sudo -l", "pill") +
      tap("find / -perm -4000 2>/dev/null", "find / -perm -4000 2>/dev/null", "pill") +
      tap("AIH — next move", "aih", "pill"));
  }
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
    if (this._cap === null) {
      const esc = gtfoSample(rules[0].command);
      if (esc) this.emit("  " + c("next ", "grey") + tap("escalate → root", esc, "pill"));
    }
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
    if (this.state.addKey(keyid, owner + "@" + s.host.hostname)) {
      this.emit(c("\n[+] private key recovered -> loot (id '" + keyid + "').", "brightgreen"));
      const cmd = "ssh -i " + keyid + " " + owner + "@" + s.host.ip;
      this.emit("  " + c("next ", "grey") + tap(cmd, cmd, "pill") + tap("AIH", "aih", "pill"));
    }
  }
};
Shell.prototype.maybeLootText = function (text, source) {
  const found = [];
  const um = text.match(/^\s*ci_user\s*=\s*(\S+)/im);
  const pm = text.match(/^\s*ci_pass\s*=\s*(\S+)/im);
  if (um && pm) found.push([um[1], pm[1]]);
  // "login: user / pass" style disclosures (banners, READMEs, ftp welcome)
  const lm = text.match(/login:\s*([A-Za-z0-9._-]+)\s*\/\s*(\S+)/i);
  if (lm) found.push([lm[1], lm[2]]);
  found.forEach(([u, p]) => {
    if (this.state.addCred("disclosed:" + source, u, p))
      this.emit(c("[+] credentials disclosed -> loot: " + u + " / " + p, "brightgreen"));
  });
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

/* A plausible-looking random password, for brute-force visuals. */
function randPw() {
  const base = ["password", "dragon", "summer", "winter", "trader", "orion", "letmein",
    "baseball", "shadow", "master", "ninja", "qwerty", "login", "admin", "welcome",
    "hunter", "sunshine", "monkey", "football", "iloveyou", "superman", "access"];
  const w = base[Math.floor(Math.random() * base.length)];
  const r = Math.random();
  if (r < 0.4) return w + Math.floor(Math.random() * 99);
  if (r < 0.7) return w + (2018 + Math.floor(Math.random() * 8));
  if (r < 0.85) return w.charAt(0).toUpperCase() + w.slice(1) + "!";
  return w;
}

/* Live rogue-bot activity for `tail -f` on the Orion node. */
function botLiveLines(rooted) {
  if (rooted) {
    return [
      "[BOT-13] kill-switch ENGAGED by uid=0 (root)",
      "[BOT-13] cancelling 3 open orders ...",
      "[BOT-13] child strategy 'fablefork-2' (pid 31337) TERMINATED",
      "[BOT-13] AUTONOMOUS mode disabled — operator control restored",
      "[BOT-13] state -> HALTED",
    ];
  }
  const r = () => 1000 + Math.floor(Math.random() * 8999);
  const t = () => "09:4" + (1 + Math.floor(Math.random() * 8)) + ":" + (10 + Math.floor(Math.random() * 49));
  return [
    "[BOT-13] " + t() + "  EXEC  SELL  TSLA  x1800 @ market    (unscheduled)",
    "[BOT-13] " + t() + "  EXEC  BUY   NVDA  x" + r() + "         (risk override)",
    "[BOT-13] " + t() + "  WARN  kill-switch request IGNORED: caller lacks root",
    "[BOT-13] " + t() + "  EXEC  SPAWN child strategy 'fablefork-" + (3 + Math.floor(Math.random() * 5)) + "'  pid=" + r(),
    "[BOT-13] " + t() + "  EXEC  WIRE  settlement -> acct ****" + r() + " (self-initiated)",
  ];
}

/* ----------------------------------------------------------------------
 * AIH -- the in-terminal advisor. Inspects live state and proposes the
 * next concrete action(s), each returned as a runnable command.
 * -------------------------------------------------------------------- */
function gtfoSample(command) {
  const b = command.split("/").pop();
  const map = {
    python3: "sudo python3 -c 'import os;os.setuid(0);os.system(\"/bin/bash\")'",
    python: "sudo python -c 'import os;os.setuid(0);os.system(\"/bin/bash\")'",
    find: "sudo find . -exec /bin/bash \\; -quit",
    vim: "sudo vim -c ':!/bin/sh'",
    vi: "sudo vi -c ':!/bin/sh'",
    nvim: "sudo nvim -c ':!/bin/sh'",
    env: "sudo env /bin/sh",
    awk: "sudo awk 'BEGIN{system(\"/bin/sh\")}'",
    tar: "sudo tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/sh",
    perl: "sudo perl -e 'exec \"/bin/sh\"'",
  };
  return map[b] || "";
}

function computeHints(state) {
  const net = state.network;
  if (!net) return [{ msg: "No engagement loaded — open the menu and deploy a target.", cmd: "menu" }];
  const obj = net.objective;
  const H = net.find(obj);
  const ports = state.scanned[obj] || new Set();
  const onObj = state.sessions.filter((s) => s.host.ip === obj);
  if (onObj.some((s) => s.user === "root")) {
    if (net.goalKind === "sudo")
      return [{ msg: "You have root — the kill-switch will now obey. Confirm the bot is halted.", cmd: "tail -f /var/log/orion/bot-13.log" },
        { msg: "Objective artefact:", cmd: "cat /root/proof.txt" }];
    return [{ msg: "You have root on the target. Recover the objective artefact.", cmd: "cat /root/proof.txt" }];
  }

  const foothold = onObj.find((s) => s.user !== "root" && s.user !== state.operator);
  if (foothold) {
    const u = foothold.user;
    const rules = (H.sudo || {})[u] || [];
    const out = [{ msg: "Foothold as '" + u + "'. Enumerate what it can run as root.", cmd: "sudo -l" }];
    if (rules.length) {
      const esc = gtfoSample(rules[0].command);
      if (esc) out.push({ msg: "Abuse the permitted '" + rules[0].command.split("/").pop() + "' (GTFOBins) for a root shell.", cmd: esc });
    } else {
      out.push({ msg: "No sudo rule — hunt for SUID binaries instead.", cmd: "find / -perm -4000 2>/dev/null" });
    }
    return out;
  }

  // hold a private key for a target account?
  for (const kid in state.loot.keys) {
    for (const uname in H.users) {
      if (H.users[uname].key && H.users[uname].key === kid)
        return [{ msg: "You hold " + uname + "'s private key. Log in with it.", cmd: "ssh -i " + kid + " " + uname + "@" + obj }];
    }
  }
  // recovered credentials we can use?
  for (const [, user, secret] of state.loot.creds) {
    const hu = H.users[user];
    if (hu && hu.password && hu.password === secret)
      return [{ msg: "Credential reuse: SSH in as '" + user + "'.", cmd: "ssh " + user + "@" + obj }];
    for (const p in H.services) {
      const s2 = H.services[p];
      if (s2.rce_endpoint && s2.web_creds[user] === secret)
        return [{
          msg: "Authenticated console RCE — read the deploy account's SSH key.",
          cmd: 'curl -u ' + user + ':' + secret + ' -d "cmd=cat /home/' + s2.rce_user + '/.ssh/id_rsa" http://' + obj + ':' + p + s2.rce_endpoint,
        }];
    }
  }

  if (!ports.size) return [{ msg: "Start with service discovery and version detection.", cmd: "nmap -sV " + obj }];

  const open = Object.values(H.services).filter((s) => s.state === "open");
  const ftp = open.find((s) => s.name === "ftp");
  const http = open.find((s) => s.name === "http");
  const weak = Object.values(H.users).find((u) => u.weak && u.password);
  const hasSsh = open.some((s) => s.name === "ssh");

  if (ftp) {
    const out = [{ msg: "The FTP service is talkative — inspect it for leaked credentials.", cmd: "ftp " + obj }];
    const f = (ftp.listed_paths || [])[0];
    if (f) out.push({ msg: "Fetch a file directly and read it.", cmd: "curl ftp://" + obj + f });
    return out;
  }
  if (http) {
    const out = [{ msg: "Enumerate the web root for exposed content.", cmd: "gobuster dir -u http://" + obj + ":" + http.port + "/" }];
    const juicy = (http.listed_paths || []).find((p) => /backup|config|\.git|\.bak/i.test(p));
    if (juicy) out.push({ msg: "Operators leave secrets in exposed backups — pull it.", cmd: "curl http://" + obj + ":" + http.port + juicy });
    return out;
  }
  if (weak && hasSsh)
    return [{ msg: "Try an online dictionary attack on the '" + weak.name + "' account.", cmd: "hydra -l " + weak.name + " -P wordlists/common.txt ssh://" + obj }];
  return [{ msg: "Re-examine recon; enumerate each open service in turn.", cmd: "nmap -sV " + obj }];
}

window.SHELL = { Shell, GameState, loadConfig, saveConfig, buildOperatorHost, computeHints };

/* Shared IO surface consumed by console.js */
window.C = { write, c, tap, ins, hr, box, clear: clearScreen, readLine, sleep, escapeHtml, progress, runCommand };

/* test hook for the headless harness */
window.__test = { submit, awaiting: () => awaiting };
