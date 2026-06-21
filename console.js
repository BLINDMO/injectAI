/* injectAI web build -- meta console, training driver and boot.
 * Browser port of console.py / training.py / app.py. */
"use strict";

(function () {
  const { Shell, GameState, loadConfig, saveConfig } = window.SHELL;

  let state, scenarios;

  /* ---- training -------------------------------------------------- */
  const TARGET = "10.13.37.20";
  const hasCred = (st, user) => st.loot.creds.some((x) => x[1] === user);
  const hasSession = (st, ip, user) => st.sessions.some((s) => s.host.ip === ip && s.user === user);

  function tasks() {
    return [
      { obj: "Identify which services the host exposes and their versions.",
        chk: (st) => (st.scanned[TARGET] || new Set()).has(22),
        runs: ["nmap -sV " + TARGET],
        hint: "Fingerprint the host with a version scan before anything else." },
      { obj: "Recover a valid login for the 'student' service account.",
        chk: (st) => hasCred(st, "student"),
        runs: ["hydra -l student -P wordlists/common.txt ssh://" + TARGET],
        hint: "The account uses a weak seasonal password. An online dictionary attack against SSH will find it." },
      { obj: "Use the recovered credential to obtain an interactive foothold.",
        chk: (st) => hasSession(st, TARGET, "student"),
        runs: ["ssh student@" + TARGET],
        note: "(when prompted, the password is summer2023)",
        hint: "Log in over SSH as the account whose password you just cracked." },
      { obj: "Enumerate the account's sudo rights and abuse them to reach root.",
        chk: (st) => hasSession(st, TARGET, "root"),
        runs: ["sudo -l", "sudo find . -exec /bin/bash \\; -quit"],
        hint: "Check `sudo -l`. A whitelisted binary that can run other programs (GTFOBins) is a direct path to a root shell." },
      { obj: "Recover the proof artefact from the root account.",
        chk: (st) => st.config.completed.includes("TRN-SANDBOX"),
        runs: ["cat /root/flag.txt"],
        hint: "Read root's proof file now that you are uid 0." },
    ];
  }

  function guidance(task, diff) {
    if (diff === "easy") {
      const pills = (task.runs || []).map((cmd) => C.tap(cmd, cmd, "pill")).join("");
      C.write("    " + pills + (task.note ? " " + C.c(task.note, "grey") : ""));
    } else if (diff === "medium") {
      C.write(C.c("    hint: " + task.hint, "grey"));
    }
  }

  async function runTraining(diff) {
    diff = diff.toLowerCase();
    const tier = { easy: "Easy / Recruit", medium: "Medium / Operator", hard: "Hard / Specialist" }[diff] || "Easy / Recruit";
    state.loadNetwork(window.WORLD.allScenarios()["TRN-SANDBOX"]);
    const sh = new Shell(state);
    const T = tasks();
    let idx = 0;
    C.clear();
    C.box("TRAINING MODULE  ::  " + tier, [
      C.c("Lab host: TRN-SANDBOX-01 (10.13.37.20)", "white"),
      C.c("This is the live operator shell. Tooling is identical to a real", "grey"),
      C.c("engagement; objectives below track your progress.", "grey"),
      "",
      C.c("Type `objective` to repeat the current goal, `back` to leave.", "grey"),
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
    C.write(C.c("  tap ", "grey") + C.tap("menu", "menu", "cmd") + C.c(" for actions  ·  ", "grey") +
            C.tap("back", "back") + C.c(" to exit", "grey"));
    C.write("");
    if (state.config.hints) {
      C.write(C.c("  start with recon: ", "grey") + C.tap("nmap -sV " + net.objective, "nmap -sV " + net.objective, "pill"));
      C.write("");
    }
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
    C.write("  " + C.tap("AIH — where to start", "aih", "pill") + C.tap("settings", "settings", "pill") +
            C.tap("status", "status", "pill"));
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
      C.write(C.c("  training", "accent", "bold") + C.c("   (tap a tier)", "grey"));
      C.hr(34);
      C.write("  " + C.tap("easy", "training easy", "cmd") + C.c("    full command walkthrough", "grey"));
      C.write("  " + C.tap("medium", "training medium", "cmd") + C.c("  conceptual hints only", "grey"));
      C.write("  " + C.tap("hard", "training hard", "cmd") + C.c("    objectives only — no guidance", "grey"));
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
    if (["colour", "color", "hints"].includes(key)) {
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
    C.write(C.c("injectai", "accent", "bold") + C.c("  ·  secure shell", "grey"));
    C.write(C.c("tap ", "grey") + C.tap("≡ menu", "menu", "cmd") + C.c(" to navigate  ·  ", "grey") +
            C.tap("AIH", "aih", "cmd") + C.c(" for guidance", "grey"));
    C.write("");
    await consoleLoop();
  }

  // C is the shared IO surface exposed by app.js bootstrap
  const C = window.C;
  window.addEventListener("DOMContentLoaded", boot);
})();
