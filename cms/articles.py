"""AMK Digital Agency Website: articles, blog, resources hub, docs help centre and search index.

Articles are ordinary CMS pages whose slug starts with "blog/" (content/pages/blog__<slug>.json).
They carry an "article" object (category, dates, takeaways, related tools ...) and use the rich
block types below as well as the basic ones. Everything is rendered at build time: no framework,
no outside requests. Word count and reading time are calculated here, never typed in by hand.
"""
import html
import math
import re

from sanitize import clean_rich_text, plain_text, safe_href

WORDS_PER_MINUTE = 220
SECONDS_PER_VISUAL = 10
MIN_PER_CATEGORY = 3          # a category card appears only with this many published articles

RICH_BLOCKS = {"table", "callout", "code", "checklist", "steps", "references", "chart", "flow"}
CALLOUTS = {"note": "Note", "tip": "Tip", "warning": "Warning", "best": "Best practice", "takeaway": "Key takeaway"}
SECTIONS = ["SEO", "AI Search & Modern SEO", "Digital Marketing", "Tools & Tutorials"]


def esc(text):
    return html.escape(str(text if text is not None else ""), quote=True)


def _words(text):
    return len(re.findall(r"[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9]+)*", plain_text(text)))


# ── Rich blocks ─────────────────────────────────────────────────────────────
def render_block(block):
    """HTML for the rich block types. Returns "" for a type it does not know."""
    kind = block.get("type")
    if kind == "table":
        align = block.get("align") or []

        def cell(tag, value, i, scope=""):
            cls = ' class="num"' if i < len(align) and align[i] == "right" else ""
            return "<%s%s%s>%s</%s>" % (tag, scope, cls, clean_rich_text(str(value)), tag)
        head = "".join(cell("th", h, i, ' scope="col"') for i, h in enumerate(block.get("headers", [])))
        rows = "".join("<tr>%s</tr>" % "".join(cell("th", c, i, ' scope="row"') if i == 0 and block.get("row_headers")
                                                 else cell("td", c, i) for i, c in enumerate(r))
                       for r in block.get("rows", []))
        cap = plain_text(block.get("caption", ""))
        return ('    <div class="table-wrap" role="region" aria-label="%s" tabindex="0"><table>%s<thead><tr>%s</tr></thead>'
                '<tbody>%s</tbody></table></div>') % (esc(cap or "Table"), "<caption>%s</caption>" % esc(cap) if cap else "", head, rows)
    if kind == "callout":
        k = block.get("kind") if block.get("kind") in CALLOUTS else "note"
        title = block.get("title") or CALLOUTS[k]
        return ('    <aside class="callout callout-%s" role="note"><p class="callout-title">%s</p><p>%s</p></aside>'
                % (k, esc(title), clean_rich_text(block.get("html", ""))))
    if kind == "code":
        lang = re.sub(r"[^a-z0-9+#-]", "", str(block.get("language", "")).lower())[:20]
        return ('    <figure class="code-block"%s><figcaption>%s</figcaption><pre tabindex="0"><code>%s</code></pre></figure>'
                % (' data-lang="%s"' % lang if lang else "", esc(lang or "code"), esc(block.get("code", ""))))
    if kind == "checklist":
        items = "".join('<li><span class="check" aria-hidden="true"></span>%s</li>' % clean_rich_text(i)
                        for i in block.get("items", []) if plain_text(i))
        return '    <ul class="checklist">%s</ul>' % items
    if kind == "steps":
        items = "".join('<li><p class="step-title">%s</p><p>%s</p></li>' % (esc(s.get("title", "")), clean_rich_text(s.get("html", "")))
                        for s in block.get("items", []))
        return '    <ol class="steps">%s</ol>' % items
    if kind == "flow":
        items = "".join("<li>%s</li>" % esc(s) for s in block.get("items", []) if str(s).strip())
        cap = plain_text(block.get("caption", ""))
        return '    <figure class="flow"><ol>%s</ol>%s</figure>' % (items, "<figcaption>%s</figcaption>" % esc(cap) if cap else "")
    if kind == "chart":
        bars = block.get("bars", [])
        top = max([float(b.get("value", 0)) for b in bars] + [1])
        unit = esc(block.get("unit", ""))
        rows = "".join('<li><span class="bar-label">%s</span><span class="bar-track"><span class="bar-fill" data-pct="%d"></span></span>'
                       '<span class="bar-value">%s%s</span></li>' % (esc(b.get("label", "")), round(float(b.get("value", 0)) * 100 / top),
                                                                    esc(b.get("value", "")), unit) for b in bars)
        src = block.get("source") or {}
        source = ('<figcaption>Source: <a href="%s" rel="noopener">%s</a></figcaption>' % (esc(safe_href(src.get("url", ""))), esc(src.get("title", "")))
                  if src.get("url") else "")
        return '    <figure class="chart"><p class="chart-title">%s</p><ul>%s</ul>%s</figure>' % (esc(block.get("title", "")), rows, source)
    if kind == "references":
        items = "".join('<li><a href="%s" rel="noopener">%s</a>%s</li>' % (
            esc(safe_href(r.get("url", ""))), esc(r.get("title", "")), (" — " + esc(r["publisher"])) if r.get("publisher") else "")
            for r in block.get("items", []) if str(r.get("url", "")).startswith("https://"))
        return '    <section class="references" aria-labelledby="refs"><h2 id="refs">References</h2><ol>%s</ol></section>' % items
    return ""


