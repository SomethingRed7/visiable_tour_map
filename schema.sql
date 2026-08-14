CREATE TABLE IF NOT EXISTS entries (
  date TEXT NOT NULL,
  ts INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  album TEXT,
  author TEXT,
  location TEXT,
  photos TEXT NOT NULL DEFAULT '[]',
  photo_hashes TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT,
  PRIMARY KEY (date, ts)
);

-- 登录账号(白名单见 wrangler.toml [vars] USERS;密码哈希运行时写入,
-- 首次登录凭一次性设置码设置,salt/hash 均为 hex 字符串)
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 规划待办(私有,仅登录用户可见/可写;date=YYYY-MM-DD,done=0/1)
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  checkin_ts INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_date ON todos (date);
