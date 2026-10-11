CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('book', 'turn', 'asr')),
  units INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
  params TEXT NOT NULL,
  record TEXT,
  UNIQUE(owner, request_id)
);
CREATE INDEX jobs_library ON jobs(owner, kind, status, created_at DESC);
CREATE INDEX jobs_ip_recent ON jobs(ip_hash, created_at);
CREATE TABLE quota (scope TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope, day));

-- All checks and increments belong to the same insertion transaction.
CREATE TRIGGER job_quota BEFORE INSERT ON jobs BEGIN
  SELECT (CASE WHEN (SELECT COUNT(*) FROM jobs WHERE ip_hash = NEW.ip_hash AND created_at > NEW.created_at - 60000) >= 6 THEN RAISE(ABORT, 'rate_limit') END);
  SELECT (CASE WHEN (SELECT COUNT(*) FROM jobs WHERE owner = NEW.owner AND status = 'pending' AND created_at > NEW.created_at - 300000) >= 2 THEN RAISE(ABORT, 'busy_limit') END);
  SELECT (CASE WHEN COALESCE((SELECT used FROM quota WHERE scope = 'global' AND day = NEW.day), 0) + NEW.units > 300 THEN RAISE(ABORT, 'daily_limit') END);
  SELECT (CASE WHEN COALESCE((SELECT used FROM quota WHERE scope = 'ip:' || NEW.ip_hash AND day = NEW.day), 0) + NEW.units > 60 THEN RAISE(ABORT, 'daily_limit') END);
  SELECT (CASE WHEN COALESCE((SELECT used FROM quota WHERE scope = 'session:' || NEW.owner AND day = NEW.day), 0) + NEW.units > 60 THEN RAISE(ABORT, 'daily_limit') END);
  INSERT INTO quota(scope, day, used) VALUES('global', NEW.day, NEW.units) ON CONFLICT(scope, day) DO UPDATE SET used = used + NEW.units;
  INSERT INTO quota(scope, day, used) VALUES('ip:' || NEW.ip_hash, NEW.day, NEW.units) ON CONFLICT(scope, day) DO UPDATE SET used = used + NEW.units;
  INSERT INTO quota(scope, day, used) VALUES('session:' || NEW.owner, NEW.day, NEW.units) ON CONFLICT(scope, day) DO UPDATE SET used = used + NEW.units;
END;