def validate_block(block):
    """Errors for one rich block (empty list = fine)."""
    kind, errs = block.get("type"), []
    if kind == "table":
        n = len(block.get("headers", []))
        if not n:
            errs.append("table needs headers")
        if not block.get("caption"):
            errs.append("table needs a caption")
        if any(len(r) != n for r in block.get("rows", [])):
            errs.append("every table row needs %d cells" % n)
    elif kind == "references":
        if any(not str(r.get("url", "")).startswith("https://") for r in block.get("items", [])):
            errs.append("every reference needs an https address")
    elif kind == "chart":
        if not (block.get("source") or {}).get("url"):
            errs.append("a chart needs a source with an address (no unsourced numbers)")
    elif kind in ("checklist", "steps", "flow") and not block.get("items"):
        errs.append("%s needs items" % kind)
    elif kind == "callout" and not plain_text(block.get("html", "")):
        errs.append("callout needs text")
    return errs


# ── Reading information ─────────────────────────────────────────────────────
def word_count(blocks):
    """Words in the article text only: headings, paragraphs, lists, tables, callouts, steps, FAQs.
    Code, references and interface labels are not counted."""
    n = 0
    for b in blocks:
        t = b.get("type")
        if t == "heading":
            n += _words(b.get("text", ""))
        elif t in ("paragraph", "callout"):
            n += _words(b.get("html", "")) + _words(b.get("title", ""))
        elif t in ("list", "checklist", "flow"):
            n += sum(_words(i) for i in b.get("items", []))
        elif t == "steps":
            n += sum(_words(s.get("title", "")) + _words(s.get("html", "")) for s in b.get("items", []))
        elif t == "table":
            n += _words(b.get("caption", "")) + sum(_words(h) for h in b.get("headers", []))
            n += sum(_words(c) for r in b.get("rows", []) for c in r)
        elif t == "faq":
            n += _words(b.get("question", "")) + _words(b.get("answer", ""))
    return n


def reading_minutes(blocks):
    visuals = sum(1 for b in blocks if b.get("type") in ("image", "chart", "flow"))
    return max(1, math.ceil((word_count(blocks) / WORDS_PER_MINUTE) + visuals * SECONDS_PER_VISUAL / 60.0))


