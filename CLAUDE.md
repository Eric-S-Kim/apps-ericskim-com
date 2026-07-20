# apps-ericskim-com

Public repo serving "Eric's Apps" via GitHub Pages. Root `index.html` renders a tile grid from `apps.json`; each hosted app lives in `apps/<slug>/`.

## Rules

1. **This repo is PUBLIC — GitHub Pages serves everything to the world.** Sanitize before publishing: no personal data, no local machine paths, no error text, no private URLs, no credentials, no operational infrastructure details.
2. `apps.json` holds public tiles only. Never commit a private app's URL, name, or data.
3. A render fix to the Chief of Staff board must bump BOTH the `BUILD` const in `apps/chief-of-staff/index.html` AND `apps/chief-of-staff/version.json` to the same value, or open phone tabs never reload.
4. Deploy = `git push origin main` (Pages rebuilds in ~1 min). `git pull` before pushing — automated data refreshes may have advanced `main`.
5. After any change, verify the rendered published surface, not just local files.

The detailed operational charter lives in Eric's private notes.
