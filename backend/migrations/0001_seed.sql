CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  team_number INTEGER NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  organization TEXT,
  contact_number TEXT,
  contact_name TEXT,
  signature_image_path TEXT,
  pre_checked_in BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in BOOLEAN NOT NULL DEFAULT FALSE,
  wristbands_estimated INTEGER CHECK (
    wristbands_estimated IS NULL
    OR wristbands_estimated BETWEEN 0 AND 10
  ),
  wristbands_actual INTEGER CHECK (
    wristbands_actual IS NULL
    OR wristbands_actual BETWEEN 0 AND 10
  ),
  parking_pass BOOLEAN NOT NULL DEFAULT FALSE,
  pickup_name TEXT,
  pickup_phone_number TEXT,
  pickup_notes TEXT,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