# ── Contents (H2 and H3) ────────────────────────────────────────────────────
def with_toc(body):
    """Give every h2/h3 an id. Returns (body, toc_html). toc_html is "" with fewer than 3 sections."""
    used = set()

    def slug(text):
        s = re.sub(r"[^a-z0-9]+", "-", plain_text(text).lower()).strip("-")[:60] or "section"
        base, i = s, 2
        while s in used:
            s, i = "%s-%d" % (base, i), i + 1
        used.add(s)
        return s
    items = []

    def repl(m):
        level, attrs, text = m.group(1), m.group(2), m.group(3)
        if "id=" in attrs:
            return m.group(0)
        sid = slug(text)
        items.append((int(level), sid, text))
        return '<h%s id="%s"%s>%s</h%s>' % (level, sid, attrs, text, level)
    body = re.sub(r"<h([23])([^>]*)>(.*?)</h\1>", repl, body)
    if sum(1 for i in items if i[0] == 2) < 3:
        return body, ""
    out, open_sub = [], False
    for level, sid, text in items:
        if level == 2:
            if open_sub:
                out.append("</ol></li>")
                open_sub = False
            elif out:
                out.append("</li>")
            out.append('<li><a href="#%s">%s</a>' % (sid, text))
        else:
            if not out:
                continue
            if not open_sub:
                out.append("<ol>")
                open_sub = True
            out.append('<li><a href="#%s">%s</a></li>' % (sid, text))
    out.append("</ol></li>" if open_sub else "</li>")
    toc = ('<nav class="art-toc" aria-label="On this page"><details open><summary>On this page</summary><ol>%s</ol></details></nav>'
           % "".join(out))
    return body, toc


# ── Helpers shared by the listing pages ─────────────────────────────────────
def info(page):
    return page.get("article") or {}


def url_of(page):
    return "/" + page["slug"].strip("/") + "/"


def h1_of(page):
    return next((b.get("text", "") for b in page.get("blocks", []) if b.get("type") == "heading" and int(b.get("level", 2)) == 1),
                page.get("title", ""))


def nice_date(iso):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", str(iso or ""))
    if not m:
        return ""
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return "%d %s %s" % (int(m.group(3)), months[int(m.group(2)) - 1], m.group(1))


def sort_articles(articles):
    return sorted(articles, key=lambda p: (info(p).get("published", ""), p["slug"]), reverse=True)


def card(page, heading="h3"):
    a = info(page)
    mins = reading_minutes(page.get("blocks", []))
    draft = '<span class="draft-chip">Draft</span>' if page.get("draft") else ""
    return ('<article class="post-card" data-category="%s"><a class="post-link" href="%s">'
            '<span class="post-thumb post-thumb-%s" aria-hidden="true"></span>'
            '<span class="post-cat">%s%s</span><%s class="post-title">%s</%s><span class="post-desc">%s</span>'
            '<span class="post-meta"><time datetime="%s">%s</time> · %d min read</span></a></article>') % (
        esc(a.get("category", "")), esc(url_of(page)), esc(_section_key(a.get("section", ""))),
        esc(a.get("category", "")), draft, heading, esc(h1_of(page)), heading,
        esc(a.get("summary") or page.get("description", "")), esc(a.get("published", "")), esc(nice_date(a.get("published"))), mins)


def _section_key(section):
    return re.sub(r"[^a-z]+", "-", str(section).lower()).strip("-") or "seo"


