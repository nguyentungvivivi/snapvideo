-- SnapVid v2.1: Persistent User Accounts for Cross-Device & Incognito VIP Sync
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  vip_until REAL DEFAULT 0,
  vip_plan TEXT DEFAULT '',
  bonus_credits INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  created_at REAL NOT NULL,
  last_login REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at REAL NOT NULL,
  created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
