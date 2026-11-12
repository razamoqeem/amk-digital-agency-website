"""
One-off helper: turn a Markdown document into a CMS page file.

    python cms/import_markdown.py <file.md> <slug> ["Page title"]

Supports headings, paragraphs, bullet and numbered lists (nested items are
flattened), bold, italic, inline code and links. Table rows become list items.
Heading levels are normalised so the page has one H1 and no skipped level.
The result is validated; nothing is written if it has errors.
"""
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build as site_build  # noqa: E402
from sanitize import clean_rich_text, plain_text  # noqa: E402
from validate import validate_page  # noqa: E402

EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]+")


def inline(text: str) -> str:
    """Markdown inline syntax -> the small HTML subset the CMS allows."""
    out = html.escape(text.strip(), quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?![*\w])", r"<em>\1</em>", out)
    out = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+|/[^)\s]*)\)", r'<a href="\2">\1</a>', out)
    out = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", out)  # drop links to local files
    return clean_rich_text(out)


def to_blocks(markdown: str) -> list:
    blocks, para, items, ordered = [], [], [], False

    def flush():
        nonlocal para, items, ordered
        if para:
            blocks.append({"type": "paragraph", "html": inline(" ".join(para)), "size": "md", "color": "ink", "opacity": 100})
            para = []
        if items:
            blocks.append({"type": "list", "ordered": ordered, "items": items, "size": "md", "color": "ink", "opacity": 100})
            items, ordered = [], False

    for raw in markdown.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or re.fullmatch(r"[-*_]{3,}", stripped):
            flush()
            continue
        m = re.match(r"(#{1,6})\s+(.*)", stripped)
        if m:
            flush()
            text = EMOJI.sub("", plain_text(inline(m.group(2)))).strip()
            if text:
                blocks.append({"type": "heading", "level": len(m.group(1)), "text": text})
            continue
        if stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                continue
            if para:
                flush()
            items.append(" — ".join(inline(c) for c in cells if c))
            continue
        m = re.match(r"([-*+]|\d+[.)])\s+(.*)", stripped)
        if m:
            if para:
                flush()
            if not items:
                ordered = m.group(1)[0].isdigit()
            items.append(inline(m.group(2)))
            continue
        if stripped.startswith(">"):
            stripped = stripped.lstrip("> ").strip()
        if items:
            flush()
        para.append(stripped)
    flush()

    # normalise heading levels: first heading is the only H1, never skip a level
    previous, seen_h1 = 0, False
    for b in blocks:
        if b["type"] != "heading":
            continue
        level = b["level"]
        if not seen_h1:
            level, seen_h1 = 1, True
        else:
            level = max(2, min(level, previous + 1, 4))
        b["level"] = previous = level
        b.update(size={1: "xl", 2: "lg"}.get(level, "md"), color="ink", opacity=100)
    return blocks


def make_description(blocks, title) -> str:
    text = " ".join(plain_text(b.get("html", "")) or " ".join(plain_text(i) for i in b.get("items", []))
                    for b in blocks if b["type"] in ("paragraph", "list"))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 70:
        text = ("%s. %s" % (title, text)).strip()
    if len(text) > 155:
        text = text[:152].rsplit(" ", 1)[0].rstrip(",;:—-") + "…"
    return text


def import_file(md_path: str, slug: str, title: str = "") -> int:
    settings = site_build.load_settings()
    blocks = to_blocks(open(md_path, encoding="utf-8").read())
    h1 = next((b["text"] for b in blocks if b["type"] == "heading"), "")
    if not h1:
        print("ERROR: %s has no heading." % md_path)
        return 1
    page = {
        "slug": slug,
        "title": title or ("%s | %s" % (h1, settings.get("site_name", ""))),
        "description": make_description(blocks, h1),
        "canonical": "", "noindex": False,
        "og": {"title": "", "description": "", "image": ""},
        "schema": ["Article", "BreadcrumbList"],
        "blocks": blocks,
    }
    others = {p.get("slug") for p in site_build.load_pages()} - {slug}
    errors, warnings = validate_page(page, settings, other_slugs=others)
    for w in warnings:
        print("  warning: %s" % w)
    if errors:
        for e in errors:
            print("  ERROR: %s" % e)
        return 1
    site_build.write_json(os.path.join(site_build.PAGES_DIR, site_build.page_file_name(slug)), page)
    print("imported %s -> /%s/ (%d blocks)" % (os.path.basename(md_path), slug, len(blocks)))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(import_file(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""))
