"""AMK Digital Agency Website: designed layouts built from existing content.

  nav_html()          the one shared header (Home, Tools, Resources, Contact Us) for every page
  designed_body()     Home / Company: turns the CMS blocks into hero, statement, feature cards,
                      service cards, tools, stats and a call-to-action band. The words stay the
                      owner's published words (edited in the CMS); only the presentation changes.
  contact_body()      the Contact page (form uses the existing secure request endpoint)
  add_toc()           "On this page" links for long documentation pages
Everything is plain HTML with classes (no inline styles), so the strict page policy keeps working.
"""
import html
import re

from sanitize import clean_rich_text, plain_text, safe_href


def esc(t):
    return html.escape(str(t), quote=True)


# ── Small line icons (drawn here, 24x24, stroke uses currentColor) ─────────
_P = {
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    "globe": '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>',
    "spark": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
    "chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/>',
    "target": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    "compass": '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    "flag": '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    "shield": '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    "layers": '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    "file": '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    "code": '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    "book": '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/>',
    "building": '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>',
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    "briefcase": '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
    "chat": '<path d="M4 5h16v11H9l-5 4z"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "arrow": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "gauge": '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.5-5"/><path d="M8 20h8"/>',
    "image": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5.5-5.5L5 20"/>',
    "redirect": '<path d="M4 7h11a4 4 0 0 1 0 8H8"/><path d="M11 12l-3 3 3 3"/>',
    "lock": '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    "robot": '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
    "headings": '<path d="M5 5v14M13 5v14M5 12h8M17 9l2-1.5V19"/>',
    "density": '<path d="M4 6h16M4 10h10M4 14h16M4 18h7"/>',
    "compare": '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
    "pen": '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
}


# Logo A (rising line). Inline, so the line can draw itself in once on load (css/motion.css).
LOGO_SVG = ('<svg class="amk-logo" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true" focusable="false">'
            '<rect width="64" height="64" rx="14" fill="#4f46e5"/>'
            '<path class="amk-logo-line" d="M15 46 L27 22 L36 37 L48 19" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" pathLength="100"/>'
            '<circle class="amk-logo-dot" cx="48" cy="19" r="4.75" fill="#38bdf8"/></svg>')


def icon(name, cls="ic"):
    return ('<svg class="%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">%s</svg>'
            % (cls, _P.get(name, _P["spark"])))


TOOL_ICONS = {"domain-overview": "globe", "website-comparison": "compare", "technology": "code", "ssl-check": "lock",
              "robots-sitemap": "robot", "meta-tags": "file", "headings": "headings", "images": "image", "links": "link",
              "redirects": "redirect", "schema-social": "layers", "keyword-density": "density", "title-generator": "pen"}
SERVICE_ICONS = [("ai", "spark"), ("geo", "spark"), ("seo", "search"), ("ads", "chart"), ("social", "chart"), ("email", "mail"),
                 ("lead", "target"), ("strategy", "compass"), ("research", "compass"), ("crawl", "search"),
                 ("e-e-a-t", "shield"), ("credib", "shield"), ("generative", "spark")]


def guess_icon(title, fallback="spark"):
    low = title.lower()
    for key, name in SERVICE_ICONS:
        if key in low:
            return name
    return fallback


def tool_href(t):
    return t.get("page") or "/tools/%s.html" % t["slug"]