# ── Article page ────────────────────────────────────────────────────────────
def article_body(page, render_block_fn, articles, tools_data, tool_href, preview=False):
    a = info(page)
    blocks = page.get("blocks", [])
    words, mins = word_count(blocks), reading_minutes(blocks)
    body = "\n".join(render_block_fn(b) for b in blocks if not (b.get("type") == "heading" and int(b.get("level", 2)) == 1))
    body, toc = with_toc(body)

    tools = {t["slug"]: t for t in tools_data.get("tools", [])}
    parts = []
    if a.get("takeaways"):
        parts.append('<aside class="callout callout-takeaway" role="note"><p class="callout-title">Key takeaways</p><ul>%s</ul></aside>'
                     % "".join("<li>%s</li>" % clean_rich_text(t) for t in a["takeaways"]))
    rel_tools = [tools[s] for s in a.get("related_tools", []) if s in tools]
    if rel_tools:
        parts.append('<section class="art-tools" aria-labelledby="try-tools"><h2 id="try-tools">Check it with a free tool</h2><ul>%s</ul></section>'
                     % "".join('<li><a href="%s"><b>%s</b><span>%s</span></a></li>' % (esc(tool_href(t)), esc(t["name"]), esc(t.get("summary", "")))
                               for t in rel_tools))
    parts.append(share_links(page))

    ordered = sort_articles(articles)
    others = [p for p in ordered if p["slug"] != page["slug"]]
    same = [p for p in others if info(p).get("category") == a.get("category")]
    tags = set(a.get("tags", []))
    related = (same + [p for p in others if p not in same and tags & set(info(p).get("tags", []))]
               + [p for p in others if p not in same])[:3]
    if related:
        parts.append('<section class="art-related" aria-labelledby="related"><h2 id="related">Related articles</h2><div class="post-grid">%s</div></section>'
                     % "".join(card(p) for p in related))
    i = next((n for n, p in enumerate(ordered) if p["slug"] == page["slug"]), None)
    if i is not None and len(ordered) > 1:
        newer = ordered[i - 1] if i > 0 else None
        older = ordered[i + 1] if i + 1 < len(ordered) else None
        nav = []
        if older:
            nav.append('<a class="pn-prev" href="%s"><small>Previous article</small><b>%s</b></a>' % (esc(url_of(older)), esc(h1_of(older))))
        if newer:
            nav.append('<a class="pn-next" href="%s"><small>Next article</small><b>%s</b></a>' % (esc(url_of(newer)), esc(h1_of(newer))))
        parts.append('<nav class="prev-next" aria-label="More articles">%s</nav>' % "".join(nav))

    meta = []
    if a.get("author"):
        meta.append("By %s" % esc(a["author"]))
    if a.get("published"):
        meta.append('Published <time datetime="%s">%s</time>' % (esc(a["published"]), esc(nice_date(a["published"]))))
    if a.get("updated") and a.get("updated") != a.get("published"):
        meta.append('Updated <time datetime="%s">%s</time>' % (esc(a["updated"]), esc(nice_date(a["updated"]))))
    meta.append("%d min read" % mins)
    meta.append("%s words" % format(words, ","))
    banner = ('<p class="draft-banner" role="status">Draft preview: this article is not published and is hidden from search engines.</p>'
              if page.get("draft") else "")
    return ('<div class="art-progress" aria-hidden="true"><span></span></div>'
            '<article class="art" data-reading>%(banner)s'
            '<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/blog/">Blog</a></li>'
            '<li aria-current="page">%(cat)s</li></ol></nav>'
            '<header class="art-head"><p class="art-cat">%(cat)s</p><h1>%(h1)s</h1><p class="art-lead">%(lead)s</p>'
            '<p class="art-meta">%(meta)s</p></header>'
            '<div class="art-layout">%(toc)s<div class="art-body">%(body)s%(end)s</div></div></article>') % {
        "banner": banner, "cat": esc(a.get("category", "Article")), "h1": esc(h1_of(page)),
        "lead": esc(a.get("summary") or page.get("description", "")), "meta": " · ".join(meta),
        "toc": toc, "body": body, "end": "".join(parts)}


SHARE = [("LinkedIn", "linkedin", "https://www.linkedin.com/sharing/share-offsite/?url=%(u)s"),
         ("X", "x", "https://twitter.com/intent/tweet?url=%(u)s&text=%(t)s"),
         ("Facebook", "facebook", "https://www.facebook.com/sharer/sharer.php?u=%(u)s")]


