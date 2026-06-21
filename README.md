# injectAI — web deployment branch

This branch (`gh-pages`) holds the **static browser build** of injectAI, ready
to be served by GitHub Pages. The site files (`index.html`, `app.js`,
`world.js`, `console.js`) live at the repo root so Pages can serve them with
**Deploy from a branch → `gh-pages` → `/(root)`**.

Once enabled, the console is live at:
**https://blindmo.github.io/injectAI/**

It runs entirely client-side — nothing leaves the browser; progress and
settings persist to `localStorage`.

> injectAI is a terminal-style *offensive security operations simulator*. Every
> host, service and exploit is fully simulated. It exists for learning and
> practice. Use what you learn responsibly and only against systems you are
> explicitly authorised to test.

## Quick start

Type `help`, `scenarios`, or `training` at the prompt. The flagship engagement
is `JH-ORIONBUILD13-FABLEFORK` (`engage ORIONBUILD`).

## Source

The full project — including the reference **Python CLI** build and developer
docs — lives on the feature branch
[`claude/terminal-hacking-simulator-c38rs9`](../../tree/claude/terminal-hacking-simulator-c38rs9).