# ═══ Navigation ═══════════════════════════════════════════════════════════
def nav_html(site_name, tools_data, current, live_paths=()):
    """current = the page's address ('/', '/tools/', '/tools/meta-tags.html', '/docs/x/', ...)."""
    tools = {t["slug"]: t for t in tools_data.get("tools", [])}

    def cur(href):
        return ' aria-current="page"' if href == current else ""

    def is_under(prefixes):
        return any(current == p or (p.endswith("/") and current.startswith(p)) for p in prefixes)

    tool_paths = ["/tools/"] + [tool_href(t) for t in tools.values()]
    resource_paths = ["/docs/", "/company/", "/owner/", "/showcase/", "/resources.html"]

    groups = []
    for g in tools_data.get("groups", []):
        items = []
        for slug in g.get("tools", []):
            t = tools.get(slug)
            if not t:
                continue
            href = tool_href(t)
            items.append('<li><a class="amk-mi" href="%s"%s>%s<span><b>%s</b><small>%s</small></span></a></li>' % (
                esc(href), cur(href), icon(TOOL_ICONS.get(slug, "search")), esc(t["name"]), esc(_short(t.get("summary", ""), 60))))
        groups.append('<div class="amk-mgroup"><p class="amk-mtitle">%s</p><ul>%s</ul></div>' % (esc(g["name"]), "".join(items)))

    resources = [
        ("/docs/", "book", "Documentation", "Search and SEO guides"),
        ("/docs/how-to-use-the-free-tools/", "file", "How to use the tools", "Step-by-step help"),
        ("/docs/seo-starter-guide/", "compass", "SEO starter guide", "Where to begin"),
        ("/company/", "building", "Company", "Vision, purpose and goals"),
        ("/owner/", "user", "About the founder", "Experience and expertise"),
    ]
    if "/showcase/" in live_paths:
        resources.append(("/showcase/", "briefcase", "Our work", "Experience across project types"))
    res_items = "".join('<li><a class="amk-mi" href="%s"%s>%s<span><b>%s</b><small>%s</small></span></a></li>' % (
        esc(h), cur(h), icon(ic), esc(n), esc(s)) for h, ic, n, s in resources)

    def top(href, label, under=None):
        active = " is-active" if (href == current or (under and is_under(under))) else ""
        return '<a class="amk-nl%s" href="%s"%s>%s</a>' % (active, esc(href), cur(href), esc(label))

    return '''<header class="amk-nav" data-amk-nav>
    <div class="amk-nav-inner">
      <a class="amk-brand" href="/">%(logo)s <span>%(site)s</span></a>
      <button type="button" class="amk-burger" aria-expanded="false" aria-controls="amk-nav-menu" aria-label="Open menu"><span></span><span></span><span></span></button>
      <nav id="amk-nav-menu" class="amk-menu" aria-label="Main">
        <ul class="amk-top">
          <li>%(home)s</li>
          <li class="amk-dd">
            %(tools)s<button type="button" class="amk-caret" aria-expanded="false" aria-label="Show the tools menu">%(chev)s</button>
            <div class="amk-panel amk-panel-wide">
              <a class="amk-feature" href="/tools/domain-overview.html">%(globe)s<b>Domain Overview</b><span>One report for a whole website: SEO health, security, crawl rules and registration.</span><em>Open the tool %(arrow)s</em></a>
              <div class="amk-mgroups">%(groups)s</div>
              <a class="amk-all" href="/tools/">See all tools %(arrow)s</a>
            </div>
          </li>
          <li class="amk-dd">
            %(res)s<button type="button" class="amk-caret" aria-expanded="false" aria-label="Show the resources menu">%(chev)s</button>
            <div class="amk-panel">
              <ul class="amk-mlist">%(res_items)s</ul>
            </div>
          </li>
          <li>%(contact)s</li>
        </ul>
        <div class="amk-actions">
          <a class="amk-cta" href="/tools/">Free tools</a>
          <button type="button" class="theme-toggle-btn" aria-label="Toggle light or dark theme">Theme</button>
        </div>
      </nav>
    </div>
  </header>''' % {
        "site": esc(site_name), "logo": LOGO_SVG, "home": top("/", "Home"), "tools": top("/tools/", "Tools", tool_paths),
        "res": top("/docs/", "Resources", resource_paths), "contact": top("/contact/", "Contact Us"),
        "chev": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        "arrow": icon("arrow", "ic ic-s"), "globe": icon("globe", "ic ic-l"), "groups": "".join(groups), "res_items": res_items}


