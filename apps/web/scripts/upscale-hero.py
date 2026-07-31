"""Upscale & enhance Unipad hero background to 4K UHD."""
from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance

ROOT = Path(r"c:\Users\HP\Desktop\Unipad\apps\web\public")
SRC = ROOT / "hero-bg.png"
BACKUP = ROOT / "hero-bg-source.png"
OUT_PNG = ROOT / "hero-bg.png"
OUT_WEBP = ROOT / "hero-bg.webp"

TARGET_W, TARGET_H = 3840, 2160


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    if not BACKUP.exists():
        im.save(BACKUP, format="PNG", optimize=False)

    # Mild denoise — keep bold cartoon lines
    clean = im.filter(ImageFilter.MedianFilter(size=3))
    clean = Image.blend(im, clean, 0.35)

    scale = max(TARGET_W / clean.width, TARGET_H / clean.height)
    new_size = (
        max(1, int(round(clean.width * scale))),
        max(1, int(round(clean.height * scale))),
    )
    up = clean.resize(new_size, Image.Resampling.LANCZOS)

    left = (up.width - TARGET_W) // 2
    top = (up.height - TARGET_H) // 2
    up = up.crop((left, top, left + TARGET_W, top + TARGET_H))

    up = up.filter(ImageFilter.UnsharpMask(radius=1.6, percent=140, threshold=2))
    up = ImageEnhance.Contrast(up).enhance(1.06)
    up = ImageEnhance.Color(up).enhance(1.04)
    up = ImageEnhance.Sharpness(up).enhance(1.25)

    soft = up.filter(ImageFilter.SMOOTH_MORE)
    up = Image.blend(up, soft, 0.18)
    up = up.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))

    up.save(OUT_PNG, format="PNG", optimize=True, compress_level=6)
    up.save(OUT_WEBP, format="WEBP", quality=95, method=6)

    print("source", im.size)
    print("png", OUT_PNG.stat().st_size, Image.open(OUT_PNG).size)
    print("webp", OUT_WEBP.stat().st_size, Image.open(OUT_WEBP).size)


if __name__ == "__main__":
    main()
