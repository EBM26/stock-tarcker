-- Every table holding user data has user_id (fixed "owner" for now).

CREATE TABLE watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_watchlists_user ON watchlists (user_id, position);

CREATE TABLE watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (watchlist_id, symbol)
);
CREATE INDEX idx_items_watchlist ON watchlist_items (watchlist_id, position);

CREATE TABLE holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  shares REAL NOT NULL,
  avg_cost REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_holdings_user ON holdings (user_id);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  target_price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  triggered_at TEXT,
  triggered_price REAL
);
CREATE INDEX idx_alerts_user ON alerts (user_id, status);

CREATE TABLE risk_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_date TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, symbol, market_date)
);

CREATE TABLE api_cache (
  cache_key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  expires_at INTEGER NOT NULL -- epoch milliseconds
);
CREATE INDEX idx_cache_expires ON api_cache (expires_at);
