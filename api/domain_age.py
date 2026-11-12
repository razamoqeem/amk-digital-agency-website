"""
Domain age from the public registration record.

First choice is RDAP (the registries' official JSON service, found through the
IANA list). Some endings (for example .pk, .io, .de) are not on that list; for
those only, the older WHOIS service is tried instead. If neither has a
registration date, we say so. Nothing is estimated.
"""
import re
from datetime import datetime, timezone

from .engine.url_safety import safe_get

IANA_LIST = "https://data.iana.org/rdap/dns.json"
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")
HEADERS = {"Accept": "application/rdap+json, application/json", "User-Agent": "AMK-Domain-Age/1.0"}


class DomainAgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def clean_domain(text: str) -> str:
    """Turn typed text into a bare domain, or raise DomainAgeError."""
    d = (text or "").strip().lower()
    d = re.sub(r"^[a-z][a-z0-9+.-]*://", "", d).split("/")[0].split("?")[0].split("#")[0]
    d = d.split("@")[-1].split(":")[0].rstrip(".")
    if d.startswith("www."):
        d = d[4:]
    try:
        d = d.encode("idna").decode("ascii")
    except UnicodeError:
        raise DomainAgeError("invalid_domain", "Please enter a valid domain name, for example example.com.")
    if not DOMAIN_RE.match(d):
        raise DomainAgeError("invalid_domain", "Please enter a valid domain name, for example example.com.")
    return d


def _parse_date(text):
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _result(domain, created, expires, registrar, source):
    now = datetime.now(timezone.utc)
    age_days = max(0, (now - created).days)
    return {
        "domain": domain,
        "registered_on": created.date().isoformat(),
        "expires_on": expires.date().isoformat() if expires else None,
        "age_days": age_days,
        "age_years": round(age_days / 365.25, 1),
        "registrar": (str(registrar)[:120] if registrar else None),
        "source": source,
    }


def rdap_servers(load_list) -> dict:
    """Map of domain ending -> RDAP base address. ``load_list`` returns the IANA JSON."""
    out = {}
    for endings, urls in (load_list() or {}).get("services", []):
        https = [u for u in urls if u.startswith("https://")]
        if https:
            for ending in endings:
                out[ending.lower()] = https[0].rstrip("/")
    return out


def fetch_iana_list() -> dict:
    resp = safe_get(IANA_LIST, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _registrar_name(record):
    for entity in record.get("entities") or []:
        if "registrar" in (entity.get("roles") or []):
            for item in (entity.get("vcardArray") or [None, []])[1]:
                if item and item[0] == "fn":
                    return item[3]
    return None


def _from_rdap(domain, base):
    labels = domain.split(".")
    # A sub-domain has no record of its own: try the name, then its parents.
    for start in range(0, max(1, len(labels) - 1)):
        name = ".".join(labels[start:])
        if name.count(".") < 1:
            break
        try:
            resp = safe_get(f"{base}/domain/{name}", headers=HEADERS, timeout=10)
        except Exception:
            raise DomainAgeError("lookup_failed", "The domain registry did not answer. Please try again later.")
        if resp.status_code == 404:
            continue
        if resp.status_code == 429:
            raise DomainAgeError("lookup_failed", "The domain registry is busy. Please try again in a few minutes.")
        if resp.status_code != 200:
            raise DomainAgeError("lookup_failed", "The domain registry did not answer. Please try again later.")
        try:
            record = resp.json()
        except ValueError:
            raise DomainAgeError("lookup_failed", "The domain registry sent an unreadable answer.")
        events = {e.get("eventAction"): e.get("eventDate") for e in record.get("events") or []}
        created = _parse_date(events.get("registration"))
        if created is None:
            raise DomainAgeError("not_available", f"The registry does not publish a registration date for {name}.")
        return _result(name, created, _parse_date(events.get("expiration")), _registrar_name(record), "rdap")
    raise DomainAgeError("not_found", f"{domain} does not appear to be registered.")


def _from_whois(domain):
    try:
        import whois
    except ImportError:
        raise DomainAgeError("not_available", f"Domain age is not available for .{domain.rsplit('.', 1)[-1]} domains.")
    try:
        record = whois.whois(domain)
    except Exception as exc:
        text = str(exc).lower()
        if "no match" in text or "not found" in text:
            raise DomainAgeError("not_found", f"{domain} does not appear to be registered.")
        raise DomainAgeError("not_available", f"Domain age is not available for .{domain.rsplit('.', 1)[-1]} domains.")

    def first(value):
        values = value if isinstance(value, (list, tuple)) else [value]
        values = [v for v in values if isinstance(v, datetime)]
        if not values:
            return None
        dt = min(values)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    created = first(getattr(record, "creation_date", None))
    if created is None:
        raise DomainAgeError("not_available", f"No public registration date was found for {domain}.")
    registrar = getattr(record, "registrar", None)
    if isinstance(registrar, (list, tuple)):
        registrar = registrar[0] if registrar else None
    return _result(domain, created, first(getattr(record, "expiration_date", None)), registrar, "whois")


def get_domain_age(domain: str, load_list=fetch_iana_list) -> dict:
    """``domain`` must already be cleaned with clean_domain()."""
    ending = domain.rsplit(".", 1)[-1]
    try:
        servers = rdap_servers(load_list)
    except Exception:
        servers = {}
    if ending in servers:
        return _from_rdap(domain, servers[ending])
    return _from_whois(domain)
