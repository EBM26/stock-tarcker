export function formatPrice(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  const digits = Math.abs(n) < 1 ? 4 : 2;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

export function formatChange(change, pct) {
  if (typeof change !== 'number' || !isFinite(change)) return '';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const abs = Math.abs(change).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const p = typeof pct === 'number' && isFinite(pct) ? ` (${sign}${Math.abs(pct).toFixed(2)}%)` : '';
  return `${sign}${abs}${p}`;
}

export function changeClass(change) {
  return change > 0 ? 'up' : change < 0 ? 'down' : '';
}

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** True during US regular market hours (9:30–16:00 America/New_York, weekdays). Holidays not included. */
export function isMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** $1,234.56 (or −$1,234.56 / +$1,234.56 with signed=true). */
export function formatMoney(n, { signed = false } = {}) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return `${sign}$${abs}`;
}

export function formatPercent(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
}

export function formatShares(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—';
}