def footer_html(settings, tools_data, live_paths, year):
    """One footer for every page: call to action, brand, link columns, contact and social links.
    Contact details and social links come from content/settings.json; empty ones are left out."""
    tools = {t["slug"]: t for t in tools_data.get("tools", [])}
    tool_links = [(tool_href(tools[s]), tools[s]["name"]) for s in
                  ("domain-overview", "website-comparison", "meta-tags", "links", "ssl-check") if s in tools]
    tool_links.append(("/tools/", "All free tools"))
    resources = [("/docs/", "Documentation"), ("/docs/how-to-use-the-free-tools/", "How to use the tools"),
                 ("/docs/seo-starter-guide/", "SEO starter guide")]
    company = [("/company/", "About the company"), ("/owner/", "About the founder")]
    if "/showcase/" in live_paths:
        company.append(("/showcase/", "Our work"))
    company.append(("/contact/", "Contact us"))

    def col(title, links):
        return '<div class="amk-fcol"><p class="amk-ftitle">%s</p><ul>%s</ul></div>' % (
            esc(title), "".join('<li><a href="%s">%s</a></li>' % (esc(h), esc(n)) for h, n in links))

    contact = settings.get("contact", {}) or {}
    reach = []
    email = str(contact.get("email", "")).strip()
    if re.fullmatch(r"[^@\s<>\"]+@[^@\s<>\"]+\.[A-Za-z]{2,}", email):
        reach.append('<li><a href="mailto:%s">%s%s</a></li>' % (esc(email), icon("mail", "ic ic-s"), esc(email)))
    phone = str(contact.get("phone", "")).strip()
    if re.fullmatch(r"\+?[0-9 ()-]{6,20}", phone):
        reach.append('<li><a href="tel:%s">%s</a></li>' % (esc(re.sub(r"[^0-9+]", "", phone)), esc(phone)))
    reach.append('<li><a href="/contact/">%sSend us a message</a></li>' % icon("arrow", "ic ic-s"))
    social = "".join(
        '<li><a href="%s" rel="noopener me" target="_blank">%s<span class="amk-sr"> (opens in a new tab)</span></a></li>'
        % (esc(i["url"]), esc(i.get("label", "")))
        for i in settings.get("social", [])
        if re.match(r"^https://[^\s\"<>]+$", str(i.get("url", ""))) and i.get("label"))
    legal = "".join(' <a href="%s">%s</a>' % (esc(i["href"]), esc(i["label"]))
                    for i in settings.get("footer_links", [])
                    if i.get("page") is None or "/%s/" % i["page"] in live_paths)
    about = (settings.get("organization", {}) or {}).get("description", "")

    parts = {
        "logo": LOGO_SVG, "site": esc(settings.get("site_name", "")), "about": esc(about),
        "social": ('<ul class="amk-social" aria-label="Follow us">%s</ul>' % social) if social else "",
        "tools": col("Free tools", tool_links), "resources": col("Resources", resources),
        "company": col("Company", company), "reach": "".join(reach), "year": year, "legal": legal}
    return (
        '<footer class="amk-footer">\n'
        '    <section class="amk-fcta" aria-label="Get started">\n'
        '      <div>\n'
        '        <p class="amk-fcta-title">Check your website for free</p>\n'
        '        <p class="amk-fcta-text">Run a real SEO check on any website, or tell us what you need help with.</p>\n'
        '      </div>\n'
        '      <div class="amk-fcta-actions">\n'
        '        <a class="amk-fbtn" href="/tools/domain-overview.html">Run a free check</a>\n'
        '        <a class="amk-fbtn amk-fbtn-ghost" href="/contact/">Contact us</a>\n'
        '      </div>\n'
        '    </section>\n'
        '    <div class="amk-fgrid">\n'
        '      <div class="amk-fbrand">\n'
        '        <a class="amk-brand" href="/">%(logo)s <span>%(site)s</span></a>\n'
        '        <p>%(about)s</p>\n'
        '        %(social)s\n'
        '      </div>\n'
        '      %(tools)s\n'
        '      %(resources)s\n'
        '      %(company)s\n'
        '      <div class="amk-fcol"><p class="amk-ftitle">Get in touch</p><ul>%(reach)s</ul></div>\n'
        '    </div>\n'
        '    <div class="amk-fbottom">\n'
        '      <span>&copy; %(year)s %(site)s</span>\n'
        '      <span class="amk-flegal">%(legal)s</span>\n'
        '    </div>\n'
        '  </footer>') % parts

def _short(text, n):
    text = re.sub(r"\s+", " ", str(text)).strip()
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


# ═══ Designed pages (Home, Company) ═══════════════════════════════════════
def _split(blocks):
    intro, sections, cur = [], [], None
    for b in blocks:
        if b.get("type") == "heading" and int(b.get("level", 2)) == 2:
            cur = {"title": b.get("text", "").strip(), "blocks": []}
            sections.append(cur)
        elif cur is None:
            intro.append(b)
        else:
            cur["blocks"].append(b)
    return intro, sections


