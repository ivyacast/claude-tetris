# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

Vanilla HTML/CSS/JS: no package.json, no build, no tests, no linter. Serve the folder with `python3 -m http.server 8000` and open `http://localhost:8000`. The only way to verify a change is to load the page in a browser and play it.

## Conventions

- Player-facing strings (overlay text, buttons, panel labels) and `README.md` are in Spanish. Identifiers and code comments are in English.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`…).
- `game.js` is a single classic script (`'use strict'`, module-level `let` state, no ES modules). It is loaded at the end of `<body>`, so DOM lookups run at load time.

## Gotchas

- `#board` canvas `width`/`height` in `index.html` must equal `COLS × BLOCK` by `ROWS × BLOCK`. The `#next-canvas` (120×120) assumes a 4×4 grid at `NB = 30`.
- A piece's cell values are its type index (1–7). That index selects its color from `COLORS`, and the board stores it after locking. Adding a piece type means updating `PIECES`, `COLORS` and the hardcoded `* 7` in `randomPiece()`.
- Type 8 is the bomb power-up. It is in `PIECES`/`COLORS` but intentionally excluded from `randomPiece()` (only `nextPiece()` emits it), and it is never stored on the board (`explode()` runs instead of `merge()`). A new regular piece type would need index 9+ or shifting `BOMB`.
- Controls are defined in three places, and all three must stay in sync: the `keydown` handler in `game.js`, the controls list in `index.html` and the controls table in `README.md`.
- The README also lists the tunable constants and the scoring and speed formulas. Update it when those change.
