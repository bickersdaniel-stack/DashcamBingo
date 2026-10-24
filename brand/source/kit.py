"""Builds the Dashcam Bingo logo kit masters (Viewfinder direction): symbol, small-size cut, wordmark, lockups, icons.

Run from anywhere with fontTools installed (`pip install fonttools`): `python brand/source/kit.py`.
It rewrites the SVGs in brand/logo and brand/web. The PNGs, favicon.ico and one-colour versions were rendered from
these SVGs with a headless browser, so re-render them too if the shapes change.
"""
import json
import os

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)  # brand/
MASTERS = os.path.join(KIT, "logo")
os.makedirs(MASTERS, exist_ok=True)

GREEN = "#22C55E"      # Bingo Green: the winning line (same as the site's default square colour)
CHARCOAL = "#111418"   # Charcoal: frame and dots on light backgrounds, icon tiles (the site's surface colour)
WHITE = "#FFFFFF"      # frame and dots on dark backgrounds
NAME = "dashcam-bingo"
TITLE = "Dashcam Bingo"


def f(n):
    return f"{n:.2f}".rstrip("0").rstrip(".")


def rrect(x, y, w, h, r):
    return (f"M{f(x + r)} {f(y)} H{f(x + w - r)} A{f(r)} {f(r)} 0 0 1 {f(x + w)} {f(y + r)} "
            f"V{f(y + h - r)} A{f(r)} {f(r)} 0 0 1 {f(x + w - r)} {f(y + h)} "
            f"H{f(x + r)} A{f(r)} {f(r)} 0 0 1 {f(x)} {f(y + h - r)} V{f(y + r)} A{f(r)} {f(r)} 0 0 1 {f(x + r)} {f(y)} Z")


def corner(c, length, radius, width, rotate=False):
    """Filled outline of a rounded L-shaped frame corner (top-left), optionally turned 180° to bottom-right."""
    h = width / 2
    pts = lambda x, y: (256 - x, 256 - y) if rotate else (x, y)
    p = [pts(*q) for q in [(c - h, c + length), (c - h, c + radius), (c + radius, c - h), (c + length, c - h),
                           (c + length, c + h), (c + radius, c + h), (c + h, c + radius), (c + h, c + length)]]
    ro, ri = radius + h, radius - h
    return (f"M{f(p[0][0])} {f(p[0][1])} L{f(p[1][0])} {f(p[1][1])} A{f(ro)} {f(ro)} 0 0 1 {f(p[2][0])} {f(p[2][1])} "
            f"L{f(p[3][0])} {f(p[3][1])} A{f(h)} {f(h)} 0 0 1 {f(p[4][0])} {f(p[4][1])} "
            f"L{f(p[5][0])} {f(p[5][1])} A{f(ri)} {f(ri)} 0 0 0 {f(p[6][0])} {f(p[6][1])} "
            f"L{f(p[7][0])} {f(p[7][1])} A{f(h)} {f(h)} 0 0 1 {f(p[0][0])} {f(p[0][1])} Z")


def symbol_parts(small=False, thin=0.0):
    """Returns (ink path data, green path data) on a 256 canvas.
    small: the simplified cut for 32 px and below (no dots, heavier frame, bigger squares).
    thin: units to take off white-on-dark geometry, which looks heavier (irradiation)."""
    if small:
        big, step, frame_c, frame_len, frame_r, frame_w = 48, 56, 22, 64, 26, 28
        dots = []
    else:
        big, step, frame_c, frame_len, frame_r, frame_w = 40, 48, 32, 46, 18, 16
        dot = 16 - thin
        dots = []
    s0 = 128 - (2 * step + big) / 2
    greens = []
    for row in range(3):
        for col in range(3):
            x, y = s0 + col * step, s0 + row * step
            if row == col:
                greens.append(rrect(x, y, big, big, big / 4))
            elif not small:
                o = (big - dot) / 2
                dots.append(rrect(x + o, y + o, dot, dot, dot * 5 / 16))
    w = frame_w - thin
    frame = [corner(frame_c, frame_len, frame_r, w), corner(frame_c, frame_len, frame_r, w, rotate=True)]
    return " ".join(frame + dots), " ".join(greens)


