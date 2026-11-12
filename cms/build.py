"""
Website build: content/ + templates/ -> public/ (the static site that gets deployed).

Run:  python cms/build.py

What it writes:
  public/<slug>/index.html   one page per file in content/pages/
  public/404.html, robots.txt, sitemap.xml (sitemap only when SITE_URL is set)
  public/_headers, public/_redirects   for hosts that read those files
  vercel.json                          the same headers and redirects for Vercel
  plus the older hand-written pages listed in settings.json ("legacy_passthrough")

Nothing is deployed from here. public/ is replaced only if every page is valid.
All text is escaped; rich text goes through the allow-list in sanitize.py.
"""
import datetime
import html
import json
import os
import shutil
import sys
from string import Template

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from sanitize import clean_rich_text, plain_text, safe_href  # noqa: E402
from validate import validate_page, heading_outline, page_url_path, HOME_SLUG  # noqa: E402

CONTENT = os.path.join(ROOT, "content")
PAGES_DIR = os.path.join(CONTENT, "pages")
TEMPLATES = os.path.join(ROOT, "templates")
PUBLIC = os.path.join(ROOT, "public")

BASE_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
]
# Strict policy for pages built here: no inline scripts or styles, same-origin only.
STRICT_CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
              "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


# ── Loading ────────────────────────────────────────────────────────────────
def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def load_settings():
    return read_json(os.path.join(CONTENT, "settings.json"), {})


def load_redirects():
    return read_json(os.path.join(CONTENT, "redirects.json"), [])


def page_file_name(slug: str) -> str:
    """content/pages file for a slug. A folder slug "docs/x" is stored as "docs__x.json"."""
    return slug.replace("/", "__") + ".json"


def page_output_rel(slug: str) -> str:
    return "index.html" if slug == HOME_SLUG else os.path.join(*slug.split("/"), "index.html")


def load_pages():
    pages = []
    for name in sorted(os.listdir(PAGES_DIR)):
        if name.endswith(".json"):
            page = read_json(os.path.join(PAGES_DIR, name))
            page["_file"] = name
            pages.append(page)
    return pages


def site_url() -> str:
    """SITE_URL from the environment or website/.env. Empty until the domain is confirmed."""
    value = os.environ.get("SITE_URL", "")
    env_path = os.path.join(ROOT, ".env")
    if not value and os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            if line.strip().startswith("SITE_URL="):
                value = line.split("=", 1)[1].strip()
    value = value.strip().rstrip("/")
    return value if value.startswith(("http://", "https://")) else ""


# ── Rendering ──────────────────────────────────────────────────────────────
def esc(text) -> str:
    return html.escape(str(text if text is not None else ""), quote=True)


def token_classes(block) -> str:
    classes = []
    if block.get("size"):
        classes.append("t-size-%s" % block["size"])
    if block.get("color"):
        classes.append("t-color-%s" % block["color"])
    if block.get("opacity") is not None:
        classes.append("t-op-%s" % block["opacity"])
    return ' class="%s"' % " ".join(classes) if classes else ""


def render_block(block) -> str:
    kind = block.get("type")
    cls = token_classes(block)
    if kind == "heading":
        level = int(block["level"])
        return "    <h%d%s>%s</h%d>" % (level, cls, esc(block.get("text", "").strip()), level)
    if kind == "paragraph":
        return "    <p%s>%s</p>" % (cls, clean_rich_text(block.get("html", "")))
    if kind == "list":
        tag = "ol" if block.get("ordered") else "ul"
        items = "".join("<li>%s</li>" % clean_rich_text(i) for i in block.get("items", []) if plain_text(i))
        return "    <%s%s>%s</%s>" % (tag, cls, items, tag)
    if kind == "image":
        return '    <img src="%s" alt="%s" width="%d" height="%d" loading="lazy" />' % (
            esc(safe_href(block.get("src", ""))), esc(block.get("alt", "")), block["width"], block["height"])
    if kind == "button":
        colour = block.get("color") or "accent"
        return '    <p><a class="btn t-bg-%s" href="%s">%s</a></p>' % (
            esc(colour), esc(safe_href(block.get("href", ""))), esc(block.get("label", "")))
    if kind == "faq":
        return "    <details class=\"faq\"><summary>%s</summary><p>%s</p></details>" % (
            esc(block.get("question", "")), clean_rich_text(block.get("answer", "")))
    if kind == "tool-embed":
        return '    <p><a class="btn t-bg-accent" href="/tools/%s.html">Open the tool</a></p>' % esc(block.get("tool", ""))
    return ""


def json_ld(data) -> str:
    text = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return '  <script type="application/ld+json">%s</script>' % text


