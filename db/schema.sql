CREATE TABLE IF NOT EXISTS predictions (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  question TEXT NOT NULL,
  ai_yes DOUBLE PRECISION NOT NULL DEFAULT 0,
  market_yes DOUBLE PRECISION NOT NULL DEFAULT 0,
  signal TEXT NOT NULL DEFAULT 'NEUTRAL',
  edge_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  ai_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'RESOLVED')),
  correct BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS predictions_client_idx
ON predictions(client_id);

CREATE INDEX IF NOT EXISTS predictions_status_idx
ON predictions(status);

CREATE INDEX IF NOT EXISTS predictions_market_idx
ON predictions(market_id);

CREATE INDEX IF NOT EXISTS predictions_created_idx
ON predictions(created_at DESC);


CREATE TABLE IF NOT EXISTS watchlist (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(client_id, market_id)
);

CREATE INDEX IF NOT EXISTS watchlist_client_idx
ON watchlist(client_id);

CREATE INDEX IF NOT EXISTS watchlist_created_idx
ON watchlist(created_at DESC);
