CREATE TABLE IF NOT EXISTS brave_daily_usage (
  day date PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0,
  CONSTRAINT brave_daily_usage_calls_range CHECK (calls BETWEEN 0 AND 30)
);
