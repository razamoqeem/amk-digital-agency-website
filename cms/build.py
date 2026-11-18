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
import re
import shutil
import subprocess
import sys
from string import Template

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from sanitize import clean_rich_text, plain_text, safe_href  # noqa: E402
from validate import validate_page, heading_outline, page_url_path, HOME_SLUG  # noqa: E402
import collections_engine  # noqa: E402
import showcase  # noqa: E402
import layouts  # noqa: E402
import articles  # noqa: E402
import schema as ld  # noqa: E402

CONTENT = os.path.join(ROOT, "content")
PAGES_DIR = os.path.join(CONTENT, "pages")
TEMPLATES = os.path.join(ROOT, "templates")
PUBLIC = os.path.join(ROOT, "public")
# --preview builds into preview/ (not committed) and includes drafts, marked and hidden from search engines.
PREVIEW = "--preview" in sys.argv
if PREVIEW:
    PUBLIC = os.path.join(ROOT, "preview")

# Bot-check service (Cloudflare Turnstile) is the only outside script and frame we allow.
TURNSTILE = "https://challenges.cloudflare.com"
# Policy for every page. Older hand-written tool pages still use inline scripts and styles,
# so 'unsafe-inline' stays here until they are moved out.
GLOBAL_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' %s; "
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
              "img-src 'self' data:; connect-src 'self' %s; frame-src %s; object-src 'none'; "
              "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests") % (TURNSTILE, TURNSTILE, TURNSTILE)
BASE_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Content-Security-Policy", GLOBAL_CSP),
]
# Stricter policy for pages built here: no inline scripts or styles, same-origin only
# (plus the bot-check service, which the chat widget may need).
STRICT_CSP = ("default-src 'self'; script-src 'self' %s; style-src 'self'; img-src 'self' data:; "
              "connect-src 'self' %s; frame-src %s; object-src 'none'; "
              "base-uri 'self'; form-action 'self'; frame-ancestors 'none'") % (TURNSTILE, TURNSTILE, TURNSTILE)

# The tools run as small serverless functions in api/. The pages call stable /v1 addresses.
# Order matters: the first match wins, so the specific tools come before the general one.
REWRITES = [
    ("/v1/tools/seo-audit", "/api/audit?tool=seo-audit"),
    ("/v1/tools/site-scan", "/api/audit?tool=site-scan"),
    ("/v1/tools/domain-overview", "/api/domain-overview"),
    ("/v1/tools/domain-age", "/api/domain-age"),
    ("/v1/tools/domain-rank", "/api/domain-rank"),
    ("/v1/tools/:tool", "/api/page-tool?tool=:tool"),
    ("/v1/usage", "/api/usage"),
    ("/v1/leads", "/api/lead"),
]
# Added to every page when the site is built: chat widget, bot check, their styles.
WIDGET_HEAD = ('  <link rel="stylesheet" href="/css/chat-widget.css" />\n'
               '  <link rel="stylesheet" href="/css/nav.css" />\n'
               '  <link rel="stylesheet" href="/css/footer.css" />\n'
               '  <link rel="stylesheet" href="/css/article.css" />\n'
               '  <script src="/js/article.js" defer></script>\n'
               '  <link rel="stylesheet" href="/css/motion.css" />\n'
               '  <script src="/js/site-nav.js"></script>\n'
               '  <script src="/js/motion.js"></script>\n')
# The old page footers that the shared footer replaces.
FOOT_RE = re.compile(r'<footer\b[^>]*(?:class="(?:site-footer|foot|tool-footer|page-footer)"|id="site-footer")[^>]*>.*?</footer>', re.S)
# The old page headers that the shared navigation replaces (one per page family).
NAV_RE = re.compile(r'<header class="(?:site-header|top|tool-header)"[^>]*>.*?</header>|<nav class="top-bar"[^>]*>.*?</nav>', re.S)
# Pages designed from their CMS blocks (hero, statement, cards ...). The words stay editable in the CMS.
DESIGNED = {"home", "company"}
WIDGET_BODY = ('  <script src="/js/bot-check.js" defer></script>\n  <script src="/js/chat-widget.js" defer></script>\n'
               '  <script src="/js/site-fx.js" defer></script>\n')


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
    """The site address, set in ONE place: content/settings.json "site_url".
    SITE_URL in the environment or website/.env overrides it (for example for a test build)."""
    value = os.environ.get("SITE_URL", "")
    env_path = os.path.join(ROOT, ".env")
    if not value and os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            if line.strip().startswith("SITE_URL="):
                value = line.split("=", 1)[1].strip()
    if not value:
        value = str(read_json(os.path.join(CONTENT, "settings.json"), {}).get("site_url", ""))
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
    return articles.render_block(block)


def git_date(path):
    """Date of the last commit that changed a file (YYYY-MM-DD), or today for files not yet committed."""
    import subprocess
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", path], cwd=ROOT, capture_output=True, text=True, timeout=10)
        dirty = subprocess.run(["git", "status", "--porcelain", "--", path], cwd=ROOT, capture_output=True, text=True, timeout=10)
        if dirty.stdout.strip() or not out.stdout.strip():
            return datetime.date.today().isoformat()
        return out.stdout.strip()
    except Exception:
        return ""


