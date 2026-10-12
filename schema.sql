DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS parties;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS news;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS complaints;
DROP TABLE IF EXISTS elections;

CREATE TABLE users (
  discord_id TEXT PRIMARY KEY,
  nick TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  party_id TEXT
);

CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  leader TEXT NOT NULL,
  members INTEGER DEFAULT 1,
  color TEXT NOT NULL,
  goal TEXT,
  avatar TEXT,
  password_hash TEXT
);

CREATE TABLE bills (
  id INTEGER PRIMARY KEY,
  party_id TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  votes TEXT DEFAULT '{}'
);

CREATE TABLE news (
  id INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  party_id TEXT,
  nick TEXT,
  why TEXT,
  name TEXT,
  leader TEXT,
  members INTEGER,
  goal TEXT,
  color TEXT,
  avatar TEXT,
  status TEXT DEFAULT 'new',
  timestamp INTEGER NOT NULL
);

CREATE TABLE complaints (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  nick TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE elections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  open INTEGER DEFAULT 0,
  candidates TEXT DEFAULT '[]',
  votes TEXT DEFAULT '{}'
);
