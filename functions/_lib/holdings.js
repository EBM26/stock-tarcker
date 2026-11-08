export const HOLDING_COLUMNS = 'id, symbol, shares, avg_cost, updated_at';

/** Validates { shares, avg_cost }. Returns { shares, avgCost } or { error }. */
export function parseHoldingNumbers(body) {
  const shares = Number(body?.shares);
  const avgCost = Number(body?.avg_cost);
  if (!Number.isFinite(shares) || shares <= 0 || shares > 1e9) return { error: 'Shares must be a number greater than 0.' };
  if (!Number.isFinite(avgCost) || avgCost < 0 || avgCost > 1e7) return { error: 'Average cost must be 0 or more.' };
  return { shares: Math.round(shares * 1e6) / 1e6, avgCost: Math.round(avgCost * 1e4) / 1e4 };
}
