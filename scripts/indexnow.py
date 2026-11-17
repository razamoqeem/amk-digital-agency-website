"""Tell IndexNow search engines (Bing, Yandex, Seznam, Naver and others) about new or changed pages.

Run it AFTER a push has been deployed, from the website folder:
    .venv/Scripts/python.exe scripts/indexnow.py            send pages that are new or changed
    .venv/Scripts/python.exe scripts/indexnow.py --dry-run  only list what would be sent

It reads public/sitemap.xml, compares each page's <lastmod> with what was sent last time
(.indexnow-state.json, kept on this computer only) and sends just the new or changed addresses.
Google does not use IndexNow: Google re-reads the sitemap submitted once in Search Console.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, ".indexnow-state.json")
ENDPOINT = "https://api.indexnow.org/indexnow"


def main():
    dry = "--dry-run" in sys.argv
    settings = json.load(open(os.path.join(ROOT, "content", "settings.json"), encoding="utf-8"))
    key = str((settings.get("indexnow") or {}).get("key", ""))
    site = str(settings.get("site_url", "")).rstrip("/")
    if not re.fullmatch(r"[a-f0-9]{32}", key) or not site.startswith("https://"):
        print("IndexNow key or site_url missing in content/settings.json.")
        return 1
    xml = open(os.path.join(ROOT, "public", "sitemap.xml"), encoding="utf-8").read()
    pages = dict(re.findall(r"<loc>([^<]+)</loc>(?:<lastmod>([^<]*)</lastmod>)?", xml))
    sent = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {}
    todo = [u for u, mod in pages.items() if sent.get(u) != mod and u.startswith(site + "/")]
    if not todo:
        print("Nothing new or changed since the last run.")
        return 0
    print("%d address(es) to send%s:" % (len(todo), " (dry run)" if dry else ""))
    for u in todo:
        print("  " + u)
    if dry:
        return 0

    # The key file must be live first, or the search engines reject the request.
    try:
        with urllib.request.urlopen("%s/%s.txt" % (site, key), timeout=15) as r:
            if r.read().decode().strip() != key:
                raise ValueError("wrong content")
    except Exception as exc:
        print("The key file is not live yet (%s). Push and wait for the deploy, then run this again." % exc)
        return 1

    host = site.split("://", 1)[1]
    body = json.dumps({"host": host, "key": key, "keyLocation": "%s/%s.txt" % (site, key), "urlList": todo[:10000]}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status = r.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    # 200 = received, 202 = received and key check pending
    if status in (200, 202):
        sent.update({u: pages[u] for u in todo})
        json.dump(sent, open(STATE, "w", encoding="utf-8"), indent=1)
        print("Sent. IndexNow answered %d." % status)
        return 0
    print("IndexNow answered %d. Nothing was marked as sent; try again later." % status)
    return 1


if __name__ == "__main__":
    sys.exit(main())
