# Environment variables: what the Website and the demo need (2026-11-15)

You type the real values into Vercel yourself. Nothing here contains a secret, and no `.env` file is in Git.

## 1. Short answers

| Question | Answer |
|---|---|
| Does the **Website** use environment variables? | Yes, but only the small server functions in `api/*.js`. The pages are plain files and read none. |
| Does the **demo** need any? | **No.** It is a static copy with no server. Its only setting, `LIVE_SITE_URL` in `script.js`, is a public address, not a secret. |
| Is an `.env` file used? | Locally only. `website/.env` exists on your PC (it holds 2 names: `APP_URL`, `OPEN_PAGERANK_KEY`) and is ignored by Git and by the Vercel upload. The demo has none. |
| Are any variables exposed to the browser (`NEXT_PUBLIC_`, `VITE_`, ...)? | **No.** A search of all browser files found no such variable and no `process.env`. This is not a Next.js project, so the `NEXT_PUBLIC_` mechanism does not exist here. |
| Can visitors see Vercel environment variables? | **No**, see section 5. |

## 2. Website: every variable

Scope = where you tick it in Vercel: **P**roduction, Pre**v**iew, **D**evelopment. Previews are strict too (they refuse to run without the secret and the bot check), so leave a variable out of Preview if you do not want that preview to run tools, chat or forms.

| Variable | Secret? | Needed for | Required? | Scope |
|---|---|---|---|---|
| `TOOLS_SECRET` | **Secret** (24+ random characters) | Signs the visitor cookie; every tool, chat and form refuses to run without it | **Yes** | P (Pv optional) |
| `TURNSTILE_SECRET` | **Secret** | Server side of the bot check | **Yes** | P (Pv optional, use a separate Turnstile site) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | **Secret** | Daily limits that survive between requests | Strongly advised | P (Pv: a separate store, never the production one) |
| `GEMINI_SEO_API_KEY` | **Secret** | Chat (Fast and Strategist modes) | One of the two chat keys | P |
| `OPENROUTER_API_KEY` | **Secret** | Chat (Auto mode and fallback) | One of the two chat keys | P |
| `LEAD_WEBHOOK_URL` | **Secret** (treat the address as a password) | Where the "request a free audit" form goes | Yes, or use Redis | P |
| `LEAD_WEBHOOK_SECRET` | **Secret** (24+ characters) | Signs each delivery so your receiver can verify it | Advised | P |
| `HEALTH_TOKEN` | **Secret** (24+ characters) | Switches on the owner-only check at `/api/health` | Advised | P |
| `OPEN_PAGERANK_KEY` | **Secret** | Domain Rank (the free key works from one network address only) | Optional | P |
| `SITE_URL`, `APP_URL` | Public addresses | Allowed website address, App link in limit messages | When the domain is confirmed | P, Pv, D |
| `ALLOWED_ORIGINS` | Public addresses | Only if another address of yours calls the tools | No | P |
| `REQUIRE_BOT_CHECK` | No | Set to `0` only to switch the bot-check requirement off (do not) | No | |
| `CHAT_DAILY_LIMIT` (6), `CHAT_IP_DAILY_LIMIT` (20), `CHAT_GLOBAL_DAILY_LIMIT` (1000) | No | Chat allowances | No | P |
| `TOOLS_DAILY_LIMIT` (10), `TOOLS_MONTHLY_LIMIT` (100), `TOOLS_IP_DAILY_RUNS` (30), `TOOLS_RATE_PER_MINUTE` (20), `TOOLS_CACHE_HOURS` (24), `TOOLS_*_DAILY_LIMIT` (500) | No | Tool allowances | No | P |
| `CHAT_MODEL_FAST`, `CHAT_MODEL_STRATEGIST`, `CHAT_MODEL_AUTO`, `CHAT_MODEL_FALLBACK` | No | Change an AI model name without code | No | P |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_REGION` | Set by Vercel | Strict mode, labels | Do not add | |

**Never add** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `XAI_API_KEY` to this project. The site never uses them; `/api/health` warns by name if one is present.

### Public values (safe in the browser)

Only these, all in `js/config.js`, committed on purpose:

| Setting | Why public is fine |
|---|---|
| `siteUrl`, `appUrl`, `apiUrl` | Addresses anyone can see in the address bar |
| `turnstileSiteKey` | The **site** key of the bot check is public by design; the **secret** key (`TURNSTILE_SECRET`) is the private half |

### One build-time setting that is NOT in Vercel

`SITE_URL` is also read when you run `cms/build.py` **on your PC** (from your shell or `website/.env`). That is what writes canonical links and the sitemap into the pages, which are committed and served as they are. Vercel does not run the build. So: set `SITE_URL=https://...` in your local `website/.env`, rebuild, commit, push. Setting it only in Vercel does not change the pages.

