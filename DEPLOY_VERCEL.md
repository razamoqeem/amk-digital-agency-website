# Deploying the Website on Vercel: checklist (2026-11-14)

You click through these steps yourself. Nothing here has been done for you: no account was
created, no repository was connected, nothing was deployed.

## 1. What will and will not work on Vercel

| Part of the Website | Works on Vercel? | Why |
|---|---|---|
| Pages built into `public/` (home, company, docs, tools hub, tool pages, 404) | Yes | They are plain files. `vercel.json` already says `"outputDirectory": "public"` and sets the redirects and security headers. |
| Light/dark switch, layout, theme | Yes | Plain CSS and JS in `public/`. |
| The free tools actually running a check (Domain Overview, Website Comparison, Meta Tags, and the others) | **No, not as set up today** | They need the tools service in `api/` (Python). It keeps its counters in a SQLite file (`api/data/tools.db`), and Vercel deletes files between requests. Crawls can run longer than Vercel allows a single request [UNCERTAIN: the exact time limit depends on the plan]. |
| Domain rank tool | **No** | Its free key works from one network address only. Vercel uses many changing addresses. |
| The CMS editor (`cms/`, port 8090) | No, and it should not be public | It is a local editing tool. Run it on your PC, rebuild, commit `public/`. |

**Short answer:** Vercel can host the Website's pages. The tools will show their forms but will not
return results until the tools service runs somewhere that keeps files and a fixed address
(a small always-on server), and `apiUrl` in `js/config.js` points to it.

## 2. Before you start

| # | Check | Done |
|---|---|---|
| 1 | The pushes to `razamoqeem/amk-digital-agency-website` are done (the latest commit is on GitHub). | [ ] |
| 2 | `public/` is up to date: run `.venv/Scripts/python.exe cms/build.py`, then commit `public/`. Vercel serves what is committed; it does not run the build. | [ ] |
| 3 | Decide the plan. Vercel's free "Hobby" plan is for personal, non-commercial use. A business website normally needs the paid "Pro" plan. Read Vercel's current terms yourself. | [ ] |
| 4 | Decide the domain. Until then, do not type a `*.vercel.app` address into any file. | [ ] |

## 3. Stop Vercel treating `api/` as functions

Vercel automatically turns Python files in a top-level `api/` folder into server functions. Ours are
not written for that and would fail or expose half-working addresses
[UNCERTAIN: confirm in the first deploy log].

- [ ] Ask Claude to add a `.vercelignore` file containing the line `api/` (and `cms/`, `content/`,
      `templates/`, `.venv/`) before the first deploy. This is a small, separate change that needs your yes.

## 4. Create the account and connect GitHub

1. [ ] Open vercel.com and choose **Sign Up** → **Continue with GitHub**. Sign in to GitHub as the
       account that owns `razamoqeem/amk-digital-agency-website`.
2. [ ] When GitHub asks which repositories Vercel may see, choose **Only select repositories** and pick
       `amk-digital-agency-website` only. Do not choose "All repositories".
3. [ ] Confirm. The repository stays private; Vercel only gets read access.

## 5. Import the project

1. [ ] In Vercel: **Add New…** → **Project** → find `amk-digital-agency-website` → **Import**.
2. [ ] **Framework Preset:** `Other`.
3. [ ] **Root Directory:** leave as `./` (the repository root).
4. [ ] **Build Command:** turn the override on and leave it **empty** (nothing to build; `public/` is committed).
5. [ ] **Output Directory:** `public` (already set by `vercel.json`).
6. [ ] **Environment Variables:** none are needed for the pages alone. Do not paste any key here
       until the tools service is planned.
7. [ ] Click **Deploy**.

## 6. Check the deploy

| # | Check | Done |
|---|---|---|
| 1 | The deploy log shows no errors and no Python function was created. | [ ] |
| 2 | Open the preview address Vercel shows. Home, `/tools/`, a tool page, Domain Overview and Website Comparison load. | [ ] |
| 3 | The light/dark button works. | [ ] |
| 4 | Try a phone-sized window: no sideways scrolling. | [ ] |
| 5 | Open `/company.html`: it should move to `/company/` (redirect in `vercel.json`). | [ ] |
| 6 | A tool shows a clear message rather than a broken page when you run it (expected, see section 1). | [ ] |

## 7. Add your domain (when confirmed)

1. [ ] Vercel project → **Settings** → **Domains** → add your domain. Follow the DNS steps it shows
       at your domain seller.
2. [ ] Put the final address in `.env` as `SITE_URL` and in `js/config.js` as `siteUrl`, rebuild,
       commit, push. This turns on canonical links and the sitemap.

## 8. Things that stay true after deploying

- Every push to `main` deploys again. Pushes to other branches create preview addresses.
- Never commit `.env`. Keys go into Vercel's **Environment Variables** screen only.
- Do not change the GitHub repository to public. See `GOING_PUBLIC.md` first.
