#!/usr/bin/env python3
"""Draws a card's Reel: 9 seconds, 1080x1920. The card rises in, flips to its back and returns (a card with no back photo
shines instead), then its price and the shop. The words stay in the area Instagram leaves clear; the top 14% and bottom
35% hold only decoration. The film is silent: Instagram attaches the song (post_listings.py), or `audio` adds one for a test."""
import math, os, random, re, subprocess
import imageio_ffmpeg
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H, FPS, SECS = 1080, 1920, 30, 9
FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "Anton-Regular.ttf")
INK, WHITE = (10, 10, 13), (255, 255, 255)
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
    return im.crop((x0 + 9, y0 + 9, x1 - 9, y1 - 9))


def accent(im):
    """The card's own loudest colour, bright enough to read on black; orange when it has none."""
    best, score = (255, 122, 0), 0
    for count, (r, g, b) in im.resize((64, 84)).quantize(12).convert("RGB").getcolors(4096):
        hi, lo = max(r, g, b), min(r, g, b)
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
    return "  ·  ".join(b for b in bits if b).upper()[:48]


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


def sticker(frame, xy, s, p, color):
    R = 150
    layer = Image.new("RGBA", (R * 2 + 40, R * 2 + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = R + 20
    pts = [(c + (R if i % 2 == 0 else R * 0.84) * math.cos(i * math.pi / 14), c + (R if i % 2 == 0 else R * 0.84) * math.sin(i * math.pi / 14)) for i in range(28)]
    d.polygon([(x + 8, y + 10) for x, y in pts], fill=(0, 0, 0, 170))
    d.polygon(pts, fill=color + (255,), outline=INK + (255,), width=7)
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


def stage(front, color, ghost_text):
    rng = random.Random(25)
    glow = front.convert("RGB").resize((W, H)).filter(ImageFilter.GaussianBlur(90))
    base = Image.eval(glow, lambda v: int(v * 0.42))
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).ellipse((-260, 60, W + 260, 1560), fill=255)
    st = Image.composite(base, Image.new("RGB", (W, H), INK), shade.filter(ImageFilter.GaussianBlur(170))).convert("RGBA")
    tone = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tone)
    for row, y in enumerate(range(1300, H + 30, 30)):
        r = (y - 1300) / (H - 1300) * 11
        for x in range((row % 2) * 15, W + 30, 30):
            d.ellipse((x - r, y - r, x + r, y + r), fill=color + (120,))
    st.alpha_composite(tone)
    ghost = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ghost).text((W / 2, 1600), ghost_text, font=ImageFont.truetype(FONT, fit(ghost_text, 460, 980)), fill=(0, 0, 0, 0), anchor="mm", stroke_width=5, stroke_fill=WHITE + (50,))
    st.alpha_composite(ghost)
    stripes = Image.new("RGBA", (W * 2, H), (0, 0, 0, 0))
    ds = ImageDraw.Draw(stripes)
    for x in range(-H, W * 2 + H, 190):
        ds.polygon([(x, 0), (x + 46, 0), (x + 46 - H // 2, H), (x - H // 2, H)], fill=WHITE + (9,))
    sparks = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.5, 4.5), rng.uniform(50, 150)) for _ in range(46)]
    return st, stripes, sparks