def _kind(sec):
    bl = sec["blocks"]
    paras = [b for b in bl if b.get("type") == "paragraph"]
    if any(b.get("type") == "heading" and int(b.get("level", 3)) == 3 for b in bl):
        return "cards"
    if any("[TO BE CONFIRMED]" in b.get("html", "") for b in paras):
        return "cta"
    lists = [b for b in bl if b.get("type") == "list"]
    if lists and any('href="/tools/' in i for l in lists for i in l.get("items", [])):
        return "tools"
    if lists:
        return "features"
    if len([p for p in paras if "<a " not in p.get("html", "")]) == 1 and len(bl) == 1:
        return "single"
    return "statement"


def _button(b, cls="x-btn"):
    return '<a class="%s" href="%s">%s</a>' % (cls, esc(safe_href(b.get("href", ""))), esc(b.get("label", "")))


def _hero(intro, page_kind, secondary):
    h1 = next((b for b in intro if b.get("type") == "heading"), {"text": ""})
    paras = [b for b in intro if b.get("type") == "paragraph"]
    buttons = [b for b in intro if b.get("type") == "button" and b.get("label")]
    ctas = "".join(_button(b, "x-btn") for b in buttons[:1])
    if secondary:
        ctas += '<a class="x-btn x-btn-ghost" href="%s">%s</a>' % secondary
    lede = "".join('<p class="x-lede" data-mx="fade">%s</p>' % clean_rich_text(p.get("html", "")) for p in paras[:1])
    visual = _hero_stack() if page_kind == "home" else ""
    return ('<section class="x-hero%s">\n      <div class="x-hero-copy">\n        <p class="x-eyebrow" data-mx="fade">%s</p>\n'
            '        <h1 data-mx="rise">%s</h1>\n        %s\n        <div class="x-ctas" data-mx="fade">%s</div>\n      </div>%s\n    </section>'
            % (" x-hero-split" if visual else "", "Conversion SEO, AEO and GEO" if page_kind == "home" else "About AMK Digital Agency",
               esc(h1.get("text", "")), lede, ctas, visual))


# The hero "growth stack": four broken SEO blocks the visitor fixes with a click or tap.
# Each fix lifts the growth line (js/site-fx.js). It shows progress only, never invented results.
STACK_BLOCKS = [("gauge", "Slow Core Web Vitals"), ("layers", "Missing AEO and schema markup"),
                ("link", "Orphaned money pages"), ("spark", "Zero AI citation visibility")]


def _hero_stack():
    blocks = "".join(
        '<li><button type="button" class="x-block x-block-%d" aria-pressed="false">'
        '<span class="x-block-ic">%s</span><span class="x-block-text"><b>%s</b>'
        '<small class="x-block-bad">Broken: tap to fix</small><small class="x-block-ok">Optimised</small></span>'
        '<span class="x-block-mark">%s</span></button></li>' % (i, icon(ic), esc(t), icon("check", "ic ic-ok"))
        for i, (ic, t) in enumerate(STACK_BLOCKS))
    return ('\n      <div class="x-hero-visual" data-mx="scale">\n        <div class="x-panel x-stack" data-stack>\n'
            '          <div class="x-panel-head"><span class="x-dot"></span><span class="x-dot"></span><span class="x-dot"></span><b>Build your growth stack</b></div>\n'
            '          <p class="x-stack-hint">Click or tap the broken SEO blocks below to fix them and watch your growth line climb.</p>\n'
            '          <div class="x-stack-chart" aria-hidden="true"><svg viewBox="0 0 320 120" preserveAspectRatio="none">'
            '<path class="x-stack-grid" d="M0 30H320M0 60H320M0 90H320"/>'
            '<g class="x-stack-rise"><path class="x-stack-line" d="M8 110 L84 84 L146 96 L222 52 L306 16" vector-effect="non-scaling-stroke"/></g>'
            '<circle class="x-stack-dot" cx="306" cy="16" r="6"/></svg></div>\n'
            '          <ul class="x-stack-blocks">%s</ul>\n'
            '          <div class="x-stack-foot"><p class="x-stack-score" role="status" aria-live="polite"><b data-stack-count>0</b> of %d fixed</p>'
            '<a class="x-btn x-stack-cta" href="/tools/">Audit your live domain free %s</a></div>\n'
            '        </div>\n      </div>' % (blocks, len(STACK_BLOCKS), icon("arrow", "ic ic-s")))


