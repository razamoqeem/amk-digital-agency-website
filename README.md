# AMK Digital Agency Website

The public website of AMK Digital Agency: marketing pages, documentation, resources and free SEO tools.

**Status: Beta / Preview. Being rebuilt. Not deployed.**

This project is independent of the App. It shares no database, secrets or sessions with it, and only links to
the App through `APP_URL` in config.

## What is here

| Path | What |
|---|---|
| `index.html`, `company.html` | Older hand-written marketing pages |
| `content/`, `templates/`, `cms/`, `public/` | CMS content, layout, local admin and build output |
| `docs.html`, `resources.html` | Knowledge hub and academy pages (still load content from a server; to be made static) |
| `tools/` | Free tools pages |
| `css/`, `js/`, `assets/` | Styles, scripts, logo |
| `content/knowledge/` | Source text for the documentation |
| `api/*.js`, `api/_lib/` | Small server functions for the free tools, chat and request form (Vercel) |
| `DEPLOY_VERCEL.md`, `ENVIRONMENT.md` | Deployment steps and every environment variable |
| `SHOWCASE.md` | How the results showcase is filled from real data |
| `AGENCY_CONTEXT.md` | The facts the chat assistant may use |

Internal working notes (audits, decisions, security assessments) are kept privately by the owner and are not part of this repository.

## How the site is built

The deployed site is the `public/` folder. It is produced by the build script from:

| Source | What |
|---|---|
| `content/pages/*.json` | Pages managed by the CMS (SEO fields + content blocks) |
| `content/settings.json` | Site name, navigation, footer, design tokens |
| `content/redirects.json` | 301 redirects |
| `templates/` | Page layout and stylesheet |
| Older hand-written pages (`index.html`, `tools/`, …) | Copied as they are until they are rebuilt as CMS pages |

Build:

```bash
python cms/build.py
```

The build writes `public/` (pages, `404.html`, `robots.txt`, `_headers`, `_redirects`) and `vercel.json`.
`sitemap.xml`, canonical links and structured data are added only when `SITE_URL` is set in `.env`.
If any page breaks a rule, the build stops and `public/` is left unchanged.

## Edit pages with the local CMS

One-time setup:

```bash
python -m venv .venv
```

```bash
.venv/Scripts/python.exe -m pip install -r cms/requirements.lock.txt
```

Start it, then open `http://127.0.0.1:8090`:

```bash
.venv/Scripts/python.exe cms/app.py
```

- It runs on this computer only and is never deployed.
- Edit → Save → **Build site** → review the changes in Git → commit → push.
- Saving is blocked unless the page has exactly one H1, no skipped heading level, and only design-token values.
- Changing a slug adds a 301 redirect automatically.

## Look at the built site

```bash
python -m http.server 8080 --directory public
```

Open `http://localhost:8080`. Redirects and security headers only take effect on the real host.

## Rules

- Branding: "AMK Digital Agency" only.
- No invented numbers, prices, testimonials or guarantees. Unknown values are written `[TO BE CONFIRMED]`.
- No secrets in this repository. Copy `.env.example` to `.env` for local values.
- Never hard-code a domain. Use `SITE_URL`, `APP_URL`, `API_URL` from config.
- The Vercel Hobby demo phase (not started) ends before the first paying client or payment. No live checkout
  on the demo.
