"""
URL safety for anything that fetches or shells out with a user-supplied URL.

Two entry points:

* ``validate_public_url(url)`` — normalise a user-typed address and reject
  anything that is not a plain http(s) URL on a public host. Raises
  ``UnsafeURLError`` (a ``ValueError``) with a message safe to show the user.
* ``safe_get(url, **kwargs)`` — ``requests.get`` that validates the URL and
  every redirect hop, so a public URL cannot bounce the crawler onto an
  internal address.

No project imports here on purpose: the audit engines, the API routes and
(later) the MCP tools can all share it.
"""
import ipaddress
import socket
from urllib.parse import urlparse, urljoin

import requests

MAX_URL_LENGTH = 2048
MAX_REDIRECTS = 5
MAX_BODY_BYTES = 3 * 1024 * 1024   # larger pages are cut off, never read fully
ALLOWED_PORTS = (80, 443)

# Characters that have no business in a URL typed into an audit box. Several
# are shell metacharacters; rejecting them is defence in depth on top of
# never passing URLs through a shell.
_FORBIDDEN_CHARS = set('"\'<>`^|\\{}')

_BLOCKED_HOSTNAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"}
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp")


class UnsafeURLError(ValueError):
    """The URL is malformed or points somewhere we refuse to fetch."""


def _is_public_ip(ip_text: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return ip.is_global and not ip.is_multicast


def _resolve(host: str):
    """Return the set of IPs a hostname resolves to, or None if it doesn't resolve."""
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError):
        return None
    return {info[4][0].split("%")[0] for info in infos}


def validate_public_url(url: str) -> str:
    """
    Return a normalised http(s) URL, or raise UnsafeURLError.

    A bare domain ("example.com") gets "https://" prepended. Only ports 80 and
    443 are allowed, and a host that does not resolve is refused.
    """
    if not isinstance(url, str):
        raise UnsafeURLError("A website URL is required.")
    url = url.strip()
    if not url:
        raise UnsafeURLError("A website URL is required.")
    if len(url) > MAX_URL_LENGTH:
        raise UnsafeURLError("That URL is too long.")
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in url):
        raise UnsafeURLError("That doesn't look like a valid website address.")
    if any(ch in _FORBIDDEN_CHARS for ch in url):
        raise UnsafeURLError("That URL contains characters that are not allowed.")

    if "://" not in url:
        url = "https://" + url

    try:
        parsed = urlparse(url)
        port = parsed.port  # raises ValueError on a malformed port
    except ValueError:
        raise UnsafeURLError("That doesn't look like a valid website address.")

    if parsed.scheme.lower() not in ("http", "https"):
        raise UnsafeURLError("Only http:// and https:// addresses can be audited.")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeURLError("URLs containing a username or password are not allowed.")

    host = (parsed.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeURLError("That doesn't look like a valid website address.")
    if port is not None and port not in ALLOWED_PORTS:
        raise UnsafeURLError("That doesn't look like a valid website address.")

    if host in _BLOCKED_HOSTNAMES or host.endswith(_BLOCKED_SUFFIXES):
        raise UnsafeURLError("Internal or private addresses cannot be audited.")

    # Literal IP address?
    try:
        ipaddress.ip_address(host)
        is_ip_literal = True
    except ValueError:
        is_ip_literal = False

    if is_ip_literal:
        if not _is_public_ip(host):
            raise UnsafeURLError("Internal or private addresses cannot be audited.")
    else:
        if "." not in host:
            raise UnsafeURLError("That doesn't look like a valid website address.")
        ips = _resolve(host)
        if ips is None:
            raise UnsafeURLError("That domain doesn't appear to exist. Check the address for typos.")
        if not all(_is_public_ip(ip) for ip in ips):
            raise UnsafeURLError("Internal or private addresses cannot be audited.")

    return url


def is_public_url(url: str) -> bool:
    try:
        validate_public_url(url)
        return True
    except UnsafeURLError:
        return False


def _read_capped(resp, limit: int = MAX_BODY_BYTES) -> None:
    """Read at most ``limit`` bytes of the body, then stop."""
    chunks, size = [], 0
    for chunk in resp.iter_content(65536):
        chunks.append(chunk)
        size += len(chunk)
        if size >= limit:
            break
    resp._content = b"".join(chunks)[:limit]
    resp._content_consumed = True
    resp.close()


def safe_get(url: str, max_redirects: int = MAX_REDIRECTS, **kwargs) -> requests.Response:
    """
    Drop-in for ``requests.get(url, **kwargs)`` that validates the URL and each
    redirect target before requesting it. ``response.history`` and
    ``response.url`` behave as they do with normal redirect following.
    """
    kwargs.pop("allow_redirects", None)
    current = validate_public_url(url)
    history = []
    with requests.Session() as session:
        for _ in range(max_redirects + 1):
            resp = session.get(current, allow_redirects=False, stream=True, **kwargs)
            _read_capped(resp)
            location = resp.headers.get("location")
            if resp.status_code in (301, 302, 303, 307, 308) and location:
                nxt = validate_public_url(urljoin(current, location))
                history.append(resp)
                current = nxt
                continue
            resp.history = history
            return resp
    raise requests.TooManyRedirects(f"Exceeded {max_redirects} redirects.")
