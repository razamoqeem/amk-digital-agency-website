# Deploying the Website on Vercel: checklist (updated 2026-11-15)

You click through these steps yourself. Nothing here has been done for you: no account was
created, no repository was connected, nothing was deployed. Read `SECURITY_LAYERS.md` first.

## 1. What works on Vercel now

The tools now run as small Node functions in `api/*.js` (no packages to install), so they work on Vercel.
The older Python service (`api/*.py`) stays for your own machine and is kept out of the upload by `.vercelignore`.

| Part | Works on Vercel? | Notes |
|---|---|---|
| Pages in `public/` (home, company, docs, tools hub, tool pages, 404) | Yes | Plain files. `vercel.json` already has the redirects, rewrites, security headers. |
| Light/dark switch, spacing, theme | Yes | |
| Free tools: Domain Overview, Website Comparison, SEO Audit, Page Analyser, AI readiness, Meta, Headings, Images, Links, Redirects, Robots/Sitemap, SSL, Schema, Technology | Yes | Real checks, same results shape as before. Tested against live sites. |
| Domain Age | Yes | Uses the registries' RDAP service. Some endings (for example `.pk`) have no RDAP, and the tool says so. |
| Domain Rank | **Probably not** | The free Open PageRank key works from one network address only; Vercel uses many. `[UNCERTAIN]` until tested with your key. |
| Title Generator | Yes | Runs in the browser |
| AI chat assistant | Yes, once keys are added | Free models only |
| Request form (when the chat limit is reached) | Yes, once a destination is set | Webhook or Redis |
| Daily limits | Reliable only with the Redis store | Without it each server instance counts on its own |
| Long crawls | Limited | Each function may run up to 30 seconds here `[UNCERTAIN: your plan's maximum may be lower]`. Checks that read many pages are capped (40 links, 10 sitemap parts). |
| CMS editor (`cms/`) | Not deployed, by design | Local only. Edit, rebuild, commit `public/`. |
| Vercel plan | Check yourself | The free "Hobby" plan is for personal, non-commercial use. A business site normally needs "Pro". Read Vercel's current terms. Hobby also limits the number of functions (this project uses 8) `[UNCERTAIN: current limit]`. |

## 2. Before you start

| # | Check | Done |
|---|---|---|
| 1 | Latest commit is on `razamoqeem/amk-digital-agency-website`. | [ ] |
| 2 | `public/` is up to date: run `.venv/Scripts/python.exe cms/build.py`, then commit `public/` and `vercel.json`. Vercel serves what is committed; it does not run the build. | [ ] |
| 3 | Final domain decided. Until then do not type a `*.vercel.app` address into any file. | [ ] |
| 4 | Turnstile site, Redis store and webhook prepared (see `SECURITY_LAYERS.md` section 3). The live site refuses tool, chat and form requests until the bot check is configured. | [ ] |
| 5 | Run `node scripts/test-api.js` on your PC: it must say `0 failed`. | [ ] |

## 3. Keep the Python service out of Vercel

- [x] `.vercelignore` leaves out `api/*.py`, `api/engine/`, `api/data/` (it holds a key and a database), `cms/`, `content/`, notes, `.env` files.
      It keeps `api/*.js`, `api/_lib/` and `AGENCY_CONTEXT.md` (the chat reads it).
- [ ] In the first deploy log, check that only these functions were created: `audit`, `chat`, `domain-age`, `domain-overview`, `domain-rank`, `lead`, `page-tool`, `usage`. No Python function should appear.

## 4. Create the account and connect GitHub

1. [ ] Open vercel.com and choose **Sign Up** > **Continue with GitHub**. Sign in to GitHub as the
       account that owns `razamoqeem/amk-digital-agency-website`.
2. [ ] When GitHub asks which repositories Vercel may see, choose **Only select repositories** and pick
       `amk-digital-agency-website` only. Do not choose "All repositories".
3. [ ] Confirm. The repository stays private; Vercel only gets read access.

## 5. Import the project

1. [ ] In Vercel: **Add New...** > **Project** > find `amk-digital-agency-website` > **Import**.
2. [ ] **Framework Preset:** `Other`.
3. [ ] **Root Directory:** leave as `./`.
4. [ ] **Build Command:** turn the override on and leave it **empty**.
5. [ ] **Output Directory:** `public` (already set by `vercel.json`).
6. [ ] **Environment Variables** (full table with scopes, secret vs public, redeploy steps and the `/api/health` check: `ENVIRONMENT.md`): add these **before** the first deploy. Mark every secret as **Sensitive**. Never paste a value anywhere else.