def lastmod_map(pages, settings, tool_paths, extras):
    """Genuine last-modified dates for the sitemap: an article's own updated date, otherwise the
    date its source file last changed."""
    mod = {}
    for p in pages:
        info = p.get("article") or {}
        if info.get("updated") or info.get("published"):
            mod[page_url_path(p["slug"])] = info.get("updated") or info["published"]
        elif p.get("_file") == "(generated)":
            src = "content/limits.json" if p["slug"].endswith("usage-limits") else "content/tools.json"
            mod[page_url_path(p["slug"])] = git_date(src)
        else:
            mod[page_url_path(p["slug"])] = git_date("content/pages/" + p["_file"])
    for path in list(settings.get("legacy_sitemap_paths", [])) + list(tool_paths):
        src = path.lstrip("/")
        mod[path] = git_date(src) if os.path.exists(os.path.join(ROOT, src)) else git_date("content/tools.json")
    dates = [mod[page_url_path(p["slug"])] for p in extras.get("articles", [])]
    if dates:
        mod["/blog/"] = max(dates)
    mod["/resources/"] = max(dates + [git_date("cms/articles.py")])
    mod["/contact/"] = git_date("cms/layouts.py")
    return mod


def social_head(html_text, url, canonical=True):
    """Canonical and sharing tags for pages written by hand, taken from their own title and description."""
    title = re.search(r"<title>(.*?)</title>", html_text, re.S)
    desc = re.search(r'<meta name="description" content="([^"]*)"', html_text)
    lines = []
    if canonical:
        lines.append('  <link rel="canonical" href="%s" />' % esc(url))
    lines.append('  <meta property="og:url" content="%s" />' % esc(url))
    if 'property="og:type"' not in html_text:
        lines.append('  <meta property="og:type" content="website" />')
    if title and 'property="og:title"' not in html_text:
        lines.append('  <meta property="og:title" content="%s" />' % title.group(1).strip())
    if desc and 'property="og:description"' not in html_text:
        lines.append('  <meta property="og:description" content="%s" />' % desc.group(1))
    if 'name="twitter:card"' not in html_text:
        lines.append('  <meta name="twitter:card" content="summary" />')
    return "\n".join(lines) + "\n"


def tool_learn_html(current, extras):
    """On each tool page: links to its guide and to the articles that use it (internal linking)."""
    tools = (extras.get("tools") or {}).get("tools", [])
    tool = next((t for t in tools if layouts.tool_href(t) == current), None)
    if not tool:
        return ""
    docs = {p["slug"] for p in extras.get("docs", [])}
    links = []
    if "docs/tools/" + tool["slug"] in docs:
        links.append('<li><a href="/docs/tools/%s/">How to use the %s</a></li>' % (esc(tool["slug"]), esc(tool["name"])))
    for p in extras.get("articles", []):
        if tool["slug"] in (p.get("article") or {}).get("related_tools", []) and not p.get("draft"):
            links.append('<li><a href="%s">%s</a></li>' % (esc(articles.url_of(p)), esc(articles.h1_of(p))))
    if not links:
        return ""
    return ('    <section class="tool-learn" aria-labelledby="tool-learn-h"><h2 id="tool-learn-h">Learn more</h2>'
            '<ul>%s</ul></section>' % "".join(links))


# ── Speed: one stylesheet and one head script per page instead of many ─────────
FONT_PRELOAD = '  <link rel="preload" href="/assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin />\n'
CSS_LINK_RE = re.compile(r'[ \t]*<link rel="stylesheet" href="(/[^"?#]+\.css)(?:\?[^"]*)?"\s*/?>\n?')
HEAD_JS_RE = re.compile(r'[ \t]*<script src="(/js/(?:theme-engine|site-nav|motion)\.js)(?:\?[^"]*)?"></script>\n?')
IMPORT_RE = re.compile(r'@import\s+url\(\s*["\']?([^"\')]+)["\']?\s*\)\s*;')
URL_RE = re.compile(r'url\(\s*(["\']?)([^"\')]+)\1\s*\)')


def _css_source(staging, web_path):
    """A stylesheet's text with local @imports pulled in and relative url()s made absolute.
    Returns (css, outside_imports)."""
    import posixpath
    full = os.path.join(staging, web_path.lstrip("/"))
    if not os.path.isfile(full):
        return "", []
    text = open(full, encoding="utf-8").read()
    base = posixpath.dirname(web_path)
    outside = []

    def fix_url(m):
        u = m.group(2).strip()
        if u.startswith(("data:", "http:", "https:", "/", "#")):
            return m.group(0)
        return 'url("%s")' % posixpath.normpath(posixpath.join(base, u))

    def pull(m):
        target = m.group(1).strip()
        if target.startswith(("http:", "https:", "//")):
            outside.append(m.group(0))
            return ""
        target = target if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
        inner, more = _css_source(staging, target.split("?")[0])
        outside.extend(more)
        return inner
    text = IMPORT_RE.sub(pull, text)
    return URL_RE.sub(fix_url, text), outside