def _hero_visual():
    checks = [("lock", "HTTPS and certificate"), ("robot", "Crawl rules and sitemap"), ("headings", "Titles, headings and meta tags"),
              ("layers", "Structured data"), ("spark", "AI-search readiness")]
    rows = "".join('<li class="x-check x-check-%d">%s<span>%s</span>%s</li>' % (i, icon(ic), esc(t), icon("check", "ic ic-ok")) for i, (ic, t) in enumerate(checks))
    return ('\n      <div class="x-hero-visual" data-mx="scale" aria-hidden="true">\n        <div class="x-panel">\n'
            '          <div class="x-panel-head"><span class="x-dot"></span><span class="x-dot"></span><span class="x-dot"></span><b>Free website check</b></div>\n'
            '          <p class="x-panel-url">%s<span>your-website.com</span></p>\n          <ul class="x-checks">%s</ul>\n'
            '          <p class="x-panel-foot">What the free check looks at. Real results come from a live check.</p>\n        </div>\n      </div>'
            % (icon("search", "ic ic-s"), rows))


def _statement(sec):
    paras = [b for b in sec["blocks"] if b.get("type") == "paragraph"]
    main, extra = (paras[0], paras[1:]) if paras else ({"html": ""}, [])
    text = clean_rich_text(main.get("html", ""))
    parts = re.split(r"(?<=\.)\s", text, maxsplit=1)
    lead = '<span class="x-hl">%s</span>%s' % (parts[0], (" " + parts[1]) if len(parts) > 1 else "")
    more = "".join('<p class="x-more" data-mx="fade">%s</p>' % clean_rich_text(p.get("html", "")) for p in extra)
    return ('<section class="x-sec x-statement">\n      <h2 class="x-kicker" data-mx="fade">%s</h2>\n'
            '      <p class="x-big" data-mx="words">%s</p>\n      %s\n    </section>' % (esc(sec["title"]), lead, more))


def _features(sec):
    paras = [b for b in sec["blocks"] if b.get("type") == "paragraph"]
    items = [i for l in sec["blocks"] if l.get("type") == "list" for i in l.get("items", []) if plain_text(i)]
    desc = "".join('<p class="x-desc" data-mx="fade">%s</p>' % clean_rich_text(p.get("html", "")) for p in paras)
    cards = "".join('<li class="x-feature">%s<span>%s</span></li>' % (icon(guess_icon(plain_text(i), "check")), clean_rich_text(i)) for i in items)
    return ('<section class="x-sec">\n      <div class="x-head"><h2 data-mx="rise">%s</h2>%s</div>\n'
            '      <ul class="x-features" data-mx-stagger>%s</ul>\n    </section>' % (esc(sec["title"]), desc, cards))


def _cards(sec, description=""):
    bl, cards, cur, intro = sec["blocks"], [], None, []
    for b in bl:
        if b.get("type") == "heading" and int(b.get("level", 3)) == 3:
            cur = {"title": b.get("text", "").strip(), "paras": []}
            cards.append(cur)
        elif b.get("type") == "paragraph":
            (cur["paras"] if cur else intro).append(b)
    desc = "".join('<p class="x-desc" data-mx="fade">%s</p>' % clean_rich_text(p.get("html", "")) for p in intro) or (
        '<p class="x-desc" data-mx="fade">%s</p>' % esc(description) if description else "")
    html_cards = "".join('<article class="x-card">%s<h3>%s</h3>%s</article>' % (
        icon(guess_icon(c["title"])), esc(c["title"]), "".join("<p>%s</p>" % clean_rich_text(p.get("html", "")) for p in c["paras"]))
        for c in cards)
    return ('<section class="x-sec">\n      <div class="x-head"><h2 data-mx="rise">%s</h2>%s</div>\n'
            '      <div class="x-cards" data-mx-stagger>%s</div>\n    </section>' % (esc(sec["title"]), desc, html_cards))


