"""Generates SparrowFi's PWA app icons (favicon, apple-touch-icon, and the
manifest's icon-*.png set) from the brand artwork at
`scripts/assets/sparrow-source.png` - a circular sparrow badge, replacing the
earlier programmatically-drawn blue arrow mark. Pure local image resizing -
no network calls.

Re-run this after swapping in new artwork: `python3 scripts/gen_icons.py`.
"""
from PIL import Image

SOURCE = "scripts/assets/sparrow-source.png"
SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
OUT_DIR = "public/icons"
BACKGROUND = (255, 255, 255, 255)  # white - the source has transparent
# corners around its circular badge, and both maskable icon safety (OS
# masks shouldn't reveal an unpredictable void) and favicon legibility at
# tiny sizes want an opaque backing square rather than transparency.


def load_master() -> Image.Image:
    img = Image.open(SOURCE).convert("RGBA")
    # Pillow's default resampling for a large downsize benefits from a
    # square power-of-two-ish source; 1024x1024 in is plenty for a 512 max
    # output size.
    return img


def flatten(img: Image.Image, size: int) -> Image.Image:
    resized = img.resize((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    canvas.paste(resized, (0, 0), resized)
    return canvas.convert("RGB")


def main():
    import os

    master = load_master()
    os.makedirs(OUT_DIR, exist_ok=True)

    for s in SIZES:
        flatten(master, s).save(f"{OUT_DIR}/icon-{s}x{s}.png")

    # Apple touch icon - iOS handles transparency inconsistently, so this is
    # always flattened onto an opaque background.
    flatten(master, 180).save("public/apple-touch-icon.png")

    # Favicon (multi-res .ico) - resample at each target size explicitly
    # rather than letting Pillow downscale one bitmap, so small sizes stay
    # legible.
    fav_sizes = [16, 32, 48, 64]
    fav_images = [flatten(master, s) for s in fav_sizes]
    fav_images[0].save(
        "public/favicon.ico",
        sizes=[(s, s) for s in fav_sizes],
        append_images=fav_images[1:],
    )

    print("Generated", len(SIZES), "icons + apple-touch-icon + favicon from", SOURCE)


if __name__ == "__main__":
    main()