def bundle_page(html, staging, made):
    """Replace a page's local stylesheets with one bundle and its early head scripts with one script.
    Bundles are named by their content, so they can be cached for a year."""
    import hashlib
    head_end = html.find("</head>")
    if head_end < 0:
        return html
    head, rest = html[:head_end], html[head_end:]

    css_paths = CSS_LINK_RE.findall(head)
    if len(css_paths) > 1 or (css_paths and IMPORT_RE.search(open(os.path.join(staging, css_paths[0].lstrip("/")), encoding="utf-8").read() if os.path.isfile(os.path.join(staging, css_paths[0].lstrip("/"))) else "")):
        parts, outside, seen = [], [], set()
        for path in css_paths:
            if path in seen:
                continue
            seen.add(path)
            css, more = _css_source(staging, path)
            parts.append("/* %s */\n%s" % (path, css))
            outside += [o for o in more if o not in outside]
        css = "\n".join(outside) + ("\n" if outside else "") + "\n".join(parts)
        name = "/assets/b/%s.css" % hashlib.sha256(css.encode()).hexdigest()[:12]
        if name not in made:
            os.makedirs(os.path.join(staging, "assets", "b"), exist_ok=True)
            open(os.path.join(staging, name.lstrip("/")), "w", encoding="utf-8", newline="\n").write(css)
            made.add(name)
        link = '  <link rel="stylesheet" href="%s" />\n' % name
        if "inter-latin-var.woff2" in css and "inter-latin-var.woff2\" as=\"font\"" not in head:
            link = FONT_PRELOAD + link
        first = [True]

        def swap(m):
            if first[0]:
                first[0] = False
                return link
            return ""
        head = CSS_LINK_RE.sub(swap, head)

    js_paths = HEAD_JS_RE.findall(head)
    if len(js_paths) > 1:
        js = "\n;\n".join("/* %s */\n%s" % (p, open(os.path.join(staging, p.lstrip("/")), encoding="utf-8").read())
                          for p in dict.fromkeys(js_paths) if os.path.isfile(os.path.join(staging, p.lstrip("/"))))
        name = "/assets/b/%s.js" % hashlib.sha256(js.encode()).hexdigest()[:12]
        if name not in made:
            os.makedirs(os.path.join(staging, "assets", "b"), exist_ok=True)
            open(os.path.join(staging, name.lstrip("/")), "w", encoding="utf-8", newline="\n").write(js)
            made.add(name)
        first = [True]

        def swap_js(m):
            if first[0]:
                first[0] = False
                return '  <script src="%s"></script>\n' % name
            return ""
        head = HEAD_JS_RE.sub(swap_js, head)
    return head + rest


def strict_ready_paths(staging):
    """Addresses of built pages that need nothing the strict security policy blocks: no inline scripts
    (JSON-LD data is fine), no onclick-style handlers, no style attributes or <style> blocks, and no outside
    stylesheets. These get the strict policy automatically; anything else keeps the older, looser one."""
    found = []
    for folder, _dirs, files in os.walk(staging):
        for name in files:
            if not name.endswith(".html"):
                continue
            path = os.path.join(folder, name)
            text = open(path, encoding="utf-8").read()
            if (re.search(r'<script(?![^>]*\ssrc=)(?![^>]*application/ld\+json)[^>]*>', text) or
                    re.search(r"\son[a-z]+\s*=\s*[\"']", text) or re.search(r"\sstyle\s*=\s*[\"']", text) or
                    re.search(r'<style[\s>]', text) or "fonts.googleapis" in text):
                continue
            rel = os.path.relpath(path, staging).replace(os.sep, "/")
            found.append("/" + (rel[:-len("index.html")] if rel.endswith("index.html") else rel))
    return sorted(found)


def json_ld(data) -> str:
    text = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return '  <script type="application/ld+json">%s</script>' % text


def render_document(template, settings, title, description, head_lines, body_html, live_paths=(), main_class="") -> str:
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
        nav_items=nav, body=body_html, main_class=main_class,
        year=datetime.date.today().year,
        footer_text=esc(settings.get("footer_text", "")),
        preview_label=esc(settings.get("preview_label", "")),
    )


def render_page(page, settings, template, base, live_paths=(), extras=None) -> str:
    path = page_url_path(page["slug"])
    url = (page.get("canonical") or "").strip() or (base + path if base else "")
    og = page.get("og") or {}
    head = []
    if url:
        head.append('  <link rel="canonical" href="%s" />' % esc(url))
    if page.get("noindex") or page.get("draft"):
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
    extras = extras or {}
    graph = ld.for_page(page, settings, base, url, extras.get("founder"), HOME_SLUG)
    if graph:
        head.append(graph)
    main_class = ""
    if page.get("slug") in DESIGNED:
        body = "    " + layouts.designed_body(page, extras.get("tools", {}), extras.get("stats") if page.get("slug") == "home" else None)
        main_class = " is-designed"
    else:
        slug = str(page.get("slug", ""))
        if slug.startswith("blog/"):
            body = articles.article_body(page, render_block, extras.get("articles", []), extras.get("tools", {}),
                                         layouts.tool_href, PREVIEW)
            main_class = " is-article"
        else:
            body = "\n".join(render_block(b) for b in page.get("blocks", []))
        if slug == "docs" or slug.startswith("docs/"):
            body, toc = articles.with_toc(body)
            if toc:
                idx = body.find("</p>")
                body = body[: idx + 4] + toc + body[idx + 4:] if idx >= 0 else toc + body
            body = articles.docs_shell(page, body, extras.get("docs", []))
            main_class = " is-doc"
    return render_document(template, settings, page.get("title", ""), page.get("description", ""), head, body, live_paths, main_class)


