// Thin wrapper around fetch for our own /api endpoints.
// Every call has a timeout and turns failures into a friendly message.

export class ApiError extends Error {
  constructor(message, status = 0, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

const TIMEOUT_MS = 15000;

export async function api(path, { method = 'GET', body, signal } = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout;
  let res;
  try {
    res = await fetch(path, {
      method,
      signal: combined,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // Caller cancelled; let them ignore it.
    if (timeout.aborted) throw new ApiError('The server took too long to respond. Please try again.');
    throw new ApiError("Can't reach the server. Check your connection.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* Non-JSON response; handled below. */
  }

  if (res.status === 401 && path !== '/api/login') {
    onUnauthorized();
    throw new ApiError('Please log in.', 401);
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Something went wrong (${res.status}).`, res.status, data?.code || null);
  }
  return data ?? {};
}
