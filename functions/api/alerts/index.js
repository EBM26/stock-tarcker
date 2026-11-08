import { ALERT_COLUMNS } from '../../_lib/alerts.js';
import { errorResponse, json, normalizeSymbol, readJson, USER_ID } from '../../_lib/http.js';
const MAX_ALERTS = 100;

/** GET /api/alerts -> { alerts } (active first, then most recently triggered) */
export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare(
      `SELECT ${ALERT_COLUMNS} FROM alerts WHERE user_id = ?
       ORDER BY status = 'triggered', triggered_at DESC, symbol`
    )
    .bind(USER_ID)
    .all();
  return json({ alerts: results });
}

/**
 * POST /api/alerts { symbol, direction: 'above'|'below', target_price }
 * One alert per ticker (v1): setting a new one replaces any existing alert for that ticker.
 */
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const symbol = normalizeSymbol(body?.symbol);
  const direction = body?.direction;
  const target = Number(body?.target_price);
  if (!symbol) return errorResponse('Invalid ticker.');
  if (direction !== 'above' && direction !== 'below') return errorResponse('Choose above or below.');
  if (!Number.isFinite(target) || target <= 0 || target > 1e7) return errorResponse('Enter a price greater than 0.');

  const { n } = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND symbol != ?')
    .bind(USER_ID, symbol)
    .first();
  if (n >= MAX_ALERTS) return errorResponse(`You can have up to ${MAX_ALERTS} alerts.`);

  // D1 runs a batch as one transaction, so this replace is atomic.
  const [, inserted] = await env.DB.batch([
    env.DB.prepare('DELETE FROM alerts WHERE user_id = ? AND symbol = ?').bind(USER_ID, symbol),
    env.DB
      .prepare(`INSERT INTO alerts (user_id, symbol, direction, target_price) VALUES (?, ?, ?, ?) RETURNING ${ALERT_COLUMNS}`)
      .bind(USER_ID, symbol, direction, Math.round(target * 10000) / 10000),
  ]);
  return json({ alert: inserted.results[0] }, 201);
}