def make(card, front_path, back_path, out, audio=None, stills=None):
    raw = cutout(front_path)
    color = accent(raw)
    cw = round(raw.width * CH / raw.height)
    def prep(c):
        c = c.resize((cw * 2, CH * 2), Image.LANCZOS).convert("RGBA")
        ImageDraw.Draw(c).rectangle((0, 0, cw * 2 - 1, CH * 2 - 1), outline=(255, 255, 255, 235), width=6)
        return c
    front = prep(raw)
    back = prep(cutout(back_path)) if back_path else None
    name = (card.get("player") or "").upper() or "UFC CARD"
    run = run_of(card)
    st, stripes, sparks = stage(front, color, f"/{run}" if run else name.split()[-1])
    words, line, price = hook(card), label(card), (card.get("price") or "").replace(".00", "")
    top_size, name_size, sub_size = fit(words, 132, 930), fit(name, 112, 930), fit(name, 86, 860)
    inputs = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    inputs += ["-i", audio] if audio else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
    ff = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", *inputs, "-t", str(SECS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                           "-preset", "medium", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    shots = {6, 16, 45, 108, 114, 126, 165, 215, 255}
    sheet = []
    for n in range(FPS * SECS):
        t = n / FPS
        frame = st.copy()
        off = int(t * 40) % 190
        frame.alpha_composite(stripes.crop((off, 0, W + off, H)))
        d = ImageDraw.Draw(frame)
        for x, y, r, v in sparks:
            yy = (y - v * t) % H
            d.ellipse((x - r, yy - r, x + r, yy + r), fill=color + (int(120 * (0.5 + 0.5 * math.sin(t * 3 + x))),))
        rise = back_out(clamp(t / 0.42)) if t < 0.42 else 1
        a = (ease(clamp((t - 3.4) / 0.7)) * 180 + ease(clamp((t - 5.2) / 0.7)) * 180) % 360 if back else 0
        flipped = 90 < a < 270
        scale = 0.90 + 0.03 * ease(clamp(t / SECS)) + 0.03 * ease(clamp((t - 5.9) / 0.3))
        base = (back if flipped else front).copy()
        if not flipped and a < 8 or not flipped and a > 352:
            for at in (1.55, 7.2) if back else (1.55, 3.8, 5.3, 7.2):
                p = (t - at) / 0.9
                if 0 <= p <= 1:
                    sw, sh = base.size
                    x = int((p * 1.5 - 0.25) * (sw + sh))
                    band = Image.new("L", base.size, 0)
                    ImageDraw.Draw(band).polygon([(x, 0), (x + 230, 0), (x + 230 - sh, sh), (x - sh, sh)], fill=120)
                    base.paste(Image.new("RGB", base.size, "white"), (0, 0), band.filter(ImageFilter.GaussianBlur(40)))
        pic = turned(base, 180 + a if flipped else a, cw, scale)
        cy = 800 + 7 * math.sin(t * 1.9) + (1 - rise) * 1100
        x, y = W // 2 - pic.width // 2, int(cy - pic.height / 2)
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rectangle((x + 14, y + 26, x + pic.width + 14, y + pic.height + 26), fill=(0, 0, 0, 190))
        frame.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)))
        if y < H: frame.paste(pic, (x, y), pic)
        hook_in, hook_out = clamp((t - 0.35) / 0.2), clamp((t - 3.1) / 0.2)
        poster(frame, (W / 2, 322), words, top_size, color, hook_in * (1 - hook_out), 1 + 0.85 * (1 - ease(hook_in)))
        name_in = clamp((t - 3.2) / 0.22)
        poster(frame, (W / 2, 288), name, name_size, WHITE, name_in, 1.25 - 0.25 * ease(name_in), tilt=0)
        caption_line(frame, 384, line, clamp((t - 3.35) / 0.25))
        sub_in = clamp((t - 1.3) / 0.2)
        poster(frame, (W / 2, 1206), name, sub_size, WHITE, sub_in * (1 - hook_out), 1 + 0.5 * (1 - ease(sub_in)), stroke=7, tilt=1)
        price_in = clamp((t - 6.1) / 0.2)
        if price_in and price: sticker(frame, (806, 1010), price, price_in, color)
        if t >= 6.7: tag(frame, 1212, back_out(clamp((t - 6.7) / 0.32)), color)
        fl = max(0.0, *[0.5 * (1 - clamp((t - at) / 0.13)) if t >= at else 0.0 for at in (0.35, 6.1)])
        if fl: frame.alpha_composite(Image.new("RGBA", (W, H), WHITE + (int(255 * fl),)))
        rgb = frame.convert("RGB")
        ff.stdin.write(rgb.tobytes())
        if stills and n in shots: sheet.append(rgb.resize((216, 384)))
    ff.stdin.close()
    if ff.wait(): raise RuntimeError("ffmpeg failed")
    if stills:
        strip = Image.new("RGB", (216 * len(sheet), 384), "white")
        for i, f in enumerate(sheet): strip.paste(f, (216 * i, 0))
        strip.save(stills)
