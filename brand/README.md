# Launcher artwork

`hummingbird-master-1024.png` is the master artwork for the four root launcher icons
(`icon-any-192/512.png`, `icon-maskable-192/512.png`). Those four PNGs are generated
from it — never edit them by hand.

Rebuild after changing the master:

```
python brand/build-launcher-icons.py
```

The script reproduces the geometry of the original origami-crane icons exactly:
full-bleed for `any`, inset to 79.9% for `maskable`, corner radius 25.2% of the
artwork square, opaque black background, no alpha. Verify by comparing the artwork
inset and corner run against the previous icons before committing.

## Provenance

Origami paper-craft hummingbird over a sunset valley, replacing the origami crane
that carried the same palette (deep forest green, cream sky, gold sun). Composed
2026-09-13 from three generated variants: the body, wings and tail of one, the
glowing valley background of another, and the head, eye fold and upswept beak of a
third, grafted together and cleaned up in Pillow/OpenCV rather than rerolled.

The exploration set (nine variants, side by side at both full and home-screen size)
lives in the pen.dev canvas document that produced it; this repo keeps only the
chosen master, which is the copy that matters for rebuilding the icons.

An installed PWA caches its icons: after deploying a new icon, remove and re-add the
home-screen shortcut to see it change.

# Pantry Shelf

`pantry-shelf-master.svg` is the master for the Pantry Shelf icon and is byte-identical
to the deployed `apps/pantry-shelf/icon.svg`. The deployed path is device-referenced
(it is listed in `protected-assets.json` and is used by BOTH the PWA manifest and the
phone launcher tile URL), so the icon is changed by replacing that file's contents in
place — never by adding a new path and repointing, which would need a fresh setup link.
This master exists so the artwork survives if that file is ever rebuilt or swept.

It is true vector — 82 paths plus 2 background rects, no raster — so there is nothing to
regenerate at other sizes; one file serves every size.

## Provenance

A chef mouse carrying a full sack home to stacked pantry shelves, folk-woodcut style, on
a deep brown ground (`#3B2212` frame, `#402719` panel). Chosen 2026-09-15 as "04 The
Haul", from the "refilling the pantry" set — the concept is restocking as an arrival
rather than a shelf inventory.

It replaces a red-berry-and-green-pickle jar pair ("01 True Scale", 2026-09-14), which
itself replaced a five-jar still life. The jar icons said "preserves"; the chef mouse
says "someone is refilling your shelf", which is what the app actually does. The trade is
density: the mouse is a single strong silhouette (chef hat + head + sack) that survives
the 48px launcher size, but the shelf jars behind it are decoration at that size, not
readable objects.

Note when rebuilding from the pen.dev canvas that produced the exploration sets: the
canvas cards place *scaled copies* of the artwork, and pen.dev rescales a path by
resizing its node box while leaving the stored geometry alone. Exporting those copies
shape-by-shape with only a translate silently drops the scale and scatters each shape's
contents. The reliable route is pen.dev's `html-css` export of the chosen 296x296 concept
frame — every layer comes out as an absolutely-positioned `<svg>` carrying its own
viewBox, which flattens losslessly into one `<g transform="translate(...) scale(...)">`
per layer. Three canvas artifacts are dropped in that flattening: two zero-geometry paths
and a stray blue guide segment.

An installed PWA caches its icons: after deploying a new icon, remove and re-add the
home-screen shortcut to see it change.

# Enveloped sunset glow

`sunset-enveloped.css` is the master for the background treatment on the root
`index.html`. It is a *copy*, not the served file — the live rules are inlined in
`index.html`'s `<style>` block, because that page ships as a single file with no
external stylesheet. Change the page and this master together, or the master
silently rots.

Self-contained apart from `--gold`, with the reuse steps and the failure modes
documented in the file's header comment. Read that header before pasting it
anywhere — three of the four gotchas listed are ones that actually happened.

## Provenance

