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