## 3. Add them in Vercel, step by step

1. vercel.com > your project `amk-digital-agency-website`.
2. **Settings** (top) > **Environment Variables** (left).
3. For each variable: type the **Key** (exactly as above), paste the **Value**.
4. Under **Environments**, tick the scopes from the table (usually just **Production**).
5. For secrets, turn on **Sensitive** if offered (a sensitive value cannot be read back in the dashboard afterwards). `[UNCERTAIN: availability depends on your plan]`
6. Click **Save**. Repeat for each variable.
7. **Redeploy.** Changes apply only to **new** deployments. Go to **Deployments**, open the newest one, click the three dots **...** > **Redeploy** > confirm. (Pushing a new commit also redeploys.)

## 4. Verify it worked (from the deployed site)

1. Add `HEALTH_TOKEN` (24+ random characters), redeploy.
2. From a terminal (replace the address and token; do not paste your token anywhere public):

```bash
curl -H "Authorization: Bearer YOUR_HEALTH_TOKEN" https://YOUR-DOMAIN/api/health
```

3. Expect JSON with `"ok": true`. Check:

| Field | You want |
|---|---|
| `settings_present` | `true` for every variable you added; it shows yes/no, never a value |
| `redis` | `"configured": true, "answers": true` |
| `agency_context` | `"readable": true` (proves the chat can read `AGENCY_CONTEXT.md` on Vercel) |
| `paid_keys_present_but_unused` | `[]` |
| `runtime.vercel_environment` | `"production"` |

4. Time limit test: `curl -H "Authorization: Bearer YOUR_HEALTH_TOKEN" "https://YOUR-DOMAIN/api/health?wait=25"`. It should return after about 25 seconds with `"waited_seconds": 25`. If Vercel stops it sooner (an error or timeout page), that is your plan's real limit: tell me and I will lower `maxDuration` and the crawl sizes.
5. Without the token, `/api/health` must answer **404**. Check that too.
6. You can also pull your settings to your PC and check by name: `vercel env pull .env.production.local` then `node scripts/check-env.js --file .env.production.local`. Do not commit that file (it is ignored).

I have not run any of these against a real deployment: no deployment exists yet.

## 5. Are Vercel environment variables visible to visitors?

| Question | Answer |
|---|---|
| Stored how? | Vercel stores them encrypted and hands them to your **server code** (functions) and your build. |
| Can a visitor read them? | **No**, unless something copies them into a file the browser downloads, or your code prints them back. |
| How could that happen by accident? | (1) Frameworks that bundle variables with a prefix such as `NEXT_PUBLIC_` or `VITE_` into browser code: anything with that prefix is **public**. (2) A function that returns or logs a value. |
| This project? | No prefixed variables exist, there is no browser build step on Vercel, and a test fails if a key name appears in any browser file or if `/api/health` ever returns a value. |
| Who can see them in the dashboard? | People you give access to the Vercel project. Mark secrets **Sensitive** so even they cannot read them back. |
| Encrypted storage vs bundled values | Encrypted storage = private, only your server code sees it at run time. Bundled = copied into JavaScript sent to every visitor, so anyone can read it in their browser. Put a secret in the first, never the second. |
| Preview addresses | Turn on **Deployment Protection** so previews need a Vercel login. |

## 6. The demo (`portfolio-demo`)

No environment variables, no server, no build step. Public repository, static files. If you host it on Vercel: Framework Preset **Other**, no build command, output folder is the repository root, nothing to add under Environment Variables.
