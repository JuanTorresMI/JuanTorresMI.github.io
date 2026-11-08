#!/usr/bin/env python3
"""Draws a card's Reel: 16 seconds, 1080x1920, long enough for its song to settle. The card rises in, flips to its back and returns (a card with no back photo
shines instead), then its price and the shop. The words stay in the area Instagram leaves clear; the top 14% and bottom
35% hold only decoration. Its own sound is recorded card effects (scripts/sfx, Kenney's Casino Audio, CC0); Instagram adds
the song on top (post_listings.py). It loops: the card flies out at the end and rises back in at the start, over the same stage. The API can't choose where a song starts, so `cue` holds the reveal for that many seconds,
until the song's good part.

What's behind the card takes one of several looks (THEMES: the card's glow, the octagon, spotlights, a comic burst, a retro
sunset, holo foil), in turn, so the feed doesn't repeat itself; the layout stays the same. make_set draws a set's collage:
its cards dropping into a grid, the dearest few stepping forward with their names and prices, then how many and the shop."""
import math, os, random, re, subprocess
import imageio_ffmpeg
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H, FPS, SECS = 1080, 1920, 30, 16
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "fonts", "Anton-Regular.ttf")
# (seconds, file, volume): the card lands, the words hit, each flip, the price, the shop.
SOUNDS = [(0.02, "card-slide-1.ogg", 0.8), (0.35, "card-place-1.ogg", 1.0), (1.3, "card-place-2.ogg", 0.6), (4.6, "card-slide-3.ogg", 1.0), (7.0, "card-slide-5.ogg", 1.0),
          (8.6, "chips-stack-2.ogg", 0.9), (9.2, "card-shove-1.ogg", 0.8), (15.3, "card-slide-1.ogg", 0.8)]
INK, WHITE, RED = (10, 10, 13), (255, 255, 255), (255, 34, 44)
SHOP_TOP, SHOP = "SHOP MY CARDS ON COLLX", "JUANJULIO"
CH = 800

ease = lambda t: t * t * (3 - 2 * t)
clamp = lambda x, a=0.0, b=1.0: max(a, min(b, x))


def back_out(t):
    c = 1.70158
    t -= 1
    return 1 + (c + 1) * t ** 3 + c * t ** 2


def cutout(path):
    """The card without its plain background; the whole photo when the card can't be told from what's behind it."""
    im = Image.open(path).convert("RGB")
    corner = im.getpixel((6, 6))
    mask = ImageChops.difference(im, Image.new("RGB", im.size, corner)).convert("L").point(lambda v: 255 if v > 55 else 0)
    box = mask.filter(ImageFilter.MinFilter(9)).getbbox()
    if not box or (box[2] - box[0]) * (box[3] - box[1]) < im.width * im.height * 0.3:
        return im
    x0, y0, x1, y1 = box
    # A card is 2.5 by 3.5 inches: anything taller than that is the stand under it.
    y1 = min(y1, y0 + round((x1 - x0) * 3.5 / 2.5 * 1.04))
    out = im.crop((x0 + 9, y0 + 9, x1 - 9, y1 - 9))
    out.info["backdrop"] = corner
    return out


def accent(im):
    """The card's own loudest colour, bright enough to read on black; orange when it has none."""
    best, score = (255, 122, 0), 0
    back = im.info.get("backdrop")
    for count, (r, g, b) in im.resize((64, 84)).quantize(12).convert("RGB").getcolors(4096):
        hi, lo = max(r, g, b), min(r, g, b)
        if back and abs(r - back[0]) + abs(g - back[1]) + abs(b - back[2]) < 110: continue    # the photo's backdrop isn't the card
        sat = (hi - lo) / hi if hi else 0
        s = sat ** 3 * count * (1 if hi > 110 and sat > 0.4 else 0)    # vivid over common, so skin doesn't win
        if s > score:
            best, score = (r, g, b), s
    k = 255 / max(best)
    return tuple(int(min(255, v * k)) for v in best)


def run_of(c):
    m = re.search(r"/\s*(\d{1,4})\b", f"{c.get('serial') or ''} {c.get('name') or ''}")
    return int(m.group(1)) if m and int(m.group(1)) > 1 else None


def hook(c):
    run = run_of(c)
    if run: return f"ONLY {run} MADE"
    if c.get("auto"): return "AUTOGRAPHED"
    if c.get("rookie"): return "ROOKIE CARD"
    if c.get("parallel") and len(c["parallel"]) <= 16: return c["parallel"].upper()
    return "FRESH DROP"


def label(c):
    bits = [c.get("set"), c.get("parallel")]
    if not c.get("set"):
        name = re.sub(r"#\S+", "", c.get("name") or "")
        for w in (c.get("player") or "").split(): name = name.replace(w, "")
        bits = [re.sub(r"[\s-]+$", "", re.sub(r"\s+", " ", name)).strip()]
    words = "  ·  ".join(b for b in bits if b).upper().split(" ")
    # A long line first loses "UFC", which every card here says, then whole words from its end, never half of one.
    wide = lambda ws: ImageFont.truetype(FONT, 30).getlength(" ".join(ws)) > 900
    if wide(words): words = [w for w in words if w != "UFC"]
    while len(words) > 1 and wide(words): words.pop()
    return re.sub(r"[\s·-]+$", "", " ".join(words))