def render_collection_item(item, schema, settings, template, base, live_paths=()) -> str:
    path = item.get("_urlPath", f"/{item['slug']}/")
    seo = item.get("seo") or {}
    url = (seo.get("canonical") or "").strip() or (base + path if base else "")
    title = seo.get("metaTitle") or seo.get("title") or item.get("title", "")
    description = seo.get("metaDesc") or seo.get("description") or ""

    head = []
    if url:
        head.append('  <link rel="canonical" href="%s" />' % esc(url))
    if seo.get("noindex") or item.get("draft"):
        head.append('  <meta name="robots" content="noindex, nofollow" />')
    head.append('  <meta property="og:type" content="article" />')
    head.append('  <meta property="og:title" content="%s" />' % esc(title))
    head.append('  <meta property="og:description" content="%s" />' % esc(description))
    if url:
        head.append('  <meta property="og:url" content="%s" />' % esc(url))
    image = safe_href(seo.get("ogImage") or seo.get("image") or "")
    if image and (image.startswith("http") or base):
        head.append('  <meta property="og:image" content="%s" />' % esc(image if image.startswith("http") else base + image))
    head.append('  <meta name="twitter:card" content="summary_large_image" />')

    # Custom JSON-LD schema
    custom_ld = item.get("jsonLd") or seo.get("jsonLd")
    if custom_ld and isinstance(custom_ld, dict):
        head.append(json_ld(custom_ld))

    fields = item.get("fields") or {}
    body_parts = []

    # Title & Subtitle
    body_parts.append('    <h1 class="t-size-xl">%s</h1>' % esc(item.get("title", "")))
    if fields.get("subtitle"):
        body_parts.append('    <p class="t-size-lg ci-sub">%s</p>' % esc(fields["subtitle"]))

    # Date / Author if present
    meta_info = []
    if fields.get("date"):
        meta_info.append('<span>Published: %s</span>' % esc(fields["date"]))
    if fields.get("author"):
        meta_info.append('<span>By %s</span>' % esc(fields["author"]))
    if fields.get("readingTime"):
        meta_info.append('<span>%s</span>' % esc(fields["readingTime"]))
    if meta_info:
        body_parts.append('    <p class="t-size-sm ci-meta">%s</p>' % " &bull; ".join(meta_info))

    # Hero / Cover image
    hero = fields.get("heroImage") or fields.get("coverImage")
    if hero:
        body_parts.append('    <img src="%s" alt="%s" class="ci-hero" loading="lazy" />' % (esc(safe_href(hero)), esc(item.get("title", ""))))

    # Main content / rich text
    content_html = fields.get("content") or fields.get("body") or ""
    if content_html:
        body_parts.append('    <div class="content-body ci-body">%s</div>' % clean_rich_text(content_html))

    # CTA Button if present
    if fields.get("ctaLabel") and fields.get("ctaUrl"):
        body_parts.append('    <p class="ci-cta"><a class="btn t-bg-accent" href="%s">%s</a></p>' % (esc(safe_href(fields["ctaUrl"])), esc(fields["ctaLabel"])))

    body_html = "\n".join(body_parts)
    return render_document(template, settings, title, description, head, body_html, live_paths)


def token_css(settings) -> str:
    # The colour values themselves live in css/theme.css (one place for the
    # palette, with light and dark). settings.json only lists the names an
    # editor may pick, plus light values used for the contrast warning.
    tokens = settings.get("tokens", {})
    colours = tokens.get("colors", {})
    lines = ["", "/* Colour picker classes for the names in content/settings.json */"]
    for name in colours:
        lines.append(".t-color-%s { color: var(--c-%s); }" % (name, name))
        lines.append(".t-bg-%s { background: var(--c-%s); }" % (name, name))
    return "\n".join(lines) + "\n"


