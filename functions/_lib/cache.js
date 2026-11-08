// Shared server-side cache in D1 (api_cache table), so several devices don't multiply API calls.

export async function cacheGet(db, key) {
  const row = await db.prepare('SELECT body FROM api_cache WHERE cache_key = ? AND expires_at > ?').bind(key, Date.now()).first();
  return row ? JSON.parse(row.body) : null;
}

export async function cacheGetMany(db, keys) {
  const out = new Map();
  if (!keys.length) return out;
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT cache_key, body FROM api_cache WHERE expires_at > ? AND cache_key IN (${placeholders})`)
    .bind(Date.now(), ...keys)
    .all();
  for (const r of results) out.set(r.cache_key, JSON.parse(r.body));
  return out;
}

export async function cachePutMany(db, entries, ttlSeconds) {
  if (!entries.length) return;
  const expires = Date.now() + ttlSeconds * 1000;
  const stmt = db.prepare('INSERT OR REPLACE INTO api_cache (cache_key, body, expires_at) VALUES (?, ?, ?)');
  const statements = entries.map(([key, value]) => stmt.bind(key, JSON.stringify(value), expires));
  // Occasionally clear out expired rows so the table stays small.
  if (Math.random() < 0.05) statements.push(db.prepare('DELETE FROM api_cache WHERE expires_at < ?').bind(Date.now()));
  await db.batch(statements);
}

export function cachePut(db, key, value, ttlSeconds) {
  return cachePutMany(db, [[key, value]], ttlSeconds);
}

// Cache failures should never break a request; log and carry on.
export async function safely(promise, fallback) {
  try {
    return await promise;
  } catch (err) {
    console.error('cache error:', err?.message || err);
    return fallback;
  }
}