def schema_tags(page, settings, base, url) -> list:
    """Structured data built only from the page's own content. Needs SITE_URL."""
    if not base:
        return []
    name = settings.get("site_name", "")
    tags = []
    for kind in page.get("schema") or []:
        if kind == "Organization":
            tags.append(json_ld({"@context": "https://schema.org", "@type": "Organization",
                                 "name": name, "url": base + "/", "logo": base + "/assets/logo.png"}))
        elif kind == "WebSite":
            tags.append(json_ld({"@context": "https://schema.org", "@type": "WebSite", "name": name, "url": base + "/"}))
        elif kind == "Article":
            tags.append(json_ld({"@context": "https://schema.org", "@type": "Article",
                                 "headline": page.get("title", ""), "description": page.get("description", ""),
                                 "mainEntityOfPage": url, "publisher": {"@type": "Organization", "name": name}}))
        elif kind == "FAQ":
            faqs = [b for b in page.get("blocks", []) if b.get("type") == "faq"]
            if faqs:
                tags.append(json_ld({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
                    {"@type": "Question", "name": b.get("question", ""),
                     "acceptedAnswer": {"@type": "Answer", "text": plain_text(b.get("answer", ""))}} for b in faqs]}))
        elif kind == "BreadcrumbList":
            h1 = next((b.get("text") for b in page.get("blocks", []) if b.get("type") == "heading" and b.get("level") == 1), page.get("title"))
            tags.append(json_ld({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home", "item": base + "/"},
                {"@type": "ListItem", "position": 2, "name": h1, "item": url}]}))
    if page.get("slug") == HOME_SLUG:
        tags = [t for t in tags if '"BreadcrumbList"' not in t]
    return tags


def render_document(template, settings, title, description, head_lines, body_html, live_paths=()) -> str:
    nav = "\n".join('          <li><a href="%s">%s</a></li>' % (esc(safe_href(i.get("href", ""))), esc(i.get("label", "")))
                    for i in settings.get("nav", []))
    # A footer link to a page of ours is shown only while that page is published.
    links = [i for i in settings.get("footer_links", [])
             if not i.get("page") or page_url_path(i["page"]) in live_paths]
    footer_links = " &middot; ".join('<a href="%s">%s</a>' % (esc(safe_href(i.get("href", ""))), esc(i.get("label", "")))
                                    for i in links)
    return template.substitute(
        footer_links=footer_links,
        lang=esc(settings.get("language", "en")),
        title=esc(title), description=esc(description),
        head_extra="\n".join(head_lines),
        site_name=esc(settings.get("site_name", "")),
        nav_items=nav, body=body_html,
        year=datetime.date.today().year,
        footer_text=esc(settings.get("footer_text", "")),
        preview_label=esc(settings.get("preview_label", "")),
    )


def render_page(page, settings, template, base, live_paths=()) -> str:
    path = page_url_path(page["slug"])
    url = (page.get("canonical") or "").strip() or (base + path if base else "")
    og = page.get("og") or {}
    head = []
    if url:
        head.append('  <link rel="canonical" href="%s" />' % esc(url))
    if page.get("noindex"):
        head.append('  <meta name="robots" content="noindex, nofollow" />')
    head.append('  <meta property="og:type" content="website" />')
    head.append('  <meta property="og:title" content="%s" />' % esc(og.get("title") or page.get("title", "")))
    head.append('  <meta property="og:description" content="%s" />' % esc(og.get("description") or page.get("description", "")))
    if url:
        head.append('  <meta property="og:url" content="%s" />' % esc(url))
    image = safe_href(og.get("image") or "")
    if image and (image.startswith("http") or base):
        head.append('  <meta property="og:image" content="%s" />' % esc(image if image.startswith("http") else base + image))
    head.append('  <meta name="twitter:card" content="summary" />')
    head.extend(schema_tags(page, settings, base, url))
    body = "\n".join(render_block(b) for b in page.get("blocks", []))
    return render_document(template, settings, page.get("title", ""), page.get("description", ""), head, body, live_paths)


def token_css(settings) -> str:
    tokens = settings.get("tokens", {})
    colours = tokens.get("colors", {})
    page_bg = colours.get(tokens.get("page_background", ""), "#ffffff")
    lines = ["", "/* Colour tokens generated from content/settings.json */", ":root {", "  --c-page: %s;" % page_bg]
    lines += ["  --c-%s: %s;" % (name, value) for name, value in colours.items()]
    lines.append("}")
    for name in colours:
        lines.append(".t-color-%s { color: var(--c-%s); }" % (name, name))
        lines.append(".t-bg-%s { background: var(--c-%s); }" % (name, name))
    return "\n".join(lines) + "\n"


# ── Host files ─────────────────────────────────────────────────────────────
def host_files(pages, redirects):
    cms_paths = [page_url_path(p["slug"]) for p in pages] + ["/404.html"]

    headers_txt = ["# Generated by cms/build.py. Do not edit by hand.", "/*"]
    headers_txt += ["  %s: %s" % h for h in BASE_HEADERS]
    for path in cms_paths:
        headers_txt += ["", path, "  Content-Security-Policy: %s" % STRICT_CSP]

    redirects_txt = ["# Generated by cms/build.py from content/redirects.json. Do not edit by hand."]
    redirects_txt += ["%s %s %s" % (r["from"], r["to"], r.get("status", 301)) for r in redirects]

    vercel = {
        "outputDirectory": "public",
        "redirects": [{"source": r["from"], "destination": r["to"], "permanent": r.get("status", 301) in (301, 308)}
                      for r in redirects],
        "headers": [{"source": "/(.*)", "headers": [{"key": k, "value": v} for k, v in BASE_HEADERS]}] +
                   [{"source": path, "headers": [{"key": "Content-Security-Policy", "value": STRICT_CSP}]}
                    for path in cms_paths],
    }
    return "\n".join(headers_txt) + "\n", "\n".join(redirects_txt) + "\n", vercel


