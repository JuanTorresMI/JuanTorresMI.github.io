"""The envelope stickers: a sheet of QR stickers to print on the 4x6 thermal label printer (Rongta, 203 dpi) and cut out.

    py -3 scripts/shop-sticker.py            writes print/sticker-sheet.png and print/sticker-sheet.pdf

Eight stickers a 4x6 label, each 2 x 1.5 in, with dashed lines to cut on. The QR code opens /shop/thanks/ (both stores
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
COLS, ROWS = 2, 4
CELL = (SHEET[0] // COLS, 304)   # 2 x 1.5 in
PAD = 14                         # room for a wobbly cut


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


def qr_image(url):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=5, border=3)
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

    # The bill's band: the name reversed out of solid black, the way the shop page's headline sits.
    band = 54
    d.rectangle([x0, y0, x1, y0 + band], fill=0)
    name = fit(d, "JUANJULIO CARDS", "anton.woff2", 40, x1 - x0 - 24)
    d.text(((x0 + x1) / 2, y0 + band / 2 + 1), "JUANJULIO CARDS", font=name, fill=1, anchor="mm")

    # The QR code, square on the dots, at the left under the band.
    qr = qr_image(cfg["url"].rstrip("/") + "/shop/thanks/")
    top = y0 + band + 6
    room = y1 - top
    if qr.height > room:
        sys.exit(f"QR code is {qr.height} px, the sticker has {room}: shorten the address or make the sticker taller")
    img.paste(qr, (x0 - 4, top + (room - qr.height) // 2))

    # The words, right of the code: what scanning gets you, then the code itself in a ruled box.
    left = x0 - 4 + qr.width + 4
    col = x1 - left
    y = top + 4
    if code and off:
        lines = [("SCAN FOR", "anton.woff2", 34), (off.group(0).upper(), "anton.woff2", 58)]
        small = f"YOUR NEXT ORDER{' OF ' + least.group(0) + '+' if least else ''}"
    else:
        lines = [("THANK", "anton.woff2", 50), ("YOU", "anton.woff2", 50)]
        small = "SCAN FOR MORE CARDS"
    for text, fname, size in lines:
        f = fit(d, text, fname, size, col)
        box = d.textbbox((left, y), text, font=f, anchor="lt")
        d.text((left, y), text, font=f, fill=0, anchor="lt")
        y = box[3] + 6
    f = fit(d, small, "inter.woff2", 15, col, 800)
    d.text((left, y), small, font=f, fill=0, anchor="lt")
    y = d.textbbox((left, y), small, font=f, anchor="lt")[3] + 10
    if code:
        label = f"CODE {code}"
        f = fit(d, label, "inter.woff2", 18, col - 14, 800)
        tb = d.textbbox((0, 0), label, font=f, anchor="lt")
        bh = tb[3] - tb[1] + 14
        d.rectangle([left, y, x1, y + bh], outline=0, width=3)
        d.text(((left + x1) / 2, y + bh / 2), label, font=f, fill=0, anchor="mm")
        y += bh + 8
    stores = "SHOP EBAY + COLLX"
    f = fit(d, stores, "inter.woff2", 17, col, 800)
    d.text((left, y1), stores, font=f, fill=0, anchor="lb")
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
    dash(CELL[0], 2, False)
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
