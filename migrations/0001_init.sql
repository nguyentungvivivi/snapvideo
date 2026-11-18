-- SnapVid Cloudflare D1 Schema (Zero-Cost Edge SQLite)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  fingerprint TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  vip_until REAL DEFAULT 0,
  vip_plan TEXT DEFAULT '',
  bonus_credits INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  created_at REAL NOT NULL,
  last_seen REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_usage (
  subject_key TEXT NOT NULL,
  date_str TEXT NOT NULL,
  used_count INTEGER DEFAULT 0,
  PRIMARY KEY (subject_key, date_str)
);

CREATE TABLE IF NOT EXISTS vip_keys (
  code TEXT PRIMARY KEY,
  plan_name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS vip_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  contact_info TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL,
  quality TEXT NOT NULL,
  title TEXT DEFAULT '',
  created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  expires_at REAL NOT NULL
);
