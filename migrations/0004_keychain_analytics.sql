CREATE TABLE IF NOT EXISTS keychain_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '/',
  referrer_host TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  order_reference TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_keychain_events_time
  ON keychain_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_keychain_events_funnel
  ON keychain_events(event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_keychain_events_session
  ON keychain_events(session_id, occurred_at DESC);
