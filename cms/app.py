"""
Website CMS — local admin.

Runs on this PC only:   python cms/app.py     then open http://127.0.0.1:8090

It edits the files in content/ and runs the build. It is never deployed: the
cms/ folder is not part of public/. There is no login because it only listens
on 127.0.0.1 and refuses every request that is not from this machine.
"""
import ipaddress
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import build as site_build  # noqa: E402
import collections_engine  # noqa: E402
from sanitize import clean_rich_text  # noqa: E402
from validate import SLUG_RE, heading_outline, validate_page, page_url_path  # noqa: E402

HOST = "127.0.0.1"
PORT = 8090
ALLOWED_HOSTS = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT}
ALLOWED_ORIGINS = {"http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT}

app = FastAPI(title="KivoReach Website CMS", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def local_only(request: Request, call_next):
    """Refuse anything that is not this machine talking to this exact address."""
    client = request.client.host if request.client else ""
    try:
        is_local = ipaddress.ip_address(client).is_loopback
    except ValueError:
        is_local = False
    if not is_local or request.headers.get("host", "") not in ALLOWED_HOSTS:
        return JSONResponse(status_code=403, content={"detail": "The CMS only works on this computer."})
    if request.method not in ("GET", "HEAD"):
        # Other websites open in the browser must not be able to post here.
        origin = request.headers.get("origin", "")
        if origin not in ALLOWED_ORIGINS or request.headers.get("x-amk-cms") != "1":
            return JSONResponse(status_code=403, content={"detail": "Request refused."})
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self'; style-src 'self'; "
                                                   "img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


def _page_path(slug: str) -> str:
    if not SLUG_RE.match(slug or ""):
        raise HTTPException(status_code=400, detail="Invalid slug.")
    return os.path.join(site_build.PAGES_DIR, site_build.page_file_name(slug))


def _clean_page(raw: dict) -> dict:
    """Keep only known fields and clean every rich-text field before saving."""
    blocks = []
    for b in raw.get("blocks") or []:
        if not isinstance(b, dict):
            continue
        kind = b.get("type")
        block = {"type": kind}
        if kind == "heading":
            block.update(level=b.get("level"), text=str(b.get("text", "")).strip())
        elif kind == "paragraph":
            block.update(html=clean_rich_text(str(b.get("html", ""))))
        elif kind == "list":
            block.update(ordered=bool(b.get("ordered")),
                         items=[clean_rich_text(str(i)) for i in (b.get("items") or []) if str(i).strip()])
        elif kind == "image":
            block.update(src=str(b.get("src", "")).strip(), alt=str(b.get("alt", "")).strip(),
                         width=b.get("width"), height=b.get("height"))
        elif kind == "button":
            block.update(label=str(b.get("label", "")).strip(), href=str(b.get("href", "")).strip())
        elif kind == "faq":
            block.update(question=str(b.get("question", "")).strip(), answer=clean_rich_text(str(b.get("answer", ""))))
        elif kind == "tool-embed":
            block.update(tool=b.get("tool"))
        for token in ("size", "color", "opacity"):
            if b.get(token) is not None:
                block[token] = b[token]
        blocks.append(block)
    og = raw.get("og") or {}
    return {
        "slug": str(raw.get("slug", "")).strip(),
        "title": str(raw.get("title", "")).strip(),
        "description": str(raw.get("description", "")).strip(),
        "canonical": str(raw.get("canonical", "")).strip(),
        "noindex": bool(raw.get("noindex")),
        "draft": bool(raw.get("draft")),
        "og": {k: str(og.get(k, "")).strip() for k in ("title", "description", "image")},
        "schema": [s for s in (raw.get("schema") or []) if isinstance(s, str)],
        "blocks": blocks,
    }


LIMITS_PATH = os.path.join(site_build.CONTENT, "limits.json")
TOOLS_PATH = os.path.join(site_build.CONTENT, "tools.json")


@app.get("/api/settings")
def api_settings():
    s = site_build.load_settings()
    return {"tokens": s.get("tokens", {}), "site_name": s.get("site_name", ""), "site_url": site_build.site_url(),
            "schema_types": ["Organization", "WebSite", "Article", "FAQ", "BreadcrumbList"]}


@app.get("/api/limits")
def api_get_limits():
    """Read usage limits and available tools list."""
    limits = site_build.read_json(LIMITS_PATH, default={})
    tools_cfg = site_build.read_json(TOOLS_PATH, default={})
    tools = []
    for t in tools_cfg.get("tools", []):
        slug = t.get("slug")
        if slug and slug != "title-generator":
            tools.append({"slug": slug, "name": t.get("name") or slug})
    return {"limits": limits, "tools": tools}


@app.put("/api/limits")
async def api_save_limits(request: Request):
    """Validate and save usage limits to content/limits.json."""
    raw = await request.json()
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Invalid data format.")

    def _num(val, default=0, min_val=0, max_val=1000000):
        try:
            return max(min_val, min(max_val, int(val)))
        except (ValueError, TypeError):
            return default

    enabled = bool(raw.get("enabled", True))
    warn_percent = _num(raw.get("warn_percent"), default=80, min_val=1, max_val=100)
    runs_before_email = _num(raw.get("runs_before_email"), default=3, min_val=0)

    free_raw = raw.get("free") if isinstance(raw.get("free"), dict) else {}
    free = {
        "daily": _num(free_raw.get("daily"), 10),
        "monthly": _num(free_raw.get("monthly"), 100),
        "session": _num(free_raw.get("session"), 10),
    }

    testers_raw = raw.get("testers") if isinstance(raw.get("testers"), dict) else {}
    testers = {
        "unlimited": bool(testers_raw.get("unlimited", True)),
        "daily": _num(testers_raw.get("daily"), 500),
        "monthly": _num(testers_raw.get("monthly"), 5000),
        "session": _num(testers_raw.get("session"), 500),
    }

    tools_raw = raw.get("tools") if isinstance(raw.get("tools"), dict) else {}
    tools = {}
    for slug, conf in tools_raw.items():
        if isinstance(conf, dict) and "daily" in conf:
            d = _num(conf.get("daily"), 0)
            if d > 0:
                tools[str(slug)] = {"daily": d}

    clean_limits = {
        "_help": "Free-use limits for the Website tools. Edit the numbers and save: the service reads this file again on the next request, no restart needed. 0 means no limit for that period. Tester email addresses are NOT kept here: put them in .env as TESTER_EMAILS.",
        "enabled": enabled,
        "warn_percent": warn_percent,
        "runs_before_email": runs_before_email,
        "free": free,
        "testers": testers,
        "tools": tools,
    }
    site_build.write_json(LIMITS_PATH, clean_limits)
    return {"saved": True, "limits": clean_limits}


# ── Collections & Folders ────────────────────────────────────
@app.get("/api/collections")
def api_get_collections():
    """List collection schemas, hierarchical folders, and all collection items."""
    return {
        "schemas": collections_engine.load_schemas().get("collections", []),
        "folders": collections_engine.load_folders(),
        "items": collections_engine.list_items()
    }


@app.get("/api/collections/{collection_id}/items")
def api_get_collection_items(collection_id: str):
    schema = collections_engine.get_schema(collection_id)
    if not schema:
        raise HTTPException(status_code=404, detail="Collection not found.")
    items = collections_engine.list_items(collection_id)
    return {"collection": schema, "items": items}


@app.get("/api/collections/{collection_id}/items/{slug}")
def api_get_collection_item(collection_id: str, slug: str):
    item = collections_engine.get_item(collection_id, slug)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")
    schema = collections_engine.get_schema(collection_id)
    return {"item": item, "schema": schema, "folders": collections_engine.load_folders()}


@app.put("/api/collections/{collection_id}/items/{slug}")
async def api_save_collection_item(collection_id: str, slug: str, request: Request):
    raw = await request.json()
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Invalid data format.")
    try:
        saved = collections_engine.save_item(collection_id, raw)
        return {"saved": True, "item": saved}
    except ValueError as e:
        return JSONResponse(status_code=422, content={"saved": False, "error": str(e)})


@app.delete("/api/collections/{collection_id}/items/{slug}")
def api_delete_collection_item(collection_id: str, slug: str):
    collections_engine.ensure_dirs()
    item_file = collections_engine.COLLECTIONS_DIR / collection_id / f"{slug}.json"
    if not item_file.exists():
        raise HTTPException(status_code=404, detail="Item not found.")
    try:
        item_file.unlink()
        return {"deleted": True, "slug": slug}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/folders")
def api_get_folders():
    return {"folders": collections_engine.load_folders()}


@app.get("/api/pages")
def api_pages():
    settings = site_build.load_settings()
    out, seen = [], set()
    for page in site_build.load_pages():
        errors, warnings = validate_page(page, settings, other_slugs=seen)
        seen.add(page.get("slug"))
        out.append({"slug": page.get("slug"), "title": page.get("title"), "noindex": bool(page.get("noindex")),
                    "draft": bool(page.get("draft")), "errors": len(errors), "warnings": len(warnings)})
    return {"pages": out}


@app.get("/api/pages/{slug:path}")
def api_page(slug: str):
    path = _page_path(slug)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Page not found.")
    return site_build.read_json(path)


@app.post("/api/check")
async def api_check(request: Request):
    """Validate without saving (used while typing)."""
    page = _clean_page(await request.json())
    errors, warnings = validate_page(page, site_build.load_settings())
    return {"errors": errors, "warnings": warnings, "outline": heading_outline(page["blocks"]), "page": page}


@app.put("/api/pages/{slug:path}")
async def api_save(slug: str, request: Request):
    """Save a page. `slug` in the address is the page's CURRENT slug ("new" for a new page)."""
    page = _clean_page(await request.json())
    settings = site_build.load_settings()
    existing = {p.get("slug") for p in site_build.load_pages()}
    is_new = slug == "new"
    if not is_new and slug not in existing:
        raise HTTPException(status_code=404, detail="Page not found.")
    others = existing - ({slug} if not is_new else set())
    errors, warnings = validate_page(page, settings, other_slugs=others)
    if errors:
        return JSONResponse(status_code=422, content={"saved": False, "errors": errors, "warnings": warnings})

    new_slug = page["slug"]
    site_build.write_json(_page_path(new_slug), page)
    redirect_added = None
    if not is_new and new_slug != slug:
        os.remove(_page_path(slug))
        redirects = site_build.load_redirects()
        old_path, new_path = page_url_path(slug), page_url_path(new_slug)
        # point earlier redirects at the newest address and drop any loop back to the old one
        redirects = [r for r in redirects if r.get("from") != new_path]
        for r in redirects:
            if r.get("to") == old_path:
                r["to"] = new_path
        redirects.append({"from": old_path, "to": new_path, "status": 301})
        site_build.write_json(os.path.join(site_build.CONTENT, "redirects.json"), redirects)
        redirect_added = {"from": old_path, "to": new_path}
    return {"saved": True, "slug": new_slug, "errors": [], "warnings": warnings, "redirect_added": redirect_added}


@app.post("/api/build")
def api_build():
    report = site_build.build()
    return JSONResponse(status_code=200 if report["ok"] else 422, content=report)


@app.get("/")
def admin_home():
    return FileResponse(os.path.join(HERE, "static", "admin.html"))


app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


if __name__ == "__main__":
    import uvicorn
    if HOST != "127.0.0.1":
        sys.exit("The CMS must only listen on 127.0.0.1.")
    print("Website CMS: http://%s:%d  (this computer only; press Ctrl+C to stop)" % (HOST, PORT))
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
