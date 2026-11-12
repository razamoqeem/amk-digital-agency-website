"""
Validation rules for Website CMS pages.

validate_page() returns (errors, warnings). Errors block saving and building;
warnings are shown but do not block.
"""
import re

from sanitize import plain_text, safe_href

# "about-us" or one folder deep: "docs/seo-starter-guide". The slug "home" is the front page (/).
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)?$")
HOME_SLUG = "home"


def page_url_path(slug: str) -> str:
    """Public path of a page: "/" for the front page, otherwise "/<slug>/"."""
    return "/" if slug == HOME_SLUG else "/%s/" % slug
RESERVED_SLUGS = {"assets", "tools", "css", "js", "api", "cms", "content", "templates", "public", "index", "404"}
BLOCK_TYPES = {"heading", "paragraph", "list", "image", "button", "faq", "tool-embed"}
SCHEMA_TYPES = {"Organization", "WebSite", "Article", "FAQ", "BreadcrumbList"}
TOOL_EMBEDS = {"title-generator"}

TITLE_MAX = 60
DESC_MIN, DESC_MAX = 70, 160


# ── Colour contrast (WCAG 2.x) ─────────────────────────────────────────────
def _channel(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def _blend(fg: str, bg: str, alpha: float) -> str:
    f, b = fg.lstrip("#"), bg.lstrip("#")
    mixed = [round(int(f[i:i + 2], 16) * alpha + int(b[i:i + 2], 16) * (1 - alpha)) for i in (0, 2, 4)]
    return "#%02x%02x%02x" % tuple(mixed)


def contrast_ratio(fg: str, bg: str, opacity: int = 100) -> float:
    """Contrast of text colour on a background, with the opacity token applied."""
    seen = _blend(fg, bg, max(0, min(100, opacity)) / 100.0)
    l1, l2 = sorted((_luminance(seen), _luminance(bg)), reverse=True)
    return round((l1 + 0.05) / (l2 + 0.05), 2)


def heading_outline(blocks) -> list:
    return [{"level": b.get("level"), "text": b.get("text", "")} for b in blocks if b.get("type") == "heading"]


def validate_page(page: dict, settings: dict, other_slugs=()) -> tuple:
    errors, warnings = [], []
    tokens = settings.get("tokens", {})
    colours = tokens.get("colors", {})
    sizes = set(tokens.get("sizes", []))
    opacities = set(tokens.get("opacities", []))
    page_bg = colours.get(tokens.get("page_background", ""), "#ffffff")

    # ── SEO fields ──
    slug = page.get("slug", "")
    if not SLUG_RE.match(slug or ""):
        errors.append("Slug must use lowercase letters, numbers and dashes only (one folder level is allowed, like docs/my-page).")
    elif slug.split("/")[0] in RESERVED_SLUGS:
        errors.append('Slug "%s" starts with a reserved name. Choose another.' % slug)
    elif slug in other_slugs:
        errors.append('Another page already uses the slug "%s".' % slug)

    title = (page.get("title") or "").strip()
    if not title:
        errors.append("Title is required.")
    elif len(title) > TITLE_MAX:
        warnings.append("Title is %d characters; search results usually show about %d." % (len(title), TITLE_MAX))

    desc = (page.get("description") or "").strip()
    if not desc:
        errors.append("Meta description is required.")
    elif not (DESC_MIN <= len(desc) <= DESC_MAX):
        warnings.append("Meta description is %d characters; aim for %d to %d." % (len(desc), DESC_MIN, DESC_MAX))

    canonical = (page.get("canonical") or "").strip()
    if canonical and not canonical.startswith(("http://", "https://")):
        errors.append("Canonical must be a full address starting with http:// or https://, or be left empty.")

    for name in page.get("schema") or []:
        if name not in SCHEMA_TYPES:
            errors.append('Unknown schema type "%s".' % name)

    og_image = ((page.get("og") or {}).get("image") or "").strip()
    if og_image and not safe_href(og_image):
        errors.append("Open Graph image must be a web address or a path on this site.")

    # ── Blocks ──
    blocks = page.get("blocks") or []
    if not blocks:
        errors.append("A page needs at least one block.")

    previous_level = 0
    h1_count = 0
    for index, block in enumerate(blocks, start=1):
        where = "Block %d" % index
        kind = block.get("type")
        if kind not in BLOCK_TYPES:
            errors.append('%s: unknown block type "%s".' % (where, kind))
            continue

        # design tokens only
        size, colour, opacity = block.get("size"), block.get("color"), block.get("opacity")
        if size is not None and size not in sizes:
            errors.append('%s: size "%s" is not a design token.' % (where, size))
        if colour is not None and colour not in colours:
            errors.append('%s: colour "%s" is not a design token.' % (where, colour))
        if opacity is not None and opacity not in opacities:
            errors.append('%s: opacity "%s" is not a design token.' % (where, opacity))

        if kind == "heading":
            level = block.get("level")
            text = (block.get("text") or "").strip()
            if level not in (1, 2, 3, 4):
                errors.append("%s: heading level must be 1 to 4." % where)
                continue
            if not text:
                errors.append("%s: heading text is empty." % where)
            if level == 1:
                h1_count += 1
            if previous_level == 0 and level != 1:
                errors.append("%s: the first heading on the page must be the H1." % where)
            elif level > previous_level + 1 and previous_level != 0:
                errors.append("%s: heading jumps from H%d to H%d. Do not skip a level." % (where, previous_level, level))
            previous_level = level
        elif kind == "paragraph":
            if not plain_text(block.get("html", "")):
                errors.append("%s: paragraph is empty." % where)
        elif kind == "list":
            items = [i for i in (block.get("items") or []) if plain_text(i)]
            if not items:
                errors.append("%s: list has no items." % where)
        elif kind == "image":
            if not safe_href(block.get("src", "")):
                errors.append("%s: image needs a file path or web address." % where)
            if not (block.get("alt") or "").strip():
                errors.append("%s: image needs alt text (a short description)." % where)
            if not (isinstance(block.get("width"), int) and isinstance(block.get("height"), int)):
                errors.append("%s: image needs width and height in pixels." % where)
        elif kind == "button":
            if not (block.get("label") or "").strip():
                errors.append("%s: button needs a label." % where)
            if not safe_href(block.get("href", "")):
                errors.append("%s: button link must be a web address or a path on this site." % where)
        elif kind == "faq":
            if not (block.get("question") or "").strip() or not plain_text(block.get("answer", "")):
                errors.append("%s: FAQ needs a question and an answer." % where)
        elif kind == "tool-embed":
            if block.get("tool") not in TOOL_EMBEDS:
                errors.append("%s: unknown tool." % where)

        # contrast: text blocks on the page background; white text on a button colour
        if kind in ("heading", "paragraph", "list") and colour in colours:
            ratio = contrast_ratio(colours[colour], page_bg, opacity or 100)
            large = kind == "heading" and size in ("lg", "xl")
            needed = 3.0 if large else 4.5
            if ratio < needed:
                warnings.append("%s: text contrast is %.2f:1; accessibility needs at least %.1f:1. "
                                "Pick a darker colour or a higher opacity." % (where, ratio, needed))
        if kind == "button" and colour in colours:
            ratio = contrast_ratio("#ffffff", colours[colour])
            if ratio < 4.5:
                warnings.append("%s: white button text on this colour has contrast %.2f:1; needs 4.5:1." % (where, ratio))

    if blocks and h1_count != 1:
        errors.append("The page must have exactly one H1 heading (found %d)." % h1_count)

    return errors, warnings
