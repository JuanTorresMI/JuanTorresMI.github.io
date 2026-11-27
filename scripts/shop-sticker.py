"""The envelope stickers: a sheet of QR stickers to print on the 4x6 thermal label printer (Rongta, 203 dpi) and cut out.

    py -3 scripts/shop-sticker.py            writes print/sticker-sheet.png and print/sticker-sheet.pdf

Twelve stickers a 4x6 label, each about 1.33 x 1.5 in, with dashed lines to cut on. The QR code opens /shop/thanks/ (both stores
and the coupon); the offer and code come from `shop_coupon` in _config.yml, so a reprint follows a new coupon. With no
code set, the sticker says thank you instead. Drawn straight onto the printer's own dots in pure black and white: grey
comes out speckled on thermal paper, and the QR's squares are whole dots so phones read it. Print it from the Rongta app
at 100% (no fit or scale), 4x6. print/ is never committed.
"""
import io
import os
import re
import sys

import qrcode
import yaml
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DPI = 203
SHEET = (812, 1218)              # 4 x 6 in
COLS, ROWS = 3, 4
CELL = (SHEET[0] // COLS, 304)   # about 1.33 x 1.5 in
PAD = 10                         # room for a wobbly cut


def config():
    with open(os.path.join(ROOT, "_config.yml"), encoding="utf-8") as f:
        return yaml.safe_load(f)


def font(name, size, weight=None):
    """The site's own fonts (woff2), opened by Pillow through an in-memory TTF."""
    data = io.BytesIO()
    t = TTFont(os.path.join(ROOT, "assets", "fonts", name))
    t.flavor = None
    t.save(data)
    data.seek(0)
    f = ImageFont.truetype(data, size)
    if weight:
        f.set_variation_by_axes([14, weight] if "opsz" in [a.axisTag for a in t["fvar"].axes] else [weight])
    return f


def fit(draw, text, name, size, width, weight=None):
    """The largest size up to `size` at which `text` fits in `width`."""
    while size > 8:
        f = font(name, size, weight)
        if draw.textlength(text, font=f) <= width:
            return f
        size -= 1
    return font(name, 8, weight)


def octagon(cx, cy, r):
    import math
    return [(cx + r * math.cos(math.radians(22.5 + 45 * i)), cy + r * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]


def qr_image(url):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=5, border=2)
    q.add_data(url)
    q.make(fit=True)
    return q.make_image(fill_color="black", back_color="white").get_image().convert("1")


def sticker(cfg):
    w, h = CELL
    img = Image.new("1", (w, h), 1)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = PAD, PAD, w - PAD, h - PAD
    coupon = cfg.get("shop_coupon") or {}
    code = (coupon.get("code") or "").strip()
    off = re.search(r"\d+%\s*off", coupon.get("offer") or "", re.I)
    least = re.search(r"\$\d+", coupon.get("offer") or "")

    # Stacked like the first stickers: the name reversed out of a black band, the QR code filling the middle, the offer
    # and the stores under it.
    # The band is cut like the cage (an octagon stretched wide), with a small octagon each side of the name: the shop
    # page's octagon, in the one ink a thermal printer has.
    band, cut = 30, 9
    d.polygon([(x0 + cut, y0), (x1 - cut, y0), (x1, y0 + cut), (x1, y0 + band - cut), (x1 - cut, y0 + band), (x0 + cut, y0 + band),
               (x0, y0 + band - cut), (x0, y0 + cut)], fill=0)
    for cx in (x0 + 20, x1 - 20):
        d.polygon(octagon(cx, y0 + band / 2, 8), outline=1, width=2)
        d.polygon(octagon(cx, y0 + band / 2, 3), fill=1)
    name = fit(d, "JUANJULIO CARDS", "anton.woff2", 26, x1 - x0 - 64)
    d.text(((x0 + x1) / 2, y0 + band / 2 + 1), "JUANJULIO CARDS", font=name, fill=1, anchor="mm")

    if code and off:
        first = f"{off.group(0).upper()}{' $' + least.group(0)[1:] + '+' if least else ''}  ·  CODE {code}"
    else:
        first = "THANK YOU  ·  SCAN FOR MORE"
    second = "SHOP EBAY + COLLX"
    f1 = fit(d, first, "inter.woff2", 15, x1 - x0, 800)
    f2 = fit(d, second, "inter.woff2", 13, x1 - x0, 700)
    d.text(((x0 + x1) / 2, y1), second, font=f2, fill=0, anchor="mb")
    h2 = d.textbbox((0, 0), second, font=f2, anchor="lt")[3]
    d.text(((x0 + x1) / 2, y1 - h2 - 5), first, font=f1, fill=0, anchor="mb")
    h1 = d.textbbox((0, 0), first, font=f1, anchor="lt")[3]

    qr = qr_image(cfg["url"].rstrip("/") + "/shop/thanks/")
    top, bottom = y0 + band, y1 - h2 - 5 - h1
    if qr.height > bottom - top:
        sys.exit(f"QR code is {qr.height} px, the sticker has {bottom - top}: shorten the address or make the sticker taller")
    qx, qy = (w - qr.width) // 2, top + (bottom - top - qr.height) // 2
    img.paste(qr, (qx, qy))
    # Corner brackets round the code, like a fight-night camera's frame; far enough out to leave its quiet zone white.
    g, arm, t = 6, 20, 3
    for cx, cy, sx, sy in ((qx - g, qy - g, 1, 1), (qx + qr.width + g, qy - g, -1, 1), (qx - g, qy + qr.height + g, 1, -1),
                           (qx + qr.width + g, qy + qr.height + g, -1, -1)):
        d.line([(cx, cy), (cx + sx * arm, cy)], fill=0, width=t)
        d.line([(cx, cy), (cx, cy + sy * arm)], fill=0, width=t)
    return img


def sheet(one):
    img = Image.new("1", SHEET, 1)
    for r in range(ROWS):
        for c in range(COLS):
            img.paste(one, (c * CELL[0], r * CELL[1]))
    d = ImageDraw.Draw(img)
    # Cut lines: dashes between the stickers and round the edge of the block, never through a sticker.
    def dash(a, b, horiz):
        for t in range(0, (SHEET[0] if horiz else SHEET[1]), 14):
            if horiz:
                d.line([(t, a), (min(t + 7, SHEET[0]), a)], fill=0, width=b)
            else:
                d.line([(a, t), (a, min(t + 7, ROWS * CELL[1]))], fill=0, width=b)
    for r in range(1, ROWS):
        dash(r * CELL[1], 2, True)
    dash(ROWS * CELL[1] - 1, 2, True)
    for c in range(1, COLS):
        dash(c * CELL[0], 2, False)
    return img


def main():
    out = os.path.join(ROOT, "print")
    os.makedirs(out, exist_ok=True)
    img = sheet(sticker(config()))
    img.save(os.path.join(out, "sticker-sheet.png"), dpi=(DPI, DPI))
    img.convert("L").save(os.path.join(out, "sticker-sheet.pdf"), resolution=DPI)
    print(os.path.join(out, "sticker-sheet.png"))


if __name__ == "__main__":
    main()
