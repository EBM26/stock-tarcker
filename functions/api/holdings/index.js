import { HOLDING_COLUMNS, parseHoldingNumbers } from '../../_lib/holdings.js';
import { errorResponse, json, normalizeSymbol, readJson, USER_ID } from '../../_lib/http.js';

const MAX_HOLDINGS = 100;

/** GET /api/holdings -> { holdings } */
export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare(`SELECT ${HOLDING_COLUMNS} FROM holdings WHERE user_id = ? ORDER BY symbol`)
    .bind(USER_ID)
    .all();
  return json({ holdings: results });
}

/** POST /api/holdings { symbol, shares, avg_cost } — one holding per ticker */
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const symbol = normalizeSymbol(body?.symbol);
  if (!symbol) return errorResponse('Choose a ticker.');
  const nums = parseHoldingNumbers(body);
  if (nums.error) return errorResponse(nums.error);

  const existing = await env.DB
    .prepare('SELECT id FROM holdings WHERE user_id = ? AND symbol = ?')
    .bind(USER_ID, symbol)
    .first();
  if (existing) return errorResponse(`${symbol} is already in your portfolio. Edit it instead.`, 409, { id: existing.id });
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM holdings WHERE user_id = ?').bind(USER_ID).first();
  if (n >= MAX_HOLDINGS) return errorResponse(`You can have up to ${MAX_HOLDINGS} holdings.`);

  const holding = await env.DB
    .prepare(`INSERT INTO holdings (user_id, symbol, shares, avg_cost) VALUES (?, ?, ?, ?) RETURNING ${HOLDING_COLUMNS}`)
    .bind(USER_ID, symbol, nums.shares, nums.avgCost)
    .first();
  return json({ holding }, 201);
}
