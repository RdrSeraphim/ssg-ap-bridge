CREATE TABLE follower (
  id TEXT PRIMARY KEY,
  inbox TEXT NOT NULL
);

CREATE TABLE following (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  inbox TEXT NOT NULL,
  state TEXT NOT NULL,
  follow_activity_id TEXT NOT NULL
);

CREATE TABLE profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE message (
  id TEXT PRIMARY KEY,
  body TEXT
);