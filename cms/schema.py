"""Structured data (JSON-LD) for every page type, as one linked graph.

Every entity has a stable @id on the live address (SITE_URL), so search engines and AI answer engines
see one Organization, one WebSite and one founder across all pages:
    <SITE_URL>/#organization  <SITE_URL>/#website  <SITE_URL>/#founder  <SITE_URL>/#software
Rules: built only from what the page visibly says; no ratings, reviews, prices or dates that are not on
the page; "<" escaped as \\u003c so the data can never close the script tag. Without SITE_URL nothing
is emitted (absolute addresses are required).
"""
import json
import re

ORG, SITE, FOUNDER, SOFTWARE = "/#organization", "/#website", "/#founder", "/#software"


def tag(nodes) -> str:
    data = {"@context": "https://schema.org", "@graph": [n for n in nodes if n]}
    return '  <script type="application/ld+json">%s</script>' % json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")


def _plain(html) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def founder_from(owner_page):
    """The founder as the Founder page shows him: its H1 is the name."""
    if not owner_page:
        return None
    h1 = next((b.get("text") for b in owner_page.get("blocks", []) if b.get("type") == "heading" and int(b.get("level", 2)) == 1), "")
    return h1.strip() or None


def site_nodes(settings, base, founder_name):
    org_cfg = settings.get("organization", {})
    name = settings.get("site_name", "")
    org = {"@type": "Organization", "@id": base + ORG, "name": name, "url": base + "/",
           "logo": {"@type": "ImageObject", "url": base + "/assets/logo-mark.png", "width": 512, "height": 512}}
    if org_cfg.get("description"):
        org["description"] = org_cfg["description"]
    if org_cfg.get("knowsAbout"):
        org["knowsAbout"] = org_cfg["knowsAbout"]
    nodes = [org, {"@type": "WebSite", "@id": base + SITE, "url": base + "/", "name": name,
                   "publisher": {"@id": base + ORG}, "inLanguage": settings.get("language", "en")}]
    if founder_name:
        org["founder"] = {"@id": base + FOUNDER}
        person = {"@type": "Person", "@id": base + FOUNDER, "name": founder_name,
                  "url": base + "/owner/", "worksFor": {"@id": base + ORG}}
        if org_cfg.get("founderJobTitle"):
            person["jobTitle"] = org_cfg["founderJobTitle"]
        nodes.append(person)
    return nodes


def breadcrumbs(base, trail):
    """trail: [(name, path), ...] starting after Home."""
    items = [("Home", "/")] + list(trail)
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": base + p} for i, (n, p) in enumerate(items)]}


def webpage(base, url, name, description, page_type="WebPage", extra=None):
    node = {"@type": page_type, "@id": url + "#webpage", "url": url, "name": name,
            "isPartOf": {"@id": base + SITE}, "about": {"@id": base + ORG}}
    if description:
        node["description"] = description
    node.update(extra or {})
    return node


