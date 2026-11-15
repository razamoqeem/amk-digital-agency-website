"""Visual results showcase: selected work, growth charts, before/after and keyword movement.

Everything is drawn as plain SVG at build time (no scripts, no libraries), so the page works under the
strict page policy and follows the light/dark switch through CSS classes.

Honesty rules:
  * Charts and numbers come only from content/showcase.json (filled by scripts/import-gsc.py from the
    owner's own Google Search Console exports). Nothing is estimated or invented here.
  * With no metrics and no results, the page is NOT built and no menu item is added.
  * Sample data exists only for previewing the design locally (python cms/showcase.py --sample). A
    sample page carries a visible "SAMPLE DATA" banner and a test fails if one is ever committed.
"""
import html
import json
import os

W, H = 640, 250
PAD_L, PAD_R, PAD_T, PAD_B = 56, 16, 14, 34


def esc(x):
    return html.escape(str(x), quote=True)


def load(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def has_metrics(m):
    m = m or {}
    return bool(m.get("series") or m.get("before_after") or m.get("keywords"))


def publishable(data):
    data = data or {}
    results = any(cs.get("results") for cs in data.get("projects", []))
    return bool(data.get("projects")) or results or has_metrics(data.get("metrics"))


# The disciplines a project can be tagged with. Tags are set by the owner in content/showcase.json
# and only for work that is documented; a project with no tags is shown as "not itemised".
SERVICES = [("technical", "Technical SEO"), ("onpage", "On-page and metadata"), ("offpage", "Off-page and links"),
            ("content", "Content and publishing"), ("keywords", "Keyword mapping")]


def stats(data):
    """Every figure is counted from the data file. Nothing is typed in by hand."""
    projects = data.get("projects") or []
    total = sum(int(p.get("count", 1)) for p in projects)
    tagged = {t for p in projects for t in p.get("services", [])}
    multi = [int(p.get("count", 1)) for p in projects if p.get("multi_brand")]
    out = [("%d" % total, "Projects documented"), ("%d" % len(projects), "Project types")]
    if multi:
        out.append(("%d" % max(multi), "Brands run together in one portfolio"))
    out.append(("%d" % len(tagged & {k for k, _ in SERVICES}), "SEO disciplines covered"))
    return out


def check_names(text, content_dir):
    """Fail the build if a confidential client or brand name appears. The list lives in
    content/confidential_names.txt, which is NOT committed (it would be a list of the names)."""
    path = os.path.join(content_dir, "confidential_names.txt")
    if not os.path.exists(path):
        return []
    low = text.lower()
    with open(path, encoding="utf-8") as f:
        names = [n.strip() for n in f if n.strip() and not n.startswith("#")]
    return [n for n in names if n.lower() in low]


# ── number helpers ─────────────────────────────────────────
def fmt(n, digits=0):
    n = float(n)
    return ("{:,.%df}" % digits).format(n)


def short(n):
    n = float(n)
    for size, tag in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(n) >= size:
            v = n / size
            return ("%.1f" % v).rstrip("0").rstrip(".") + tag
    return ("%.1f" % n).rstrip("0").rstrip(".")


def nice_max(v):
    if v <= 0:
        return 1
    import math
    exp = 10 ** int(math.floor(math.log10(v)))
    for step in (1, 2, 2.5, 5, 10):
        if v <= step * exp:
            return step * exp
    return 10 * exp


def change_pct(before, after):
    return None if not before else (after - before) / before * 100.0


# ── charts ─────────────────────────────────────────────────
def line_chart(points, title, uid):
    """points: list of (label, value). Returns an <svg> plus a hidden data table for screen readers."""
    pts = [(str(l), float(v)) for l, v in points]
    if len(pts) < 2:
        return ""
    ymax = nice_max(max(v for _, v in pts))
    iw, ih = W - PAD_L - PAD_R, H - PAD_T - PAD_B
    xs = [PAD_L + iw * i / (len(pts) - 1) for i in range(len(pts))]
    ys = [PAD_T + ih * (1 - v / ymax) for _, v in pts]
    line = " ".join("%s%.1f %.1f" % ("M" if i == 0 else "L", x, y) for i, (x, y) in enumerate(zip(xs, ys)))
    area = line + " L%.1f %.1f L%.1f %.1f Z" % (xs[-1], PAD_T + ih, xs[0], PAD_T + ih)
    grid = []
    for i in range(5):
        v = ymax * i / 4
        y = PAD_T + ih * (1 - i / 4)
        grid.append('<line class="sc-grid" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>' % (PAD_L, y, W - PAD_R, y))
        grid.append('<text class="sc-tick" x="%d" y="%.1f" text-anchor="end">%s</text>' % (PAD_L - 8, y + 4, short(v)))
    ticks = sorted({0, len(pts) // 2, len(pts) - 1})
    for i in ticks:
        anchor = "start" if i == 0 else "end" if i == len(pts) - 1 else "middle"
        grid.append('<text class="sc-tick" x="%.1f" y="%d" text-anchor="%s">%s</text>' % (xs[i], H - 10, anchor, esc(pts[i][0])))
    rows = "".join("<tr><td>%s</td><td>%s</td></tr>" % (esc(l), fmt(v)) for l, v in pts[:: max(1, len(pts) // 24)])
    return (
        '<figure class="sc-chart"><svg viewBox="0 0 %d %d" role="img" aria-labelledby="%s-t">'
        '<title id="%s-t">%s</title>%s<path class="sc-area" d="%s"/><path class="sc-line" d="%s"/>'
        '<circle class="sc-dot" cx="%.1f" cy="%.1f" r="4"/></svg>'
        '<figcaption>%s</figcaption><table class="sr-only"><caption>%s</caption><tbody>%s</tbody></table></figure>'
        % (W, H, uid, uid, esc(title), "".join(grid), area, line, xs[-1], ys[-1], esc(title), esc(title), rows))


def before_after(rows):
    out = []
    for r in rows:
        before, after = float(r["before"]), float(r["after"])
        lower = bool(r.get("lower_is_better"))
        pct = change_pct(before, after)
        better = (after < before) if lower else (after > before)
        top = max(before, after) or 1
        digits = int(r.get("digits", 0))
        badge = "" if pct is None else '<span class="sc-delta %s">%s%.0f%%</span>' % (
            "is-good" if better else "is-bad" if before != after else "", "+" if pct > 0 else "", pct)
        out.append(
            '<div class="sc-ba"><div class="sc-ba-head"><strong>%s</strong>%s</div>'
            '<div class="sc-bar-row"><span>Before</span><div class="sc-bar"><i class="sc-bar-before sc-w-%d"></i></div><b>%s</b></div>'
            '<div class="sc-bar-row"><span>After</span><div class="sc-bar"><i class="sc-bar-after sc-w-%d"></i></div><b>%s</b></div>'
            '<p class="sc-note">%s%s</p></div>' % (
                esc(r["label"]), badge, int(round(before / top * 20)) * 5, fmt(before, digits), int(round(after / top * 20)) * 5, fmt(after, digits),
                esc(r.get("period_before", "")) + (" to " if r.get("period_after") else ""), esc(r.get("period_after", ""))))
    return "".join(out)


def keyword_table(rows):
    usable = [r for r in rows if r.get("position_before") is not None and r.get("position_after") is not None]
    usable.sort(key=lambda r: float(r["position_before"]) - float(r["position_after"]), reverse=True)
    body = []
    for r in usable[:15]:
        b, a = float(r["position_before"]), float(r["position_after"])
        gain = b - a
        cls = "is-good" if gain > 0 else "is-bad" if gain < 0 else ""
        arrow = "&#9650;" if gain > 0 else "&#9660;" if gain < 0 else "&#8211;"
        body.append('<tr><td>%s</td><td>%.1f</td><td>%.1f</td><td><span class="sc-delta %s">%s %.1f</span></td></tr>' % (
            esc(r["keyword"]), b, a, cls, arrow, abs(gain)))
    if not body:
        return ""
    return ('<div class="sc-table-wrap"><table class="sc-table"><thead><tr><th>Keyword</th><th>Position before</th>'
            '<th>Position now</th><th>Places gained</th></tr></thead><tbody>%s</tbody></table></div>' % "".join(body))


# ── page ───────────────────────────────────────────────────
def type_bars(projects):
    top = max([int(p.get("count", 1)) for p in projects] or [1])
    rows = []
    for p in projects:
        n = int(p.get("count", 1))
        rows.append('<div class="sc-bar-row sc-type-row"><span>%s</span><div class="sc-bar"><i class="sc-bar-after sc-w-%d"></i></div><b>%d</b></div>'
                    % (esc(p.get("type", "")), max(5, int(round(n / top * 20)) * 5), n))
    return '<div class="sc-ba">%s<p class="sc-note">Number of projects documented for each type.</p></div>' % "".join(rows)


def service_matrix(projects):
    head = "".join("<th>%s</th>" % esc(label) for _, label in SERVICES)
    rows = []
    for p in projects:
        tags = set(p.get("services", []))
        cells = "".join('<td>%s</td>' % ('<span class="sc-yes" aria-label="Yes">&#9679;</span>' if key in tags else '<span class="sc-no" aria-label="Not itemised">&ndash;</span>')
                        for key, _ in SERVICES)
        rows.append("<tr><th scope=\"row\">%s</th>%s</tr>" % (esc(p.get("type", "")), cells))
    return ('<div class="sc-table-wrap"><table class="sc-table sc-matrix"><thead><tr><th>Project type</th>%s</tr></thead><tbody>%s</tbody></table></div>'
            '<p class="sc-note">A dot means that discipline is documented for that project type; a dash means it is not itemised.</p>'
            % (head, "".join(rows)))


def body_html(data, sample=False):
    m = data.get("metrics") or {}
    projects = data.get("projects") or []
    out = []
    if sample:
        out.append('    <p class="sc-sample" role="note"><strong>SAMPLE DATA, NOT REAL RESULTS.</strong> '
                   'This preview only shows the design. It must never be published.</p>')
    out.append('    <h1>%s</h1>' % esc(data.get("title", "Experience across brands and project types")))
    out.append('    <p>%s</p>' % esc(data.get("intro", "")))
    if m.get("source"):
        out.append('    <p class="sc-source">Source of every performance figure below: %s</p>' % esc(m["source"]))

    if projects:
        out.append('    <div class="sc-stats">%s</div>' % "".join(
            '<div class="sc-stat"><b>%s</b><span>%s</span></div>' % (esc(n), esc(label)) for n, label in stats(data)))
        out.append('    <p class="sc-source">%s</p>' % esc(data.get("count_note", "Counts are projects documented in this portfolio. Client identities are kept confidential.")))
        out.append('    <h2>Project types</h2>')
        cards = []
        for pr in projects:
            results = "".join("<li>%s</li>" % esc(x) for x in pr.get("results", []))
            cards.append('<article class="sc-card"><p class="sc-kind">%s</p><h3>%s</h3><p>%s</p>%s</article>' % (
                esc(pr.get("model", "")), esc(pr.get("type", "")), esc(pr.get("summary", "")),
                ('<ul class="sc-results">%s</ul>' % results) if results else ""))
        out.append('    <div class="sc-grid-cards">%s</div>' % "".join(cards))
        out.append('    <h2>Where the experience sits</h2>')
        out.append('    <div class="sc-charts">%s</div>' % type_bars(projects))
        out.append('    <h2>SEO work delivered</h2>')
        out.append('    ' + service_matrix(projects))
        if data.get("platforms"):
            out.append('    <h2>Tools and platforms</h2>')
            out.append('    <ul class="sc-chips">%s</ul>' % "".join("<li>%s</li>" % esc(x) for x in data["platforms"]))

    series = m.get("series") or []
    if series:
        out.append('    <h2>Organic search growth</h2>')
        out.append('    <div class="sc-charts">%s%s</div>' % (
            line_chart([(p["date"], p["clicks"]) for p in series if "clicks" in p], "Organic clicks over time", "sc-clicks"),
            line_chart([(p["date"], p["impressions"]) for p in series if "impressions" in p], "Organic impressions (visibility) over time", "sc-impr")))
    if m.get("before_after"):
        out.append('    <h2>Before and after</h2>')
        out.append('    <div class="sc-ba-grid">%s</div>' % before_after(m["before_after"]))
    kw = keyword_table(m.get("keywords") or [])
    if kw:
        out.append('    <h2>Keyword ranking improvements</h2>')
        out.append('    ' + kw)
    return "\n".join(out)


def sample_data(real):
    """Synthetic numbers for a local design preview only. Never used by a normal build."""
    import math
    series = []
    for i in range(26):
        d = "2026-%02d-%02d" % (1 + (i * 7) // 30, 1 + (i * 7) % 30 if (i * 7) % 30 < 28 else 28)
        series.append({"date": d, "clicks": round(120 + i * 14 + 18 * math.sin(i / 2)), "impressions": round(4200 + i * 310 + 260 * math.sin(i / 3))})
    data = dict(real)
    data["metrics"] = {
        "source": "SAMPLE DATA for design preview",
        "series": series,
        "before_after": [
            {"label": "Clicks per day", "before": 31, "after": 74, "period_before": "Sample period A", "period_after": "Sample period B"},
            {"label": "Impressions per day", "before": 1020, "after": 2380},
            {"label": "Average position", "before": 18.4, "after": 9.7, "lower_is_better": True, "digits": 1}],
        "keywords": [{"keyword": "sample keyword one", "position_before": 21.0, "position_after": 6.2},
                     {"keyword": "sample keyword two", "position_before": 14.5, "position_after": 8.1},
                     {"keyword": "sample keyword three", "position_before": 9.0, "position_after": 9.4}]}
    return data


if __name__ == "__main__":
    import sys
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    if "--sample" not in sys.argv:
        sys.exit("Use: python cms/showcase.py --sample   (writes a SAMPLE preview into public/showcase; run cms/build.py before committing)")
    sys.path.insert(0, here)
    import build  # noqa: E402
    real = load(os.path.join(root, "content", "showcase.json"))
    settings = build.load_settings()
    settings = dict(settings, nav=list(settings.get("nav", [])) + [{"label": "Work", "href": "/showcase/"}])
    from string import Template
    template = Template(open(os.path.join(root, "templates", "page.html"), encoding="utf-8").read())
    page = build.render_document(template, settings, "SAMPLE: Selected work and results", "Sample preview", ['  <meta name="robots" content="noindex, nofollow" />'], body_html(sample_data(real), sample=True))
    out = os.path.join(root, "public", "showcase")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print("SAMPLE preview written to public/showcase/index.html. Run cms/build.py before committing.")
