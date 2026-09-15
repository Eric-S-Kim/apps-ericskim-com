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

It is true vector — 131 shapes, no raster — so there is nothing to regenerate at other
sizes; one file serves every size.

## Provenance

A red berry jar and a tall green pickle jar on a cream shelf, folk-woodcut style, on a
deep brown ground (`#3C1A04`). Chosen 2026-09-14 as "01 True Scale", where the two jars
keep their real relative heights.

It replaces a five-jar still life that used the same drawing language. Five jars across
left each one about a fifth of the icon width, which turned to mush at the 48px launcher
size; two jars give each roughly four times the area. An earlier two-jar attempt paired
the red jar with the honey jar, but gold on brown sat too close in value and the pair
fused into one shape when small — the green jar separates by both hue and value.

The jar artwork is reused from the five-jar original rather than redrawn, so the style is
identical by construction. The exploration sets (five single/multi-jar compositions, then
five arrangements of the red-and-green pair, each rendered at real launcher sizes for
judging) live in the pen.dev canvas document that produced them; this repo keeps only the
chosen master.

Note when rebuilding from that canvas: the canvas cards place *scaled copies* of each jar,
and pen.dev rescales a path by resizing its node box while leaving the stored geometry
alone. Exporting those copies shape-by-shape with only a translate silently drops the
scale and scatters each jar's contents outside its jar. Compose from the original
unscaled jars instead and apply the placement as one group transform.

An installed PWA caches its icons: after deploying a new icon, remove and re-add the
home-screen shortcut to see it change.
