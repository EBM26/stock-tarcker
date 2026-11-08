# Stock Tracker — v1 Build Spec

You are building a personal stock tracking web app for one user (Eyal). Read this whole file before writing any code. Build in the phases listed under "Build order", and **stop after each phase** so the user can deploy and test before you continue.

## Goal

A simple, calm web page for following a few stocks. It replaces Yahoo Finance for this user because Yahoo is too busy and confusing. **Simplicity is the main feature.** Every decision should favor a clean, uncluttered screen over showing more data.

## Hard rules

1. **Plain HTML, CSS and JavaScript.** No frameworks, no bundler, no build step for the front end.
2. **White background**, minimal colors. Green for gains, red for losses, one accent color for buttons and links. Use a system font stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).
3. **The default screen shows only the current watchlist and one chart.** Portfolio, alerts management, chart options and settings live behind tabs or toggles. Never add a panel to the default screen without being asked.
4. **Responsive.** Watchlist beside the chart on desktop, stacked on mobile.
5. **All third-party API calls go through the server** (Cloudflare Pages Functions). API keys never reach the browser.
6. **Every external API call has a timeout, error handling, and a friendly error message in the UI.** The page must never break or go blank because one call failed.
7. **Keep all third-party API code in one place on the server** (`functions/_lib/providers.js` or similar) so a data provider can be swapped without touching the rest of the app.
8. **Check current API docs before writing integration code.** Free-tier endpoints, limits and Gemini model names change. If something in this spec no longer matches the docs, follow the docs and tell the user what changed.
9. **Every database table that holds user data has a `user_id` column**, even though there is only one user today. Use a fixed ID (e.g. `"owner"`) for now. This keeps the schema ready if multi-user support is added later.

## Stack

- **Code:** private GitHub repo, deploying automatically to **Cloudflare Pages** (Pages, not Workers).
- **Backend:** Cloudflare Pages Functions in `/functions`.
- **Database:** Cloudflare D1, with migrations in `/migrations`.
- **Charts:** TradingView Lightweight Charts, loaded from a CDN at an **exact pinned version**. Use the API that matches that version (v4 and v5 differ).
- **Data providers (free tiers):**
  - **Finnhub:** live quotes, symbol search, company news, company profile, basic financials.
  - **Twelve Data:** historical price data for charts.
  - **Google Gemini API:** risk summaries.

### Secrets and variables

Set in the Cloudflare Pages dashboard as type **Secret** (and in a git-ignored `.dev.vars` file for local development):

| Name | Purpose |
|---|---|
| `FINNHUB_API_KEY` | Finnhub |
| `TWELVEDATA_API_KEY` | Twelve Data |
| `GEMINI_API_KEY` | Gemini (free tier, no billing) |
| `APP_PASSWORD` | Password gate |
| `SESSION_SECRET` | Signs the session cookie |

Plain variables (not secrets):

| Name | Purpose |
|---|---|
| `GEMINI_MODEL` | Current Gemini Flash model name. Do not hardcode a model name anywhere in the code. |
| `GEMINI_FALLBACK_MODEL` | Optional second model to try if the main one keeps returning 503. |

## Password gate

- A simple password screen protects the whole app.
- `POST /api/login` checks the password against `APP_PASSWORD` and sets an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie signed with `SESSION_SECRET`, valid for 30 days.
- `functions/api/_middleware.js` rejects every `/api/*` request without a valid cookie (except `/api/login`).
- Add a "Log out" link in settings.
- Known bug from a previous project: if you hide the password screen with the `hidden` attribute, make sure no CSS `display` rule overrides it, or the screen stays visible after login.

## Database (D1)

Suggested schema; adjust if needed, but keep `user_id` everywhere:

- **watchlists**: `id`, `user_id`, `name`, `position`, `created_at`
- **watchlist_items**: `id`, `watchlist_id`, `symbol`, `display_name`, `position`, `added_at`
- **holdings**: `id`, `user_id`, `symbol`, `shares`, `avg_cost`, `updated_at`
- **alerts**: `id`, `user_id`, `symbol`, `direction` (`above` / `below`), `target_price`, `status` (`active` / `triggered`), `created_at`, `triggered_at`, `triggered_price`
- **risk_summaries**: `id`, `user_id`, `symbol`, `market_date`, `summary_json`, `model`, `created_at`, unique on (`user_id`, `symbol`, `market_date`)
- **api_cache**: `cache_key` (primary key), `body`, `expires_at`

