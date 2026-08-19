CREATE TABLE IF NOT EXISTS keychain_orders (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  shipping_json TEXT NOT NULL,
  items_json TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  estimated_price_usd REAL,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'tiny-county-makers',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  package_key TEXT NOT NULL,
  package_size INTEGER NOT NULL,
  package_sha256 TEXT NOT NULL,
  download_token_hash TEXT NOT NULL,
  payment_url TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  status_note TEXT NOT NULL DEFAULT '',
  workshop_notification_status TEXT NOT NULL DEFAULT 'not_configured',
  customer_notification_status TEXT NOT NULL DEFAULT 'not_configured',
  last_customer_email_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_keychain_orders_created_at
  ON keychain_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_keychain_orders_status
  ON keychain_orders(status, created_at DESC);
