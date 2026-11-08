// Small response helpers shared by all functions.

export const USER_ID = 'owner'; // Single user for now; kept in every user-data table.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

export function normalizeSymbol(value) {
  const s = String(value ?? '').trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

export function cleanName(value, max = 50) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= max ? s : null;
}