def symbol_body(ink, small=False, thin=0.0, dx=0, dy=0, scale=1.0):
    ink_d, green_d = symbol_parts(small, thin)
    t = f' transform="translate({f(dx)} {f(dy)}) scale({f(scale)})"' if (dx or dy or scale != 1) else ""
    return f'<g id="symbol"{t}><path fill="{ink}" d="{ink_d}"/><path fill="{GREEN}" d="{green_d}"/></g>'


def svg(body, w, h, title=TITLE, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}" '
            f'role="img" aria-labelledby="title"><title id="title">{title}</title>{extra}{body}</svg>\n')


def write(folder, name, content):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "w", encoding="utf-8") as fh:
        fh.write(content)


# ---------- Wordmark: "Dashcam Bingo" outlined from Plus Jakarta Sans ExtraBold (800), with the font's kerning ----------
font = instantiateVariableFont(TTFont(os.path.join(HERE, "fonts", "PlusJakartaSans-Variable.ttf")), {"wght": 800})
glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
cap_units = font["OS/2"].sCapHeight


def kern_lookups():
    gpos = font["GPOS"].table
    idx = sorted({i for fr in gpos.FeatureList.FeatureRecord if fr.FeatureTag == "kern" for i in fr.Feature.LookupListIndex})
    return [gpos.LookupList.Lookup[i] for i in idx]


LOOKUPS = kern_lookups()


def kern(a, b):
    for lookup in LOOKUPS:
        for st in lookup.SubTable:
            st = st.ExtSubTable if lookup.LookupType == 9 else st
            if getattr(st, "LookupType", 2) != 2 or a not in st.Coverage.glyphs:
                continue
            if st.Format == 1:
                for rec in st.PairSet[st.Coverage.glyphs.index(a)].PairValueRecord:
                    if rec.SecondGlyph == b:
                        return getattr(rec.Value1, "XAdvance", 0) or 0
            else:
                rec = st.Class1Record[st.ClassDef1.classDefs.get(a, 0)].Class2Record[st.ClassDef2.classDefs.get(b, 0)]
                return getattr(rec.Value1, "XAdvance", 0) or 0
    return 0


def wordmark(cap_height, tracking_em=-0.02):
    """Path data for the wordmark with its baseline at y=0 and left edge at x=0, plus its bounding box."""
    scale = cap_height / cap_units
    names = [cmap[ord(ch)] for ch in TITLE]
    x, parts, bounds = 0.0, [], [None, None, None, None]
    for i, g in enumerate(names):
        if g != "space":
            pen = SVGPathPen(glyphs)
            glyphs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
            parts.append(pen.getCommands())
            bp = BoundsPen(glyphs)
            glyphs[g].draw(TransformPen(bp, (scale, 0, 0, -scale, x, 0)))
            if bp.bounds:
                b = bp.bounds
                bounds = [b[0] if bounds[0] is None else min(bounds[0], b[0]), b[1] if bounds[1] is None else min(bounds[1], b[1]),
                          b[2] if bounds[2] is None else max(bounds[2], b[2]), b[3] if bounds[3] is None else max(bounds[3], b[3])]
        x += glyphs[g].width * scale + tracking_em * upm * scale
        if i + 1 < len(names):
            x += kern(g, names[i + 1]) * scale
    return " ".join(parts), bounds  # bounds: xmin, ymin (top, negative), xmax, ymax (bottom of descender)


CAP = 88  # cap height of the wordmark in lockups: about two-thirds of the winning line's height
word_d, (wx0, wy0, wx1, wy1) = wordmark(CAP)
word_w = wx1 - wx0