def _pillars(secs):
    names = ["target", "compass", "flag", "spark"]
    cards = "".join('<article class="x-card x-pillar">%s<h2>%s</h2><p>%s</p></article>' % (
        icon(names[i % len(names)]), esc(s["title"]),
        clean_rich_text(next((b.get("html", "") for b in s["blocks"] if b.get("type") == "paragraph"), ""))) for i, s in enumerate(secs))
    return '<section class="x-sec x-pillars">\n      <div class="x-cards x-cards-3" data-mx-stagger>%s</div>\n    </section>' % cards


def _tools(sec, tools_data):
    tools = {t["slug"]: t for t in tools_data.get("tools", [])}
    pick = [s for s in ["domain-overview", "website-comparison", "meta-tags", "ssl-check", "headings", "title-generator"] if s in tools]
    cards = "".join('<a class="x-card x-tool" href="%s">%s<h3>%s</h3><p>%s</p><span class="x-go">Open %s</span></a>' % (
        esc(tool_href(tools[s])), icon(TOOL_ICONS.get(s, "search")), esc(tools[s]["name"]), esc(_short(tools[s].get("summary", ""), 110)),
        icon("arrow", "ic ic-s")) for s in pick)
    return ('<section class="x-sec">\n      <div class="x-head"><h2 data-mx="rise">%s</h2>'
            '<p class="x-desc" data-mx="fade">Professional diagnostic analysers and AI content tools. Every check uses real data with zero invented metrics.</p></div>\n'
            '      <div class="x-cards" data-mx-stagger>%s</div>\n      <p class="x-center" data-mx="fade"><a class="x-btn x-btn-ghost" href="/tools/">See all %d free tools %s</a></p>\n    </section>'
            % (esc(sec["title"]), cards, len(tools), icon("arrow", "ic ic-s")))


def _stats(stats):
    tiles = "".join('<div class="sc-stat"><b>%s</b><span>%s</span></div>' % (esc(n), esc(l)) for n, l in stats)
    return ('<section class="x-sec">\n      <div class="x-head"><h2 data-mx="rise">Experience in numbers</h2>'
            '<p class="x-desc" data-mx="fade">Counted from the projects documented in our portfolio. Client identities stay confidential.</p></div>\n'
            '      <div class="sc-stats" data-mx-stagger>%s</div>\n      <p class="x-center" data-mx="fade"><a class="x-btn x-btn-ghost" href="/showcase/">See our work %s</a></p>\n    </section>'
            % (tiles, icon("arrow", "ic ic-s")))


def _cta(secs, buttons):
    paras = [b for s in secs for b in s["blocks"] if b.get("type") == "paragraph"]
    lines = []
    for p in paras:
        text = clean_rich_text(p.get("html", ""))
        if "[TO BE CONFIRMED]" in text:
            if "plan" in text.lower() or "price" in text.lower():
                lines.append("Plans and prices will be published here once they are final.")
            continue                      # contact details: the Contact page covers this
        lines.append(text)
    btns = "".join(_button(b, "x-btn") for b in buttons) or '<a class="x-btn" href="/contact/">Contact us</a>'
    btns += '<a class="x-btn x-btn-ghost" href="/tools/">Try the free tools</a>'
    return ('<section class="x-sec x-cta" data-mx="scale">\n      <h2>Let\'s talk about your website</h2>\n      %s\n'
            '      <div class="x-ctas">%s</div>\n    </section>' % ("".join('<p>%s</p>' % l for l in lines), btns))


def designed_body(page, tools_data, stats=None):
    """Home and Company: the CMS blocks, presented as designed sections."""
    kind = "home" if page.get("slug") == "home" else "story"
    intro, sections = _split(page.get("blocks", []))
    end_buttons = [b for s in sections for b in s["blocks"] if b.get("type") == "button" and b.get("label")]
    for s in sections:
        s["blocks"] = [b for b in s["blocks"] if b.get("type") != "button"]
    out = [_hero(intro, kind,
                 ("/contact/", "Request App access") if kind == "home" else ("/contact/", "Talk to us"))]
    intro_paras = [b for b in intro if b.get("type") == "paragraph"][1:]
    if intro_paras and kind == "story":
        out.append(_statement({"title": "Who we are", "blocks": intro_paras}))
    i, ctas = 0, []
    while i < len(sections):
        s, k = sections[i], _kind(sections[i])
        if k == "single":
            run = [s]
            while i + 1 < len(sections) and _kind(sections[i + 1]) == "single":
                i += 1
                run.append(sections[i])
            out.append(_pillars(run) if len(run) > 1 else _statement(s))
        elif k == "statement":
            out.append(_statement(s))
        elif k == "features":
            out.append(_features(s))
        elif k == "cards":
            out.append(_cards(s, "What we offer, at a glance." if kind == "home" else ""))
            if kind == "home" and stats:
                out.append(_stats(stats))
        elif k == "tools":
            out.append(_tools(s, tools_data))
        elif k == "cta":
            ctas.append(s)
        i += 1
    if ctas or end_buttons or kind == "home":
        out.append(_cta(ctas, end_buttons))
    return "\n    ".join(out)