On first run, create one watchlist called "My Watchlist" so the app is never empty.

## Features

### 1. Watchlists

- One watchlist is shown at a time. A dropdown at the top switches lists.
- Create, rename, delete watchlists (confirm before deleting). Deleting the last list is not allowed.
- Each row shows: **symbol, company name, current price, daily change ($ and %)**. Nothing else.
- Remove a ticker from the list. Reordering is optional; skip it if it adds complexity.
- Clicking a row opens that ticker in the chart panel.
- Show a small "Last updated" time and a note that prices may be delayed.

### 2. Ticker search with autocomplete

- A search box at the top. Uses Finnhub symbol search.
- Wait ~300 ms after the user stops typing before searching; minimum 1 character.
- Show up to 8 results: symbol and company name. Prefer US-listed common stocks and ETFs; filter out the many foreign-exchange duplicates Finnhub returns.
- Selecting a result opens it in the chart panel, with an "Add to watchlist" button.

### 3. Quotes and polling

- `GET /api/quotes?symbols=AAPL,MSFT` returns current price, daily change and previous close for each symbol.
- Server caches each quote in `api_cache` for 30 seconds, so multiple devices don't multiply API calls.
- Finnhub's free tier allows roughly 60 requests per minute. Each symbol is one request. Keep well under that:
  - The page polls only symbols on the **currently viewed watchlist** plus symbols with **active alerts** (deduplicated).
  - Poll every 60 seconds during US regular market hours (9:30 to 16:00 America/New_York, weekdays), every 15 minutes otherwise.
  - Cap at 50 symbols per cycle. If over the cap, show a quiet note rather than failing.

### 4. Chart panel

- Shows the selected ticker: name, symbol, current price, daily change.
- Range toggles: **1H, 1D, 1M, 1Y**. Pick sensible Twelve Data intervals for each (e.g. 1-minute bars for 1H, 5-minute for 1D, daily for 1M and 1Y).
- Line chart by default.
- Server endpoint `GET /api/chart?symbol=AAPL&range=1D`, cached in `api_cache`: about 1 minute for 1H and 1D, about 1 hour for 1M and 1Y.
- Twelve Data's free tier allows roughly 8 requests per minute and a daily cap. If a limit is hit, show "Chart data limit reached, try again in a minute," not an error dump.

**Chart options** (hidden behind a small "Chart options" toggle):

- **Moving averages:** 50-day and 200-day toggles. Available on 1M and 1Y only. Calculate them in the browser from daily data; fetch enough extra history that the lines start at the left edge of the visible range.
- **Compare:** pick a second ticker (reuse the search box component). Both lines are shown as **% change from the start of the range**, with a small legend. One "Clear compare" control.

### 5. Price alerts

- In the chart panel, a compact "Set alert" control: above/below and a price.
- An **Alerts** tab lists all alerts: active ones (with delete) and recently triggered ones (with "Re-arm" and delete).
- Alert checking happens in the browser, using the quotes already being polled.
- When a price crosses an alert:
  1. The browser calls `POST /api/alerts/:id/trigger`. The server updates the alert **only if it is still active** (`UPDATE ... WHERE status = 'active'`) and returns whether this request was the one that triggered it.
  2. Only if it was, show a **desktop notification** and play a short sound (generated with the Web Audio API; no audio file). This prevents duplicate alerts when the page is open on two devices.
- Notifications need permission, which browsers only allow from a click. Show an "Enable notifications" button in settings and as a one-time prompt the first time the user sets an alert.
- Each alert fires once, then stays "triggered" until re-armed.
- Alerts only work while the page is open in a tab. State this once in the Alerts tab, in one short line.

### 6. Portfolio

- A **Portfolio** tab.
- Add a holding: symbol (via search), shares, average cost per share. Edit and delete holdings.
- Table columns: symbol, shares, avg cost, current price, market value, profit/loss ($ and %), today's change ($).
- Totals row: total value, total cost, total P/L ($ and %), today's total change.
- Holdings are separate from watchlists. Portfolio symbols are polled only while the Portfolio tab is open.