Chosen 2026-09-15 as "4 · Enveloped — light on three sides", from a set of five
sunset treatments rendered at real phone width (412px) against Eric's actual
tiles. The others were "Low Sun" (band dissolved entirely, most restrained),
"Ember Horizon" (kept a horizon, feathered the seam, terracotta floor),
"Alpenglow" (muted rose above the amber) and "Deep Dusk" (bronze floor, small
concentrated sun — the richest, and the one that tinted the bottom row of tiles
most).

Enveloped won because it is the only one where the light also comes up the left
and right edges, so the screen reads as sitting inside the glow rather than above
a landscape — while staying subtle, since the side columns are only 15% gold.

It replaced a flat amber slab (`--horizon-top`/`--horizon-bottom`, a
`clamp()`-height band) that carried a 2px gold `border-top`. Because that band was
`position: fixed`, the rule appeared to cut straight across the app tiles whenever
the page scrolled. The rule was removed first (2026-09-15, commit `bcfee02`); the
whole band was replaced by this treatment in the same day's work.

The five-variant comparison was rendered from the live page with the device tiles
seeded into `localStorage`, not mocked up — the same method used for the icon
exploration sets.

# Chief of Staff — meerkat sentinel

`chief-of-staff-meerkat-master-1024.png` is the master for the Chief of Staff
launcher tile. The deployed file is `apps/chief-of-staff/icon-any-192.png`.

That deployed path is device-referenced — it is listed in `protected-assets.json`
and is the exact URL in the `cos-private-board` row of `cos-phone-sync/device-tiles.json`
(private canon), which the phone tile and the MB3 board both read. So the icon is
changed by **replacing that file's contents in place**, never by adding a new path
and repointing, which would need a fresh setup link.

Rebuild both sizes from the master by resizing it; no script is needed, because
the artwork is full-bleed with no inset or corner geometry to reproduce (unlike
the four root launcher icons, which do need `build-launcher-icons.py`).

Two older copies, `icons/chief-of-staff-192.png` and `icons/chief-of-staff-red-192.png`,
are byte-identical to each other and still carry the previous red pulse mark. They
are protected assets and were deliberately **left untouched** when the meerkat
shipped: no current reference points at them, but a device holding an older setup
link might, and a repo grep cannot see that. Update them only if a stale tile
actually turns up.

## Provenance

Chosen 2026-09-15 as "6 · Meerkat sentinel", from a set of fifteen animal
directions, each drawn in its own palette and drawing style.

The brief came from the Chief of Staff's own `INVARIANTS.md`: *"observes automation
evidence, projects the board, and alerts Eric. It does not repair, rerun, or mutate
monitored systems."* That is a watcher with a voice and no hands, which rules out
the obvious fixer animals — the beaver patching the dam, the mongoose killing the
snake — because the mark would promise something the software deliberately refuses
to do. A meerkat colony posts one sentinel on a mound while the rest forage; its
entire job is to watch and call out, and nothing else. That is the invariant with
fur on it.

It replaces a red ECG pulse line. The pulse said "vital signs", which was close but
read as *the alarm itself*; the CoS is the thing that watches and decides whether
an alarm is warranted, and it is quiet most of the time.

Built by exporting the chosen 296px concept frame from the pen.dev canvas at 4x
with the card's cream fill and corner clipping removed, cropping to the alpha
bounding box (the generated SVG panel does not fill the frame, and leaves uneven
transparent side margins), then flattening onto the panel's own sampled colour
`#D49856` so the tile is fully opaque with no alpha fringe at any size. The crop is
1134x1184, so squaring it stretches the artwork about 4% horizontally — invisible
at tile size and preferable to transparent side strips.

Known mismatch, deliberately not changed: the tile's stored `borderColor` /
`glowColor` in `device-tiles.json` are still red (`#cc2222`), chosen for the old
pulse mark. Tile colours live in the device's localStorage, so changing them
requires Eric to tap a fresh setup link — see rule 5 in the repo `CLAUDE.md`.

An installed PWA caches its icons: after deploying a new icon, remove and re-add the
home-screen shortcut to see it change.
