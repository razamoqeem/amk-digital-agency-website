"""
Rich-text cleaning for the Website CMS.

Only a small allow-list of tags survives. Everything else (scripts, styles,
event attributes, unknown tags) is dropped and all text is escaped. Links may
only point to http(s), mailto, tel, or a path on this site.
"""
import html
from html.parser import HTMLParser

ALLOWED_TAGS = {"strong", "b", "em", "i", "a", "br", "code"}
VOID_TAGS = {"br"}
DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "template", "noscript"}
_SAFE_LINK_STARTS = ("http://", "https://", "mailto:", "tel:", "/", "#")


def safe_href(value: str) -> str:
    """Return the link if it is safe to use, otherwise an empty string."""
    v = (value or "").strip()
    compact = "".join(ch for ch in v if not ch.isspace() and ord(ch) > 31).lower()
    if not compact or compact.startswith("//"):
        return ""
    if compact.startswith(_SAFE_LINK_STARTS):
        return v
    return ""


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.open_tags = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in DROP_WITH_CONTENT:
            self.skip_depth += 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return
        if tag in VOID_TAGS:
            self.out.append("<br />")
            return
        if tag == "a":
            href = safe_href(dict(attrs).get("href") or "")
            if not href:
                return
            rel = ' rel="noopener"' if href.startswith(("http://", "https://")) else ""
            self.out.append('<a href="%s"%s>' % (html.escape(href, quote=True), rel))
        else:
            self.out.append("<%s>" % tag)
        self.open_tags.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self.skip_depth:
            self.out.append("<br />")

    def handle_endtag(self, tag):
        if tag in DROP_WITH_CONTENT:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag not in self.open_tags:
            return
        while self.open_tags:
            last = self.open_tags.pop()
            self.out.append("</%s>" % last)
            if last == tag:
                break

    def handle_data(self, data):
        if not self.skip_depth:
            self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.open_tags:
            self.out.append("</%s>" % self.open_tags.pop())
        return "".join(self.out)


def clean_rich_text(value: str) -> str:
    """Clean rich text typed in the editor. Safe to place inside an element."""
    cleaner = _Cleaner()
    cleaner.feed(value or "")
    cleaner.close()
    return cleaner.result().strip()


def plain_text(value: str) -> str:
    """Strip all tags; used for lengths and outlines."""
    cleaner = _Cleaner()
    cleaner.feed(value or "")
    cleaner.close()
    text = "".join(part for part in cleaner.out if not part.startswith("<"))
    return html.unescape(text).strip()
