import { cleanName, errorResponse, json, normalizeSymbol, USER_ID } from '../_lib/http.js';
import { parseHoldingNumbers } from '../_lib/holdings.js';

const MAX_BYTES = 1_000_000;
const LIMITS = { lists: 30, items: 100, holdings: 100, alerts: 100 };

const isoOrNull = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** Validates a backup file. Returns { data } or { error }. Never trusts the file's shape. */
function parseBackup(body) {
  if (!body || body.app !== 'stock-tracker' || !Array.isArray(body.watchlists)) {
    return { error: "That file isn't a Stock Tracker backup." };
  }
  if (body.version !== 1) return { error: 'This backup was made by a newer version of the app.' };

  const watchlists = [];
  for (const l of body.watchlists.slice(0, LIMITS.lists)) {
    const name = cleanName(l?.name) || 'Watchlist';
    const seen = new Set();
    const items = [];
    for (const it of Array.isArray(l?.items) ? l.items : []) {
      const symbol = normalizeSymbol(it?.symbol);
      if (!symbol || seen.has(symbol) || items.length >= LIMITS.items) continue;
      seen.add(symbol);
      items.push({ symbol, name: String(it?.name ?? symbol).trim().slice(0, 120) || symbol });
    }
    watchlists.push({ name, items });
  }
  if (!watchlists.length) watchlists.push({ name: 'My Watchlist', items: [] });

  const holdings = [];
  const heldSeen = new Set();
  for (const h of Array.isArray(body.holdings) ? body.holdings : []) {
    const symbol = normalizeSymbol(h?.symbol);
    const nums = parseHoldingNumbers(h);
    if (!symbol || nums.error || heldSeen.has(symbol) || holdings.length >= LIMITS.holdings) continue;
    heldSeen.add(symbol);
    holdings.push({ symbol, shares: nums.shares, avgCost: nums.avgCost });
  }

  const alerts = [];
  const alertSeen = new Set();
  for (const a of Array.isArray(body.alerts) ? body.alerts : []) {
    const symbol = normalizeSymbol(a?.symbol);
    const target = Number(a?.target_price);
    if (!symbol || alertSeen.has(symbol) || alerts.length >= LIMITS.alerts) continue; // one alert per ticker
    if (a?.direction !== 'above' && a?.direction !== 'below') continue;
    if (!Number.isFinite(target) || target <= 0 || target > 1e7) continue;
    alertSeen.add(symbol);
    const triggered = a?.status === 'triggered';
    const price = Number(a?.triggered_price);
    alerts.push({
      symbol,
      direction: a.direction,
      target,
      status: triggered ? 'triggered' : 'active',
      createdAt: isoOrNull(a?.created_at),
      triggeredAt: triggered ? isoOrNull(a?.triggered_at) : null,
      triggeredPrice: triggered && Number.isFinite(price) ? price : null,
    });
  }
  return { data: { watchlists, holdings, alerts } };
}

/** POST /api/import (backup JSON) — replaces all watchlists, holdings and alerts in one transaction. */
export async function onRequestPost({ request, env }) {
  const text = await request.text();
  if (text.length > MAX_BYTES) return errorResponse('That file is too large to be a backup.', 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse("That file isn't valid JSON.");
  }
  const { data, error } = parseBackup(body);
  if (error) return errorResponse(error);

  const db = env.DB;
  const now = new Date().toISOString();
  const stmts = [
    db.prepare('DELETE FROM watchlist_items WHERE user_id = ?').bind(USER_ID),
    db.prepare('DELETE FROM watchlists WHERE user_id = ?').bind(USER_ID),
    db.prepare('DELETE FROM holdings WHERE user_id = ?').bind(USER_ID),
    db.prepare('DELETE FROM alerts WHERE user_id = ?').bind(USER_ID),
  ];
  data.watchlists.forEach((l, pos) => {
    stmts.push(db.prepare('INSERT INTO watchlists (user_id, name, position) VALUES (?, ?, ?)').bind(USER_ID, l.name, pos));
    l.items.forEach((it, i) => {
      // New list ids aren't known inside a batch, so look the list up by its (unique) position.
      stmts.push(
        db
          .prepare(
            `INSERT INTO watchlist_items (user_id, watchlist_id, symbol, display_name, position)
             SELECT ?, id, ?, ?, ? FROM watchlists WHERE user_id = ? AND position = ?`
          )
          .bind(USER_ID, it.symbol, it.name, i + 1, USER_ID, pos)
      );
    });
  });
  for (const h of data.holdings) {
    stmts.push(db.prepare('INSERT INTO holdings (user_id, symbol, shares, avg_cost) VALUES (?, ?, ?, ?)').bind(USER_ID, h.symbol, h.shares, h.avgCost));
  }
  for (const a of data.alerts) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO alerts (user_id, symbol, direction, target_price, status, created_at, triggered_at, triggered_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(USER_ID, a.symbol, a.direction, a.target, a.status, a.createdAt || now, a.triggeredAt, a.triggeredPrice)
    );
  }
  await db.batch(stmts); // D1 runs a batch as one transaction: all or nothing.

  return json({
    ok: true,
    counts: {
      watchlists: data.watchlists.length,
      tickers: data.watchlists.reduce((n, l) => n + l.items.length, 0),
      holdings: data.holdings.length,
      alerts: data.alerts.length,
    },
  });
}
