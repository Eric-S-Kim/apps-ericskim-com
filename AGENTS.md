# apps-ericskim-com — agent guidance

Read `CLAUDE.md` before substantial work in this repo; it is the canonical project charter (dual-AI parity — Codex reads this file, Claude Code reads `CLAUDE.md`).

The load-bearing rules, restated so they reach you even without following the pointer:

- **This repo is PUBLIC (GitHub Pages).** Sanitize before publishing — no paths, no error text, no private-app URLs or data. The CoS board's `health-state.json` is sanitized (names + health + freshness only); keep it that way.
- **Add a public app with the `ship` CLI** (`C:/code/eric-ship/ship.ps1 <appPath>`, dry-run by default), which copies to `apps/<slug>/` and registers the tile in `apps.json`. Do not hand-edit the grid in `index.html`. Private apps go via a `#setup=` localStorage link, never into `apps.json`.
- **CoS-board render fix: bump BOTH** `BUILD` (const in `apps/chief-of-staff/index.html`) **and** `apps/chief-of-staff/version.json` to the same value, or open phone tabs never reload.
- **Deploy = `git push origin main`** → Pages rebuilds (~1 min). No Actions, no Railway. `git pull` first — the `EricsApps-CoS-Phone-Sync` task auto-commits/pushes on its own schedule, so `HEAD` may not be your last commit.
- **Verify the rendered phone surface**, not the local file — `curl` the published `health-state.json`/`version.json`.
- **Backup:** GitHub-only; NOT in the D: mirror lanes.
