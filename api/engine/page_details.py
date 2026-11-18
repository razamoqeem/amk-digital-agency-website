"""
KivoReach Website: detailed checks for the single-purpose tools.

Each function looks at one thing and reports only what it finds:
  page_details()   one fetch of a page: meta tags, headings, images, links, text
  redirect_chain() every hop from the typed address to the final page
  check_links()    which links on a page answer and which are broken
  robots_details() robots.txt rules and the XML sitemaps
  ssl_details()    the security certificate

All outside requests go through url_safety, so private and local addresses are refused.
"""
import datetime
import re
import socket
import ssl
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .url_safety import UnsafeURLError, safe_get, validate_public_url

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AMK-SEO-Check/1.0)", "Accept": "text/html,*/*;q=0.8"}
MAX_LIST = 200          # longest list returned to the page
MAX_LINK_CHECKS = 40    # links tested by the broken-link check

STOPWORDS = set("""a about above after again all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here
hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our ours out
over own same she so some such than that the their theirs them then there these they this those through to too under
until up us very was we were what when where which while who whom why will with would you your yours""".split())


class PageError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def _fetch(url):
    try:
        resp = safe_get(url, headers=HEADERS, timeout=20)
    except UnsafeURLError as exc:
        raise PageError("invalid_url", str(exc))
    except requests.Timeout:
        raise PageError("site_unreachable", "The site took too long to answer.")
    except Exception:
        raise PageError("site_unreachable", "The site could not be reached.")
    return resp


def _safe(url):
    try:
        return validate_public_url(url)
    except UnsafeURLError as exc:
        raise PageError("invalid_url", str(exc))


def _clip(text, limit=300):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text[:limit]


def _syllables(word):
    groups = re.findall(r"[aeiouy]+", word)
    count = len(groups)
    if word.endswith("e") and count > 1 and not word.endswith(("le", "ee")):
        count -= 1
    return max(1, count)


def _text_stats(soup, lang):
    for tag in soup(["script", "style", "noscript", "template", "svg"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    words = [w.lower() for w in re.findall(r"[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*", text)]
    total = len(words)
    if not total:
        return {"word_count": 0, "top_words": [], "top_phrases": [], "readability": None}
    kept = [w for w in words if w not in STOPWORDS and len(w) > 2]
    top_words = [{"word": w, "count": c, "percent": round(100 * c / total, 2)} for w, c in Counter(kept).most_common(20)]
    pairs = Counter(f"{a} {b}" for a, b in zip(words, words[1:])
                    if a not in STOPWORDS and b not in STOPWORDS and len(a) > 2 and len(b) > 2)
    top_phrases = [{"phrase": p, "count": c} for p, c in pairs.most_common(12) if c > 1]
    readability = None
    if (lang or "en").lower().startswith("en"):
        sentences = max(1, len(re.findall(r"[.!?]+(?:\s|$)", text)))
        syllables = sum(_syllables(w) for w in words)
        score = 206.835 - 1.015 * (total / sentences) - 84.6 * (syllables / total)
        readability = {"flesch_reading_ease": round(max(0.0, min(100.0, score)), 1),
                       "sentences": sentences, "words_per_sentence": round(total / sentences, 1)}
    return {"word_count": total, "top_words": top_words, "top_phrases": top_phrases, "readability": readability}


def page_details(url: str) -> dict:
    """Fetch one page and return its meta tags, headings, images, links and text figures."""
    resp = _fetch(url)
    if resp.status_code >= 400:
        raise PageError("site_unreachable", f"The page answered with error code {resp.status_code}, so there is nothing to check.")
    ctype = (resp.headers.get("Content-Type") or "").lower()
    if ctype and "html" not in ctype:
        raise PageError("invalid_url", "That address is a file, not a web page.")
    final = resp.url
    host = urlparse(final).netloc.lower()
    soup = BeautifulSoup(resp.text, "html.parser")

    def meta(name, attr="name"):
        tag = soup.find("meta", attrs={attr: re.compile(f"^{re.escape(name)}$", re.I)})
        return _clip(tag.get("content"), 500) if tag and tag.get("content") else None

    title = _clip(soup.title.string, 500) if soup.title and soup.title.string else None
    canonical = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    html_tag = soup.find("html")
    lang = (html_tag.get("lang") if html_tag else None) or None
    og = {t["property"][3:]: _clip(t.get("content"), 300) for t in soup.find_all("meta", property=re.compile(r"^og:", re.I))
          if t.get("content")}
    twitter = {t["name"][8:]: _clip(t.get("content"), 300) for t in soup.find_all("meta", attrs={"name": re.compile(r"^twitter:", re.I)})
               if t.get("content")}
    description = meta("description")
    meta_out = {
        "title": title, "title_length": len(title or ""),
        "description": description, "description_length": len(description or ""),
        "canonical": urljoin(final, canonical["href"]) if canonical and canonical.get("href") else None,
        "robots": meta("robots"), "x_robots_tag": resp.headers.get("X-Robots-Tag"),
        "viewport": meta("viewport"), "language": lang,
        "charset": (soup.find("meta", charset=True) or {}).get("charset") if soup.find("meta", charset=True) else None,
        "open_graph": dict(list(og.items())[:20]), "twitter": dict(list(twitter.items())[:20]),
    }

    headings = [{"level": int(h.name[1]), "text": _clip(h.get_text(" ", strip=True), 200)}
                for h in soup.find_all(re.compile(r"^h[1-6]$"))]
    counts = Counter(h["level"] for h in headings)

    images = []
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not src or src.startswith("data:"):
            continue
        alt = img.get("alt")
        images.append({"src": _clip(urljoin(final, src), 400), "alt": _clip(alt, 200) if alt is not None else None,
                       "has_size": bool(img.get("width") and img.get("height")), "lazy": img.get("loading") == "lazy"})

    internal, external, seen = [], [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
            continue
        full = urljoin(final, href).split("#")[0]
        if not full.startswith(("http://", "https://")) or full in seen:
            continue
        seen.add(full)
        rel = a.get("rel") or []
        item = {"url": _clip(full, 400), "text": _clip(a.get_text(" ", strip=True), 120) or None,
                "nofollow": "nofollow" in [r.lower() for r in (rel if isinstance(rel, list) else [rel])]}
        (internal if urlparse(full).netloc.lower() == host else external).append(item)

    text = _text_stats(soup, lang)
    return {
        "url": url, "final_url": final, "status_code": resp.status_code, "meta": meta_out,
        "headings": {"outline": headings[:MAX_LIST], "total": len(headings),
                     "counts": {f"h{n}": counts.get(n, 0) for n in range(1, 7)}},
        "images": {"total": len(images), "missing_alt": sum(1 for i in images if i["alt"] is None),
                   "empty_alt": sum(1 for i in images if i["alt"] == ""),
                   "without_size": sum(1 for i in images if not i["has_size"]), "items": images[:MAX_LIST]},
        "links": {"internal_total": len(internal), "external_total": len(external),
                  "nofollow_total": sum(1 for i in internal + external if i["nofollow"]),
                  "internal": internal[:MAX_LIST], "external": external[:MAX_LIST]},
        "text": text,
    }


def redirect_chain(url: str) -> dict:
    """Every hop from the typed address to the final answer. An error page is a result, not a failure."""
    resp = _fetch(url)
    hops = [{"url": _clip(r.url, 400), "status_code": r.status_code} for r in resp.history]
    hops.append({"url": _clip(resp.url, 400), "status_code": resp.status_code})
    first, last = urlparse(hops[0]["url"]), urlparse(hops[-1]["url"])
    return {"start_url": url, "final_url": resp.url, "final_status": resp.status_code, "redirects": len(resp.history),
            "hops": hops, "http_to_https": first.scheme == "http" and last.scheme == "https",
            "host_changed": first.netloc.lower() != last.netloc.lower(),
            "server": resp.headers.get("Server"), "content_type": resp.headers.get("Content-Type")}


def _link_status(url):
    """Status code of one link, or a short reason. HEAD first, then GET without reading the page."""
    current = url
    try:
        for _ in range(4):
            current = validate_public_url(current)
            resp = requests.head(current, headers=HEADERS, timeout=8, allow_redirects=False)
            if resp.status_code in (403, 405, 501):
                resp = requests.get(current, headers=HEADERS, timeout=8, allow_redirects=False, stream=True)
                resp.close()
            location = resp.headers.get("location")
            if resp.status_code in (301, 302, 303, 307, 308) and location:
                current = urljoin(current, location)
                continue
            return resp.status_code, None
        return None, "Too many redirects"
    except UnsafeURLError:
        return None, "Address not allowed"
    except requests.Timeout:
        return None, "No answer in time"
    except Exception:
        return None, "Could not connect"


def check_links(url: str) -> dict:
    """Test the links found on a page. Internal links first, up to MAX_LINK_CHECKS."""
    details = page_details(url)
    links = details["links"]
    todo = ([dict(i, kind="internal") for i in links["internal"]] +
            [dict(i, kind="external") for i in links["external"]])[:MAX_LINK_CHECKS]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda item: _link_status(item["url"]), todo))
    checked = []
    for item, (status, reason) in zip(todo, results):
        # 401 / 403 / 429 usually mean "robots not welcome", not a broken link.
        if status is None:
            state = "unknown"
        elif status in (401, 403, 429):
            state = "blocked"
        elif status >= 400:
            state = "broken"
        else:
            state = "ok"
        checked.append({"url": item["url"], "text": item["text"], "kind": item["kind"], "nofollow": item["nofollow"],
                        "status_code": status, "state": state, "reason": reason})
    return {"final_url": details["final_url"], "internal_total": links["internal_total"],
            "external_total": links["external_total"], "nofollow_total": links["nofollow_total"],
            "checked_total": len(checked), "not_checked": links["internal_total"] + links["external_total"] - len(checked),
            "broken": sum(1 for c in checked if c["state"] == "broken"), "checked": checked}


def _sitemap(url):
    out = {"url": _clip(url, 400), "found": False}
    try:
        resp = safe_get(url, headers=HEADERS, timeout=10)
        if resp.status_code != 200 or "<" not in resp.text:
            out["status_code"] = resp.status_code
            return out, []
        root = ET.fromstring(resp.text)
    except Exception:
        return out, []
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    out["found"] = True
    if "sitemapindex" in root.tag.lower():
        children = [c.find(f"{ns}loc").text.strip() for c in root.findall(f"{ns}sitemap")
                    if c.find(f"{ns}loc") is not None and c.find(f"{ns}loc").text]
        out.update(type="index", child_sitemaps=len(children))
        return out, children
    out.update(type="list", url_count=len(root.findall(f"{ns}url")))
    return out, []


def robots_details(url: str) -> dict:
    parsed = urlparse(_safe(url))
    base = f"{parsed.scheme}://{parsed.netloc}"
    out = {"site": base, "robots": {"found": False}, "sitemaps": []}
    declared = []
    try:
        resp = safe_get(f"{base}/robots.txt", headers=HEADERS, timeout=10)
    except UnsafeURLError as exc:
        raise PageError("invalid_url", str(exc))
    except Exception:
        raise PageError("site_unreachable", "The site could not be reached.")
    is_text = "html" not in (resp.headers.get("Content-Type") or "").lower()
    if resp.status_code == 200 and resp.text.strip() and is_text:
        groups, current, rules = [], None, []
        blocks_all = False
        for raw in resp.text.splitlines()[:3000]:
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (p.strip() for p in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if current is None or current["allow"] or current["disallow"]:
                    current = {"agents": [], "allow": 0, "disallow": 0, "crawl_delay": None}
                    groups.append(current)
                current["agents"].append(_clip(value, 80))
            elif key in ("allow", "disallow") and current is not None:
                if key == "disallow" and not value:
                    continue
                current[key] += 1
                if len(rules) < 60:
                    rules.append({"agent": ", ".join(current["agents"])[:80], "rule": key.capitalize(), "path": _clip(value, 200)})
                if key == "disallow" and value == "/" and "*" in current["agents"]:
                    blocks_all = True
            elif key == "crawl-delay" and current is not None:
                current["crawl_delay"] = _clip(value, 20)
            elif key == "sitemap":
                declared.append(value)
        out["robots"] = {"found": True, "size_bytes": len(resp.content), "groups": groups[:30],
                         "rules": rules, "rule_total": sum(g["allow"] + g["disallow"] for g in groups),
                         "blocks_all_crawlers": blocks_all, "sitemaps_declared": [_clip(s, 400) for s in declared[:10]]}
    else:
        out["robots"]["status_code"] = resp.status_code

    queue = declared[:5] or [f"{base}/sitemap.xml", f"{base}/sitemap_index.xml"]
    total = 0
    for sm in queue:
        info, children = _sitemap(sm)
        if not info["found"] and not declared:
            continue
        counted = 0
        for child in children[:10]:
            child_info, _ = _sitemap(child)
            counted += child_info.get("url_count", 0)
        if children:
            info["url_count"] = counted
            info["children_counted"] = min(10, len(children))
        total += info.get("url_count", 0)
        out["sitemaps"].append(info)
    out["sitemap_url_total"] = total
    return out


def ssl_details(url: str) -> dict:
    parsed = urlparse(_safe(url))
    host = parsed.hostname
    out = {"host": host}
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=8) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as tls:
                cert = tls.getpeercert()
                out.update(protocol=tls.version(), cipher=(tls.cipher() or [None])[0])
    except ssl.SSLCertVerificationError as exc:
        out.update(valid=False, problem=_clip(getattr(exc, "verify_message", "") or "The certificate could not be verified.", 160))
        return out
    except (socket.timeout, OSError):
        raise PageError("site_unreachable", "No secure connection could be made to that site (port 443).")
    fmt = "%b %d %H:%M:%S %Y %Z"
    start = datetime.datetime.strptime(cert["notBefore"], fmt)
    end = datetime.datetime.strptime(cert["notAfter"], fmt)
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    names = [v for k, v in cert.get("subjectAltName", []) if k == "DNS"]
    out.update(valid=True, issued_to=dict(x[0] for x in cert.get("subject", [])).get("commonName"),
               issuer=dict(x[0] for x in cert.get("issuer", [])).get("organizationName"),
               valid_from=start.date().isoformat(), valid_until=end.date().isoformat(),
               days_left=(end - now).days, names_total=len(names), names=names[:12])
    return out
