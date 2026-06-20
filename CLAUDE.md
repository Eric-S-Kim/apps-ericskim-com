---
title: apps-ericskim-com — folder charter
charter: folder-charter-v1
last_reviewed: 2026-06-19
applies_to: C:\code\apps-ericskim-com
---

# apps-ericskim-com — folder charter

**What this is:** "Eric's Apps" — his installable personal app-store PWA (origami-crane logo), served from **GitHub Pages** at `https://Eric-S-Kim.github.io/apps-ericskim-com/` and added to his phone home screen via Chrome "Add to Home Screen." The repo is the **PUBLIC launcher**: root `index.html` renders a tile grid from `apps.json`; each hosted app lives in `apps/<slug>/`. The live Chief of Staff health board (`apps/chief-of-staff/`) is the one hosted app right now.

> Orientation + the publish-safety drill only. The always-on judgment layer is `~/CLAUDE.md`; the Flourishing-Ray brand work lives in the `flourishing-ray-brand` skill. This charter **points**; it does not restate them.

## Golden rules (if you read nothing else)
1. **This repo is PUBLIC — GitHub Pages serves everything to the world.** A client-side passcode is a speed-bump, not a lock (the data is fetched regardless). **Sanitize before publishing.** The CoS board fetches a SANITIZED `health-state.json` (job names + health + freshness only — no paths, no error text); keep it that way.
2. **NEVER commit a PRIVATE app's URL, name, or data here.** Private apps live ONLY in a device's `localStorage` (`eric-apps-private-v1`), delivered by a one-tap `#setup=<base64url>` link — never in `apps.json`. `apps.json` holds PUBLIC tiles only (today: just `chief-of-staff`).
3. **Use the `ship` CLI to add a public app, not hand-edited HTML** — `C:/code/eric-ship/ship.ps1 <appPath>` (dry-run by default; backend-archetype detect; refuses to publish a private-repo URL onto this public launcher). It copies the app to `apps/<slug>/` and registers the tile in `apps.json`. The root grid is data-driven; do not hand-author `<a class="card">` markup.
4. **To ship a CoS-board render fix you MUST bump BOTH** `BUILD` (the const in `apps/chief-of-staff/index.html`) **AND** `apps/chief-of-staff/version.json` to the same value, or open phone tabs never reload (they poll `version.json` every 60s and reload once on mismatch). Bumping one without the other = the fix never reaches the phone.
5. **Verify the RENDERED phone surface, not the source file.** After any board change, `curl` the published `…/apps/chief-of-staff/health-state.json` the phone actually fetches (and check the deployed `version.json`) — never call a tile green from a local file. See `~/.claude/memory/feedback-cos-verify-rendered-surface.md`.

## What lives here
- `index.html` — the store landing page + data-driven tile grid (fetches `apps.json`); this is what installs as the PWA. `manifest.json` + the 4 root PWA icons.
- `apps.json` — the PUBLIC tile registry (`{slug,name,sub,icon,kind,url,labelColor,borderColor,glowColor}`; `kind: hosted|link`). `ship` writes here.
- `apps/chief-of-staff/` — the hosted CoS health board: `index.html` (independent renderer with `BUILD` const + passcode `PW_HASH`), `version.json`, sanitized `health-state.json` (refreshed by the sync task), manifest + icons.
- `icons/` — tile glyphs (green = healthy / red = needs-attention variants).

## Do NOT
- Publish unsanitized local state, paths, error text, or any private-app URL/data (rule 1–2).
- Hand-edit the tile grid in `index.html` or hand-write `apps.json` cards — go through `ship` (rule 3).
- Bump `BUILD` without bumping `version.json` (or vice-versa) on a board render fix (rule 4).
- FR-restyle the CoS board off its current look without Eric's go — match the existing board (parity surface, like MB3).
- Assume `HEAD` is your last commit: the **`EricsApps-CoS-Phone-Sync`** task auto-commits + pushes `chore(cos): refresh phone health board` on its own schedule. `git pull` (expect divergence) before you push.

## Deploy / ops
- **Deploy = `git push origin main`** → GitHub Pages rebuilds in ~1 min. There is **no** Actions workflow and **no** Railway service for this repo — it is plain Pages from the `main` branch root. (`ship` does the push with confirmation when not `--no-push`.)
- **CoS data refresh** is automated: the scheduled task `EricsApps-CoS-Phone-Sync` runs `C:/code/cos-phone-sync/sync_cos_health.py --push` hourly, which sanitizes + commits + pushes ONLY `health-state.json` (data) — it does NOT update render code. A render-code fix is a separate manual push with the BUILD/version bump (rule 4).
- **Backup note:** this repo is **GitHub-only — it is NOT in the D: `personal-mirror` / `research-mirror` lanes.** GitHub `Eric-S-Kim/apps-ericskim-com` (PUBLIC) is the sole durable copy; if anything here becomes sole-copy and sensitive, flag it (it should never be sensitive — see rule 1).

## Deeper docs (point, don't duplicate)
- `README.md` — structure + "adding a new app" (legacy manual path; prefer `ship`).
- `C:/code/eric-ship/` — the `ship` CLI (`ship.mjs` + `ship.ps1` wrapper, `ship.config.json` points launcherRepo here).
- Wiki canon `OneDrive/10_ai_integration/15_llm_wiki/topics/personal-app-store.md` — the "how any app type fits" architecture (hosted / framework-static / link / private).
- memory `reference-erics-apps-store.md` (ops quick-ref) · `reference-cos-dashboard-surfaces.md` (the BUILD/version self-update gate) · `feedback-cos-verify-rendered-surface.md` (verify the live phone board).

<!-- folder-charter-v1, written 2026-06-19 from the system-enhancement deep scan (20_reference_library/24_10x_coder_setups/). Loads on demand when an agent works in C:\code\apps-ericskim-com. Codex reads AGENTS.md, not this file — see AGENTS.md (thin pointer) for dual-AI parity. -->
