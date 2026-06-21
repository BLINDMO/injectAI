/* injectAI web build -- meta console, training driver and boot.
 * Browser port of console.py / training.py / app.py. */
"use strict";

(function () {
  const { Shell, GameState, loadConfig, saveConfig } = window.SHELL;

  let state, scenarios;

  /* ---- training -------------------------------------------------- */
  const hasCred = (st, user) => st.loot.creds.some((x) => x[1] === user);
  const hasSession = (st, ip, user) => st.sessions.some((s) => s.host.ip === ip && s.user === user);
  const rooted = (st, ip) => st.sessions.some((s) => s.host.ip === ip && s.user === "root");

  // each tier teaches a DIFFERENT path on a different host.
  const TIERS = {
    easy: { code: "TRN-SANDBOX", ip: "10.13.37.20", path: "Brute-force → sudo (GTFOBins)" },
    medium: { code: "PHAROS", ip: "10.20.5.30", path: "Credential disclosure → SSH → sudo editor escape" },
    hard: { code: "ORIONBUILD", ip: "10.10.10.13", path: "Sophisticated multi-path — no guidance" },
  };

  function tasksFor(tier) {
    const ip = tier.ip;
    if (tier.code === "TRN-SANDBOX") return [
      { obj: "Discover the host's services and versions.",
        chk: (st) => (st.scanned[ip] || new Set()).has(22), runs: ["nmap -sV " + ip],
        hint: "Fingerprint with a version scan first." },
      { obj: "Brute-force the weak 'student' SSH password.",
        chk: (st) => hasCred(st, "student"), runs: ["hydra -l student -P wordlists/common.txt ssh://" + ip],
        hint: "An online dictionary attack on SSH will crack a weak seasonal password." },
      { obj: "Log in with the cracked credential.",
        chk: (st) => hasSession(st, ip, "student"), runs: ["ssh student@" + ip],
        note: "(tap the autofill pill at the password prompt)",
        hint: "SSH in as the account you just cracked." },
      { obj: "Abuse the account's sudo rights to become root.",
        chk: (st) => rooted(st, ip), runs: ["sudo -l", "sudo find . -exec /bin/bash \\; -quit"],
        hint: "`sudo -l` reveals a whitelisted binary you can turn into a root shell (GTFOBins)." },
      { obj: "Recover the proof artefact.",
        chk: (st) => st.config.completed.includes("TRN-SANDBOX"), runs: ["cat /root/flag.txt"],
        hint: "Read root's flag." },
    ];
    if (tier.code === "PHAROS") return [
      { obj: "Discover the host's services.",
        chk: (st) => (st.scanned[ip] || new Set()).has(21), runs: ["nmap -sV " + ip],
        hint: "Scan first — note the FTP service." },
      { obj: "Recover credentials the FTP service leaks.",
        chk: (st) => hasCred(st, "relay"), runs: ["ftp " + ip, "curl ftp://" + ip + "/welcome.txt"],
        hint: "Read the anonymous FTP files — one discloses a maintenance login." },
      { obj: "Reuse the credential over SSH.",
        chk: (st) => hasSession(st, ip, "relay"), runs: ["ssh relay@" + ip],
        note: "(tap the autofill pill at the password prompt)",
        hint: "The disclosed password is reused on SSH." },
      { obj: "Escalate to root via the whitelisted editor.",
        chk: (st) => rooted(st, ip), runs: ["sudo -l", "sudo vim -c ':!/bin/sh'"],
        hint: "`sudo -l` shows an editor you can shell out of." },
      { obj: "Recover the proof artefact.",
        chk: (st) => st.config.completed.includes("PHAROS"), runs: ["cat /root/proof.txt"],
        hint: "Read root's proof." },
    ];
    // hard: ORION, single objective, no step guidance
    return [
      { obj: "Gain sudo / root on the rogue trading node — any path you can find.",
        chk: (st) => st.config.completed.includes("ORIONBUILD"), runs: [],
        hint: "Recon widely. Tap ⌗ cmds for the command palette, or AIH if you stall." },
    ];
  }

  function guidance(task, diff) {
    if (diff === "easy") {
      const pills = (task.runs || []).map((cmd) => C.tap(cmd, cmd, "pill")).join("");
      if (pills) C.write("    " + pills + (task.note ? " " + C.c(task.note, "grey") : ""));
    } else if (diff === "medium") {
      C.write(C.c("    hint: " + task.hint, "grey"));
    }
  }

  async function runTraining(diff) {
    diff = diff.toLowerCase();
    const tier = TIERS[diff] || TIERS.easy;
    const label = { easy: "Easy / Recruit", medium: "Medium / Operator", hard: "Hard / Specialist" }[diff];
    state.loadNetwork(window.WORLD.allScenarios()[tier.code]);
    const sh = new Shell(state);
    const T = tasksFor(tier);
    let idx = 0;
    C.clear();
    C.box("TRAINING  ::  " + label, [
      C.c("Lab: " + tier.code + " (" + tier.ip + ")", "white"),
      C.c("Path: " + tier.path, "grey"),
      "",
      C.c("Live operator shell. `objective` repeats the goal · `back` leaves.", "grey"),
      C.c("Tap ", "grey") + C.tap("⌗ cmds", "commands", "cmd") + C.c(" for the command palette.", "grey"),
    ], 66);
    C.write("");
    const showObjective = () => {
      if (idx >= T.length) return;
      C.write(C.c("  OBJECTIVE " + (idx + 1) + "/" + T.length + ": ", "cyan", "bold") + C.c(T[idx].obj, "white"));
      guidance(T[idx], diff);
      C.write("");
    };
    showObjective();
    while (true) {
      if (idx >= T.length) {
        C.write("");
        C.box("MODULE COMPLETE", [
          C.c("All objectives met. You chained service discovery, a", "white"),
          C.c("credential attack, a foothold and a sudo/GTFOBins escalation", "white"),
          C.c("into full root access -- a complete real-world kill chain.", "white"),
        ], 66, "green");
        const order = { easy: 1, medium: 2, hard: 3 };
        if ((order[diff] || 0) >= (order[state.config.training_best] || 0)) { state.config.training_best = diff; saveConfig(state.config); }
        C.write("");
        return;
      }
      const raw = await C.readLine(sh.prompt());
      const cmd = raw.trim();
      if (["objective", "objectives", "goal"].includes(cmd)) { showObjective(); continue; }
      if (cmd === "hint") { C.write(C.c("    hint: " + T[idx].hint, "grey")); continue; }
      const sig = await sh.runLine(raw);
      if (sig === "BACK") { C.write(C.c("leaving training module.", "grey")); return; }
      let advanced = false;
      while (idx < T.length && T[idx].chk(state)) {
        C.write("");
        C.write(C.c("  [✓] objective " + (idx + 1) + " complete: ", "brightgreen", "bold") + C.c(T[idx].obj, "green"));
        idx++; advanced = true;
      }
      if (advanced && idx < T.length) { C.write(""); showObjective(); }
    }
  }

  /* ---- engagement shell ----------------------------------------- */
  async function enterShell(net) {
    state.loadNetwork(net);
    C.clear();
    C.write(C.c("  " + net.code, "accent", "bold") + C.c("   " + net.title, "grey"));
    C.write(C.c("  scope " + net.subnet + "  ·  workstation " + state.operatorHost.ip, "grey"));
    C.write(C.c("  tap ", "grey") + C.tap("≡ menu", "menu", "cmd") + C.c(" · ", "grey") +
            C.tap("⌗ commands", "commands", "cmd") + C.c(" · ", "grey") + C.tap("AIH", "aih", "cmd") +
            C.c(" · ", "grey") + C.tap("back", "back") + C.c(" to exit", "grey"));
    C.write("");
    const sh = new Shell(state);
    while (true) {
      const raw = await C.readLine(sh.prompt());
      const sig = await sh.runLine(raw);
      if (sig === "BACK") { C.write(C.c("disengaged. returning to console.", "grey")); return; }
    }
  }

  /* ---- meta console --------------------------------------------- */
  const CONSOLE = {};
  CONSOLE.menu = function () {
    C.write("");
    C.write(C.c("  menu", "accent", "bold") + C.c("   (tap to navigate)", "grey"));
    C.hr(34);
    const done = state.config.completed;
    Object.keys(scenarios).forEach((code) => {
      const n = scenarios[code];
      const tag = done.includes(code) ? C.c("  ✓", "brightgreen") : "";
      C.write("  " + C.tap("▸ engage " + code, "engage " + code, "cmd") + tag);
      C.write("     " + C.c(n.title + "  ", "grey") + C.tap("brief", "brief " + code) + C.c("   " + n.difficulty, "grey"));
    });
    C.write("");
    C.write("  " + C.c("training ", "white") + C.tap("easy", "training easy", "pill") +
            C.tap("medium", "training medium", "pill") + C.tap("hard", "training hard", "pill"));
    C.write("  " + C.tap("⌗ commands", "commands", "pill") + C.tap("AIH — where to start", "aih", "pill") +
            C.tap("settings", "settings", "pill") + C.tap("status", "status", "pill"));
    C.write("");
  };
  CONSOLE.commands = function () {
    C.write("");
    C.write(C.c("  command palette", "accent", "bold") + C.c("   tap to run", "grey"));
    C.hr(40);
    C.write("  " + C.c("navigate ", "cyan") + C.tap("menu", "menu", "pill") + C.tap("scenarios", "scenarios", "pill") +
            C.tap("status", "status", "pill") + C.tap("settings", "settings", "pill") + C.tap("aih", "aih", "pill"));
    C.write("  " + C.c("engage   ", "cyan") + Object.keys(scenarios).map((code) => C.tap(code, "engage " + code, "pill")).join(""));
    C.write("  " + C.c("training ", "cyan") + C.tap("easy", "training easy", "pill") +
            C.tap("medium", "training medium", "pill") + C.tap("hard", "training hard", "pill"));
    C.write("  " + C.c("brief    ", "cyan") + Object.keys(scenarios).map((code) => C.tap(code, "brief " + code, "pill")).join(""));
    C.write("");
    C.write(C.c("  (inside an engagement, ⌗ commands lists the full toolset)", "grey"));
    C.write("");
  };
  CONSOLE.aih = function () {
    C.write("");
    C.write(C.c("  AIH", "accent", "bold") + C.c("  ·  where to start", "grey"));
    C.hr(34);
    const done = state.config.completed;
    const next = Object.keys(scenarios).find((code) => !done.includes(code)) || "ORIONBUILD";
    C.write("  " + C.c("• New here? Run the guided module first — it walks a full", "white"));
    C.write("    " + C.c("compromise end to end.", "white") + " " + C.tap("training easy", "training easy", "pill"));
    C.write("  " + C.c("• Then take on a live engagement:", "white"));
    C.write("    " + C.tap("engage " + next, "engage " + next, "pill") + C.tap("scenarios", "scenarios", "pill"));
    C.write("  " + C.c("• Inside an engagement, tap ", "white") + C.tap("≡ menu", "menu", "cmd") +
            C.c(" → AIH for the next move.", "white"));
    C.write("");
  };
  CONSOLE.help = function () {
    C.write("");
    C.write(C.c("  commands", "accent", "bold") + C.c("   (or tap ", "grey") + C.tap("menu", "menu", "cmd") + C.c(")", "grey"));
    C.hr(34);
    [["menu", "tappable navigation"],
    ["scenarios", "list engagements / targets"],
    ["brief <code>", "read an engagement briefing"],
    ["engage <code>", "deploy into an engagement"],
    ["training [tier]", "guided modules (easy | medium | hard)"],
    ["status", "progress and recovered objectives"],
    ["settings", "display & interaction preferences"],
    ["clear", "clear the screen"],
    ].forEach(([k, v]) => C.write("  " + C.c(k.padEnd(16), "cyan") + C.c(v, "grey")));
    C.write("");
  };
  CONSOLE.scenarios = function () {
    C.write("");
    C.write(C.c("  engagements", "accent", "bold"));
    C.hr(34);
    const done = state.config.completed;
    Object.keys(scenarios).forEach((code) => {
      const n = scenarios[code];
      const tag = done.includes(code) ? C.c("  ✓ resolved", "brightgreen") : "";
      C.write("  " + C.tap(code, "engage " + code, "cmd") + C.c("   " + n.difficulty, "grey") + tag);
      C.write("    " + C.c(n.title, "white"));
      C.write("    " + C.c(n.summary, "grey") + "   " + C.tap("brief", "brief " + code));
      C.write("");
    });
  };
  CONSOLE.brief = function (args) {
    if (!args.length) { C.write(C.c("usage: brief <code>", "red")); return; }
    const n = scenarios[args[0].toUpperCase()];
    if (!n) { C.write(C.c("no engagement '" + args[0] + "'.", "red")); return; }
    C.write("");
    C.write(C.c("  " + n.code, "accent", "bold") + C.c("   " + n.difficulty, "grey"));
    C.write("  " + C.c(n.title, "white"));
    C.hr(34);
    n.brief.split("\n").forEach((ln) => C.write("  " + C.escapeHtml(ln)));
    C.write("");
    C.write("  " + C.tap("engage " + n.code, "engage " + n.code, "cmd"));
    C.write("");
  };
  CONSOLE.engage = async function (args) {
    if (!args.length) { C.write(C.c("usage: engage <code>  (see `scenarios`)", "red")); return; }
    const n = scenarios[args[0].toUpperCase()];
    if (!n) { C.write(C.c("no engagement '" + args[0] + "'.", "red")); return; }
    await enterShell(n);
  };
  CONSOLE.training = async function (args) {
    let tier = args.length ? args[0].toLowerCase() : null;
    if (!["easy", "medium", "hard"].includes(tier)) {
      C.write("");
      C.write(C.c("  training", "accent", "bold") + C.c("   (each tier is a different target & path)", "grey"));
      C.hr(40);
      C.write("  " + C.tap("easy", "training easy", "cmd") + C.c("    brute-force → sudo  (TRN-SANDBOX)", "grey"));
      C.write("  " + C.tap("medium", "training medium", "cmd") + C.c("  credential disclosure → SSH → sudo  (PHAROS)", "grey"));
      C.write("  " + C.tap("hard", "training hard", "cmd") + C.c("    rogue-bot node, no guidance  (ORIONBUILD)", "grey"));
      C.write("");
      return;
    }
    await runTraining(tier);
  };
  CONSOLE.settings = function (args) {
    const cfg = state.config;
    if (args.length >= 2) { setSetting(args[0].toLowerCase(), args[1].toLowerCase()); return; }
    C.write("");
    C.write(C.c("  SETTINGS", "cyan", "bold"));
    C.hr(48);
    [["colour", cfg.colour, "ANSI colour output"],
    ["hints", cfg.hints, "inline tactical hints"],
    ["sound", cfg.sound, "beep when a password is cracked"],
    ["operator", cfg.operator, "operator handle (prompt name)"],
    ].forEach(([k, v, d]) => C.write("  " + C.c(String(k).padEnd(10), "brightyellow") + C.c(String(v).padEnd(10), "white") + C.c(d, "grey")));
    C.write("");
    C.write(C.c("  change with: settings <key> <value>", "grey"));
    C.write(C.c("  e.g. settings hints off   |   settings operator ghost", "grey"));
    C.write("");
  };
  function setSetting(key, val) {
    const cfg = state.config;
    const bools = { on: true, off: false, true: true, false: false, yes: true, no: false, "1": true, "0": false };
    if (["colour", "color", "hints", "sound"].includes(key)) {
      const k = key === "color" ? "colour" : key;
      if (!(val in bools)) { C.write(C.c("  value must be on/off.", "red")); return; }
      cfg[k] = bools[val];
      if (k === "colour") document.body.classList.toggle("nocolour", !cfg.colour);
    } else if (key === "operator") {
      cfg.operator = val; state.operator = val;
      state.operatorHost = window.SHELL.buildOperatorHost(val);
      state.sessions = [{ host: state.operatorHost, user: val, cwd: state.homeNode(state.operatorHost, val), label: "local" }];
    } else { C.write(C.c("  unknown setting '" + key + "'.", "red")); return; }
    saveConfig(cfg);
    C.write(C.c("  " + key + " = " + val, "brightgreen"));
  }
  CONSOLE.status = function () {
    const cfg = state.config;
    C.write("");
    C.box("OPERATOR STATUS", [
      C.c("handle:        " + state.operator, "white"),
      C.c("training best: " + (cfg.training_best || "none"), "white"),
      C.c("engagements resolved: " + cfg.completed.length + " / " + Object.keys(scenarios).length, "white"),
    ], 60);
    Object.keys(scenarios).forEach((code) => {
      const mark = cfg.completed.includes(code) ? C.c("✓", "brightgreen") : C.c("·", "grey");
      C.write("   " + mark + " " + code.padEnd(12) + " " + C.c(scenarios[code].title, "grey"));
    });
    C.write("");
  };
  CONSOLE.whoami = function () { C.write(state.operator + "@injectai"); };
  CONSOLE.clear = function () { C.clear(); };

  const ALIASES = {
    targets: "scenarios", engagements: "scenarios", ls: "scenarios",
    info: "brief", connect: "engage", start: "engage",
    train: "training", learn: "training", config: "settings", progress: "status", "?": "help",
    hint: "aih", hints: "aih",
  };

  async function consoleLoop() {
    while (true) {
      const op = state.operator;
      const prompt = C.c(op, "brightgreen", "bold") + C.c("@", "grey") + C.c("injectai", "accent") + C.c(" $ ", "grey");
      const raw = await C.readLine(prompt);
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      let name = parts[0].toLowerCase();
      if (name === "exit" || name === "quit" || name === "logout") {
        C.write(C.c("session closed — reloading…", "grey"));
        setTimeout(() => location.reload(), 500); return;
      }
      if (name === "back") continue;   // no-op at the top level
      name = ALIASES[name] || name;
      const fn = CONSOLE[name];
      if (!fn) { C.write(C.c(parts[0] + ": command not found", "red")); continue; }
      await fn(parts.slice(1));
    }
  }

  /* ---- boot ------------------------------------------------------ */
  async function boot() {
    const cfg = loadConfig();
    document.body.classList.toggle("nocolour", !cfg.colour);
    state = new GameState(cfg);
    scenarios = window.WORLD.allScenarios();
    C.clear();
    C.write(C.c("injectai", "accent", "bold") + C.c("  ·  secure shell  ·  build 11", "grey"));
    C.write(C.c("tap ", "grey") + C.tap("≡ menu", "menu", "cmd") + C.c(" · ", "grey") +
            C.tap("⌗ commands", "commands", "cmd") + C.c(" · ", "grey") +
            C.tap("AIH", "aih", "cmd") + C.c(" for guidance", "grey"));
    C.write("");
    await consoleLoop();
  }

  // C is the shared IO surface exposed by app.js bootstrap
  const C = window.C;
  window.addEventListener("DOMContentLoaded", boot);
})();