# ── Tool pages ─────────────────────────────────────────────────────────────
def tool_pages(settings, base):
    """One page per tool in content/tools.json, plus the list of all tools. Returns {path: html}."""
    data = read_json(os.path.join(CONTENT, "tools.json"), {"tools": [], "groups": []})
    template = Template(open(os.path.join(TEMPLATES, "tool.html"), encoding="utf-8").read())
    tools = {t["slug"]: t for t in data["tools"]}
    href = lambda t: t.get("page") or "/tools/%s.html" % t["slug"]
    common = dict(year=datetime.date.today().year, preview_label=esc(settings.get("preview_label", "")))
    scripts = '  <script src="/js/tools-client.js" defer></script>\n  <script src="/js/page-tools.js" defer></script>'
    out = {}

    for tool in data["tools"]:
        if tool.get("page"):
            continue
        others = "".join('<a class="card link" href="%s"><h3>%s</h3><p>%s</p></a>' % (esc(href(t)), esc(t["name"]), esc(t["summary"]))
                         for t in data["tools"] if t["slug"] != tool["slug"])
        body = "\n".join([
            '    <section class="hero">',
            "      <h1>%s</h1>" % esc(tool["name"]),
            "      <p>%s</p>" % esc(tool["intro"]),
            '      <form id="tool-form" class="search" data-tool="%s">' % esc(tool["slug"]),
            '        <label class="sr-only" for="tool-url">Website address</label>',
            '        <input id="tool-url" class="tool-input" type="text" inputmode="url" autocomplete="off" placeholder="%s" required />' % esc(tool["placeholder"]),
            '        <button id="tool-run" class="tool-run-btn" type="submit">%s</button>' % esc(tool["button"]),
            "      </form>",
            '      <p id="runs-line" class="runs-line" role="status" data-tool="%s" hidden></p>' % esc(tool["slug"]),
            '      <p id="tools-unavailable" class="notice" role="status" hidden>This tool is temporarily unavailable. Please try again soon.</p>',
            "    </section>",
            '    <div id="gate-panel" class="gate-panel" hidden></div>',
            '    <p id="tool-loading" class="notice" role="status" hidden>Checking. This can take a few seconds.</p>',
            '    <p id="tool-error" class="notice bad" role="alert" hidden></p>',
            '    <div id="tool-result" hidden></div>',
            '    <section><h2>What this tool checks</h2><div class="panel"><ul class="plain">%s</ul></div></section>'
            % "".join("<li>%s</li>" % esc(i) for i in tool["what"]),
            '    <section><h2>More free tools</h2><div class="cards">%s</div></section>' % others,
        ])
        head = ['  <link rel="canonical" href="%s%s" />' % (esc(base), esc(href(tool)))] if base else []
        out[os.path.join("tools", tool["slug"] + ".html")] = template.substitute(
            title=esc(tool["title"]), description=esc(tool["description"]), head_extra="\n".join(head),
            scripts=scripts, body=body, **common)

    groups = []
    for group in data["groups"]:
        cards = "".join('<a class="card link" href="%s"><h3>%s</h3><p>%s</p></a>' % (
            esc(href(tools[s])), esc(tools[s]["name"]), esc(tools[s]["summary"])) for s in group["tools"] if s in tools)
        gid = re.sub(r"[^a-z0-9]+", "-", group["name"].lower()).strip("-")
        groups.append('    <section id="%s"><h2>%s</h2><div class="cards">%s</div></section>' % (gid, esc(group["name"]), cards))
    chips = "".join('<a href="#%s">%s</a>' % (re.sub(r"[^a-z0-9]+", "-", g["name"].lower()).strip("-"), esc(g["name"])) for g in data["groups"])
    groups.insert(0, '    <nav class="x-chips" aria-label="Tool categories">%s</nav>' % chips)
    body = "\n".join([
        '    <section class="hero">', "      <h1>Free Tools &amp; AI Tools</h1>",
        "      <p>Professional diagnostic analysers and AI content generators. Every check uses real data with zero invented metrics.</p>",
        '      <p><a class="btn ghost" href="/docs/how-to-use-the-free-tools/">How to use the tools</a></p>', "    </section>"] + groups)
    head = ['  <link rel="canonical" href="%s/tools/" />' % esc(base)] if base else []
    out[os.path.join("tools", "index.html")] = template.substitute(
        title="Free Tools & AI Tools | AMK Digital Agency",
        description="Free SEO tools and AI utilities from AMK Digital Agency: domain overview, title generator, meta tags, headings, SSL, schema, links and more.",
        head_extra="\n".join(head), scripts="", body=body, **common)
    return out, ["/tools/"] + [href(t) for t in data["tools"] if not t.get("page")]


# ── Host files ─────────────────────────────────────────────────────────────
def host_files(pages, redirects, extra_paths=()):
    cms_paths = [page_url_path(p["slug"]) for p in pages] + list(extra_paths) + ["/404.html"]

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
        "rewrites": [{"source": src, "destination": dst} for src, dst in REWRITES],
        "functions": {
            # One rule only: Vercel refuses two rules that match the same file (api/chat.js).
            # The chat reads AGENCY_CONTEXT.md, so every function carries that small file.
            "api/*.js": {"maxDuration": 30, "includeFiles": "AGENCY_CONTEXT.md"},
        },
        "headers": [{"source": "/(.*)", "headers": [{"key": k, "value": v} for k, v in BASE_HEADERS]}] +
                   [{"source": path, "headers": [{"key": "Content-Security-Policy", "value": STRICT_CSP}]}
                    for path in cms_paths] +
                   [{"source": "/api/(.*)", "headers": [{"key": "X-Robots-Tag", "value": "noindex, nofollow"},
                                                        {"key": "Cache-Control", "value": "no-store"}]},
                    {"source": "/v1/(.*)", "headers": [{"key": "X-Robots-Tag", "value": "noindex, nofollow"},
                                                       {"key": "Cache-Control", "value": "no-store"}]},
                    {"source": "/assets/b/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]},
                    {"source": "/assets/fonts/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=604800"}]}],
    }
    return "\n".join(headers_txt) + "\n", "\n".join(redirects_txt) + "\n", vercel


