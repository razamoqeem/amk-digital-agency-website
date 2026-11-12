"""
AMK Digital Agency Website: tools service.

Real tools (SEO audit, site scan, domain age, and domain rank when a key is set)
behind a free-use limit:
3 runs per tool with no sign-up, 7 more after confirming an email address, then
the visitor is sent to the App. Also serves the built Website (public/) so the
whole site can be viewed and tested on one local address.

Run from the Website folder:
    .venv/Scripts/python.exe -m uvicorn api.main:app --port 8080
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .domain_rank import DomainRankError, get_domain_rank
from .domain_age import DomainAgeError, clean_domain, fetch_iana_list, get_domain_age
from .engine.deep_audit import CLIENT_ERROR_KINDS, run_deep_audit
from .engine.url_safety import UnsafeURLError, validate_public_url
from .store import Store

ROOT = Path(__file__).resolve().parent.parent


def _load_env_file():
    """Read Website/.env (if present) without overriding real environment values."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


_load_env_file()


def _url_setting(name):
    value = os.getenv(name, "").strip().rstrip("/")
    return value if re.match(r"^https?://", value) else ""


def _int_setting(name, default):
    try:
        return max(0, int(os.getenv(name, "")))
    except ValueError:
        return default


SITE_URL = _url_setting("SITE_URL")
APP_URL = _url_setting("APP_URL")
API_URL = _url_setting("API_URL")
ANON_RUNS = _int_setting("TOOLS_ANON_RUNS", 3)        # runs per tool with no email
TOTAL_RUNS = _int_setting("TOOLS_TOTAL_RUNS", 10)     # runs per tool in total
IP_DAILY_RUNS = _int_setting("TOOLS_IP_DAILY_RUNS", 30)
RATE_PER_MINUTE = _int_setting("TOOLS_RATE_PER_MINUTE", 20)
CACHE_SECONDS = _int_setting("TOOLS_CACHE_HOURS", 24) * 3600
# Self-chosen daily ceilings that protect the machine this runs on. Not provider quotas.
DAILY_LIMITS = {"crawl": _int_setting("TOOLS_CRAWL_DAILY_LIMIT", 500),
                "registry": _int_setting("TOOLS_REGISTRY_DAILY_LIMIT", 500),
                "rank": _int_setting("TOOLS_RANK_DAILY_LIMIT", 500)}
TURNSTILE_SECRET = os.getenv("TURNSTILE_SECRET", "").strip()
OPEN_PAGERANK_KEY = os.getenv("OPEN_PAGERANK_KEY", "").strip()
TOOLS = {"seo-audit": "crawl", "site-scan": "crawl", "domain-age": "registry"}
if OPEN_PAGERANK_KEY:                      # domain rank is switched on only when a key is set
    TOOLS["domain-rank"] = "rank"

DATA_DIR = Path(os.getenv("TOOLS_DATA_DIR", "") or (ROOT / "api" / "data"))
store = Store(DATA_DIR / "tools.db")


def _secret() -> bytes:
    """Signing key: TOOLS_SECRET if set, otherwise a random one kept in the data folder."""
    value = os.getenv("TOOLS_SECRET", "").strip()
    if value:
        return value.encode()
    path = DATA_DIR / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_hex(32), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip().encode()


SECRET = _secret()


