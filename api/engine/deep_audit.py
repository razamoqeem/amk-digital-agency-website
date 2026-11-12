"""
AMK Digital Agency Website: technical SEO check of one page.

Fetches the page, robots.txt, the sitemap and llms.txt, and reports only what it
actually finds. Uses requests and beautifulsoup4 only: no paid services.
Every check is wrapped so one failing check never sinks the whole report.
"""
import os
import re
import ssl
import json
import socket
import datetime
from urllib.parse import urlparse, urljoin, urldefrag
from urllib import robotparser
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup

from .url_safety import safe_get, validate_public_url, UnsafeURLError

UA = ("Mozilla/5.0 (compatible; AMK-SEO-Audit/2026; +" + os.getenv("SITE_URL", "") + ")"
      " AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}

# Penalty applied to the 0-100 score per finding severity.
_PENALTY = {"HIGH": 12, "MEDIUM": 6, "LOW": 2}

# Required properties per schema.org @type for rich-result eligibility.
SCHEMA_REQUIRED = {
    "Article": ["headline", "author", "datePublished"],
    "NewsArticle": ["headline", "author", "datePublished"],
    "BlogPosting": ["headline", "author", "datePublished"],
    "Product": ["name", "offers"],
    "FAQPage": ["mainEntity"],
    "QAPage": ["mainEntity"],
    "BreadcrumbList": ["itemListElement"],
    "Organization": ["name", "url"],
    "LocalBusiness": ["name", "address"],
    "Person": ["name"],
    "Recipe": ["name", "recipeIngredient", "recipeInstructions"],
    "Event": ["name", "startDate", "location"],
    "VideoObject": ["name", "thumbnailUrl", "uploadDate"],
    "Review": ["reviewRating", "author"],
    "HowTo": ["name", "step"],
}

# Google Core Web Vitals lab thresholds.
CWV_THRESHOLDS = {
    "LCP": (2.5, 4.0),   # seconds  (Good <=2.5, Poor >4.0)
    "FCP": (1.8, 3.0),
    "CLS": (0.1, 0.25),  # unitless
    "TBT": (200, 600),   # ms
    "INP": (200, 500),   # ms
}


class _Report:
    """Accumulates findings + per-section data and rolls up a score."""
    def __init__(self, url):
        self.url = url
        self.final_url = url
        self.findings = []
        self.sections = {}

    def finding(self, severity, category, title, detail="", recommendation=""):
        self.findings.append({
            "severity": severity, "category": category, "title": title,
            "detail": detail, "recommendation": recommendation,
        })

    def section(self, name, data):
        self.sections[name] = data

    def build(self):
        score = 100
        counts = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
        for f in self.findings:
            score -= _PENALTY.get(f["severity"], 2)
            counts[f["severity"]] = counts.get(f["severity"], 0) + 1
        score = max(0, min(100, score))
        # Order findings by severity for presentation.
        order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
        self.findings.sort(key=lambda f: order.get(f["severity"], 3))
        return {
            "url": self.url,
            "final_url": self.final_url,
            "score": score,
            "grade": _grade(score),
            "issue_counts": counts,
            "total_issues": len(self.findings),
            "findings": self.findings,
            "sections": self.sections,
        }


def _grade(score):
    if score >= 90: return "A"
    if score >= 80: return "B"
    if score >= 70: return "C"
    if score >= 55: return "D"
    return "F"


def _norm(url):
    try:
        return urldefrag(url)[0].rstrip("/").lower()
    except Exception:
        return (url or "").rstrip("/").lower()


# ─────────────────────────────────────────────────────────────────────────────
#  Individual analyzers — each pure-ish and defensive.
# ─────────────────────────────────────────────────────────────────────────────

def analyze_redirects(rep, resp):
    chain = [{"url": h.url, "status": h.status_code} for h in resp.history]
    rep.final_url = resp.url
    data = {"redirect_chain": chain, "hops": len(chain), "final_status": resp.status_code}
    if len(chain) >= 2:
        rep.finding("MEDIUM", "Crawlability", f"Redirect chain of {len(chain)} hops",
                    detail=" → ".join(str(h["status"]) for h in chain) + f" → {resp.status_code}",
                    recommendation="Point the first URL directly at the final destination (single 301).")
    # http → https upgrade present?
    if chain and chain[0]["url"].startswith("http://") and resp.url.startswith("https://"):
        data["https_upgrade"] = True
    rep.section("redirects", data)


def analyze_security(rep, parsed, resp):
    data = {"https": parsed.scheme == "https"}
    headers = {k.lower(): v for k, v in resp.headers.items()}
    if parsed.scheme != "https":
        rep.finding("HIGH", "Security", "Site not served over HTTPS",
                    recommendation="Install an SSL certificate and 301-redirect all http:// to https://.")
    # Security headers
    sec_headers = {
        "strict-transport-security": ("HSTS", "MEDIUM"),
        "content-security-policy": ("Content-Security-Policy", "LOW"),
        "x-content-type-options": ("X-Content-Type-Options", "LOW"),
        "x-frame-options": ("X-Frame-Options", "LOW"),
        "referrer-policy": ("Referrer-Policy", "LOW"),
    }
    present, missing = [], []
    for h, (label, sev) in sec_headers.items():
        if h in headers:
            present.append(label)
        else:
            missing.append(label)
            if h == "strict-transport-security" and parsed.scheme == "https":
                rep.finding("MEDIUM", "Security", "Missing HSTS header",
                            recommendation="Add Strict-Transport-Security to force HTTPS on repeat visits.")
    data["headers_present"] = present
    data["headers_missing"] = missing
    if missing:
        rep.finding("LOW", "Security", f"{len(missing)} security headers missing",
                    detail=", ".join(missing),
                    recommendation="Add the missing hardening headers at the server/CDN.")

    # SSL certificate inspection
    if parsed.scheme == "https":
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((parsed.hostname, parsed.port or 443), timeout=8) as sock:
                with ctx.wrap_socket(sock, server_hostname=parsed.hostname) as ss:
                    cert = ss.getpeercert()
            not_after = cert.get("notAfter")
            exp = datetime.datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
            days_left = (exp - datetime.datetime.utcnow()).days
            data["ssl_valid"] = True
            data["ssl_expires_in_days"] = days_left
            data["ssl_issuer"] = dict(x[0] for x in cert.get("issuer", [])).get("organizationName")
            if days_left < 0:
                rep.finding("HIGH", "Security", "SSL certificate expired",
                            recommendation="Renew the TLS certificate immediately.")
            elif days_left < 15:
                rep.finding("MEDIUM", "Security", f"SSL certificate expires in {days_left} days",
                            recommendation="Renew/auto-renew the certificate soon.")
        except Exception as e:
            data["ssl_valid"] = False
            data["ssl_error"] = str(e)[:120]
            rep.finding("HIGH", "Security", "Could not validate SSL certificate",
                        detail=str(e)[:120],
                        recommendation="Verify the certificate chain and hostname match.")
    rep.section("security", data)


def analyze_mixed_content(rep, parsed, soup):
    if parsed.scheme != "https":
        return
    insecure = []
    for tag, attr in (("img", "src"), ("script", "src"), ("link", "href"),
                      ("iframe", "src"), ("source", "src"), ("video", "src")):
        for el in soup.find_all(tag):
            val = el.get(attr)
            if val and val.startswith("http://"):
                insecure.append(val)
    if insecure:
        rep.finding("HIGH", "Security", f"{len(insecure)} mixed-content (http) resources on HTTPS page",
                    detail=insecure[0],
                    recommendation="Serve every sub-resource over https:// to avoid browser warnings.")
    rep.section("mixed_content", {"count": len(insecure), "examples": insecure[:5]})


def analyze_indexability(rep, soup, resp):
    data = {}
    robots = soup.find("meta", attrs={"name": re.compile("^robots$", re.I)})
    content = (robots.get("content", "") if robots else "").lower()
    x_robots = resp.headers.get("X-Robots-Tag", "").lower()
    data["meta_robots"] = content or None
    data["x_robots_tag"] = x_robots or None
    if "noindex" in content or "noindex" in x_robots:
        rep.finding("HIGH", "Indexability", "Page is set to NOINDEX",
                    detail=content or x_robots,
                    recommendation="Remove noindex if this page should rank in search.")
    if "nofollow" in content:
        rep.finding("MEDIUM", "Indexability", "Page is set to NOFOLLOW",
                    recommendation="Allow link equity to flow unless intentionally sculpted.")
    rep.section("indexability", data)


def analyze_canonical(rep, soup):
    link = soup.find("link", rel=lambda v: v and "canonical" in [x.lower() for x in (v if isinstance(v, list) else [v])])
    href = link.get("href") if link else None
    data = {"canonical": href}
    if not href:
        rep.finding("MEDIUM", "On-Page", "No canonical tag",
                    recommendation="Add a self-referential <link rel=canonical> to consolidate signals.")
    else:
        if _norm(href) != _norm(rep.final_url):
            data["self_referential"] = False
            rep.finding("LOW", "On-Page", "Canonical points to a different URL",
                        detail=href,
                        recommendation="Confirm this is intentional; otherwise self-canonicalize.")
        else:
            data["self_referential"] = True
    rep.section("canonical", data)


def analyze_on_page(rep, soup):
    title = (soup.title.string.strip() if soup.title and soup.title.string else "")
    desc_el = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    desc = (desc_el.get("content", "").strip() if desc_el else "")
    h1s = [h.get_text(strip=True) for h in soup.find_all("h1")]
    headings = [int(h.name[1]) for h in soup.find_all(re.compile("^h[1-6]$"))]
    viewport = soup.find("meta", attrs={"name": re.compile("^viewport$", re.I)})
    lang = (soup.html.get("lang") if soup.html else None)
    text = soup.get_text(" ", strip=True)
    words = len(text.split())

    data = {"title": title, "title_len": len(title), "meta_description": desc,
            "desc_len": len(desc), "h1_count": len(h1s), "word_count": words,
            "has_viewport": bool(viewport), "lang": lang}

    if not title:
        rep.finding("HIGH", "On-Page", "Missing <title> tag",
                    recommendation="Add a unique 50-60 char title with the primary keyword near the front.")
    elif len(title) > 65:
        rep.finding("LOW", "On-Page", f"Title too long ({len(title)} chars)",
                    recommendation="Trim to ~60 chars so it doesn't truncate in SERPs.")
    elif len(title) < 25:
        rep.finding("LOW", "On-Page", f"Title quite short ({len(title)} chars)",
                    recommendation="Expand toward 50-60 chars to use the available SERP space.")
    if not desc:
        rep.finding("MEDIUM", "On-Page", "Missing meta description",
                    recommendation="Write a 140-160 char description with a call to action.")
    elif len(desc) > 165:
        rep.finding("LOW", "On-Page", f"Meta description long ({len(desc)} chars)",
                    recommendation="Trim to ~155 chars to avoid truncation.")
    if len(h1s) == 0:
        rep.finding("HIGH", "On-Page", "No H1 heading",
                    recommendation="Add exactly one descriptive H1 per page.")
    elif len(h1s) > 1:
        rep.finding("LOW", "On-Page", f"Multiple H1s ({len(h1s)})",
                    recommendation="Prefer a single H1; demote the rest to H2/H3.")
    # Heading hierarchy: flag a jump >1 level (e.g. H1 -> H3)
    prev = 0
    for lvl in headings:
        if prev and lvl - prev > 1:
            rep.finding("LOW", "On-Page", "Skipped heading level",
                        detail=f"H{prev} → H{lvl}",
                        recommendation="Keep heading levels sequential for accessibility & structure.")
            break
        prev = lvl
    if not viewport:
        rep.finding("HIGH", "Mobile", "No viewport meta tag",
                    recommendation="Add <meta name=viewport content='width=device-width, initial-scale=1'>.")
    if not lang:
        rep.finding("LOW", "On-Page", "Missing <html lang> attribute",
                    recommendation="Declare the page language for accessibility & hreflang correctness.")
    if words < 300:
        rep.finding("MEDIUM", "Content", f"Thin content ({words} words)",
                    recommendation="Expand to comprehensively cover the topic (usually 600+ words).")
    rep.section("on_page", data)


def analyze_images(rep, soup):
    imgs = soup.find_all("img")
    total = len(imgs)
    missing_alt = [i for i in imgs if not (i.get("alt") or "").strip()]
    no_dims = [i for i in imgs if not (i.get("width") and i.get("height"))]
    lazy = [i for i in imgs if (i.get("loading") == "lazy")]
    data = {"total": total, "missing_alt": len(missing_alt),
            "alt_coverage_pct": round((total - len(missing_alt)) / total * 100) if total else 100,
            "without_dimensions": len(no_dims), "lazy_loaded": len(lazy)}
    if total and len(missing_alt) / total > 0.2:
        rep.finding("MEDIUM", "On-Page", f"{len(missing_alt)}/{total} images missing alt text",
                    recommendation="Add descriptive, keyword-relevant alt text for accessibility & image SEO.")
    if total and len(no_dims) / total > 0.5:
        rep.finding("LOW", "Performance", "Many images lack width/height",
                    recommendation="Set explicit dimensions to reduce Cumulative Layout Shift (CLS).")
    rep.section("images", data)


def analyze_links(rep, soup, parsed):
    host = parsed.netloc
    internal, external, empty_anchor, generic = 0, 0, 0, 0
    GENERIC = {"click here", "read more", "here", "more", "link", "this"}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("#") or href.startswith("javascript:") or href.startswith("mailto:"):
            continue
        full = urljoin(rep.final_url, href)
        anchor = a.get_text(strip=True).lower()
        if not anchor:
            empty_anchor += 1
        elif anchor in GENERIC:
            generic += 1
        if urlparse(full).netloc == host:
            internal += 1
        else:
            external += 1
    data = {"internal": internal, "external": external,
            "empty_anchors": empty_anchor, "generic_anchors": generic}
    if empty_anchor > 0:
        rep.finding("LOW", "Links", f"{empty_anchor} links with empty anchor text",
                    recommendation="Give every link descriptive anchor text (helps crawlers & screen readers).")
    if generic >= 5:
        rep.finding("LOW", "Links", f"{generic} generic anchors ('click here', 'read more')",
                    recommendation="Use keyword-relevant anchors so internal links pass topical context.")
    if internal == 0:
        rep.finding("MEDIUM", "Links", "No internal links found",
                    recommendation="Add internal links to distribute authority and aid discovery.")
    rep.section("links", data)


def analyze_structured_data(rep, soup):
    blocks = soup.find_all("script", attrs={"type": "application/ld+json"})
    types_found, errors, validated = [], [], []

    def walk(obj):
        items = obj if isinstance(obj, list) else [obj]
        for it in items:
            if not isinstance(it, dict):
                continue
            graph = it.get("@graph")
            if graph:
                walk(graph)
            t = it.get("@type")
            tlist = t if isinstance(t, list) else [t]
            for tt in tlist:
                if not tt:
                    continue
                types_found.append(tt)
                req = SCHEMA_REQUIRED.get(tt)
                if req:
                    missing = [p for p in req if p not in it]
                    if missing:
                        validated.append({"type": tt, "missing": missing})

    for b in blocks:
        try:
            walk(json.loads(b.string or b.get_text() or "{}"))
        except Exception as e:
            errors.append(str(e)[:80])

    data = {"types": sorted(set(types_found)), "blocks": len(blocks),
            "parse_errors": errors, "incomplete": validated}
    if not blocks:
        rep.finding("MEDIUM", "Structured Data", "No JSON-LD structured data",
                    recommendation="Add schema.org markup (Organization, Article/Product, BreadcrumbList) for rich results.")
    if errors:
        rep.finding("MEDIUM", "Structured Data", f"{len(errors)} JSON-LD blocks failed to parse",
                    detail=errors[0],
                    recommendation="Fix the malformed JSON-LD so search engines can read it.")
    for v in validated:
        rep.finding("LOW", "Structured Data", f"{v['type']} schema missing: {', '.join(v['missing'])}",
                    recommendation=f"Add the required properties so {v['type']} is rich-result eligible.")
    rep.section("structured_data", data)


def analyze_social(rep, soup):
    def meta(prop, attr="property"):
        el = soup.find("meta", attrs={attr: prop})
        return el.get("content") if el else None
    og = {k: meta(f"og:{k}") for k in ("title", "description", "image", "url", "type")}
    tw = {k: meta(f"twitter:{k}", attr="name") for k in ("card", "title", "image")}
    data = {"open_graph": {k: v for k, v in og.items() if v},
            "twitter": {k: v for k, v in tw.items() if v}}
    missing_og = [k for k in ("title", "description", "image") if not og.get(k)]
    if missing_og:
        rep.finding("LOW", "Social", f"Open Graph missing: {', '.join(missing_og)}",
                    recommendation="Add og:title/description/image so shared links render rich previews.")
    if not tw.get("card"):
        rep.finding("LOW", "Social", "No Twitter Card markup",
                    recommendation="Add twitter:card (summary_large_image) for better X/Twitter previews.")
    rep.section("social", data)


def analyze_international(rep, soup):
    links = soup.find_all("link", rel=lambda v: v and "alternate" in [x.lower() for x in (v if isinstance(v, list) else [v])])
    hreflangs = [l.get("hreflang") for l in links if l.get("hreflang")]
    data = {"hreflang_count": len(hreflangs), "hreflangs": hreflangs,
            "has_x_default": "x-default" in [h.lower() for h in hreflangs]}
    if hreflangs and not data["has_x_default"]:
        rep.finding("LOW", "International", "hreflang set without x-default",
                    recommendation="Add an x-default hreflang for users outside the targeted locales.")
    rep.section("international", data)


def analyze_robots_sitemap(rep, parsed):
    base = f"{parsed.scheme}://{parsed.netloc}"
    data = {"robots_txt": False, "sitemaps": [], "sitemap_url_count": 0, "disallow_rules": 0}
    sitemap_urls = []
    # robots.txt
    try:
        r = safe_get(f"{base}/robots.txt", headers=HEADERS, timeout=8)
        if r.status_code == 200 and r.text.strip():
            data["robots_txt"] = True
            for line in r.text.splitlines():
                ls = line.strip().lower()
                if ls.startswith("sitemap:"):
                    sitemap_urls.append(line.split(":", 1)[1].strip())
                elif ls.startswith("disallow:") and ls.split(":", 1)[1].strip():
                    data["disallow_rules"] += 1
        else:
            rep.finding("MEDIUM", "Crawlability", "No robots.txt found",
                        recommendation="Add a robots.txt (even a permissive one) and reference your sitemap.")
    except Exception as e:
        data["robots_error"] = str(e)[:80]

    if not sitemap_urls:
        sitemap_urls = [f"{base}/sitemap.xml", f"{base}/sitemap_index.xml"]
    else:
        data["sitemap_declared_in_robots"] = True

    # sitemap(s)
    found_any = False
    total_urls = 0
    for sm in sitemap_urls[:5]:
        try:
            r = safe_get(sm, headers=HEADERS, timeout=10)
            if r.status_code != 200 or "<" not in r.text:
                continue
            found_any = True
            root = ET.fromstring(r.text)
            tag = root.tag.lower()
            ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
            if "sitemapindex" in tag:
                children = root.findall(f"{ns}sitemap")
                data.setdefault("sitemap_index", True)
                # count URLs in nested sitemaps (cap to keep it fast)
                for child in children[:10]:
                    loc = child.find(f"{ns}loc")
                    if loc is None or not loc.text:
                        continue
                    try:
                        rr = safe_get(loc.text.strip(), headers=HEADERS, timeout=10)
                        sub = ET.fromstring(rr.text)
                        total_urls += len(sub.findall(f"{ns}url"))
                    except Exception:
                        pass
            else:
                total_urls += len(root.findall(f"{ns}url"))
            data["sitemaps"].append(sm)
        except Exception:
            continue
    data["sitemap_url_count"] = total_urls
    if not found_any:
        rep.finding("MEDIUM", "Crawlability", "No XML sitemap found",
                    recommendation="Generate sitemap.xml and submit it in Google Search Console.")
    rep.section("crawlability", data)


def analyze_tech_stack(rep, resp, soup):
    """Detect the underlying platform from real response headers + markup
    fingerprints — informational only, no findings/score impact."""
    html = resp.text.lower()
    headers = {k.lower(): v for k, v in resp.headers.items()}
    server = headers.get("server", "")
    powered = headers.get("x-powered-by", "")
    generator_el = soup.find("meta", attrs={"name": re.compile("^generator$", re.I)})
    generator = (generator_el.get("content", "") if generator_el else "").lower()

    detected = []
    fingerprints = [
        ("WordPress", ["wp-content", "wp-includes", "wordpress"]),
        ("Shopify", ["cdn.shopify.com", "shopify"]),
        ("Next.js", ["__next_data__", "_next/static"]),
        ("Wix", ["static.wixstatic.com", "wix.com"]),
        ("Squarespace", ["static1.squarespace.com", "squarespace"]),
        ("Webflow", ["assets.website-files.com", "webflow"]),
        ("Drupal", ["drupal.js", "drupal.settings"]),
        ("Joomla", ["/media/jui/", "joomla"]),
        ("Magento", ["mage/cookies", "magento"]),
    ]
    haystack = html + " " + generator
    for name, needles in fingerprints:
        if any(n in haystack for n in needles):
            detected.append(name)
    if "php" in powered.lower() and "PHP" not in detected:
        detected.append("PHP")
    if "cloudflare" in server.lower():
        detected.append("Cloudflare")
    elif "nginx" in server.lower():
        detected.append("Nginx")
    elif "apache" in server.lower():
        detected.append("Apache")

    rep.section("tech_stack", {
        "detected": detected,
        "server_header": server or None,
        "generator": generator or None,
    })


def analyze_llms_txt(rep, parsed):
    """Check for a real /llms.txt file at the domain root — informational,
    no findings/score impact (not an established ranking factor)."""
    base = f"{parsed.scheme}://{parsed.netloc}"
    data = {"present": False}
    try:
        r = safe_get(f"{base}/llms.txt", headers=HEADERS, timeout=6)
        data["present"] = r.status_code == 200 and bool(r.text.strip())
    except Exception:
        pass
    rep.section("llms_txt", data)


# Failure kinds returned in report["error"]["kind"] when a page cannot be audited.
#   invalid_url, not_allowed  -> the address itself is the problem (HTTP 400)
#   dns, timeout, ssl, connection, redirects, http_error, not_html
#                             -> the site could not be read (HTTP 502)
CLIENT_ERROR_KINDS = ("invalid_url", "not_allowed")


def failed_report(url: str, kind: str, message: str, status_code=None) -> dict:
    """
    The report returned when a page could not be audited. It carries NO score,
    grade or findings: an unreachable page has not been measured, so nothing
    is invented for it. Callers must check report["fetched"].
    """
    return {
        "url": url,
        "final_url": url,
        "fetched": False,
        "score": None,
        "grade": None,
        "issue_counts": {"HIGH": 0, "MEDIUM": 0, "LOW": 0},
        "total_issues": 0,
        "findings": [],
        "sections": {},
        "status_code": status_code,
        "blocked": kind == "not_allowed",
        "error": {"kind": kind, "message": message},
    }


def classify_fetch_error(exc: Exception):
    """Map a requests/network exception to (kind, plain-language message)."""
    text = f"{type(exc).__name__}: {exc}"
    if isinstance(exc, requests.exceptions.TooManyRedirects):
        return "redirects", "The site redirects too many times to be audited."
    if isinstance(exc, requests.exceptions.SSLError) or "SSLError" in text or "CERTIFICATE_VERIFY_FAILED" in text:
        return "ssl", "The site's SSL certificate could not be verified."
    if "NameResolutionError" in text or "getaddrinfo failed" in text or "Name or service not known" in text \
            or "nodename nor servname" in text or "Temporary failure in name resolution" in text:
        return "dns", "That domain doesn't appear to resolve — check the URL for typos."
    if isinstance(exc, requests.exceptions.Timeout) or "timed out" in text or "Timeout" in text:
        return "timeout", "The site took too long to respond."
    if isinstance(exc, requests.exceptions.ConnectionError) or "ConnectionError" in text:
        return "connection", "Could not connect to that site."
    return "connection", "Could not fetch the page."


def _http_error_message(status_code: int) -> str:
    if status_code in (401, 403):
        return f"The site refused our request (HTTP {status_code}). It may be blocking automated tools."
    if status_code == 404:
        return "That page was not found (HTTP 404). Check the address."
    if status_code == 429:
        return "The site is rate-limiting requests (HTTP 429). Try again in a few minutes."
    if status_code >= 500:
        return f"The site returned a server error (HTTP {status_code}). Try again later."
    return f"The page returned an error (HTTP {status_code})."


def run_deep_audit(url: str) -> dict:
    """
    Run the full deep technical-SEO battery on a single URL and return a report dict.

    If the page cannot be audited the result has fetched=False, score=None and
    an "error" {kind, message}; it never contains a made-up score.
    """
    url = (url or "").strip()
    if not url:
        return failed_report(url, "invalid_url", "A website URL is required.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    # Refuse malformed, non-http(s) and internal/private addresses before any
    # network call.
    try:
        validate_public_url(url)
    except UnsafeURLError as e:
        message = str(e)
        kind = "not_allowed" if "Internal or private" in message else "invalid_url"
        return failed_report(url, kind, message)

    try:
        resp = safe_get(url, headers=HEADERS, timeout=20, allow_redirects=True)
    except UnsafeURLError:
        return failed_report(url, "not_allowed", "The site redirects to an address that cannot be audited.")
    except Exception as e:
        kind, message = classify_fetch_error(e)
        return failed_report(url, kind, message)

    if resp.status_code >= 400:
        return failed_report(url, "http_error", _http_error_message(resp.status_code), resp.status_code)

    content_type = (resp.headers.get("Content-Type") or "").lower()
    if content_type and not any(t in content_type for t in ("html", "xml", "text/plain")):
        return failed_report(url, "not_html", "That address is a file, not a web page, so it cannot be audited.",
                             resp.status_code)

    rep = _Report(url)
    parsed = urlparse(resp.url)
    soup = BeautifulSoup(resp.text, "html.parser")

    # Run every analyzer defensively.
    for fn, args in [
        (analyze_redirects, (rep, resp)),
        (analyze_security, (rep, parsed, resp)),
        (analyze_mixed_content, (rep, parsed, soup)),
        (analyze_indexability, (rep, soup, resp)),
        (analyze_canonical, (rep, soup)),
        (analyze_on_page, (rep, soup)),
        (analyze_images, (rep, soup)),
        (analyze_links, (rep, soup, parsed)),
        (analyze_structured_data, (rep, soup)),
        (analyze_social, (rep, soup)),
        (analyze_international, (rep, soup)),
        (analyze_robots_sitemap, (rep, parsed)),
        (analyze_tech_stack, (rep, resp, soup)),
        (analyze_llms_txt, (rep, parsed)),
    ]:
        try:
            fn(*args)
        except Exception as e:
            rep.section(fn.__name__.replace("analyze_", ""), {"error": str(e)[:120]})

    out = rep.build()
    out["fetched"] = True
    out["status_code"] = resp.status_code
    return out
