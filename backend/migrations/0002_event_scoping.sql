CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  robotevents_event_id BIGINT NOT NULL UNIQUE,
  event_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  program_name TEXT,
  program_code TEXT,
  season_name TEXT,
  season_code TEXT,
  location_venue TEXT,
  location_city TEXT,
  location_region TEXT,
  location_country TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teams
  ALTER COLUMN team_number TYPE TEXT USING team_number::text;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS event_id BIGINT;

DELETE FROM teams;

ALTER TABLE teams
  ALTER COLUMN event_id SET NOT NULL;

ALTER TABLE teams
  ADD CONSTRAINT teams_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_team_number_key;

ALTER TABLE teams
  ADD CONSTRAINT teams_event_id_team_number_key UNIQUE (event_id, team_number);

CREATE INDEX IF NOT EXISTS teams_event_id_idx ON teams (event_id);
