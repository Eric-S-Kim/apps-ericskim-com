"""Rebuild the four launcher icons from the master artwork.

Usage: python brand/build-launcher-icons.py     (runs from any working directory)

Geometry is copied from the previous origami-crane icons so the launcher keeps
its exact silhouette:
  any-N       : artwork fills the square, corner radius 25.2% of N
  maskable-N  : artwork inset to 79.9% of N, centred, same relative radius
Both sit on an opaque black background (no alpha), matching the originals.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / 'brand' / 'hummingbird-master-1024.png'
RADIUS_RATIO = 0.252
MASKABLE_RATIO = 0.799
SS = 4  # supersampling for a clean rounded edge


def rounded(art_size, radius):
    m = Image.new('L', (art_size * SS, art_size * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, art_size * SS - 1, art_size * SS - 1], radius=radius * SS, fill=255)
    return m.resize((art_size, art_size), Image.LANCZOS)


def build(master, size, maskable):
    art_size = round(size * MASKABLE_RATIO) if maskable else size
    art = master.resize((art_size, art_size), Image.LANCZOS)
    art.putalpha(rounded(art_size, art_size * RADIUS_RATIO))
    out = Image.new('RGB', (size, size), (0, 0, 0))
    off = (size - art_size) // 2
    out.paste(art, (off, off), art)
    return out


def main():
    master = Image.open(MASTER).convert('RGB')
    for size in (192, 512):
        for maskable in (False, True):
            name = f"icon-{'maskable' if maskable else 'any'}-{size}.png"
            build(master, size, maskable).save(ROOT / name)
            print('wrote', name)


if __name__ == '__main__':
    main()
