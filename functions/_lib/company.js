// Cached wrappers around provider calls that several endpoints share.
import { cacheGet, cachePut, safely } from './cache.js';
import { getBasicFinancials, getCompanyNews, getCompanyProfile } from './providers.js';

const DAY = 24 * 60 * 60;

/** Company profile, cached 7 days. Returns null when unavailable (e.g. most ETFs). */
export async function profileCached(env, symbol) {
  const key = `profile:${symbol}`;
  const cached = await safely(cacheGet(env.DB, key), null);
  if (cached) return cached.name ? cached : null;
  const profile = await getCompanyProfile(env, symbol);
  await safely(cachePut(env.DB, key, profile || { name: null }, 7 * DAY));
  return profile;
}

/** Basic financials, cached 12 hours. */
export async function financialsCached(env, symbol) {
  const key = `metric:${symbol}`;
  const cached = await safely(cacheGet(env.DB, key), null);
  if (cached) return cached;
  const metrics = await getBasicFinancials(env, symbol);
  await safely(cachePut(env.DB, key, metrics, DAY / 2));
  return metrics;
}

/** Company news from the last 7 days, newest first, cached 15 minutes. */
export async function newsCached(env, symbol) {
  const key = `news:${symbol}`;
  const cached = await safely(cacheGet(env.DB, key), null);
  if (cached) return cached;
  const ymd = (d) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(to.getTime() - 7 * DAY * 1000);
  const news = (await getCompanyNews(env, symbol, ymd(from), ymd(to))).slice(0, 30);
  await safely(cachePut(env.DB, key, news, 15 * 60));
  return news;
}