def share_links(page):
    """Plain share links built at runtime from the page address (js/article.js fills in the address,
    so no site address is hard-coded). Without JavaScript the block stays hidden."""
    title = h1_of(page)
    links = "".join('<li><a data-share="%s" data-title="%s" href="#" rel="noopener" target="_blank" aria-label="Share on %s">%s<span>%s</span></a></li>'
                    % (esc(tpl), esc(title), esc(name), social_icon(key), esc(name)) for name, key, tpl in SHARE)
    return '<section class="share" aria-label="Share this article" hidden><p>Share this article</p><ul>%s</ul></section>' % links


# ── Social icons (simple inline marks; no outside requests) ─────────────────
_ICONS = {
    "linkedin": '<rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor"/><path d="M7 10v7M7 7v.01M11 17v-7M11 13.5c0-2 1.2-3.5 3-3.5s2.5 1.2 2.5 3.2V17" stroke="var(--icon-on, #fff)" stroke-width="2" stroke-linecap="round" fill="none"/>',
    "facebook": '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M13.5 21v-7h2.3l.4-2.8h-2.7V9.5c0-.8.3-1.4 1.4-1.4h1.4V5.6c-.3 0-1.1-.1-2-.1-2 0-3.4 1.2-3.4 3.5v2.2H8.6V14h2.3v7" fill="var(--icon-on, #fff)"/>',
    "instagram": '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>',
    "x": '<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    "youtube": '<rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor"/><path d="M10 9v6l5-3z" fill="var(--icon-on, #fff)"/>',
    "github": '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 19v-2.5c0-1 .3-1.6.8-2-2.6-.3-4.3-1.3-4.3-4.3 0-.9.3-1.7.9-2.3-.1-.3-.4-1.2.1-2.4 0 0 .8-.2 2.5.9a8.5 8.5 0 0 1 4.6 0c1.7-1.1 2.5-.9 2.5-.9.5 1.2.2 2.1.1 2.4.6.6.9 1.4.9 2.3 0 3-1.7 4-4.3 4.3.5.4.8 1.1.8 2.1V19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
}


def social_icon(key):
    path = _ICONS.get(key)
    return '<svg class="soc-ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">%s</svg>' % path if path else ""


def platform_key(item):
    key = str(item.get("platform") or item.get("label") or "").lower().replace(" ", "")
    return {"twitter": "x", "x(twitter)": "x"}.get(key, key)


# ── Blog listing ────────────────────────────────────────────────────────────
def blog_body(articles):
    ordered = sort_articles(articles)
    if not ordered:
        return ('<section class="hub-hero"><p class="hub-kicker">Blog</p><h1>SEO and digital marketing articles</h1>'
                '<p>Our first articles are being written and checked. Meanwhile, try the <a href="/tools/">free SEO tools</a> '
                'or read the <a href="/docs/">documentation</a>.</p></section>')
    featured = [p for p in ordered if info(p).get("featured")][:1]
    cats = sorted({info(p).get("category", "") for p in ordered if info(p).get("category")})
    chips = '<button type="button" class="chip is-on" data-filter="">All</button>' + "".join(
        '<button type="button" class="chip" data-filter="%s">%s</button>' % (esc(c), esc(c)) for c in cats)
    feat = ""
    if featured:
        f = featured[0]
        feat = ('<section class="blog-featured" aria-label="Featured article">%s</section>' % card(f, "h2")).replace("post-card", "post-card is-featured", 1)
    return ('<section class="hub-hero"><p class="hub-kicker">Blog</p><h1>SEO and digital marketing articles</h1>'
            '<p>Practical, sourced guides on technical SEO, AI search and website optimisation, each linked to a free tool you can use straight away.</p>'
            '<form class="hub-search" role="search" data-list-search><label class="amk-sr" for="blog-q">Search articles</label>'
            '<input id="blog-q" type="search" placeholder="Search articles" autocomplete="off" /></form></section>'
            '%s<section aria-labelledby="latest"><div class="hub-head"><h2 id="latest">Latest articles</h2>'
            '<div class="chips" role="group" aria-label="Filter by category" hidden>%s</div></div>'
            '<div class="post-grid" data-list>%s</div><p class="no-results" hidden>No articles match your search.</p></section>') % (
        feat, chips, "".join(card(p) for p in ordered))


# ── Resources hub ───────────────────────────────────────────────────────────
def resources_body(articles, docs_pages, tools_data, tool_href):
    ordered = sort_articles(articles)
    by_cat = {}
    for p in ordered:
        by_cat.setdefault((info(p).get("section", "SEO"), info(p).get("category", "")), []).append(p)
    cat_cards = []
    for section in SECTIONS:
        for (sec, cat), items in sorted(by_cat.items()):
            if sec == section and cat and len(items) >= MIN_PER_CATEGORY:
                cat_cards.append('<a class="topic-card" href="/blog/#%s"><small>%s</small><b>%s</b><span>%d articles</span></a>'
                                 % (esc(re.sub(r"[^a-z0-9]+", "-", cat.lower())), esc(section), esc(cat), len(items)))
    topics = ('<section aria-labelledby="topics"><h2 id="topics">Topics</h2><div class="topic-grid">%s</div></section>'
              % "".join(cat_cards)) if cat_cards else ""
    latest = ('<section aria-labelledby="latest"><div class="hub-head"><h2 id="latest">Latest articles</h2><a href="/blog/">All articles</a></div>'
              '<div class="post-grid">%s</div></section>' % "".join(card(p) for p in ordered[:6])) if ordered else ""
    guides = [p for p in docs_pages if p["slug"] != "docs"][:6]
    guide_cards = "".join('<a class="topic-card" href="%s"><small>Guide</small><b>%s</b><span>%d min read</span></a>'
                          % (esc(url_of(p)), esc(h1_of(p)), reading_minutes(p.get("blocks", []))) for p in guides)
    tools = tools_data.get("tools", [])[:6]
    tool_cards = "".join('<a class="topic-card" href="%s"><small>Free tool</small><b>%s</b><span>%s</span></a>'
                         % (esc(tool_href(t)), esc(t["name"]), esc(t.get("summary", ""))) for t in tools)
    return ('<section class="hub-hero"><p class="hub-kicker">Resources</p><h1>Learn SEO, AI search and website optimisation</h1>'
            '<p>Guides, articles and documentation that explain how search works and how to fix what our free tools find.</p>'
            '<form class="hub-search" role="search" data-site-search><label class="amk-sr" for="site-q">Search guides, articles and tools</label>'
            '<input id="site-q" type="search" placeholder="Search guides, articles and tools" autocomplete="off" />'
            '<ul class="search-results" aria-live="polite"></ul></form></section>'
            '%s%s<section aria-labelledby="guides"><div class="hub-head"><h2 id="guides">Guides and documentation</h2>'
            '<a href="/docs/">All documentation</a></div><div class="topic-grid">%s</div></section>'
            '<section aria-labelledby="tools-h"><div class="hub-head"><h2 id="tools-h">Free tools to put it into practice</h2>'
            '<a href="/tools/">All tools</a></div><div class="topic-grid">%s</div></section>') % (topics, latest, guide_cards, tool_cards)


# ── Docs help centre ────────────────────────────────────────────────────────
DOC_GROUPS = [
    ("Getting started", ["docs/how-to-use-the-free-tools", "docs/seo-starter-guide", "docs/tools/usage-limits"]),
    ("Tool guides", "docs/tools/"),
    ("Search guides", None),
]


def docs_nav(docs_pages, current_slug):
    """Sidebar groups: getting started, one page per tool, then every other guide."""
    by_slug = {p["slug"]: p for p in docs_pages}
    used, groups = {"docs"}, []
    for title, rule in DOC_GROUPS:
        if isinstance(rule, list):
            items = [by_slug[s] for s in rule if s in by_slug]
        elif isinstance(rule, str):
            items = sorted([p for p in docs_pages if p["slug"].startswith(rule) and p["slug"] not in used], key=h1_of)
        else:
            items = sorted([p for p in docs_pages if p["slug"] not in used], key=h1_of)
        used.update(p["slug"] for p in items)
        if items:
            groups.append((title, items))
    flat = [p for _, items in groups for p in items]
    html_groups = "".join('<p class="docs-gtitle">%s</p><ul>%s</ul>' % (esc(t), "".join(
        '<li><a href="%s"%s>%s</a></li>' % (esc(url_of(p)), ' aria-current="page"' if p["slug"] == current_slug else "", esc(_short_title(p)))
        for p in items)) for t, items in groups)
    return html_groups, flat


def _short_title(p):
    return re.sub(r"\s*[:|].*$", "", h1_of(p)) or h1_of(p)


def docs_shell(page, body, docs_pages):
    nav, flat = docs_nav(docs_pages, page["slug"])
    blocks = page.get("blocks", [])
    mins = reading_minutes(blocks)
    i = next((n for n, p in enumerate(flat) if p["slug"] == page["slug"]), None)
    pn = []
    if i is not None:
        if i > 0:
            pn.append('<a class="pn-prev" href="%s"><small>Previous</small><b>%s</b></a>' % (esc(url_of(flat[i - 1])), esc(_short_title(flat[i - 1]))))
        if i + 1 < len(flat):
            pn.append('<a class="pn-next" href="%s"><small>Next</small><b>%s</b></a>' % (esc(url_of(flat[i + 1])), esc(_short_title(flat[i + 1]))))
    crumbs = ('<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/docs/">Documentation</a></li>'
              '<li aria-current="page">%s</li></ol></nav>' % esc(_short_title(page))) if page["slug"] != "docs" else ""
    meta = '<p class="art-meta">%d min read</p>' % mins if page["slug"] != "docs" else ""
    # the reading time goes right after the page title
    body = re.sub(r"(</h1>)", r"\1" + meta, body, count=1)
    return ('<div class="art-progress" aria-hidden="true"><span></span></div><div class="docs">'
            '<aside class="docs-side" aria-label="Documentation"><details class="docs-menu" open><summary>Documentation menu</summary>'
            '<form class="hub-search docs-search" role="search" data-site-search><label class="amk-sr" for="docs-q">Search the documentation</label>'
            '<input id="docs-q" type="search" placeholder="Search" autocomplete="off" /><ul class="search-results" aria-live="polite"></ul></form>'
            '%s</details></aside><div class="docs-main" data-reading>%s%s%s</div></div>') % (
        nav, crumbs, body, '<nav class="prev-next" aria-label="More documentation">%s</nav>' % "".join(pn) if pn else "")


def tool_doc_page(tool, tool_href, limits):
    """A documentation page for one tool, built only from what content/tools.json says the tool does."""
    slug = tool["slug"]
    caps = (limits.get("tools", {}) or {}).get(slug, {})
    daily = (limits.get("free", {}) or {}).get("daily")
    limit_text = "Free runs are shared across all tools%s." % (" (%d per day)" % daily if daily else "")
    if caps.get("daily"):
        limit_text += " This tool also has its own cap of %d runs per day." % caps["daily"]
    blocks = [
        {"type": "heading", "level": 1, "text": "%s: how to use it" % tool["name"]},
        {"type": "paragraph", "html": esc(tool.get("summary", ""))},
        {"type": "heading", "level": 2, "text": "What it does"},
        {"type": "paragraph", "html": esc(tool.get("intro", tool.get("summary", "")))},
        {"type": "heading", "level": 2, "text": "How to use it"},
        {"type": "steps", "items": [
            {"title": "Open the tool", "html": 'Go to <a href="%s">%s</a>.' % (esc(tool_href(tool)), esc(tool["name"]))},
            {"title": "Enter an address", "html": "Type a full address, for example <code>%s</code>." % esc(tool.get("placeholder", "https://example.com"))},
            {"title": "Run the check", "html": "Click <strong>%s</strong> and wait a few seconds." % esc(tool.get("button", "Check"))},
            {"title": "Read the result", "html": "Each part of the result is explained on the page. Fix the items marked as problems first."}]},
        {"type": "heading", "level": 2, "text": "What the result shows"},
        {"type": "list", "items": [esc(w) for w in tool.get("what", [])]},
        {"type": "heading", "level": 2, "text": "Limits"},
        {"type": "paragraph", "html": esc(limit_text) + " Results for the same address are saved for 24 hours, and a saved result does not use a run."},
        {"type": "callout", "kind": "tip", "html": "Test the exact page you care about, including <code>https://</code>. A different address, such as without <code>www</code>, can give a different result."},
    ]
    return {"slug": "docs/tools/%s" % slug, "title": "%s Guide | AMK Digital Agency" % tool["name"],
            "description": "How to use the free %s: what it checks, how to run it and how to read the result." % tool["name"],
            "blocks": blocks, "schema": ["Article", "BreadcrumbList"], "generated": True}


def usage_doc_page(limits):
    """Help page about free runs, built from content/limits.json so it always matches the real limits."""
    free = limits.get("free", {}) or {}
    caps = limits.get("tools", {}) or {}
    rows = []
    if free.get("daily"):
        rows.append(["All tools, per day", str(free["daily"]), "Midnight UTC"])
    if free.get("monthly"):
        rows.append(["All tools, per month", str(free["monthly"]), "1st of the month, midnight UTC"])
    names = {"links": "Link Checker", "domain-overview": "Domain Overview"}
    for slug, c in sorted(caps.items()):
        if c.get("daily"):
            rows.append(["%s, per day" % names.get(slug, slug.replace("-", " ").title()), str(c["daily"]), "Midnight UTC"])
    blocks = [
        {"type": "heading", "level": 1, "text": "Free runs and limits"},
        {"type": "paragraph", "html": "Every free tool on this website runs a real check. To keep the tools fast and fair for everyone, each visitor gets a number of free runs."},
        {"type": "heading", "level": 2, "text": "How many free runs you get"},
        {"type": "table", "caption": "Free run limits", "headers": ["Limit", "Runs", "Resets"], "rows": rows, "align": ["left", "right", "left"]},
        {"type": "paragraph", "html": "The panel under each tool shows how many runs you have left now, which limit runs out first, and when it resets."},
        {"type": "heading", "level": 2, "text": "What does not use a run"},
        {"type": "list", "items": ["Opening a saved result: results for the same address are kept for 24 hours.",
                                   "Tools that work in your browser only, such as the Title Generator."]},
        {"type": "heading", "level": 2, "text": "When you reach a limit"},
        {"type": "paragraph", "html": "The tool tells you which limit was reached and shows a countdown until it resets. Your free runs come back automatically; you do not need to do anything."},
        {"type": "callout", "kind": "note", "html": "A short security check from Cloudflare runs in the background to keep automated traffic out. Most visitors never see it."},
    ]
    return {"slug": "docs/tools/usage-limits", "title": "Free Runs and Limits | AMK Digital Agency",
            "description": "How many free tool runs you get each day and month, what does not use a run, and when your free runs reset.",
            "blocks": blocks, "schema": ["Article", "BreadcrumbList"], "generated": True}


# ── Search index ────────────────────────────────────────────────────────────
def search_index(articles, docs_pages, tools_data, tool_href):
    out = []
    for p in sort_articles(articles):
        if p.get("draft"):
            continue
        out.append({"t": h1_of(p), "u": url_of(p), "d": info(p).get("summary") or p.get("description", ""), "k": "Article",
                    "c": info(p).get("category", "")})
    for p in docs_pages:
        out.append({"t": _short_title(p), "u": url_of(p), "d": p.get("description", ""), "k": "Guide", "c": "Documentation"})
    for t in tools_data.get("tools", []):
        out.append({"t": t["name"], "u": tool_href(t), "d": t.get("summary", ""), "k": "Tool", "c": "Free tools"})
    return out
