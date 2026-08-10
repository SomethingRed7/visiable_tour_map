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
  created_at TEXT,
  PRIMARY KEY (date, ts)
);