def keyed_hash(kind: str, value: str) -> str:
    return hmac.new(SECRET, f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()[:40]


app = FastAPI(title="AMK Digital Agency Website tools", docs_url=None, redoc_url=None, openapi_url=None)

_origins = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=True,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.middleware("http")
async def api_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/v1/") or request.url.path == "/js/config.js":
        response.headers["Cache-Control"] = "no-store"
    return response


# ── Visitor ────────────────────────────────────────────────────────────────
COOKIE = "amk_vid"


def _visitor(request: Request):
    """Return (visitor_id, is_new). The cookie carries a random id plus a signature."""
    raw = request.cookies.get(COOKIE, "")
    if "." in raw:
        vid, sig = raw.split(".", 1)
        if re.fullmatch(r"[a-f0-9]{32}", vid) and hmac.compare_digest(sig, keyed_hash("vid", vid)):
            return vid, False
    return secrets.token_hex(16), True


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _runs(vid: str, tool: str) -> dict:
    email_hash = store.visitor_email(vid)
    if email_hash:
        used, stage = store.get_usage("email", email_hash, tool), "email"
    else:
        used, stage = store.get_usage("visitor", vid, tool), "anonymous"
    used = min(used, TOTAL_RUNS)
    return {"used": used, "limit": TOTAL_RUNS, "remaining": TOTAL_RUNS - used, "stage": stage,
            "free_without_email": ANON_RUNS}


def _reply(request, vid, is_new, status, body, retry_after=None):
    response = JSONResponse(status_code=status, content=body)
    if retry_after:
        response.headers["Retry-After"] = str(retry_after)
    if is_new:
        response.set_cookie(COOKIE, f"{vid}.{keyed_hash('vid', vid)}", max_age=365 * 24 * 3600,
                            httponly=True, samesite="lax", secure=request.url.scheme == "https", path="/")
    return response


def _fail(request, vid, is_new, tool, status, code, message, retry_after=None):
    body = {"ok": False, "tool": tool, "error": {"code": code, "message": message}}
    if tool in TOOLS:
        body["runs"] = _runs(vid, tool)
    if code == "upgrade_required":
        body["upgrade_url"] = f"{APP_URL}/signup?ref={tool}" if APP_URL else ""
    return _reply(request, vid, is_new, status, body, retry_after)


def _rate_limited(request) -> bool:
    return store.rate_hit(keyed_hash("ip", _client_ip(request))) > RATE_PER_MINUTE


def _bot_check_ok(token: str, request: Request) -> bool:
    """Cloudflare Turnstile. Switched off until TURNSTILE_SECRET is set."""
    if not TURNSTILE_SECRET:
        return True
    if not token or len(token) > 2048:
        return False
    try:
        result = requests.post("https://challenges.cloudflare.com/turnstile/v0/siteverify",
                               data={"secret": TURNSTILE_SECRET, "response": token,
                                     "remoteip": _client_ip(request)}, timeout=8).json()
        return bool(result.get("success"))
    except Exception:
        return False


def _run_tool(request: Request, tool: str, cache_key: str, token: str, work, shape):
    """
    The shared path for every tool (order from AUDIT_REPORT.md section 14.1):
    rate limit, cache, bot check, run quota, daily budget, then the real work.
    ``work()`` returns data to cache or raises ToolFailure; ``shape(data)`` builds the reply.
    """
    vid, is_new = _visitor(request)
    if _rate_limited(request):
        return _fail(request, vid, is_new, tool, 429, "rate_limited",
                     "Too many requests. Please wait a minute and try again.", 60)

    cached = store.cache_get(cache_key)
    if cached is not None:
        return _reply(request, vid, is_new, 200,
                      {"ok": True, "tool": tool, "cached": True, "runs": _runs(vid, tool), "data": shape(cached)})

    if not _bot_check_ok(token, request):
        return _fail(request, vid, is_new, tool, 403, "bot_check_failed",
                     "Please complete the check and try again.")

    runs = _runs(vid, tool)
    if runs["used"] >= TOTAL_RUNS:
        return _fail(request, vid, is_new, tool, 402, "upgrade_required",
                     f"You have used all {TOTAL_RUNS} free runs of this tool.")
    if runs["stage"] == "anonymous" and runs["used"] >= ANON_RUNS:
        return _fail(request, vid, is_new, tool, 401, "email_required",
                     f"You have used your {ANON_RUNS} free runs. Confirm your email address to get "
                     f"{TOTAL_RUNS - ANON_RUNS} more.")

    today = datetime.now(timezone.utc).date().isoformat()
    ip_key = keyed_hash("ip", _client_ip(request))
    if store.get_usage("ip", ip_key, tool, today) >= IP_DAILY_RUNS:
        return _fail(request, vid, is_new, tool, 429, "rate_limited",
                     "This network has reached today's free limit for this tool. Please try again tomorrow.", 3600)

    upstream = TOOLS[tool]
    if store.budget_calls(upstream, today) >= 0.8 * DAILY_LIMITS[upstream]:
        return _fail(request, vid, is_new, tool, 503, "busy",
                     "The free tools are in high demand right now. Please try again later.", 3600)

    try:
        data = work()
    except ToolFailure as failure:
        return _fail(request, vid, is_new, tool, failure.status, failure.code, failure.message)
    except Exception:
        return _fail(request, vid, is_new, tool, 500, "tool_error",
                     "Something went wrong while running this tool. Please try again.")

    email_hash = store.visitor_email(vid)
    if email_hash:
        store.incr_usage("email", email_hash, tool)
    else:
        store.incr_usage("visitor", vid, tool)
    store.incr_usage("ip", ip_key, tool, today)
    store.budget_add(upstream, today)
    store.cache_set(cache_key, data, CACHE_SECONDS)
    return _reply(request, vid, is_new, 200,
                  {"ok": True, "tool": tool, "cached": False, "runs": _runs(vid, tool), "data": shape(data)})


class ToolFailure(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


async def _body(request: Request) -> dict:
    try:
        raw = await request.body()
        data = json.loads(raw[:10000] or b"{}")
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


# ── Crawl-based tools ──────────────────────────────────────────────────────
def _checked_url(text):
    try:
        url = validate_public_url(str(text or ""))
    except UnsafeURLError as exc:
        raise ToolFailure(400, "invalid_url", str(exc))
    parsed = urlparse(url)
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{parsed.path or '/'}" + \
        (f"?{parsed.query}" if parsed.query else "")


def _crawl(url):
    report = run_deep_audit(url)
    if report.get("fetched") is False:
        error = report.get("error") or {}
        if error.get("kind") in CLIENT_ERROR_KINDS:
            raise ToolFailure(400, "invalid_url", error.get("message") or "Please enter a valid website address.")
        raise ToolFailure(422, "site_unreachable", error.get("message") or "That site could not be read.")
    return report


def _audit_shape(report):
    sections = report.get("sections", {})
    security, crawl = sections.get("security", {}), sections.get("crawlability", {})
    on_page = sections.get("on_page", {})
    meta_robots = (sections.get("indexability", {}).get("meta_robots") or "")
    if "noindex" in meta_robots:
        crawler = "Blocked from search (noindex)"
    elif not crawl.get("robots_txt"):
        crawler = "Allowed (no robots.txt found)"
    else:
        crawler = "Open to search engines"
    findings = report.get("findings", [])
    return {
        "domain": urlparse(report.get("final_url") or report.get("url") or "").netloc,
        "score": report.get("score"),
        "grade": report.get("grade"),
        "issue_counts": report.get("issue_counts", {}),
        "total_issues": report.get("total_issues", 0),
        "metrics": {
            "crawler_access": crawler,
            "https": "Secure (HTTPS)" if security.get("https") else "Not secure (no HTTPS)",
            "word_count": on_page.get("word_count"),
        },
        "most_important_fix": (f"{findings[0]['title']}: {findings[0].get('recommendation') or ''}".strip(": ")
                               if findings else ""),
        "top_findings": [{"severity": f["severity"], "title": f["title"]} for f in findings[:5]],
    }


def _scan_shape(keyword):
    def shape(report):
        sections = report.get("sections", {})
        on_page = sections.get("on_page", {})
        match = None
        if keyword:
            match = {"in_title": keyword in (on_page.get("title") or "").lower(),
                     "in_description": keyword in (on_page.get("meta_description") or "").lower()}
        data = {name: sections.get(name, {}) for name in (
            "on_page", "images", "structured_data", "security", "crawlability",
            "international", "tech_stack", "llms_txt", "social")}
        data.update({"domain": urlparse(report.get("final_url") or report.get("url") or "").netloc,
                     "score": report.get("score"), "keyword_match": match})
        return data
    return shape


@app.post("/v1/tools/seo-audit")
async def seo_audit(request: Request):
    body = await _body(request)
    return await _crawl_tool(request, "seo-audit", body, _audit_shape)


@app.post("/v1/tools/site-scan")
async def site_scan(request: Request):
    body = await _body(request)
    keyword = str(body.get("keyword") or "").strip().lower()[:100]
    return await _crawl_tool(request, "site-scan", body, _scan_shape(keyword))


async def _crawl_tool(request, tool, body, shape):
    from starlette.concurrency import run_in_threadpool
    try:
        url = _checked_url(body.get("url"))
    except ToolFailure as failure:
        vid, is_new = _visitor(request)
        return _fail(request, vid, is_new, tool, failure.status, failure.code, failure.message)
    # Both crawl tools share one saved result per address, so a second tool on the same page is free.
    key = "crawl:" + hashlib.sha256(url.encode()).hexdigest()
    return await run_in_threadpool(_run_tool, request, tool, key, str(body.get("turnstile_token") or ""),
                                   lambda: _crawl(url), shape)


# ── Domain age ─────────────────────────────────────────────────────────────
def _iana_list():
    cached = store.cache_get("iana-rdap-list")
    if cached is None:
        cached = fetch_iana_list()
        store.cache_set("iana-rdap-list", cached, 24 * 3600)
    return cached


_AGE_STATUS = {"invalid_domain": 400, "not_found": 404, "not_available": 404, "lookup_failed": 422}


@app.post("/v1/tools/domain-age")
async def domain_age(request: Request):
    from starlette.concurrency import run_in_threadpool
    body = await _body(request)
    try:
        domain = clean_domain(str(body.get("domain") or ""))
    except DomainAgeError as exc:
        vid, is_new = _visitor(request)
        return _fail(request, vid, is_new, "domain-age", 400, exc.code, exc.message)

    def work():
        try:
            return get_domain_age(domain, _iana_list)
        except DomainAgeError as exc:
            raise ToolFailure(_AGE_STATUS.get(exc.code, 422), exc.code, exc.message)

    def shape(data):
        # Age is worked out again on every reply so a saved result never shows a stale number.
        registered = datetime.fromisoformat(data["registered_on"]).replace(tzinfo=timezone.utc)
        days = max(0, (datetime.now(timezone.utc) - registered).days)
        return {**data, "age_days": days, "age_years": round(days / 365.25, 1)}

    return await run_in_threadpool(_run_tool, request, "domain-age", "age:" + domain,
                                   str(body.get("turnstile_token") or ""), work, shape)


# ── Domain rank ────────────────────────────────────────────────────────────
_RANK_STATUS = {"not_found": 404, "busy": 503, "lookup_failed": 422}


@app.post("/v1/tools/domain-rank")
async def domain_rank(request: Request):
    from starlette.concurrency import run_in_threadpool
    body = await _body(request)
    vid, is_new = _visitor(request)
    if "domain-rank" not in TOOLS:
        return _fail(request, vid, is_new, "domain-rank", 404, "not_available",
                     "This tool is not switched on yet.")
    try:
        domain = clean_domain(str(body.get("domain") or ""))
    except DomainAgeError as exc:
        return _fail(request, vid, is_new, "domain-rank", 400, exc.code, exc.message)

    def work():
        try:
            return get_domain_rank(domain, OPEN_PAGERANK_KEY)
        except DomainRankError as exc:
            raise ToolFailure(_RANK_STATUS.get(exc.code, 422), exc.code, exc.message)

    return await run_in_threadpool(_run_tool, request, "domain-rank", "rank:" + domain,
                                   str(body.get("turnstile_token") or ""), work, lambda data: data)


# ── Usage, leads, health ───────────────────────────────────────────────────
@app.get("/v1/usage")
def usage(request: Request):
    vid, is_new = _visitor(request)
    return _reply(request, vid, is_new, 200,
                  {"ok": True, "runs": {tool: _runs(vid, tool) for tool in TOOLS},
                   "upgrade_url": f"{APP_URL}/signup" if APP_URL else ""})


EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


@app.post("/v1/leads")
async def add_lead(request: Request):
    vid, is_new = _visitor(request)
    body = await _body(request)
    if _rate_limited(request):
        return _fail(request, vid, is_new, "leads", 429, "rate_limited",
                     "Too many requests. Please wait a minute and try again.", 60)
    email = str(body.get("email") or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        return _fail(request, vid, is_new, "leads", 400, "invalid_email", "Please enter a valid email address.")
    if not _bot_check_ok(str(body.get("turnstile_token") or ""), request):
        return _fail(request, vid, is_new, "leads", 403, "bot_check_failed",
                     "Please complete the check and try again.")
    tool = str(body.get("tool") or "")
    token = secrets.token_urlsafe(32)
    store.save_pending_lead(keyed_hash("email", email), email, keyed_hash("token", token), vid,
                            tool if tool in TOOLS else "")
    base = API_URL or str(request.base_url).rstrip("/")
    link = f"{base}/v1/leads/confirm?token={token}"
    # No email-sending service is connected yet (owner decision pending). Until then the
    # confirmation link is shown only in this service's own window, for local testing.
    print(f"\n[local test] Confirmation link for the email just entered:\n  {link}\n", flush=True)
    return _reply(request, vid, is_new, 200,
                  {"ok": True, "status": "confirmation_pending", "delivery": "local_window"})


@app.get("/v1/leads/confirm")
def confirm_lead(token: str = ""):
    back = (SITE_URL or "") + "/tools/free-tools.html"
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,100}", token or ""):
        return RedirectResponse(back + "?confirmed=0", status_code=303)
    row = store.confirm_lead(keyed_hash("token", token))
    if not row:
        return RedirectResponse(back + "?confirmed=0", status_code=303)
    email_hash, visitor_id = row
    if visitor_id:
        # Runs already used anonymously count towards the email's total.
        for tool in TOOLS:
            store.raise_usage_to("email", email_hash, tool, store.get_usage("visitor", visitor_id, tool))
    return RedirectResponse(back + "?confirmed=1", status_code=303)


@app.get("/v1/health")
def health():
    return {"ok": True}


# ── The Website itself (local viewing) ─────────────────────────────────────
@app.get("/js/config.js")
def config_js(request: Request):
    """Site addresses from .env, so no address is ever written into a committed file."""
    settings = {"siteUrl": SITE_URL, "appUrl": APP_URL,
                "apiUrl": API_URL or str(request.base_url).rstrip("/")}
    return Response("window.AMK_SITE = " + json.dumps(settings) + ";\n", media_type="application/javascript")


if (ROOT / "public").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "public", html=True), name="site")