# ── Build ──────────────────────────────────────────────────────────────────
def build() -> dict:
    settings = load_settings()
    pages = load_pages()
    redirects = load_redirects()
    base = site_url()
    report = {"ok": False, "pages": [], "errors": [], "warnings": [], "site_url": base, "written": []}

    seen = set()
    for page in pages:
        errors, warnings = validate_page(page, settings, other_slugs=seen)
        seen.add(page.get("slug"))
        report["pages"].append({"slug": page.get("slug"), "file": page["_file"], "errors": errors,
                                "warnings": warnings, "outline": heading_outline(page.get("blocks", []))})
        report["errors"] += ["%s: %s" % (page["_file"], e) for e in errors]
        report["warnings"] += ["%s: %s" % (page["_file"], w) for w in warnings]
    for r in redirects:
        if not (str(r.get("from", "")).startswith("/") and str(r.get("to", "")).startswith("/")):
            report["errors"].append("redirects.json: both paths must start with / (%s)" % r)
    if not base:
        report["warnings"].append("SITE_URL is not set ([TO BE CONFIRMED]): canonical links, sitemap.xml and "
                                  "structured data are left out until it is.")
    if report["errors"]:
        return report

    drafts = [p["slug"] for p in pages if p.get("draft")]
    pages = [p for p in pages if not p.get("draft")]     # drafts stay in the admin only
    report["drafts"] = drafts
    live_paths = {page_url_path(p["slug"]) for p in pages}

    template = Template(open(os.path.join(TEMPLATES, "page.html"), encoding="utf-8").read())
    staging = PUBLIC + ".building"
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(os.path.join(staging, "assets"))

    def write(rel, text):
        path = os.path.join(staging, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        report["written"].append(rel.replace(os.sep, "/"))

    # older hand-written pages and their files, copied as they are
    for name in settings.get("legacy_passthrough", []):
        src = os.path.join(ROOT, name)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(staging, name), dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("__pycache__"))
        elif os.path.isfile(src):
            dest = os.path.join(staging, name)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(src, dest)

    css = open(os.path.join(TEMPLATES, "site.css"), encoding="utf-8").read() + token_css(settings)
    write(os.path.join("assets", "site.css"), css)

    for page in pages:
        write(page_output_rel(page["slug"]), render_page(page, settings, template, base, live_paths))

    nf = settings.get("not_found", {})
    nf_body = "\n".join([
        "    <h1 class=\"t-size-xl\">%s</h1>" % esc(nf.get("title", "Page not found")),
        "    <p>%s</p>" % esc(nf.get("text", "")),
        '    <p><a class="btn t-bg-accent" href="%s">%s</a></p>' % (esc(safe_href(nf.get("button_href", "/")) or "/"),
                                                                   esc(nf.get("button_label", "Home"))),
    ])
    write("404.html", render_document(template, settings, "%s | %s" % (nf.get("title", "Page not found"),
          settings.get("site_name", "")), nf.get("text", ""), ['  <meta name="robots" content="noindex" />'], nf_body, live_paths))

    robots = ["User-agent: *", "Allow: /"]
    if base:
        paths = list(settings.get("legacy_sitemap_paths", [])) + [page_url_path(p["slug"]) for p in pages if not p.get("noindex")]
        today = datetime.date.today().isoformat()
        urls = "\n".join("  <url><loc>%s</loc><lastmod>%s</lastmod></url>" % (esc(base + p), today) for p in paths)
        write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s\n</urlset>\n' % urls)
        robots += ["", "Sitemap: %s/sitemap.xml" % base]
    write("robots.txt", "\n".join(robots) + "\n")

    headers_txt, redirects_txt, vercel = host_files(pages, redirects)
    write("_headers", headers_txt)
    write("_redirects", redirects_txt)

    # swap in the new build only now that everything succeeded
    old = PUBLIC + ".old"
    shutil.rmtree(old, ignore_errors=True)
    if os.path.exists(PUBLIC):
        os.replace(PUBLIC, old)
    os.replace(staging, PUBLIC)
    shutil.rmtree(old, ignore_errors=True)
    write_json(os.path.join(ROOT, "vercel.json"), vercel)

    report["ok"] = True
    return report


def main():
    report = build()
    for w in report["warnings"]:
        print("WARNING:", w)
    if not report["ok"]:
        for e in report["errors"]:
            print("ERROR:", e)
        print("\nBuild stopped. public/ was not changed.")
        return 1
    drafts = report.get("drafts", [])
    print("Built %d page(s) into public/ (%d files written by the build)." % (len(report["pages"]) - len(drafts), len(report["written"])))
    if drafts:
        print("Drafts kept out of the website: %s" % ", ".join(drafts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
