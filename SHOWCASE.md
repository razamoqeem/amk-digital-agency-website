# Showcase (/showcase/): agency experience, no client names

The page presents the agency's experience across project types, platforms and SEO disciplines, with counts and charts.
**Client and brand identities are never shown.** Every number is counted from `content/showcase.json` or from your own Search Console exports.

## What the page shows

| Section | Where the numbers come from |
|---|---|
| Stat tiles (projects documented, project types, brands run together, disciplines covered) | Counted from the `projects` list in `content/showcase.json` |
| Project type cards | The `type`, `model` and `summary` of each entry (anonymous wording) |
| "Where the experience sits" bar chart | The `count` of each entry |
| "SEO work delivered" matrix | The `services` tags of each entry; an entry with no tags shows dashes (not itemised) |
| Tools and platforms | The `platforms` list |
| Growth charts, before/after, keyword movement | Only when you import real Search Console data (below). Without it these sections do not appear. |

## Keeping names out

- Never write a client or brand name in `content/showcase.json`.
- Put the names you want to protect, one per line, in `content/confidential_names.txt` (**not committed**, see `.gitignore`).
  The site build **stops with an error** if any of them appears on the showcase page, and a test checks the built page too.
- The Founder page (`/owner/`) is separate content and is not covered by this guard.

## Adding or changing projects

Edit `content/showcase.json`. Add an entry only for work you can document: anonymous `type` and `model`, how many projects it
stands for (`count`), which disciplines are documented (`technical`, `onpage`, `offpage`, `content`, `keywords`), and a one-line `summary`.
Add `results` lines only for outcomes you can prove. Nothing is estimated: if a number is not in the file, it is not on the page.
Then rebuild (`.venv/Scripts/python.exe cms/build.py`) and commit `content/showcase.json` and `public/`.

## Adding verified performance charts

1. Google Search Console > Performance > Search results > Export > Download CSV (Clicks, Impressions, CTR, Position ticked).
   Export the Queries table once for a "before" period and once for an "after" period.
2. Run from the Website folder:

```bash
python scripts/import-gsc.py --chart Chart.csv --split 2026-04-01 --queries-before Queries_before.csv --queries-after Queries_after.csv --source "Google Search Console, your-site, 2025-10-01 to 2026-09-30"
```

3. Rebuild and check `/showcase/`. The importer only reads and adds up your files (per-day averages so periods of different length compare fairly).

Use data from sites you are allowed to show. The chart source line names the source, not the site, if you word `--source` that way.

## Design preview without real data

`python cms/showcase.py --sample` writes a preview with synthetic numbers and a red "SAMPLE DATA, NOT REAL RESULTS" banner into
`public/showcase/`. Run `cms/build.py` afterwards (it removes it). A test fails if that banner ever reaches the built site.

## Claims to confirm

The project counts come from the projects listed on your Founder page, several of them from earlier roles at other companies.
Confirm you are happy presenting them as the agency's documented experience, and that you may reference them anonymously.
Add other types you can document (for example e-commerce SEO) to the `projects` list; none is claimed without an entry.
