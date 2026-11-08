import { cacheGet, cachePut, safely } from '../_lib/cache.js';
import { errorResponse, json, normalizeSymbol } from '../_lib/http.js';
import { getTimeSeries, ProviderError } from '../_lib/providers.js';

// 1M and 1Y share one daily fetch with ~200 extra trading days, so the 50/200-day
// moving averages can start at the left edge of the visible range.
const RANGES = {
  '1H': { interval: '1min', outputsize: 60, ttl: 60, latestSessionOnly: true },
  '1D': { interval: '5min', outputsize: 160, ttl: 60, latestSessionOnly: true },
  '1M': { interval: '1day', outputsize: 480, ttl: 3600, months: 1 },
  '1Y': { interval: '1day', outputsize: 480, ttl: 3600, months: 12 },
};

/**
 * GET /api/chart?symbol=AAPL&range=1D
 * -> { symbol, range, interval, bars: [{t, c}], start }
 * bars may begin before `start` (extra history for moving averages); the visible range starts at `start`.
 * Times are New York wall-clock seconds (as if UTC).
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get('symbol'));
  const range = (url.searchParams.get('range') || '').toUpperCase();
  const cfg = RANGES[range];
  if (!symbol) return errorResponse('Invalid ticker.');
  if (!cfg) return errorResponse('Range must be one of 1H, 1D, 1M, 1Y.');

  const key = `chart:${symbol}:${cfg.interval}:${cfg.outputsize}`;
  let series = await safely(cacheGet(env.DB, key), null);
  if (!series) {
    try {
      series = await getTimeSeries(env, symbol, cfg.interval, cfg.outputsize);
    } catch (err) {
      if (err instanceof ProviderError) return errorResponse(err.message, err.status, { code: err.code });
      throw err;
    }
    await safely(cachePut(env.DB, key, series, cfg.ttl));
  }

  let bars = series.bars;
  let start;
  if (cfg.latestSessionOnly) {
    // Keep only the most recent trading day (e.g. no overnight jump at 9:35 am).
    const lastDay = Math.floor(bars[bars.length - 1].t / 86400);
    bars = bars.filter((b) => Math.floor(b.t / 86400) === lastDay);
    start = bars[0].t;
  } else {
    const last = new Date(bars[bars.length - 1].t * 1000);
    const y = last.getUTCFullYear();
    const m = last.getUTCMonth() - cfg.months;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // avoid Mar 31 -> "Feb 31"
    start = Date.UTC(y, m, Math.min(last.getUTCDate(), daysInMonth)) / 1000;
  }

  return json({ symbol, range, interval: cfg.interval, bars, start });
}