### 7. News

- Under the chart, the **latest 5 headlines** for the selected ticker from Finnhub company news (last 7 days).
- Each shows headline, source and time ago, and opens the article in a new tab.
- Cache per symbol for 15 minutes.

### 8. Risk summary (Gemini)

- A **"Summarize risks"** button under the news. It runs only when clicked.
- `POST /api/risk-summary` with the symbol. The server:
  1. Returns the saved summary if one exists for this symbol and today's US market date, unless the request asks for a refresh.
  2. Otherwise gathers: company profile, basic financials (52-week high/low, beta, P/E, market cap, where available), and up to 15 recent headlines with their short summaries from Finnhub.
  3. Sends them to Gemini with a prompt that:
     - uses **only** the provided information, and says so plainly if the information is thin;
     - gives no buy/sell/hold recommendation and no price predictions;
     - returns JSON only (use Gemini's JSON response mode), shaped like:
       ```json
       {
         "overview": "2-3 plain-English sentences on what's happening with the company right now",
         "risks": [
           { "title": "short name", "detail": "1-2 sentences", "level": "low|medium|high" }
         ],
         "watch": ["things worth keeping an eye on, 2-4 items"],
         "data_note": "one line on how much information this was based on"
       }
       ```
  4. Validates the JSON, saves it to `risk_summaries`, returns it.
- **Gemini 503 / 429 handling:** retry automatically twice with backoff (about 1 s, then 3 s). If it still fails and `GEMINI_FALLBACK_MODEL` is set, try that once. If everything fails, show "Gemini is busy, try again in a minute."
- Display: overview, then risks with a small colored level tag, then "Watch for," then the data note. Show the date it was generated and a "Refresh" link.
- One line under it: "AI summary of recent news and basic data. Not financial advice."

### 9. Settings

A small settings panel (gear icon) with: enable notifications, export data, import data, log out.

- **Export:** downloads a JSON file of watchlists, holdings and alerts (a backup).
- **Import:** loads that file, with a confirmation that it replaces current data.

## Build order

Stop after each phase, summarize what was built, and list what the user should test.

1. **Setup and core:** project structure, `wrangler.jsonc`, D1 migrations, password gate, watchlists, ticker search, live quotes with polling. Deployable.
2. **Charts:** chart panel, range toggles, moving averages, compare.
3. **Alerts:** alert setting, Alerts tab, trigger endpoint, notifications and sound.
4. **Portfolio.**
5. **News, risk summary, settings (export/import).**

## Deployment notes

Lessons from a previous Cloudflare Pages + D1 project. Follow them and include them in the README:

- Create the project as **Pages** (connected to the GitHub repo), not as a Worker. The dashboard sometimes defaults to the Workers flow; look for the "Pages" tab or "Looking to deploy Pages?" link, then "Connect to Git."
- A correct deploy log includes "Found Functions directory at /functions" and "Compiled Worker successfully." If those lines are missing, only static files were deployed.
- **Never leave a placeholder D1 database ID.** In Phase 1, tell the user to run `npx wrangler d1 create stock-tracker` and paste the real `database_id` into `wrangler.jsonc` themselves. The binding name must match the code (use `DB`). If Wrangler offers to add the database entry automatically, the answer is no, because it would create a second, mismatched entry.
- Then apply migrations with `npx wrangler d1 migrations apply stock-tracker --remote`.
- All five secrets must be type **Secret** in Cloudflare before the first real deploy.
- `.dev.vars` must be in `.gitignore`.
- Local development: `npx wrangler pages dev` with a local D1 database.

## README

Write a short README covering: what the app does, how to get each free API key (Finnhub, Twelve Data, Google AI Studio for Gemini), setup and deployment steps, and how to change the Gemini model name.

## Out of scope for v1

Do not build these: email or phone alerts, alerts while the page is closed, percentage-change or volume alerts, multiple alerts per ticker, drawing tools, RSI/MACD or other indicators, crypto, non-US exchanges, broker connections, dark mode, user accounts beyond the single password.