def for_page(page, settings, base, url, founder_name, home_slug="home"):
    """CMS pages: home, company, founder, docs (articles), service pages."""
    if not base or not url:
        return ""
    slug = page.get("slug", "")
    h1 = next((b.get("text") for b in page.get("blocks", []) if b.get("type") == "heading" and int(b.get("level", 2)) == 1),
              page.get("title", ""))
    kinds = set(page.get("schema") or [])
    nodes = site_nodes(settings, base, founder_name)
    path = url[len(base):] or "/"
    if slug == home_slug:
        nodes.append(webpage(base, url, page.get("title", ""), page.get("description", "")))
        app = settings.get("organization", {}).get("software")
        if app:
            nodes.append({"@type": "SoftwareApplication", "@id": base + SOFTWARE, "name": app.get("name", ""),
                          "description": app.get("description", ""), "applicationCategory": "BusinessApplication",
                          "operatingSystem": "Web", "publisher": {"@id": base + ORG}})
        return tag(nodes)
    trail = []
    if slug.startswith("docs/"):
        trail.append(("Resources", "/docs/"))
    trail.append((h1, path))
    page_type = "AboutPage" if slug == "company" else "WebPage"
    extra = {"breadcrumb": {"@id": url + "#breadcrumb"}}
    if slug == "owner" and founder_name:
        page_type, extra["mainEntity"] = "ProfilePage", {"@id": base + FOUNDER}
    nodes.append(webpage(base, url, page.get("title", ""), page.get("description", ""), page_type, extra))
    crumbs = breadcrumbs(base, trail)
    crumbs["@id"] = url + "#breadcrumb"
    nodes.append(crumbs)
    if "Article" in kinds:
        art = {"@type": "TechArticle", "@id": url + "#article", "headline": h1, "description": page.get("description", ""),
               "mainEntityOfPage": {"@id": url + "#webpage"}, "publisher": {"@id": base + ORG}, "isPartOf": {"@type": "CollectionPage", "@id": base + "/docs/#webpage", "url": base + "/docs/", "name": "Resources"},
               "inLanguage": settings.get("language", "en")}
        if founder_name:
            art["author"] = {"@id": base + FOUNDER}
        nodes.append(art)
    faqs = [b for b in page.get("blocks", []) if b.get("type") == "faq"]
    if faqs:
        nodes.append({"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [
            {"@type": "Question", "name": b.get("question", ""),
             "acceptedAnswer": {"@type": "Answer", "text": _plain(b.get("answer", ""))}} for b in faqs]})
    return tag(nodes)


def for_tools_hub(data, settings, base, href, founder_name, title, description):
    if not base:
        return ""
    url = base + "/tools/"
    tools = data.get("tools", [])
    nodes = site_nodes(settings, base, founder_name)
    nodes.append(webpage(base, url, title, description, "CollectionPage",
                         {"breadcrumb": {"@id": url + "#breadcrumb"}, "mainEntity": {"@id": url + "#tools"}}))
    nodes.append({"@type": "ItemList", "@id": url + "#tools", "numberOfItems": len(tools), "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": t["name"], "url": base + href(t)} for i, t in enumerate(tools)]})
    crumbs = breadcrumbs(base, [("Free Tools & AI Tools", "/tools/")])
    crumbs["@id"] = url + "#breadcrumb"
    nodes.append(crumbs)
    return tag(nodes)


def for_tool(tool, settings, base, path, founder_name):
    if not base:
        return ""
    url = base + path
    nodes = site_nodes(settings, base, founder_name)
    app = {"@type": "WebApplication", "@id": url + "#app", "name": tool["name"], "url": url,
           "description": tool.get("summary") or tool.get("description", ""),
           "applicationCategory": "SEOApplication", "operatingSystem": "Web", "isAccessibleForFree": True,
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
           "provider": {"@id": base + ORG}}
    if tool.get("what"):
        app["featureList"] = list(tool["what"])
    nodes.append(webpage(base, url, tool.get("title") or tool["name"], tool.get("description") or tool.get("summary", ""), "WebPage",
                         {"breadcrumb": {"@id": url + "#breadcrumb"}, "mainEntity": {"@id": url + "#app"}}))
    nodes.append(app)
    crumbs = breadcrumbs(base, [("Free Tools & AI Tools", "/tools/"), (tool["name"], path)])
    crumbs["@id"] = url + "#breadcrumb"
    nodes.append(crumbs)
    return tag(nodes)


def for_simple(settings, base, path, title, description, page_type, crumb_name, founder_name):
    """A plain page (for example Contact): WebPage of the given type + breadcrumb."""
    if not base:
        return ""
    url = base + path
    nodes = site_nodes(settings, base, founder_name)
    nodes.append(webpage(base, url, title, description, page_type, {"breadcrumb": {"@id": url + "#breadcrumb"}}))
    crumbs = breadcrumbs(base, [(crumb_name, path)])
    crumbs["@id"] = url + "#breadcrumb"
    nodes.append(crumbs)
    return tag(nodes)
