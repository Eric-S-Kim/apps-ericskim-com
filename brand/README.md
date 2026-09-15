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