def fit(text, size, width):
    f = ImageFont.truetype(FONT, size)
    while f.getlength(text) > width and size > 30:
        size -= 2
        f = ImageFont.truetype(FONT, size)
    return size


def poster(frame, xy, s, size, fill, alpha=1.0, scale=1.0, stroke=9, tilt=-2):
    if alpha <= 0: return
    f = ImageFont.truetype(FONT, max(8, round(size * scale)))
    tw, th = int(f.getlength(s)) + 90, int(size * scale * 1.8)
    layer = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((tw / 2 + 7, th / 2 + 9), s, font=f, fill=(0, 0, 0, 210), anchor="mm", stroke_width=stroke, stroke_fill=(0, 0, 0, 210))
    d.text((tw / 2, th / 2), s, font=f, fill=fill + (255,), anchor="mm", stroke_width=stroke, stroke_fill=INK + (255,))
    layer = layer.rotate(tilt, expand=True, resample=Image.BICUBIC)
    if alpha < 1: layer.putalpha(layer.getchannel("A").point(lambda v: int(v * alpha)))
    frame.alpha_composite(layer, (int(xy[0] - layer.width / 2), int(xy[1] - layer.height / 2)))


def caption_line(frame, y, s, alpha):
    if alpha <= 0 or not s: return
    f = ImageFont.truetype(FONT, fit(s, 36, 900))
    w = int(f.getlength(s)) + 12
    layer = Image.new("RGBA", (w, 60), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((w / 2, 30), s, font=f, fill=WHITE + (235,), anchor="mm")
    layer.putalpha(layer.getchannel("A").point(lambda v: int(v * alpha)))
    frame.alpha_composite(layer, (W // 2 - w // 2, y - 30))


def sticker(frame, xy, s, p, color, was=None, strike=0, under=None):
    """The price on a starburst. A price drop has the old price struck through inside it, so everything about the price is in one place."""
    R = 150
    layer = Image.new("RGBA", (R * 2 + 40, R * 2 + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = R + 20
    pts = [(c + (R if i % 2 == 0 else R * 0.84) * math.cos(i * math.pi / 14), c + (R if i % 2 == 0 else R * 0.84) * math.sin(i * math.pi / 14)) for i in range(28)]
    d.polygon([(x + 8, y + 10) for x, y in pts], fill=(0, 0, 0, 170))
    d.polygon(pts, fill=color + (255,), outline=INK + (255,), width=7)
    if was:
        f = ImageFont.truetype(FONT, 54)
        d.text((c, c - 66), was, font=f, fill=WHITE + (255,), anchor="mm", stroke_width=3, stroke_fill=INK + (255,))
        w = f.getlength(was) + 20
        if strike: d.line((c - w / 2, c - 58, c - w / 2 + w * strike, c - 72), fill=INK + (255,), width=9)
        d.text((c, c + 30), s, font=ImageFont.truetype(FONT, fit(s, 108, 230)), fill=INK + (255,), anchor="mm")
    elif under:
        # A count with its word under it: "84" over "CARDS".
        d.text((c, c - 22), s, font=ImageFont.truetype(FONT, fit(s, 118, 220)), fill=INK + (255,), anchor="mm")
        d.text((c, c + 66), under, font=ImageFont.truetype(FONT, fit(under, 52, 200)), fill=WHITE + (255,), anchor="mm", stroke_width=3, stroke_fill=INK + (255,))
    else:
        d.text((c, c), s, font=ImageFont.truetype(FONT, fit(s, 118, 230)), fill=INK + (255,), anchor="mm")
    layer = layer.rotate(10, expand=True, resample=Image.BICUBIC)
    k = 1.5 - 0.5 * ease(p)
    layer = layer.resize((int(layer.width * k), int(layer.height * k)), Image.BICUBIC)
    frame.alpha_composite(layer, (int(xy[0] - layer.width / 2), int(xy[1] - layer.height / 2)))


def tag(frame, y, slide, color):
    f1, f2 = ImageFont.truetype(FONT, 34), ImageFont.truetype(FONT, 74)
    w = int(max(f1.getlength(SHOP_TOP), f2.getlength(SHOP))) + 110
    layer = Image.new("RGBA", (w, 158), INK + (250,))
    d = ImageDraw.Draw(layer)
    d.rectangle((0, 0, 16, 158), fill=color + (255,))
    d.text((w / 2 + 8, 40), SHOP_TOP, font=f1, fill=(205, 205, 210, 255), anchor="mm")
    d.text((w / 2 + 8, 106), SHOP, font=f2, fill=WHITE + (255,), anchor="mm")
    layer = layer.rotate(-2, expand=True, resample=Image.BICUBIC)
    frame.alpha_composite(layer, (int(W / 2 - layer.width / 2 - (1 - slide) * 900), y - layer.height // 2))


def solve(a, b):
    n = len(b)
    m = [r[:] + [v] for r, v in zip(a, b)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(m[r][i]))
        m[i], m[p] = m[p], m[i]
        for r in range(n):
            if r != i:
                f = m[r][i] / m[i][i]
                m[r] = [x - f * y for x, y in zip(m[r], m[i])]
    return [m[i][n] / m[i][i] for i in range(n)]


def turned(img, deg, cw, scale):
    """The card turned about its upright axis, in perspective."""
    w, h = cw * scale, CH * scale
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    pts = []
    for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        k = 1500 / (1500 + x * w / 2 * s)
        pts.append((x * w / 2 * c * k, y * h / 2 * k))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    dst = [(p[0] - min(xs) + 4, p[1] - min(ys) + 4) for p in pts]
    sw, sh = img.size
    A, B = [], []
    for (x, y), (u, v) in zip(dst, [(0, 0), (sw, 0), (sw, sh), (0, sh)]):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return img.transform((max(int(max(xs) - min(xs)) + 8, 2), max(int(max(ys) - min(ys)) + 8, 2)), Image.PERSPECTIVE, solve(A, B), Image.BILINEAR)


# The looks a Reel can take (Juan, Nov 8, 2026: "I like the layout, I just want some more variety"). The card, its words,
# the price and the shop stay where they are; only what's behind them changes. Each look moves in whole turns over the
# Reel, so its last frame meets its first and the loop doesn't jump. post_listings.py takes them in turn.
THEMES = ("glow", "octagon", "spotlight", "comic", "retro", "holo")


def mix(a, b, k):
    """a toward b by k (0 is a, 1 is b)."""
    return tuple(int(x + (y - x) * k) for x, y in zip(a, b))


def scaled(layer, k):
    """An RGBA layer with its alpha times k."""
    out = layer.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * k)))
    return out


def ghost(text, y=1600, alpha=50):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((W / 2, y), text, font=ImageFont.truetype(FONT, fit(text, 460, 980)), fill=(0, 0, 0, 0), anchor="mm", stroke_width=5, stroke_fill=WHITE + (alpha,))
    return layer


def glow_base(front, dim=0.42):
    """The card's own colours, blurred into the stage, darkening to ink at the edges."""
    glow = front.convert("RGB").resize((W, H)).filter(ImageFilter.GaussianBlur(90))
    base = Image.eval(glow, lambda v: int(v * dim))
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).ellipse((-260, 60, W + 260, 1560), fill=255)
    return Image.composite(base, Image.new("RGB", (W, H), INK), shade.filter(ImageFilter.GaussianBlur(170))).convert("RGBA")


def soft_ellipse(box, fill, blur):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(box, fill=fill)
    return layer.filter(ImageFilter.GaussianBlur(blur))


class Backdrop:
    """Everything behind the card for one look: `at(p, n)` is the frame's background, p the share of the loop gone (0 to 1)."""

    def __init__(self, theme, front, color, ghost_text):
        self.theme = theme if theme in THEMES else "glow"
        self.color, self.rng = color, random.Random(25)
        getattr(self, "_" + self.theme)(front, color, ghost_text)

    def at(self, p, n):
        return getattr(self, "_at_" + self.theme)(p, n)

    def specks(self, frame, p, color, count=46, rise=True, size=(1.5, 4.5), alpha=120):
        if not hasattr(self, "_specks"):
            self._specks = [(self.rng.uniform(0, W), self.rng.uniform(0, H), self.rng.uniform(*size), self.rng.choice((1, 2))) for _ in range(count)]
        d = ImageDraw.Draw(frame)
        for x, y, r, v in self._specks:
            yy = (y - v * H * p) % H if rise else (y + v * H * p) % H
            d.ellipse((x - r, yy - r, x + r, yy + r), fill=color + (int(alpha * (0.5 + 0.5 * math.sin(p * 2 * math.pi * 5 + x))),))

    # The first look: the card's colours glowing behind it, a halftone floor, slow stripes and rising sparks.
    def _glow(self, front, color, text):
        self.base = glow_base(front)
        tone = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(tone)
        for row, y in enumerate(range(1300, H + 30, 30)):
            r = (y - 1300) / (H - 1300) * 11
            for x in range((row % 2) * 15, W + 30, 30):
                d.ellipse((x - r, y - r, x + r, y + r), fill=color + (120,))
        self.base.alpha_composite(tone)
        self.base.alpha_composite(ghost(text))
        self.stripes = Image.new("RGBA", (W * 2, H), (0, 0, 0, 0))
        ds = ImageDraw.Draw(self.stripes)
        for x in range(-H, W * 2 + H, 190):
            ds.polygon([(x, 0), (x + 46, 0), (x + 46 - H // 2, H), (x - H // 2, H)], fill=WHITE + (9,))

    def _at_glow(self, p, n):
        frame = self.base.copy()
        off = round(p * 190 * 3) % 190
        frame.alpha_composite(self.stripes.crop((off, 0, W + off, H)))
        self.specks(frame, p, self.color)
        return frame

    # The cage: chain-link fence, the octagon's rails in the card's colour (pulsing), embers rising.
    def _octagon(self, front, color, text):
        base = Image.new("RGBA", (W, H), INK + (255,))
        base.alpha_composite(soft_ellipse((120, 260, 960, 1340), color + (110,), 160))
        fence = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(fence)
        for x in range(-H, W + H, 58):
            d.line((x, 0, x + H, H), fill=WHITE + (30,), width=3)
            d.line((x, H, x + H, 0), fill=WHITE + (30,), width=3)
        fade = Image.new("L", (W, H), 0)
        ImageDraw.Draw(fade).ellipse((-200, 0, W + 200, H), fill=255)
        fence.putalpha(ImageChops.multiply(fence.getchannel("A"), fade.filter(ImageFilter.GaussianBlur(200))))
        base.alpha_composite(fence)
        cx, cy, r = W / 2, 800, 520
        pts = [(cx + r * math.cos(math.radians(22.5 + 45 * k)), cy + r * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
        ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(ring).polygon(pts, outline=color + (255,), width=16)
        inner = [(cx + (r - 40) * math.cos(math.radians(22.5 + 45 * k)), cy + (r - 40) * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
        ImageDraw.Draw(ring).polygon(inner, outline=WHITE + (90,), width=4)
        halo = ring.filter(ImageFilter.GaussianBlur(26))
        base.alpha_composite(ghost(text, alpha=40))
        base.alpha_composite(ring)
        self.base, self.halos = base, [scaled(halo, k / 5) for k in range(6)]

    def _at_octagon(self, p, n):
        frame = self.base.copy()
        frame.alpha_composite(self.halos[min(5, int((0.5 + 0.5 * math.sin(p * 2 * math.pi * 6)) * 6))])
        self.specks(frame, p, mix(self.color, (255, 200, 120), 0.4), count=60, size=(1.5, 3.5), alpha=170)
        return frame

    # The walkout: a dark stage, two spotlights swaying onto the card, a pool of light under it, dust in the beams.
    def _spotlight(self, front, color, text):
        base = Image.new("RGBA", (W, H), (6, 6, 9, 255))
        base.alpha_composite(soft_ellipse((140, 340, 940, 1300), color + (60,), 150))
        base.alpha_composite(soft_ellipse((160, 1330, 920, 1560), WHITE + (70,), 40))
        base.alpha_composite(ghost(text, alpha=45))
        self.base, self.beams = base, []
        hw, hh = W // 2, H // 2
        for i in range(12):
            sway = (i / 11 - 0.5) * 120
            layer = Image.new("RGBA", (hw, hh), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            for ax, aim, tint in ((40 + sway / 2, hw / 2 - 70 + sway / 3, WHITE), (hw - 40 - sway / 2, hw / 2 + 70 - sway / 3, mix(color, WHITE, 0.45))):
                d.polygon([(ax - 10, -40), (ax + 10, -40), (aim + 190, hh * 0.8), (aim - 190, hh * 0.8)], fill=tint + (58,))
            fall = Image.linear_gradient("L").resize((hw, hh)).point(lambda v: 255 - v)
            layer.putalpha(ImageChops.multiply(layer.getchannel("A"), fall))
            self.beams.append(layer.filter(ImageFilter.GaussianBlur(14)).resize((W, H), Image.BILINEAR))

    def _at_spotlight(self, p, n):
        frame = self.base.copy()
        frame.alpha_composite(self.beams[round((0.5 + 0.5 * math.sin(p * 2 * math.pi * 2)) * 11)])
        self.specks(frame, p, (235, 235, 240), count=70, rise=False, size=(1, 2.6), alpha=110)
        return frame

    # The comic panel: speed lines bursting from behind the card, redrawn every few frames like a hand-drawn page, halftone corners.
    def _comic(self, front, color, text):
        base = Image.new("RGBA", (W, H), mix(INK, color, 0.18) + (255,))
        base.alpha_composite(soft_ellipse((60, 220, 1020, 1380), mix(color, INK, 0.35) + (200,), 170))
        dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(dots)
        for y in range(0, H + 34, 34):
            for x in range((y // 34 % 2) * 17, W + 34, 34):
                far = math.hypot((x - W / 2) / (W / 2), (y - 800) / 1100)
                rad = max(0, (far - 0.75) * 22)
                if rad > 0.6: d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=INK + (150,))
        base.alpha_composite(dots)
        base.alpha_composite(ghost(text, alpha=55))
        self.base, self.bursts = base, []
        cx, cy = W / 2, 800
        for v in range(3):
            rng = random.Random(40 + v)
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            for k in range(54):
                a = rng.uniform(0, 2 * math.pi)
                w, r0 = math.radians(rng.uniform(0.5, 1.8)), rng.uniform(420, 600)
                fill = WHITE + (70,) if k % 3 else color + (170,)
                d.polygon([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)), (cx + 2300 * math.cos(a - w), cy + 2300 * math.sin(a - w)),
                           (cx + 2300 * math.cos(a + w), cy + 2300 * math.sin(a + w))], fill=fill)
            self.bursts.append(layer)

    def _at_comic(self, p, n):
        frame = self.base.copy()
        frame.alpha_composite(self.bursts[(n // 4) % 3])
        return frame

    # Retro: a sunset in the card's colour sinking behind it, a neon grid floor rolling toward you, stars.
    def _retro(self, front, color, text):
        hz = 1330
        base = Image.new("RGBA", (W, H), INK + (255,))
        d = ImageDraw.Draw(base)
        top, low = (8, 6, 20), mix(color, (8, 6, 20), 0.55)
        for y in range(hz):
            d.line((0, y, W, y), fill=mix(top, low, (y / hz) ** 1.6) + (255,))
        sun = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ds = ImageDraw.Draw(sun)
        cy, r = 1210, 400
        for y in range(cy - r, hz):
            half = math.sqrt(max(0, r * r - (y - cy) ** 2))
            ds.line((W / 2 - half, y, W / 2 + half, y), fill=mix(mix(color, (255, 236, 160), 0.55), color, (y - cy + r) / (2 * r)) + (255,))
        for i, y in enumerate(range(cy + 30, hz, 46)):
            ds.rectangle((0, y, W, y + 6 + i * 4), fill=(0, 0, 0, 0))
        base.alpha_composite(sun.filter(ImageFilter.GaussianBlur(30)))
        base.alpha_composite(sun)
        d.rectangle((0, hz, W, H), fill=(12, 8, 24, 255))
        base.alpha_composite(soft_ellipse((-100, hz - 40, W + 100, hz + 40), color + (200,), 18))
        self.base, self.hz = base, hz
        self.line = mix(color, (12, 8, 24), 0.3)
        self.stars = [(self.rng.uniform(0, W), self.rng.uniform(0, hz - 300), self.rng.uniform(0, 6.3), self.rng.choice((2, 3, 4))) for _ in range(80)]

    def _at_retro(self, p, n):
        frame = self.base.copy()
        d = ImageDraw.Draw(frame)
        hz = self.hz
        for k in range(-9, 10):
            d.line((W / 2 + k * 46, hz, W / 2 + k * 520, H), fill=self.line, width=3)
        roll = (p * 10) % 1
        for i in range(14):
            u = (i + roll) / 14
            y = hz + (H - hz + 20) * u ** 2.3
            d.line((0, y, W, y), fill=self.line, width=max(2, round(1 + u * 5)))
        for x, y, ph, k in self.stars:
            a = 0.5 + 0.5 * math.sin(p * 2 * math.pi * k + ph)
            r = 1 + 1.6 * a
            d.ellipse((x - r, y - r, x + r, y + r), fill=mix((40, 30, 60), WHITE, a))
        return frame

    # Holo foil: rainbow bands sliding across like a refractor under a light, and sparkles that blink.
    def _holo(self, front, color, text):
        self.base = glow_base(front, 0.3)
        self.base.alpha_composite(ghost(text, alpha=45))
        period, wide = 900, W + 900
        bands = Image.new("RGBA", (wide, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(bands)
        import colorsys
        for x in range(-H, wide + H, 36):
            r, g, b = colorsys.hsv_to_rgb((x % period) / period, 0.75, 1)
            d.polygon([(x, 0), (x + 36, 0), (x + 36 - H // 2, H), (x - H // 2, H)], fill=(int(r * 255), int(g * 255), int(b * 255), 46))
        self.bands, self.period = bands.filter(ImageFilter.GaussianBlur(26)), period
        self.glints = [(self.rng.uniform(40, W - 40), self.rng.uniform(80, H - 80), self.rng.uniform(0, 6.3), self.rng.choice((2, 3)), self.rng.uniform(10, 24)) for _ in range(28)]

    def _at_holo(self, p, n):
        frame = self.base.copy()
        off = round(p * self.period * 2) % self.period
        frame.alpha_composite(self.bands.crop((off, 0, W + off, H)))
        d = ImageDraw.Draw(frame)
        for x, y, ph, k, size in self.glints:
            a = max(0.0, math.sin(p * 2 * math.pi * k + ph))
            if a < 0.05: continue
            s, t = size * a, size * a * 0.22
            d.polygon([(x, y - s), (x + t, y - t), (x + s, y), (x + t, y + t), (x, y + s), (x - t, y + t), (x - s, y), (x - t, y - t)], fill=WHITE + (int(220 * a),))
        return frame


def make(card, front_path, back_path, out, cue=0.0, stills=None, was=None, words=None, theme="glow"):
    """`was` is the old price of a price drop, which gets its own look: red, with the old price struck through.
    `words` replaces the opening hook ("STILL AVAILABLE"); `theme` is one of THEMES, what's behind the card."""
    raw = cutout(front_path)
    color = RED if was else accent(raw)
    cw = round(raw.width * CH / raw.height)
    def prep(c):
        c = c.resize((cw * 2, CH * 2), Image.LANCZOS).convert("RGBA")
        ImageDraw.Draw(c).rectangle((0, 0, cw * 2 - 1, CH * 2 - 1), outline=(255, 255, 255, 235), width=6)
        return c
    front = prep(raw)
    # A front kept whole (a slab or a case on a pale backdrop) keeps its back whole too, so the two sides match.
    back = prep(cutout(back_path) if "backdrop" in raw.info else Image.open(back_path).convert("RGB")) if back_path else None
    name = (card.get("player") or "").upper() or "UFC CARD"
    run = run_of(card)
    price_now = float(re.sub(r"[^\d.]", "", card.get("price") or "0") or 0)
    off = round((1 - price_now / float(re.sub(r"[^\d.]", "", was))) * 100) if was else 0
    bd = Backdrop(theme, front, color, f"/{run}" if run else f"-{off}%" if was else name.split()[-1])
    rarity = hook(card)
    words, line, price = ("PRICE DROP" if was else words or rarity), label(card), (card.get("price") or "").replace(".00", "")
    top_size, name_size, sub_size = fit(words, 132, 930), fit(name, 112, 930), fit(name, 86, 860)
    total = SECS + cue
    sounds = [(at + cue, f, v) for at, f, v in SOUNDS if back or at not in (4.6, 7.0)]
    silent = out + ".video.mp4"
    ff = encoder(silent)
    shots = {6, 20, 80, 150, 165, 225, 262, 290, 420, 462}
    sheet = []
    for n in range(int(FPS * total)):
        t = n / FPS - cue
        frame = bd.at(n / (FPS * total), n)       # whole turns, so the last frame meets the first
        if t < 0:
            # Before the song's good part: only the hook, breathing, and the card still hidden.
            poster(frame, (W / 2, 800), words, top_size, color, 1, 1 + 0.03 * math.sin(n / FPS * 4))
            rgb = frame.convert("RGB")
            ff.stdin.write(rgb.tobytes())
            continue
        rise = back_out(clamp(t / 0.42)) if t < 0.42 else 1
        a = (ease(clamp((t - 4.6) / 0.7)) * 180 + ease(clamp((t - 7.0) / 0.7)) * 180) % 360 if back else 0
        flipped = 90 < a < 270
        # The card eases back and up for the finish, so the price and the shop sit clear of it.
        settle = ease(clamp((t - 7.9) / 0.6))
        scale = 0.88 + 0.04 * ease(clamp(t / 8)) - 0.14 * settle + 0.03 * ease(clamp((t - 9) / (SECS - 9)))
        base = (back if flipped else front).copy()
        if not flipped and a < 8 or not flipped and a > 352:
            for at in (2.2, 10.5, 13.0) if back else (2.2, 5.0, 7.8, 10.5, 13.0):
                p = (t - at) / 0.9
                if 0 <= p <= 1:
                    sw, sh = base.size
                    x = int((p * 1.5 - 0.25) * (sw + sh))
                    band = Image.new("L", base.size, 0)
                    ImageDraw.Draw(band).polygon([(x, 0), (x + 230, 0), (x + 230 - sh, sh), (x - sh, sh)], fill=120)
                    base.paste(Image.new("RGB", base.size, "white"), (0, 0), band.filter(ImageFilter.GaussianBlur(40)))
        pic = turned(base, 180 + a if flipped else a, cw, scale)
        # The last moment: the card flies up and out as the words go, and the Reel starts over with it rising in.
        leave = ease(clamp((t - (SECS - 0.7)) / 0.7))
        cy = 800 - 55 * settle + 7 * math.sin(t / SECS * 2 * math.pi * 3) + (1 - rise) * 1500 - leave * 1400
        x, y = W // 2 - pic.width // 2, int(cy - pic.height / 2)
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rectangle((x + 14, y + 26, x + pic.width + 14, y + pic.height + 26), fill=(0, 0, 0, 190))
        frame.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)))
        if y < H: frame.paste(pic, (x, y), pic)
        hook_in, hook_out = clamp((t - 0.35) / 0.2), clamp((t - 4.3) / 0.2)
        if was and rarity != "FRESH DROP":
            # A price drop still says how rare the card is: the drop first, then the rarity.
            swap = clamp((t - 2.3) / 0.2)
            poster(frame, (W / 2, 322), words, top_size, color, hook_in * (1 - swap), 1 + 0.85 * (1 - ease(hook_in)))
            poster(frame, (W / 2, 322), rarity, fit(rarity, 132, 930), color, swap * (1 - hook_out), 1.25 - 0.25 * ease(swap))
        else:
            poster(frame, (W / 2, 322), words, top_size, color, hook_in * (1 - hook_out), 1 + 0.85 * (1 - ease(hook_in)))
        name_in = clamp((t - 4.4) / 0.22)
        poster(frame, (W / 2, 288), name, name_size, WHITE, name_in * (1 - leave), 1.25 - 0.25 * ease(name_in), tilt=0)
        caption_line(frame, 384, line, clamp((t - 4.55) / 0.25) * (1 - leave))
        sub_in = clamp((t - 1.3) / 0.2)
        poster(frame, (W / 2, 1206), name, sub_size, WHITE, sub_in * (1 - hook_out), 1 + 0.5 * (1 - ease(sub_in)), stroke=7, tilt=1)
        price_in = clamp((t - 8.6) / 0.2)
        lift = leave * 1400
        if price_in and price and leave < 1:
            sticker(frame, (816, 975 - lift), price, price_in, color, was and was.replace(".00", ""), ease(clamp((t - 8.9) / 0.3)))
        if t >= 9.2 and leave < 1: tag(frame, 1185, back_out(clamp((t - 9.2) / 0.32)) * (1 - leave), color)
        fl = max(0.0, *[0.5 * (1 - clamp((t - at) / 0.13)) if t >= at else 0.0 for at in (0.35, 8.6)])
        if fl: frame.alpha_composite(Image.new("RGBA", (W, H), WHITE + (int(255 * fl),)))
        rgb = frame.convert("RGB")
        ff.stdin.write(rgb.tobytes())
        if stills and n - int(cue * FPS) in shots: sheet.append(rgb.resize((216, 384)))
    finish(ff, silent, out, sounds, total)
    if stills:
        contact(sheet, stills)


def encoder(silent):
    """ffmpeg taking raw frames down a pipe into a silent video."""
    return subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", silent], stdin=subprocess.PIPE)


def finish(ff, silent, out, sounds, total):
    """The silent video done, then its sounds ([(seconds, file, volume)]) mixed on in a second pass. Doing both in one ffmpeg,
    with the frames coming down a pipe, now and then left ffmpeg and this script waiting on each other until the run timed out."""
    ff.stdin.close()
    if ff.wait(timeout=120): raise RuntimeError("ffmpeg failed")
    inputs, chains = ["-i", silent], []
    for i, (at, sound, vol) in enumerate(sounds, 1):
        inputs += ["-i", os.path.join(HERE, "sfx", sound)]
        ms = int(at * 1000)
        chains.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol},adelay={ms}|{ms}[s{i}]")
    graph = ";".join(chains) + ";" + "".join(f"[s{i}]" for i in range(1, len(sounds) + 1)) + f"amix=inputs={len(sounds)}:normalize=0:duration=longest,apad=whole_dur={total},atrim=0:{total}[a]"
    # The sounds, with stdin shut (ffmpeg reads it for keys and once sat 2 minutes on it, Nov 7) and a padding that ends
    # by itself. Tried twice; if both fail the Reel goes out without its card sounds (Instagram still adds the song).
    for tries in (1, 2):
        try:
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]",
                            "-t", str(total), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out],
                           check=True, timeout=60, stdin=subprocess.DEVNULL)
            break
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
            print(f"Mixing the sounds failed ({type(e).__name__}), try {tries} of 2", flush=True)
            if tries == 2:
                print("Posting it without the card sounds", flush=True)
                os.replace(silent, out)
    if os.path.exists(silent): os.remove(silent)


def contact(sheet, path):
    strip = Image.new("RGB", (216 * len(sheet), 384), "white")
    for i, f in enumerate(sheet): strip.paste(f, (216 * i, 0))
    strip.save(path)


def grid_of(n):
    """Columns and rows for a collage of n cards (n is 4, 6, 9 or 12)."""
    return {4: (2, 2), 6: (3, 2), 9: (3, 3)}.get(n, (4, 3))


def make_set(title, sub, items, out, count, cue=0.0, theme="glow", stills=None):
    """A set's collage (Juan, Nov 8, 2026): its cards drop into a grid one by one, the dearest few step forward in turn with
    their names and prices, then how many the shop has and the shop itself. `items` is [(card, front photo path)], dearest
    first, 4, 6, 9 or 12 of them; `count` is how many of the set are for sale. Same loop, sounds and safe areas as a card's."""
    cols, rows = grid_of(len(items))
    gap, top, tall, wide = 22, 470, 1050, 1000
    cw = min((wide - (cols - 1) * gap) / cols, (tall - (rows - 1) * gap) / rows / 1.4)
    ch = cw * 1.4
    x0, y0 = (W - (cols * cw + (cols - 1) * gap)) / 2, top + (tall - (rows * ch + (rows - 1) * gap)) / 2
    rng = random.Random(len(items) * 7 + count)
    pics, color = [], None
    for i, (card, path) in enumerate(items):
        raw = cutout(path)
        if color is None: color = accent(raw)
        k = min(cw / raw.width, ch / raw.height)
        im = raw.resize((max(2, round(raw.width * k)), max(2, round(raw.height * k))), Image.LANCZOS).convert("RGBA")
        ImageDraw.Draw(im).rectangle((0, 0, im.width - 1, im.height - 1), outline=(255, 255, 255, 235), width=4)
        tilt = rng.uniform(-2.5, 2.5)
        big = im.resize((round(im.width * 2), round(im.height * 2)), Image.LANCZOS).rotate(tilt / 2, expand=True, resample=Image.BICUBIC)
        im = im.rotate(tilt, expand=True, resample=Image.BICUBIC)
        shade = Image.new("RGBA", (im.width + 60, im.height + 60), (0, 0, 0, 0))
        ImageDraw.Draw(shade).rectangle((30, 30, 30 + im.width, 30 + im.height), fill=(0, 0, 0, 170))
        c, r = i % cols, i // cols
        pics.append({"im": im, "big": big, "shade": shade.filter(ImageFilter.GaussianBlur(14)), "cx": x0 + c * (cw + gap) + cw / 2, "cy": y0 + r * (ch + gap) + ch / 2,
                     "name": (card.get("player") or "").upper(), "price": (card.get("price") or "").replace(".00", "")})
    year = title.split()[0]
    bd = Backdrop(theme, cutout(items[0][1]), color, year if year.isdigit() else "UFC")
    n_items = len(items)
    step = min(0.45, 3.2 / max(n_items - 1, 1))
    lands = [0.5 + i * step for i in range(n_items)]
    stars = [i for i in range(min(4, n_items)) if pics[i]["name"] or pics[i]["price"]]
    hold = 4.2 / max(len(stars), 1)
    title_size, more = fit(title, 132, 930), str(count)
    total = SECS + cue
    sounds = [(0.05 + cue, "card-slide-1.ogg", 0.8)] + [(at + 0.3 + cue, ("card-place-1.ogg", "card-place-2.ogg")[i % 2], 0.7) for i, at in enumerate(lands)]
    sounds += [(4.4 + j * hold + cue, "card-slide-3.ogg", 0.6) for j in range(len(stars))]
    sounds += [(8.6 + cue, "chips-stack-2.ogg", 0.9), (9.2 + cue, "card-shove-1.ogg", 0.8), (SECS - 0.7 + cue, "card-slide-1.ogg", 0.8)]
    silent = out + ".video.mp4"
    ff = encoder(silent)
    shots = {6, 40, 100, 150, 175, 215, 250, 290, 420, 462}
    sheet = []
    for n in range(int(FPS * total)):
        t = n / FPS - cue
        frame = bd.at(n / (FPS * total), n)
        if t < 0:
            poster(frame, (W / 2, 800), title, title_size, color, 1, 1 + 0.03 * math.sin(n / FPS * 4))
            ff.stdin.write(frame.convert("RGB").tobytes())
            continue
        leave = clamp((t - (SECS - 0.9)) / 0.9)
        # Which card is stepping forward now, and how far (in, held, back).
        star, lift = None, 0.0
        if 4.4 <= t < 4.4 + hold * len(stars):
            j = int((t - 4.4) / hold)
            u = (t - 4.4 - j * hold) / hold
            star, lift = stars[j], ease(clamp(u / 0.18)) * (1 - ease(clamp((u - 0.82) / 0.18)))
        dim = ease(clamp((t - 4.3) / 0.3)) * (1 - ease(clamp((t - 8.5) / 0.3)))
        for i, pc in enumerate(pics):
            d = clamp((t - lands[i]) / 0.38)
            if d <= 0 or i == star: continue
            out_i = ease(clamp((t - (SECS - 0.9) - i * 0.03) / 0.55))
            cy = pc["cy"] - (1 - back_out(d)) * 1300 - out_i * 1800
            im, sh = pc["im"], pc["shade"]
            frame.alpha_composite(sh, (int(pc["cx"] - sh.width / 2 + 10), int(cy - sh.height / 2 + 18)))
            frame.alpha_composite(im, (int(pc["cx"] - im.width / 2), int(cy - im.height / 2)))
        if dim: frame.alpha_composite(Image.new("RGBA", (W, H), INK + (int(150 * dim),)))
        if star is not None:
            pc = pics[star]
            k = (1 + lift) / 2
            big = pc["big"].resize((max(2, round(pc["big"].width * k)), max(2, round(pc["big"].height * k))), Image.BILINEAR)
            cx, cy = pc["cx"] + (W / 2 - pc["cx"]) * lift, pc["cy"] + (840 - pc["cy"]) * lift
            frame.alpha_composite(pc["shade"].resize((big.width + 60, big.height + 60)), (int(cx - big.width / 2 - 20), int(cy - big.height / 2 - 4)))
            frame.alpha_composite(big, (int(cx - big.width / 2), int(cy - big.height / 2)))
        title_in = clamp((t - 0.1) / 0.2)
        poster(frame, (W / 2, 300), title, title_size, color, title_in * (1 - leave), 1 + 0.85 * (1 - ease(title_in)))
        if star is not None and lift > 0.05:
            pc = pics[star]
            caption_line(frame, 404, "  ·  ".join(x for x in (pc["name"], pc["price"]) if x), clamp(lift * 1.5))
        else:
            caption_line(frame, 404, sub, clamp((t - 0.35) / 0.25) * (1 - leave) * (1 - dim))
        if t >= 8.6 and leave < 1:
            sticker(frame, (816, 975 - leave * 1400), more, clamp((t - 8.6) / 0.2), color, under="CARDS")
        if t >= 9.2 and leave < 1: tag(frame, 1185, back_out(clamp((t - 9.2) / 0.32)) * (1 - leave), color)
        fl = max(0.0, *[0.5 * (1 - clamp((t - at) / 0.13)) if t >= at else 0.0 for at in (0.1, 8.6)])
        if fl: frame.alpha_composite(Image.new("RGBA", (W, H), WHITE + (int(255 * fl),)))
        rgb = frame.convert("RGB")
        ff.stdin.write(rgb.tobytes())
        if stills and n - int(cue * FPS) in shots: sheet.append(rgb.resize((216, 384)))
    finish(ff, silent, out, sounds, total)
    if stills:
        contact(sheet, stills)