| Name | Needed? | What it is |
|---|---|---|
| `TOOLS_SECRET` | **Required** | Long random text (24+ characters). Production refuses to run without it. |
| `TURNSTILE_SECRET` | **Required** | Secret key from your Cloudflare Turnstile site. Without it, tools, chat and forms refuse requests. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | **Strongly advised** | Makes daily limits reliable (Vercel's own store names `KV_REST_API_URL` and `KV_REST_API_TOKEN` also work). |
| `GEMINI_SEO_API_KEY` | For chat | Free-tier Gemini key |
| `OPENROUTER_API_KEY` | For chat | Free-tier OpenRouter key |
| `LEAD_WEBHOOK_URL` | For the request form | https address that receives the request as JSON |
| `LEAD_WEBHOOK_SECRET` | Advised | 24+ characters. Signs each delivery so your receiver can verify it (`SECURITY_LAYERS.md` section 3) |
| `SITE_URL`, `APP_URL` | When the domain is confirmed | Full addresses with https. Never a `*.vercel.app` address. |
| `OPEN_PAGERANK_KEY` | Optional | Turns Domain Rank on (see section 1 for the address limit) |
| `CHAT_DAILY_LIMIT` (6), `CHAT_IP_DAILY_LIMIT` (20), `CHAT_GLOBAL_DAILY_LIMIT` (1000) | Optional | Chat allowances. Defaults in brackets. |
| `TOOLS_DAILY_LIMIT` (10), `TOOLS_MONTHLY_LIMIT` (100), `TOOLS_IP_DAILY_RUNS` (30), `TOOLS_RATE_PER_MINUTE` (20) | Optional | Tool allowances |
| `CHAT_MODEL_FAST`, `CHAT_MODEL_STRATEGIST`, `CHAT_MODEL_AUTO`, `CHAT_MODEL_FALLBACK` | Optional | Change an AI model name without touching code |

   **Do not add** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `XAI_API_KEY` to this project. The website never uses them.
   Then run `vercel env pull .env.production.local` and `node scripts/check-env.js --file .env.production.local` to see what is still missing (names only, never values).
7. [ ] Put the Turnstile **site key** in `js/config.js` (`turnstileSiteKey`), rebuild, commit and push, so the bot check can show.
8. [ ] Click **Deploy**.

## 6. Check the deploy

| # | Check | Done |
|---|---|---|
| 1 | The deploy log shows no errors, and only the 8 Node functions from section 3. | [ ] |
| 2 | Home, `/tools/`, a tool page, Domain Overview and Website Comparison load. | [ ] |
| 3 | Run Domain Overview on a site you own. It returns real data, and the "free runs" bar counts down. | [ ] |
| 4 | Open `/api/chat` in a tab: a short JSON answer with `"enabled": true`. | [ ] |
| 5 | Open the chat bubble, send a message in each of the 3 modes. Counter goes 6, 5, 4 ... | [ ] |
| 6 | Send until the limit: input is replaced by the request form; submit it; check it reached your webhook. | [ ] |
| 7 | The light/dark button works; chat follows it. Phone-sized window: no sideways scrolling. | [ ] |
| 8 | `/robots.txt` shows `Disallow: /api/` and `/v1/`. | [ ] |
| 9 | Type `localhost` into a tool: it is refused with a plain message. | [ ] |
| 10 | `/company.html` moves to `/company/` (redirect). | [ ] |

## 7. Add your domain (when confirmed)

1. [ ] Vercel project > **Settings** > **Domains** > add your domain. Follow the DNS steps shown at your domain seller. Vercel issues the HTTPS certificate by itself.
2. [ ] Add the domain to your Turnstile site in Cloudflare.
3. [ ] Put the final address in `SITE_URL` (Vercel) and `siteUrl` in `js/config.js`, rebuild, commit, push. This turns on canonical links and the sitemap.

## 8. Things that stay true after deploying

- Every push to `main` deploys again. Pushes to other branches create preview addresses (protect them: `SECURITY_LAYERS.md` step 9).
- Never commit `.env`. Keys go into Vercel's **Environment Variables** screen only.
- Do not change the GitHub repository to public. See `GOING_PUBLIC.md` first.
- If a key is ever exposed, replace it at the provider first, then in Vercel, then redeploy.
