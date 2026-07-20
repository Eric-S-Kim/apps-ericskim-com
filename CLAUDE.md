# apps-ericskim-com

Public repo serving "Eric's Apps" via GitHub Pages. Root `index.html` renders a tile grid from `apps.json`; hosted apps live in `apps/<slug>/`.

## Rules

1. **This repo is PUBLIC — GitHub Pages serves everything to the world.** Sanitize before publishing: no personal data, no local machine paths, no error text, no private URLs, no credentials, no operational infrastructure details.
2. `apps.json` holds public tiles only. Never commit a private app's URL, name, or data. Icon-only folders under `apps/` (glyphs for device-private tiles) are fine.
3. Deploy = `git push origin main` (Pages rebuilds in ~1 min). `git pull` before pushing.
4. After any change, verify the rendered published surface, not just local files.

The detailed operational charter lives in Eric's private notes.
