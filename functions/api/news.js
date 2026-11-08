import { newsCached } from '../_lib/company.js';
import { errorResponse, json, normalizeSymbol } from '../_lib/http.js';
import { ProviderError } from '../_lib/providers.js';

/** GET /api/news?symbol=AAPL -> { news: [{ headline, source, url, time }] } (latest 5, last 7 days) */
export async function onRequestGet({ request, env }) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get('symbol'));
  if (!symbol) return errorResponse('Invalid ticker.');
  try {
    const news = await newsCached(env, symbol);
    return json({ news: news.slice(0, 5).map(({ headline, source, url, time }) => ({ headline, source, url, time })) });
  } catch (err) {
    if (err instanceof ProviderError) return errorResponse(err.message, err.status, { code: err.code });
    throw err;
  }
}
