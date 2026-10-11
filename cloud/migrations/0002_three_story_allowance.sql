-- Three preparation groups per visitor daily; global allowance remains 300.
DROP TRIGGER job_quota;
CREATE TRIGGER job_quota BEFORE INSERT ON jobs BEGIN
  SELECT (CASE WHEN (SELECT COUNT(*) FROM jobs WHERE ip_hash = NEW.ip_hash AND created_at > NEW.created_at - 60000) >= 6 THEN RAISE(ABORT, 'rate_limit') END);
  SELECT (CASE WHEN (SELECT COUNT(*) FROM jobs WHERE owner = NEW.owner AND status = 'pending' AND created_at > NEW.created_at - 300000) >= 2 THEN RAISE(ABORT, 'busy_limit') END);
  SELECT (CASE WHEN COALESCE((SELECT used FROM quota WHERE scope = 'global' AND day = NEW.day), 0) + NEW.units > 300 THEN RAISE(ABORT, 'daily_limit') END);
  SELECT (CASE WHEN COALESCE((SELECT used FROM quota WHERE scope = 'ip:' || NEW.ip_hash AND day = NEW.day), 0) + NEW.units > 90 THEN RAISE(ABORT, 'daily_limit') END);
  SELECT (CASE WHEN COALESCE((SELECT used FROM quota WHERE scope = 'session:' || NEW.owner AND day = NEW.day), 0) + NEW.units > 90 THEN RAISE(ABORT, 'daily_limit') END);
  INSERT INTO quota(scope, day, used) VALUES('global', NEW.day, NEW.units) ON CONFLICT(scope, day) DO UPDATE SET used = used + NEW.units;
  INSERT INTO quota(scope, day, used) VALUES('ip:' || NEW.ip_hash, NEW.day, NEW.units) ON CONFLICT(scope, day) DO UPDATE SET used = used + NEW.units;
  INSERT INTO quota(scope, day, used) VALUES('session:' || NEW.owner, NEW.day, NEW.units) ON CONFLICT(scope, day) DO UPDATE SET used = used + NEW.units;
END;