# ── Build ──────────────────────────────────────────────────────────────────
def build() -> dict:
    settings = load_settings()
    pages = load_pages()
    redirects = load_redirects()
    base = site_url()
    report = {"ok": False, "pages": [], "errors": [], "warnings": [], "site_url": base, "written": []}

    # Showcase: built only when content/showcase.json holds real metrics or results.
    show_data = showcase.load(os.path.join(CONTENT, "showcase.json"))
    show_live = showcase.publishable(show_data)
    if show_live:
        found = showcase.check_names(showcase.body_html(show_data), CONTENT)
        if found:
            report["errors"].append("showcase: %d confidential name(s) from content/confidential_names.txt appear on the page. "
                                    "Remove them from content/showcase.json." % len(found))
            return report
    if show_live:
        nav = list(settings.get("nav", []))
        at = next((i for i, n in enumerate(nav) if n.get("href") == "/owner/"), len(nav))
        nav.insert(at, {"label": "Work", "href": "/showcase/"})
        settings = dict(settings, nav=nav)
    else:
        report["warnings"].append("showcase: no real metrics or results in content/showcase.json, so /showcase/ is not built. "
                                  "Add data with scripts/import-gsc.py.")

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
    if not PREVIEW:
        pages = [p for p in pages if not p.get("draft")]     # drafts stay in the admin only
    # Generated help-centre pages: one guide per tool, plus free runs and limits.
    tools_json = read_json(os.path.join(CONTENT, "tools.json"), {"tools": [], "groups": []})
    limits_json = read_json(os.path.join(CONTENT, "limits.json"), {})
    for t in tools_json.get("tools", []):
        if t.get("what") and not any(p["slug"] == "docs/tools/" + t["slug"] for p in pages):
            pages.append(dict(articles.tool_doc_page(t, layouts.tool_href, limits_json), _file="(generated)"))
    pages.append(dict(articles.usage_doc_page(limits_json), _file="(generated)"))
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

    tool_files, tool_paths = tool_pages(settings, base)
    for rel, text in tool_files.items():
        write(rel, text)

    extras = {"tools": tools_json,
              "articles": [p for p in pages if p["slug"].startswith("blog/")],
              "docs": [p for p in pages if p["slug"] == "docs" or p["slug"].startswith("docs/")],
              "stats": showcase.stats(show_data) if show_live else None,
              "founder": ld.founder_from(next((p for p in pages if p["slug"] == "owner"), None))}
    for page in pages:
        write(page_output_rel(page["slug"]), render_page(page, settings, template, base, live_paths, extras))

    # Blog listing, resources hub and the search index used by both and by the docs
    hub_pages = [
        ("blog", "SEO and Digital Marketing Blog | %s" % settings.get("site_name", ""),
         "Practical, sourced articles on technical SEO, AI search and website optimisation from AMK Digital Agency.",
         articles.blog_body(extras["articles"])),
        ("resources", "SEO Resources: Guides, Articles and Tools | %s" % settings.get("site_name", ""),
         "Learn SEO, AI search and website optimisation with guides, articles, documentation and free tools.",
         articles.resources_body(extras["articles"], extras["docs"], tools_json, layouts.tool_href)),
    ]
    for name, h_title, h_desc, h_body in hub_pages:
        if name == "blog" and not extras["articles"]:
            continue                                  # no empty blog page: it appears with the first published article
        live_paths.add("/%s/" % name)
        head = ['  <link rel="canonical" href="%s/%s/" />' % (esc(base), name)] if base else []
        if base:
            head.append(ld.for_simple(settings, base, "/%s/" % name, h_title, h_desc, "CollectionPage", name.title(), extras["founder"]))
        write(os.path.join(name, "index.html"), render_document(template, settings, h_title, h_desc, head, "    " + h_body,
                                                              live_paths, " is-designed is-hub"))
    write("search-index.json", json.dumps(articles.search_index(extras["articles"], extras["docs"], tools_json, layouts.tool_href),
                                          ensure_ascii=False, separators=(",", ":")))

    # Contact page (form posts to the existing secure request endpoint)
    live_paths.add("/contact/")
    write(os.path.join("contact", "index.html"), render_document(
        template, settings, "Contact Us | %s" % settings.get("site_name", ""),
        "Contact AMK Digital Agency: ask for a free audit, a question about our services, or access to the App.",
        (['  <link rel="canonical" href="%s/contact/" />' % esc(base),
          ld.for_simple(settings, base, "/contact/", "Contact Us | %s" % settings.get("site_name", ""),
                        "Contact AMK Digital Agency: ask for a free audit, a question about our services, or access to the App.",
                        "ContactPage", "Contact Us", extras["founder"])] if base else []) + ['  <script src="/js/contact.js" defer></script>'],
        layouts.contact_body(), live_paths, " is-designed"))

    if show_live:
        live_paths.add("/showcase/")
        write(os.path.join("showcase", "index.html"), render_document(
            template, settings, "%s | %s" % (show_data.get("title", "Selected work and results"), settings.get("site_name", "")),
            show_data.get("description", "Selected projects and measured organic search results."),
            ['  <link rel="canonical" href="%s/showcase/" />' % esc(base)] if base else [],
            showcase.body_html(show_data), live_paths))

    # Compile custom CMS collection items
    col_items = collections_engine.list_items()
    schemas = {c["id"]: c for c in collections_engine.load_schemas().get("collections", [])}
    col_paths = []
    for it in col_items:
        if it.get("draft"):
            continue
        cid = it.get("_collectionId") or it.get("collection", "pages")
        schema = schemas.get(cid, {})
        url_path = (it.get("_urlPath") or f"/{it['slug']}/").strip("/")
        rel_out = os.path.join(*url_path.split("/"), "index.html")
        full_route = "/" + url_path + "/"
        live_paths.add(full_route)
        if not (it.get("seo") or {}).get("noindex"):
            col_paths.append(full_route)
        write(rel_out, render_collection_item(it, schema, settings, template, base, live_paths))

    nf = settings.get("not_found", {})
    nf_body = "\n".join([
        "    <h1 class=\"t-size-xl\">%s</h1>" % esc(nf.get("title", "Page not found")),
        "    <p>%s</p>" % esc(nf.get("text", "")),
        '    <p><a class="btn t-bg-accent" href="%s">%s</a></p>' % (esc(safe_href(nf.get("button_href", "/")) or "/"),
                                                                   esc(nf.get("button_label", "Home"))),
    ])
    write("404.html", render_document(template, settings, "%s | %s" % (nf.get("title", "Page not found"),
          settings.get("site_name", "")), nf.get("text", ""), ['  <meta name="robots" content="noindex" />'], nf_body, live_paths))

    # Search engines may crawl every page. The tool and chat addresses return no pages, so crawlers
    # are told to skip them and spend their crawl budget on real content.
    robots = ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /v1/"]
    if base:
        paths = list(settings.get("legacy_sitemap_paths", [])) + tool_paths + [page_url_path(p["slug"]) for p in pages if not p.get("noindex") and not p.get("draft")] + col_paths + (["/showcase/"] if show_live else []) + ["/contact/", "/resources/"] + (["/blog/"] if "/blog/" in live_paths else [])
        mod = lastmod_map(pages, settings, tool_paths, extras)
        urls = "\n".join("  <url><loc>%s</loc>%s</url>" % (esc(base + p), "<lastmod>%s</lastmod>" % mod[p] if mod.get(p) else "")
                         for p in dict.fromkeys(paths))
        write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s\n</urlset>\n' % urls)
        robots += ["", "Sitemap: %s/sitemap.xml" % base]
    write("robots.txt", "\n".join(robots) + "\n")

    # IndexNow key file (public by design), from content/settings.json "indexnow".
    inow = str((settings.get("indexnow", {}) or {}).get("key", ""))
    if re.fullmatch(r"[a-f0-9]{32}", inow):
        write(inow + ".txt", inow)

    # Google Search Console verification, from content/settings.json "search_console".
    # To remove it: delete the entry there, rebuild, commit, push.
    gsc = settings.get("search_console", {}) or {}
    for name in gsc.get("files", []):
        if re.fullmatch(r"google[0-9a-f]{16}", str(name)):
            write(name + ".html", "google-site-verification: %s.html" % name)
        else:
            report["warnings"].append("search_console: ignored file name %r (expected google + 16 letters/numbers)" % name)

    # Structured data for the tools hub and every tool page (hand-written or generated).
    tool_href = lambda t: t.get("page") or "/tools/%s.html" % t["slug"]
    tool_graphs = {}
    if base:
        tdata = extras["tools"]
        tool_graphs["/tools/"] = ld.for_tools_hub(tdata, settings, base, tool_href, extras["founder"],
                                                  "Free Tools & AI Tools | AMK Digital Agency",
                                                  "Free SEO tools and AI utilities from AMK Digital Agency.")
        for tl in tdata.get("tools", []):
            tool_graphs[tool_href(tl)] = ld.for_tool(tl, settings, base, tool_href(tl), extras["founder"])

    # chat widget and bot check on every page (hand-written pages are copied as they are, so this runs last)
    bundles_made = set()
    for folder, _dirs, files in os.walk(staging):
        for name in files:
            if not name.endswith(".html"):
                continue
            path = os.path.join(folder, name)
            with open(path, encoding="utf-8") as f:
                html = f.read()
            if "chat-widget.js" in html or "</body>" not in html or "</head>" not in html:
                continue
            rel = os.path.relpath(path, staging).replace(os.sep, "/")
            current = "/" + (rel[:-len("index.html")] if rel.endswith("index.html") else rel)
            header = layouts.nav_html(settings.get("site_name", ""), extras["tools"], current, live_paths)
            html, swapped = NAV_RE.subn(header, html, count=1)
            if not swapped:
                html = html.replace('<a class="skip-link"', header + '\n  <a class="skip-link"', 1) if '<a class="skip-link"' in html else html.replace("<body>", "<body>\n  " + header, 1)
            footer = layouts.footer_html(settings, extras["tools"], live_paths, datetime.date.today().year)
            html, fswapped = FOOT_RE.subn(lambda m: footer, html, count=1)
            if not fswapped:
                html = html.replace("</body>", "  " + footer + "\n</body>", 1)
            if base and 'rel="canonical"' not in html and 'name="robots" content="noindex' not in html:
                html = html.replace("</head>", social_head(html, base + current) + "</head>", 1)
            elif base and 'property="og:url"' not in html and 'rel="canonical"' in html:
                html = html.replace("</head>", social_head(html, base + current, canonical=False) + "</head>", 1)
            learn = tool_learn_html(current, extras)
            if learn:
                html = html.replace("</main>", learn + "\n  </main>", 1)
            if current == "/":
                for code in (settings.get("search_console", {}) or {}).get("meta", []):
                    if re.fullmatch(r"[A-Za-z0-9_-]{20,100}", str(code)):
                        html = html.replace("</head>", '  <meta name="google-site-verification" content="%s" />\n</head>' % code, 1)
            head = WIDGET_HEAD if "theme-engine.js" in html else '  <script src="/js/theme-engine.js"></script>\n' + WIDGET_HEAD
            if current in tool_graphs and "application/ld+json" not in html:
                head = tool_graphs[current] + "\n" + head
            html = html.replace("</head>", head + "</head>", 1).replace("</body>", WIDGET_BODY + "</body>", 1)
            html = bundle_page(html, staging, bundles_made)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(html)

    # No confidential client, brand or employer name may appear on any page (list: content/confidential_names.txt, not committed).
    leaked = []
    for folder, _dirs, files in os.walk(staging):
        for name in files:
            if name.endswith((".html", ".json", ".xml", ".txt", ".js")):
                path = os.path.join(folder, name)
                with open(path, encoding="utf-8", errors="ignore") as f:
                    if showcase.check_names(f.read(), CONTENT):
                        leaked.append(os.path.relpath(path, staging).replace(os.sep, "/"))
    if leaked:
        report["errors"].append("confidential names found on %d built file(s): %s. Generalise them in the source." % (len(leaked), ", ".join(leaked[:5])))
        shutil.rmtree(staging, ignore_errors=True)
        return report

    strict = [p for p in strict_ready_paths(staging) if p != "/404.html"]
    headers_txt, redirects_txt, vercel = host_files(pages, redirects, sorted(set((["/showcase/"] if show_live else []) + ["/contact/", "/blog/", "/resources/"] + strict)))
    write("_headers", headers_txt)
    write("_redirects", redirects_txt)

    # Address guard: a page that was ever published must keep its address, or get a redirect.
    # content/url-registry.json remembers every indexable address; it only grows.
    if not PREVIEW:
        registry_file = os.path.join(CONTENT, "url-registry.json")
        registry = read_json(registry_file, {"paths": []})
        redirected = {r["from"] for r in redirects}

        def built(path):
            rel = path.lstrip("/")
            return (os.path.isfile(os.path.join(staging, rel)) or
                    os.path.isfile(os.path.join(staging, rel, "index.html")) or path == "/")
        lost = [p for p in registry.get("paths", []) if not built(p) and p not in redirected]
        if lost:
            report["errors"].append(
                "These published addresses would disappear: %s. Keep the old slug, or add a 301 redirect for each "
                "in content/redirects.json (from the old address to the new one)." % ", ".join(lost))
            shutil.rmtree(staging, ignore_errors=True)
            return report
        if base:
            now = sorted(set(registry.get("paths", [])) | set(paths))
            if now != registry.get("paths"):
                write_json(registry_file, {"_help": "Every address the site has published. Built by cms/build.py; do not "
                                                    "remove entries. A removed or renamed page needs a redirect.", "paths": now})

    # Keep the previous build's bundles that its pages used, so a page loaded just before this version
    # went live never asks for a file that is gone (a missing bundle would be cached as "not found").
    prev_b = os.path.join(PUBLIC, "assets", "b")
    if os.path.isdir(prev_b):
        used = set()
        for folder, _dirs, files in os.walk(PUBLIC):
            for name in files:
                if name.endswith(".html"):
                    with open(os.path.join(folder, name), encoding="utf-8", errors="ignore") as f:
                        used.update(re.findall(r"/assets/b/([0-9a-f]{12}\.(?:css|js))", f.read()))
        try:  # also the bundles of the last committed (deployed) pages, in case of several builds before a push
            out = subprocess.run(["git", "grep", "-hoE", r"/assets/b/[0-9a-f]{12}\.(css|js)", "HEAD", "--", "public"],
                                 cwd=ROOT, capture_output=True, text=True, timeout=30).stdout
            used.update(line.rsplit("/", 1)[-1] for line in out.split())
        except Exception:
            pass
        os.makedirs(os.path.join(staging, "assets", "b"), exist_ok=True)
        for name in used:
            src, dst = os.path.join(prev_b, name), os.path.join(staging, "assets", "b", name)
            if os.path.isfile(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)

    # swap in the new build only now that everything succeeded
    old = PUBLIC + ".old"
    shutil.rmtree(old, ignore_errors=True)
    if os.path.exists(PUBLIC):
        os.replace(PUBLIC, old)
    os.replace(staging, PUBLIC)
    shutil.rmtree(old, ignore_errors=True)
    if not PREVIEW:
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
    print("Built %d page(s) into %s/ (%d files written by the build)." % (len(report["pages"]) - (0 if PREVIEW else len(drafts)), os.path.basename(PUBLIC), len(report["written"])))
    if drafts:
        print(("Drafts included for review (marked, hidden from search engines): %s" if PREVIEW else "Drafts kept out of the website: %s") % ", ".join(drafts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
