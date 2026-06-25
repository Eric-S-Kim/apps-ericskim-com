# Class Booker

A one-tap launchpad (PWA) for booking Eric's recreational classes from his phone.
Part of **Eric's Apps**. Static, no backend, no nightly job, no personal data.

## What it does
Four cards, each **deep-links straight to a studio's booking page**. The phone's own
autofill + wallet (Chrome autofill, Google Pay, Stripe Link) handle the details and
payment. The app stores nothing.

## Where it lives
- **Files:** `apps/class-booker/` in this repo (`github.com/Eric-S-Kim/apps-ericskim-com`).
- **Served:** GitHub Pages → `https://eric-s-kim.github.io/apps-ericskim-com/apps/class-booker/`
- **Tile:** registered as a **private tile** (per-device `localStorage` via a `#setup=` link),
  intentionally **not** in `apps.json`. This keeps it below the public tiles in the launcher,
  next to Eric's other personal apps. (Most hosted apps go in `apps.json`; this one is private
  by choice — the app itself is still hosted here like Chief of Staff.)

## Theme
Aqua-teal (Flourishing Ray teal family), chosen distinct from the other tiles
(Chief of Staff = red, Morning Brief = green, Cupcake = orange, Nest = violet).
Lustria headings + Hanken Grotesk body. Tile colors: label `#115E75`, border `#0891B2`,
glow `#0891B252`.

## Venues (stable deep links)
| Venue | Link | Notes |
|---|---|---|
| Ballet BC · MOVE | `https://balletbc.com/move-dropin/` | Thu 6pm · pick the $25 Drop-in · Google Pay |
| Bettina Rothe | `https://www.bettinarothe.com/classes/?type=inperson` | Wed 7pm · 2 tickets · Stripe Link |
| Modo · Olympic Village | `https://modoyoga.com/olympic-village/schedule/` | membership, no payment · Reserve → Complete |
| Gloria Glo | `https://www.gloriaglo.com/5rhythms` | Sundance + Mon (resumes Aug 31, 2026) · 2 tickets · card by hand |

## Add a new venue
1. Copy an existing `<a class="card" ...>` block in `index.html`; set its `href` to the new
   studio's **stable booking URL**, and edit the chip, tag, venue name, and schedule line.
2. Commit + push — GitHub Pages redeploys in ~1 min.
3. No setup-link change needed: the tile points at this whole app, not at individual venues.

## Icons
A teal "dancer in motion" mark, generated via Playwright SVG→PNG. If you change the icon,
bump the `?v=N` cache-buster on the icon URL in the `#setup=` link so phones re-fetch it
(GitHub's CDN caches by full URL).

## Related
The deeper desktop automation — Playwright-over-CDP that drives each booking all the way to
its payment page — is the separate **class-booker skill** at `~/.claude/skills/class-booker/`.
This app is just the phone-side launchpad of stable deep links.