# ---------- Masters ----------
for suffix, ink, thin in [("", CHARCOAL, 0), ("-on-dark", WHITE, 0.75)]:
    # Symbol, full detail (use from 40 px up)
    write(MASTERS, f"{NAME}-symbol{suffix}.svg", svg(symbol_body(ink, thin=thin), 256, 256))
    # Small-size cut (use at 32 px and below)
    write(MASTERS, f"{NAME}-symbol-small{suffix}.svg", svg(symbol_body(ink, small=True, thin=thin), 256, 256))

    # Wordmark only
    pad = 24
    ww, wh = word_w + 2 * pad, (wy1 - wy0) + 2 * pad
    write(MASTERS, f"{NAME}-wordmark{suffix}.svg",
          svg(f'<g id="wordmark" transform="translate({f(pad - wx0)} {f(pad - wy0)})"><path fill="{ink}" d="{word_d}"/></g>', ww, wh))

    # Horizontal lockup: symbol, a gap of one winning square (40), then the name with its caps centred on the symbol
    text_x = 232 + 40
    baseline = 128 + CAP / 2
    hw = text_x + word_w + 24
    write(MASTERS, f"{NAME}-horizontal{suffix}.svg",
          svg(symbol_body(ink, thin=thin) +
              f'<g id="wordmark" transform="translate({f(text_x - wx0)} {f(baseline)})"><path fill="{ink}" d="{word_d}"/></g>', hw, 256))

    # Stacked lockup: symbol at 1.5x (so it holds its own above the long name), centred, one winning square between
    k = 1.5
    sw = max(256 * k, word_w + 48)
    s_baseline = 232 * k + 40 * k + CAP
    sh = s_baseline + wy1 + 24
    write(MASTERS, f"{NAME}-stacked{suffix}.svg",
          svg(symbol_body(ink, thin=thin, dx=(sw - 256 * k) / 2, scale=k) +
              f'<g id="wordmark" transform="translate({f((sw - word_w) / 2 - wx0)} {f(s_baseline)})"><path fill="{ink}" d="{word_d}"/></g>',
              sw, sh))

# App icon / Discord avatar: full mark on a Charcoal tile; safe inside a circle crop
tile = f'<rect width="256" height="256" rx="56" fill="{CHARCOAL}"/>'
write(MASTERS, f"{NAME}-app-icon.svg", svg(tile + symbol_body(WHITE, thin=0.75, dx=128 - 0.66 * 128, dy=128 - 0.66 * 128, scale=0.66), 256, 256))
square = f'<rect width="256" height="256" fill="{CHARCOAL}"/>'
write(MASTERS, f"{NAME}-avatar.svg", svg(square + symbol_body(WHITE, thin=0.75, dx=128 - 0.6 * 128, dy=128 - 0.6 * 128, scale=0.6), 256, 256))

# ---------- Web icons (sources for render_png) ----------
WEB = os.path.join(KIT, "web")
# favicon.svg / .ico: the small cut on a Charcoal tile, so it reads the same on light and dark browser tabs
tile_small = svg(tile + symbol_body(WHITE, small=True, thin=0.75, dx=128 - 0.82 * 128, dy=128 - 0.82 * 128, scale=0.82), 256, 256)
write(WEB, "favicon.svg", tile_small)
write(os.path.join(HERE, "build"), "tile-small.svg", tile_small)
write(os.path.join(HERE, "build"), "fullbleed.svg",
      svg(square + symbol_body(WHITE, thin=0.75, dx=128 - 0.66 * 128, dy=128 - 0.66 * 128, scale=0.66), 256, 256))
write(os.path.join(HERE, "build"), "maskable.svg",
      svg(square + symbol_body(WHITE, thin=0.75, dx=128 - 0.56 * 128, dy=128 - 0.56 * 128, scale=0.56), 256, 256))
# logo-mark.svg: the symbol as reusable <symbol>s for the site's top bar (<svg><use href="…#mark-small"/></svg>).
# The frame and dots take the text colour (currentColor), so they follow the light and dark themes.
full_ink, full_green = symbol_parts()
small_ink, small_green = symbol_parts(small=True)
write(WEB, "logo-mark.svg",
      '<svg xmlns="http://www.w3.org/2000/svg">'
      f'<symbol id="mark" viewBox="24 24 208 208"><path fill="currentColor" d="{full_ink}"/><path fill="{GREEN}" d="{full_green}"/></symbol>'
      f'<symbol id="mark-small" viewBox="8 8 240 240"><path fill="currentColor" d="{small_ink}"/><path fill="{GREEN}" d="{small_green}"/></symbol>'
      '</svg>\n')
write(WEB, "site.webmanifest", json.dumps({
    "name": TITLE, "short_name": TITLE, "start_url": "../", "theme_color": CHARCOAL, "background_color": CHARCOAL, "display": "standalone",
    "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
              {"src": "maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}, indent=2) + "\n")
write(WEB, "head-snippet.html",
      '<link rel="icon" href="favicon.ico" sizes="32x32">\n'
      '<link rel="icon" href="favicon.svg" type="image/svg+xml">\n'
      '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
      '<link rel="manifest" href="site.webmanifest">\n'
      f'<meta name="theme-color" content="{CHARCOAL}">\n')

print(f"wordmark: {word_w:.0f} x {wy1 - wy0:.0f} units at cap {CAP}; masters in {MASTERS}")
