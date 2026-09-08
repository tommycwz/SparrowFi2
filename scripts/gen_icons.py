"""Generates SparrowFi's PWA app icons.

Draws a simple brand mark (a rounded-square in the app's accent blue with a
white ascending-arrow glyph, representing growth) at each size Angular's PWA
schematic expects, plus a maskable-safe variant and the favicon. Pure local
image generation - no network calls, no external assets.
"""
from PIL import Image, ImageDraw
import math

ACCENT = (29, 78, 216, 255)  # matches --accent in styles.scss
WHITE = (255, 255, 255, 255)

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
OUT_DIR = "public/icons"


def rounded_square(size: int, radius_ratio: float = 0.22) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=ACCENT)
    return img


def draw_arrow(draw: ImageDraw.ImageDraw, size: int, safe_ratio: float) -> None:
    # An ascending arrow (shaft + head) drawn inside a safe_ratio-sized box
    # centered on the canvas, so it survives maskable-icon center-cropping.
    # All coordinates below are normalized fractions (0..1) of that box.
    box = size * safe_ratio
    ox = (size - box) / 2
    oy = (size - box) / 2

    def pt(x, y):
        return (ox + x * box, oy + (1 - y) * box)

    shaft_w = 0.16  # fraction of the box
    x0, y0 = 0.10, 0.10
    x1, y1 = 0.62, 0.62
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * (shaft_w / 2), dx / length * (shaft_w / 2)
    shaft = [
        pt(x0 + nx, y0 + ny),
        pt(x1 + nx, y1 + ny),
        pt(x1 - nx, y1 - ny),
        pt(x0 - nx, y0 - ny),
    ]
    draw.polygon(shaft, fill=WHITE)

    # Arrow head at the top-right end: an isoceles triangle pointing along
    # the same (dx, dy) direction as the shaft, not axis-aligned.
    ux, uy = dx / length, dy / length  # unit vector along the shaft
    px, py = -uy, ux  # perpendicular unit vector
    head_len = 0.30  # fraction of the box
    head_w = 0.34
    tip_x, tip_y = 0.90, 0.90
    back_x, back_y = tip_x - ux * head_len, tip_y - uy * head_len
    tip = pt(tip_x, tip_y)
    base_a = pt(back_x + px * head_w / 2, back_y + py * head_w / 2)
    base_b = pt(back_x - px * head_w / 2, back_y - py * head_w / 2)
    draw.polygon([tip, base_a, base_b], fill=WHITE)


def make_icon(size: int) -> Image.Image:
    img = rounded_square(size)
    draw = ImageDraw.Draw(img)
    draw_arrow(draw, size, safe_ratio=0.62)
    return img


def main():
    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    for s in SIZES:
        icon = make_icon(s)
        icon.save(f"{OUT_DIR}/icon-{s}x{s}.png")

    # Apple touch icon (iOS ignores transparency/rounded corners itself).
    make_icon(180).save("public/apple-touch-icon.png")

    # Favicon (multi-res .ico).
    fav = make_icon(64)
    fav.save("public/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    print("Generated", len(SIZES), "icons + apple-touch-icon + favicon")


if __name__ == "__main__":
    main()
