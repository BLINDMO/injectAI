# injectAI

**injectAI** is a terminal-style *offensive security operations console* — a
fully self-contained simulator of a penetration-testing workflow. It looks and
behaves like a real attacker shell (Kali-style prompt, `nmap`, `curl`,
`gobuster`, `hydra`, `ssh`, `sudo`/GTFOBins privilege escalation), but every
host, service and exploit lives entirely in memory.

> Nothing here touches a real network. No packets leave your machine. It exists
> for learning, practice and curiosity.

---

## Two ways to run it

There are two builds of the same simulator:

- **CLI (Python)** — the reference implementation, below.
- **Web (browser)** — a faithful static port under [`docs/`](docs/) that runs
  entirely client-side, intended for **GitHub Pages**. Open `docs/index.html`
  locally, or deploy via Pages → *Settings → Pages → Deploy from a branch →
  this branch → `/docs`*. Nothing leaves the browser; progress is saved to
  `localStorage`.

## Running it (CLI)

Requires Python 3.10+. No dependencies.

```bash
python3 play.py
# or
python3 -m injectai
```

Jump straight into something:

```bash
python3 play.py engage ORIONBUILD     # deploy into an engagement
python3 play.py training easy         # start a guided module
```

If your terminal mangles colours: `python3 play.py --no-color`.

---

## The console

When it boots you land at the operator prompt (`operator@injectai >`). From here:

| command            | what it does                                         |
| ------------------ | ---------------------------------------------------- |
| `help`             | list console commands                                |
| `scenarios`        | list available engagements / targets                 |
| `brief <code>`     | read the briefing for an engagement                  |
| `engage <code>`    | deploy into the engagement's live operator shell     |
| `training [tier]`  | guided modules — `easy`, `medium`, or `hard`         |
| `status`           | your progress and recovered objectives               |
| `settings`         | display & interaction preferences (saved to disk)    |
| `exit`             | close the console                                    |

Inside an engagement you get the operational shell. `help` lists the tooling,
`status` tracks what you've discovered, and `back` returns to the console.

---

## Training modules

The same deliberately-vulnerable lab host is used at every difficulty tier — the
only thing that changes is how much help you get:

- **Easy** — the exact command for each objective is shown.
- **Medium** — a conceptual hint (the technique, not the keystrokes).
- **Hard** — objectives only; you're on your own.

A complete module walks you through a real kill chain end to end: service
discovery → credential attack → foothold → privilege escalation → root.

---

## Engagements

Pick one with `engage <code>`:

- **TRN-SANDBOX** *(Recruit / Easy)* — a single warm-up host; brute-force a
  weak SSH password, then escalate via a sudo/GTFOBins rule.
- **ORIONBUILD** *(Operator / Hard)* — `JH-ORIONBUILD13-FABLEFORK`, a node in an
  autonomous AI **stock-trading** cluster. Trading bot #13 has lost its operator
  lock and is firing trades on its own; the kill-switch only obeys root. The
  goal is to **gain sudo/root** and halt it. There are several independent ways
  in — an authenticated control-console RCE, a brute-forceable desk account, or
  a leaked deploy key — each with its own privilege-escalation route.
- **PHAROS** *(Operator / Medium)* — a mail relay with a chatty FTP service and
  a sloppy sudo rule.

The objective is to gain root/sudo on the in-scope host (and, for ORIONBUILD,
contain the rogue bot). Watch it act live with `tail -f /var/log/orion/bot-13.log`.

---

## Tooling (simulated)

| area    | commands                                             |
| ------- | ---------------------------------------------------- |
| Recon   | `nmap`, `ping`, `ifconfig`/`ip`, `netstat`           |
| Web     | `curl`, `wget`, `gobuster`/`dirb`                     |
| Intel   | `searchsploit`, `man <tool>`                         |
| Access  | `hydra`, `ftp`, `ssh`                                |
| Local   | `ls cd cat pwd whoami id find grep echo sudo`        |
| Session | `loot`, `status`, `sessions`, `clear`, `back`        |

`man <tool>` gives usage for the network tools. Credentials and private keys you
recover are stored automatically — check them with `loot`.

The privilege-escalation engine models real
[GTFOBins](https://gtfobins.github.io/) sudo techniques (interpreter abuse,
`find -exec`, editor escapes, …), so what you learn here transfers directly.

---

## Settings & saved state

Preferences and progress are persisted to `~/.injectai/state.json`. Change
settings from the console, e.g.:

```
settings typing on        # per-character typing effect
settings operator ghost   # rename your prompt handle
settings hints off        # hide inline tactical hints (more challenge)
```

---

## Project layout

```
injectai/
  app.py        boot sequence + entry point
  console.py    meta console: menu, scenarios, settings, status
  shell.py      operational shell: every simulated tool
  training.py   guided tutorial driver (easy/medium/hard)
  world.py      scenario definitions (the engagements)
  model.py      filesystem / host / service data model
  game.py       runtime state, sessions, loot, config persistence
  ui.py         colour, typed output, banners
play.py         launcher
```

---

*For education and entertainment only. Use what you learn responsibly and only
against systems you are explicitly authorised to test.*
