# apps-ericskim-com — agent guidance

Read `CLAUDE.md` — its rules are canonical for this repo. In short: this repo is PUBLIC (GitHub Pages serves everything), so sanitize before publishing — no personal data, local paths, private URLs, or credentials. `apps.json` holds public tiles only. **Before any commit that deletes/renames files, run `node scripts/check-protected-assets.mjs`** — paths in `protected-assets.json` are referenced by phone tiles/PWAs and must never be removed without Eric's sign-off. Deploy = `git push origin main`; pull first.