# ═══ Contact page ═════════════════════════════════════════════════════════
def contact_body():
    return '''<section class="x-hero x-hero-compact">
      <div class="x-hero-copy">
        <p class="x-eyebrow" data-mx="fade">Contact</p>
        <h1 data-mx="rise">Contact Us</h1>
        <p class="x-lede" data-mx="fade">Tell us about your website and what you need. Ask for a free audit, a question about our services, or access to the AMK Digital Agency App.</p>
      </div>
    </section>
    <section class="x-sec x-contact">
      <form class="x-form" id="contact-form" novalidate data-mx="rise">
        <div class="x-field"><label for="c-name">Your name</label><input id="c-name" name="name" type="text" autocomplete="name" maxlength="80" required /></div>
        <div class="x-field"><label for="c-email">Work email</label><input id="c-email" name="email" type="email" autocomplete="email" maxlength="254" required /></div>
        <div class="x-field"><label for="c-site">Website address <small>(optional)</small></label><input id="c-site" name="website" type="url" inputmode="url" autocomplete="url" maxlength="200" placeholder="example.com" /></div>
        <div class="x-field"><label for="c-msg">How can we help? <small>(optional)</small></label><textarea id="c-msg" name="message" rows="5" maxlength="1000"></textarea></div>
        <div class="x-trap" aria-hidden="true"><label for="c-company">Leave this empty</label><input id="c-company" name="company_site" type="text" tabindex="-1" autocomplete="off" /></div>
        <label class="x-consent"><input id="c-consent" type="checkbox" /> <span>I agree to be contacted about this request. We use your details only to reply.</span></label>
        <button class="x-btn" type="submit">Send message</button>
        <p class="x-form-msg" id="contact-msg" role="status"></p>
        <noscript><p class="x-form-msg is-error">This form needs JavaScript to send your message.</p></noscript>
      </form>
      <aside class="x-side" data-mx="fade">
        <div class="x-card">''' + icon("chat") + '''<h2>What happens next</h2><ol class="x-steps"><li>We read your message.</li><li>We reply by email.</li><li>If it helps, we suggest a free check of your site first.</li></ol></div>
        <div class="x-card">''' + icon("search") + '''<h2>Want answers now?</h2><p>Run a free check on your site in seconds.</p><p><a class="x-btn x-btn-ghost" href="/tools/domain-overview.html">Open Domain Overview</a></p></div>
      </aside>
    </section>'''


# ═══ Docs: "On this page" ═════════════════════════════════════════════════
def add_toc(body):
    """Give each h2 an id and put an 'On this page' list after the first paragraph. Needs 3+ sections."""
    heads = re.findall(r"<h2([^>]*)>(.*?)</h2>", body)
    if len(heads) < 3:
        return body
    used, links = set(), []

    def slug(text):
        s = re.sub(r"[^a-z0-9]+", "-", plain_text(text).lower()).strip("-")[:60] or "section"
        base, n = s, 2
        while s in used:
            s, n = "%s-%d" % (base, n), n + 1
        used.add(s)
        return s

    def repl(m):
        sid = slug(m.group(2))
        links.append('<li><a href="#%s">%s</a></li>' % (sid, m.group(2)))
        return '<h2 id="%s"%s>%s</h2>' % (sid, m.group(1), m.group(2))

    body = re.sub(r"<h2([^>]*)>(.*?)</h2>", repl, body)
    toc = '    <nav class="x-toc" aria-label="On this page"><p>On this page</p><ol>%s</ol></nav>\n' % "".join(links)
    idx = body.find("</p>")
    return body[: idx + 4] + "\n" + toc + body[idx + 4:] if idx >= 0 else toc + body
