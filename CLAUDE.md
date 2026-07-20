# apps-ericskim-com

Public repo serving "Eric's Apps" via GitHub Pages. Root `index.html` renders a tile grid from `apps.json`; hosted apps live in `apps/<slug>/`.

## Rules

1. **This repo is PUBLIC — GitHub Pages serves everything to the world.** Sanitize before publishing: no personal data, no local machine paths, no error text, no private URLs, no credentials, no operational infrastructure details.
2. `apps.json` holds public tiles only. Never commit a private app's URL, name, or data. Icon-only folders under `apps/` (glyphs for device-private tiles) are fine.
3. **Device-referenced assets are LOAD-BEARING.** Phone launcher tiles (device localStorage) and installed PWAs reference icon/manifest URLs in this repo — no grep here can see those references. Every such path is listed in `protected-assets.json`. Run `node scripts/check-protected-assets.mjs` before ANY commit that deletes or renames files; it must print OK. Deleting a listed path requires Eric's explicit sign-off. When you publish a new setup link or PWA, ADD its asset paths to the list in the same commit. <!-- 2026-07-20: a privacy sweep deleted class-booker icons and silently broke the phone tile's image -->
4. Deploy = `git push origin main` (Pages rebuilds in ~1 min). `git pull` before pushing.
5. After any change, verify the rendered published surface, not just local files. Tile LOOKS (icon/colors/glow) live in each device's localStorage and in `C:/code/cos-phone-sync/device-tiles.json` (private canon) — repo changes must never alter them except via a new setup link Eric taps.

The detailed operational charter lives in Eric's private notes.
