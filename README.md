# Stocks

A calm, simple web page for following a few stocks: watchlists, live quotes, charts, alerts, a portfolio, news and AI risk summaries. Built for one user and protected by a password.

Plain HTML/CSS/JS front end (`public/`), Cloudflare Pages Functions back end (`functions/`), Cloudflare D1 database (`migrations/`). All third-party API code lives in `functions/_lib/providers.js`.

**Build status:** Phase 1 (setup, password gate, watchlists, search, live quotes) All five phases are done: watchlists and quotes, charts, price alerts, portfolio, and news / AI risk summaries / settings.

## Free API keys

| Key | Where to get it |
|---|---|
| `FINNHUB_API_KEY` | Sign up at <https://finnhub.io/register>. The key is on your dashboard. Free tier: about 60 calls/minute. |
| `TWELVEDATA_API_KEY` | Sign up at <https://twelvedata.com/pricing> (Basic/free plan). The key is under *API Keys*. Free tier: about 8 calls/minute plus a daily cap. Needed from Phase 2. |
| `GEMINI_API_KEY` | Open <https://aistudio.google.com/apikey> and create a key. Don't enable billing, so it stays on the free tier. Needed from Phase 5. |

You choose `APP_PASSWORD` yourself. For `SESSION_SECRET`, use a long random string, e.g. `openssl rand -base64 32`.

## Setup and deployment

1. **Install tools:** `npm install` (installs Wrangler), then `npx wrangler login`.
2. **Create the database:** `npx wrangler d1 create stock-tracker`.
   - Copy the `database_id` it prints into `wrangler.jsonc`, replacing `PASTE_REAL_DATABASE_ID_HERE`. **Never deploy with the placeholder.**
   - The binding name must stay `DB`.
   - If Wrangler offers to add the database entry to your config automatically, answer **no**. That would create a second, mismatched entry.
3. **Apply migrations:** `npx wrangler d1 migrations apply stock-tracker --remote`.
4. **Push to a private GitHub repo.**
5. **Create the Cloudflare project as Pages, not a Worker.** In the dashboard, go to *Workers & Pages → Create*. The dashboard sometimes defaults to the Workers flow; look for the **Pages** tab or the "Looking to deploy Pages?" link, then **Connect to Git** and pick the repo.
   - Framework preset: *None*. Build command: leave empty. Build output directory: `public`.
6. **Add secrets before the first real deploy.** Under *Settings → Variables and Secrets*, add all five as type **Secret**: `FINNHUB_API_KEY`, `TWELVEDATA_API_KEY`, `GEMINI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`. Then redeploy.
7. **Check the deploy log.** It must include **"Found Functions directory at /functions"** and **"Compiled Worker successfully."** If those lines are missing, only static files were deployed.

### Local development

```sh
cp .dev.vars.example .dev.vars        # fill in your keys (.dev.vars is git-ignored)
npm run db:migrate:local              # local D1 database
npm run dev                           # http://localhost:8788
```

## Changing the Gemini model

The model name is never hardcoded. It comes from the plain (non-secret) variable `GEMINI_MODEL`, with an optional `GEMINI_FALLBACK_MODEL` that is tried once if the main model is still busy (503/429) after two retries. They're currently set to `gemini-3.6-flash` and `gemini-3.5-flash-lite` (both stable and on the free tier as of November 2026).

To change it, edit the `vars` section of `wrangler.jsonc` and push. Once `wrangler.jsonc` is used for deploys, it is the source of truth for these variables, so the dashboard won't let you edit them there. Check <https://ai.google.dev/gemini-api/docs/models> for the current Flash model names. For local dev, you can also set them in `.dev.vars`.

## Notes

- Quotes are cached on the server for 30 seconds, so several open devices share the same Finnhub calls.
- The page refreshes prices every 60 s during US market hours (9:30–16:00 ET, weekdays) and every 15 min otherwise. Market holidays aren't detected; on those days it just polls more often than needed.
- Prices on Finnhub's free tier may be delayed.
- Charts use TradingView Lightweight Charts **5.2.1**, pinned with an integrity hash in `public/index.html`. To upgrade, change the version and recompute the hash: `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
- Chart ranges: 1H (1-min bars), 1D (5-min), 1M and 1Y (daily), 5Y (weekly), All (monthly, as much history as Twelve Data returns — up to 5000 bars; whatever comes back is shown). Chart data is cached on the server for 1 minute (1H, 1D), 1 hour (1M, 1Y) or 12 hours (5Y, All). 1M and 1Y share one daily fetch that includes ~200 extra days, so the moving averages start at the left edge. Twelve Data's free tier allows ~8 requests a minute; if that runs out, the chart says so and recovers a minute later.
- If a required setting (`APP_PASSWORD`, `SESSION_SECRET`, `FINNHUB_API_KEY`, `TWELVEDATA_API_KEY` or the `DB` binding) is missing, the page shows a full-screen message naming it.
- **Alerts** are checked in the browser using the prices already being polled, so they only work while the page is open in a tab. One alert per ticker; setting a new one replaces the old one. When a price crosses, the browser asks the server to mark the alert triggered (`UPDATE … WHERE status = 'active'`), and only the browser that wins shows the notification, so two open devices never both alert. Desktop notifications need permission (gear menu → Enable notifications). The chime plays only after you've clicked somewhere on the page, which is a browser rule.
- **Portfolio** holdings are separate from watchlists (one row per ticker). Their prices are polled only while the Portfolio tab is open. Totals leave out any holding without a price yet and say so.
- **News** shows the latest 5 headlines from the past week (Finnhub, cached 15 minutes).
- **Risk summary** runs only when you click "Summarize risks". The server gathers the company profile, basic financials and up to 15 recent headlines, asks Gemini for JSON, validates it, and saves one summary per ticker per US market day (click Refresh for a new one). Gemini's free tier has daily limits; if it's busy you'll see "Gemini is busy, try again in a minute."
- **Settings** (gear icon): enable notifications, export data (downloads a JSON backup of watchlists, holdings and alerts), import data (replaces everything after a confirmation; done in one database transaction), log out.
