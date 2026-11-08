import { cacheGet, safely } from '../_lib/cache.js';
import { financialsCached, newsCached, profileCached } from '../_lib/company.js';
import { errorResponse, json, normalizeSymbol, readJson, USER_ID } from '../_lib/http.js';
import { generateJson, getQuote, ProviderError } from '../_lib/providers.js';
import { buildRiskPrompt, isLegacySummary, RISK_SCHEMA, RISK_SYSTEM, usMarketDate, validateRiskSummary } from '../_lib/risk.js';

// Optional inputs: a failure here just means less information for the summary.
const optional = (promise) => promise.catch(() => null);

/**
 * POST /api/risk-summary { symbol, refresh? }  — the outlook summary (upsides + risks)
 * Returns today's saved summary unless refresh is set; otherwise gathers data, asks Gemini, validates and saves.
 * A saved summary in the old risks-only format is regenerated automatically; if that fails, the old one is
 * returned with legacy: true so the page can offer "Refresh for full outlook".
 */
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const symbol = normalizeSymbol(body?.symbol);
  if (!symbol) return errorResponse('Invalid ticker.');
  const marketDate = usMarketDate();

  let legacy = null;
  if (!body?.refresh) {
    const saved = await env.DB
      .prepare('SELECT summary_json, model, created_at FROM risk_summaries WHERE user_id = ? AND symbol = ? AND market_date = ?')
      .bind(USER_ID, symbol, marketDate)
      .first();
    if (saved) {
      const response = { symbol, market_date: marketDate, model: saved.model, created_at: saved.created_at, summary: JSON.parse(saved.summary_json), saved: true };
      if (!isLegacySummary(response.summary)) return json(response);
      legacy = { ...response, legacy: true }; // old format: try to regenerate below
    }
  }

  try {
    const cachedQuote = await safely(cacheGet(env.DB, `quote:${symbol}`), null);
    const [profile, financials, news, quote] = await Promise.all([
      optional(profileCached(env, symbol)),
      optional(financialsCached(env, symbol)),
      optional(newsCached(env, symbol)),
      cachedQuote ? cachedQuote : optional(getQuote(env, symbol)),
    ]);
    const prompt = buildRiskPrompt({ symbol, profile, financials, quote, news: (news || []).slice(0, 15), marketDate });
    const { json: raw, model } = await generateJson(env, { system: RISK_SYSTEM, prompt, schema: RISK_SCHEMA });
    const summary = validateRiskSummary(raw);
    if (!summary) {
      if (legacy) return json({ ...legacy, refresh_error: 'Gemini returned an unexpected answer.' });
      return errorResponse('Gemini returned an unexpected answer. Please try again.', 502, { code: 'bad_output' });
    }

    const row = await env.DB
      .prepare(
        `INSERT INTO risk_summaries (user_id, symbol, market_date, summary_json, model) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, symbol, market_date) DO UPDATE SET
           summary_json = excluded.summary_json, model = excluded.model,
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         RETURNING created_at`
      )
      .bind(USER_ID, symbol, marketDate, JSON.stringify(summary), model)
      .first();
    return json({ symbol, market_date: marketDate, model, created_at: row.created_at, summary, saved: false });
  } catch (err) {
    if (legacy) return json({ ...legacy, refresh_error: err instanceof ProviderError ? err.message : 'Could not refresh.' });
    if (err instanceof ProviderError) return errorResponse(err.message, err.status, { code: err.code });
    throw err;
  }
}
