"""Make the default 1200x630 share image for KivoReach. Usage: python make_og.py <output.png>"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
S = 2  # draw at 2x, then shrink, for smooth edges
img = Image.new("RGB", (W * S, H * S), (11, 16, 32))
d = ImageDraw.Draw(img)

# soft glow top-right and bottom-left
glow = Image.new("RGB", (W * S, H * S), (0, 0, 0))
g = ImageDraw.Draw(glow)
for r, col in ((520, (40, 34, 110)), (380, (52, 44, 140))):
    g.ellipse((W * S - r * S // 1 - 200, -r * S // 2, W * S + r * S // 2, r * S), fill=col)
glow = glow.resize((W // 8, H // 8)).resize((W * S, H * S), Image.BICUBIC)
img = Image.blend(img, glow, 0.35)
d = ImageDraw.Draw(img)

def font(name, size):
    for path in ("C:/Windows/Fonts/" + name,):
        try:
            return ImageFont.truetype(path, size * S)
        except OSError:
            pass
    return ImageFont.load_default()

bold = font("segoeuib.ttf", 92)
semi = font("seguisb.ttf", 40)
reg = font("segoeui.ttf", 30)

# logo mark (same shape as assets/logo-mark.svg, 64x64 viewBox) at 150px
x0, y0, size = 90, 92, 150
k = size * S / 64
def p(x, y):
    return (x0 * S + x * k, y0 * S + y * k)
d.rounded_rectangle((x0 * S, y0 * S, x0 * S + size * S, y0 * S + size * S), radius=14 * k, fill=(79, 70, 229))
pts = [p(15, 46), p(27, 22), p(36, 37), p(48, 19)]
d.line(pts, fill=(255, 255, 255), width=int(5.5 * k), joint="curve")
for q in pts:  # round caps and joins
    rr = 5.5 * k / 2
    d.ellipse((q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr), fill=(255, 255, 255))
cx, cy = p(48, 19)
rr = 4.75 * k
d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(56, 189, 248))

# brand name next to the mark
d.text(((x0 + size + 40) * S, (y0 + 16) * S), "KivoReach", font=bold, fill=(255, 255, 255))

# tagline and line of what it is
d.text((90 * S, 330 * S), "Get found. Get trusted. Get chosen.", font=semi, fill=(196, 199, 255))
d.text((90 * S, 400 * S), "Free SEO tools  \u00b7  AI search optimization  \u00b7  Free learning hub", font=reg, fill=(170, 178, 204))

# bottom accent bar
d.rectangle((90 * S, 520 * S, 330 * S, 526 * S), fill=(124, 116, 255))
# no address on the image: it must not need redoing when the site address changes

img = img.resize((W, H), Image.LANCZOS)
img.save(sys.argv[1], "PNG", optimize=True)
print("saved", sys.argv[1])
