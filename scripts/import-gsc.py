"""Turn your Google Search Console exports into the data behind the /showcase/ page.

Nothing is invented: every number is read from, or calculated from, your own CSV files.

How to export (Search Console > Performance > Search results > Export > Download CSV):
  1. Set a date range that covers the period you want to show (for example 12 months), with the
     Clicks, Impressions, CTR and Position boxes ticked, then export. The zip holds "Chart.csv" (or "Dates.csv").
  2. For keyword movement, export the Queries table twice: once for the "before" period and once for the
     "after" period. The files are named "Queries.csv"; rename them so you can tell them apart.

Run from the Website folder:
  python scripts/import-gsc.py --chart Chart.csv --split 2026-04-01 \
      --queries-before Queries_before.csv --queries-after Queries_after.csv \
      --source "Google Search Console, example.com, 2025-10-01 to 2026-09-30"

  --split  the first day of the "after" period. Days before it are "before".
Then rebuild the site (.venv/Scripts/python.exe cms/build.py) and check /showcase/.
The column names can be in any capitalisation; Search Console's own export names work as they are.
"""
import argparse
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "content", "showcase.json")
MAX_POINTS = 120


def read_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def column(row, *needles):
    for key in row:
        low = key.lower()
        if any(n in low for n in needles):
            return key
    return None


def num(text):
    try:
        return float(str(text).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def read_chart(path):
    rows = read_rows(path)
    if not rows:
        sys.exit("The chart file has no rows: " + path)
    first = rows[0]
    kd, kc, ki, kp = column(first, "date"), column(first, "click"), column(first, "impression"), column(first, "position")
    if not (kd and kc and ki):
        sys.exit("Could not find Date, Clicks and Impressions columns in " + path + ". Found: " + ", ".join(first))
    out = []
    for r in rows:
        c, i = num(r[kc]), num(r[ki])
        if c is None or i is None:
            continue
        out.append({"date": r[kd].strip(), "clicks": c, "impressions": i, "position": num(r[kp]) if kp else None})
    out.sort(key=lambda p: p["date"])
    return out


def bucket(days):
    """Keep the chart readable: sum days into equal buckets when there are many."""
    if len(days) <= MAX_POINTS:
        return [{"date": d["date"], "clicks": int(d["clicks"]), "impressions": int(d["impressions"])} for d in days]
    size = -(-len(days) // MAX_POINTS)
    out = []
    for i in range(0, len(days), size):
        part = days[i:i + size]
        out.append({"date": part[0]["date"], "clicks": int(sum(d["clicks"] for d in part)), "impressions": int(sum(d["impressions"] for d in part))})
    return out, size


def summarise(days):
    n = len(days)
    clicks, imps = sum(d["clicks"] for d in days), sum(d["impressions"] for d in days)
    pos_w = sum((d["position"] or 0) * d["impressions"] for d in days if d["position"] is not None)
    pos_i = sum(d["impressions"] for d in days if d["position"] is not None)
    return {"days": n, "clicks_per_day": clicks / n, "impressions_per_day": imps / n,
            "ctr": (clicks / imps * 100) if imps else None, "position": (pos_w / pos_i) if pos_i else None,
            "first": days[0]["date"], "last": days[-1]["date"]}


def read_queries(path):
    rows = read_rows(path)
    if not rows:
        return {}
    kq, kp = column(rows[0], "quer", "keyword"), column(rows[0], "position")
    if not (kq and kp):
        sys.exit("Could not find the query and position columns in " + path + ". Found: " + ", ".join(rows[0]))
    return {r[kq].strip(): num(r[kp]) for r in rows if num(r[kp]) is not None}


def main():
    ap = argparse.ArgumentParser(description="Import Search Console exports into content/showcase.json")
    ap.add_argument("--chart", required=True)
    ap.add_argument("--split", required=True, help="first day of the 'after' period, YYYY-MM-DD")
    ap.add_argument("--queries-before")
    ap.add_argument("--queries-after")
    ap.add_argument("--source", required=True, help="where the numbers come from, shown on the page")
    ap.add_argument("--out", default=TARGET, help="file to update (default: content/showcase.json)")
    args = ap.parse_args()

    days = read_chart(args.chart)
    before = [d for d in days if d["date"] < args.split]
    after = [d for d in days if d["date"] >= args.split]
    if not before or not after:
        sys.exit("The split date leaves one period empty. The data runs %s to %s." % (days[0]["date"], days[-1]["date"]))

    bucketed = bucket(days)
    series, size = (bucketed if isinstance(bucketed, tuple) else (bucketed, 1))
    b, a = summarise(before), summarise(after)
    pb, pa = "%s to %s (%d days)" % (b["first"], b["last"], b["days"]), "%s to %s (%d days)" % (a["first"], a["last"], a["days"])
    rows = [
        {"label": "Clicks per day", "before": round(b["clicks_per_day"], 1), "after": round(a["clicks_per_day"], 1), "digits": 1, "period_before": pb, "period_after": pa},
        {"label": "Impressions per day", "before": round(b["impressions_per_day"]), "after": round(a["impressions_per_day"]), "period_before": pb, "period_after": pa}]
    if b["ctr"] is not None and a["ctr"] is not None:
        rows.append({"label": "Click-through rate (%)", "before": round(b["ctr"], 2), "after": round(a["ctr"], 2), "digits": 2, "period_before": pb, "period_after": pa})
    if b["position"] is not None and a["position"] is not None:
        rows.append({"label": "Average position", "before": round(b["position"], 1), "after": round(a["position"], 1), "digits": 1, "lower_is_better": True, "period_before": pb, "period_after": pa})

    keywords = []
    if args.queries_before and args.queries_after:
        qb, qa = read_queries(args.queries_before), read_queries(args.queries_after)
        keywords = [{"keyword": q, "position_before": round(qb[q], 1), "position_after": round(qa[q], 1)} for q in qb if q in qa]

    with open(TARGET, encoding="utf-8") as f:
        data = json.load(f)   # case studies are always taken from the real file
    note = "" if size == 1 else " (each chart point = %d days)" % size
    data["metrics"] = {"source": args.source + note, "series": series, "before_after": rows, "keywords": keywords}
    with open(args.out + ".tmp", "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(args.out + ".tmp", args.out)
    print("Imported %d days (%d chart points), %d before/after rows, %d keywords." % (len(days), len(series), len(rows), len(keywords)))
    print("Next: .venv/Scripts/python.exe cms/build.py   then open /showcase/")


if __name__ == "__main__":
    main()
