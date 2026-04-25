ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_wristbands_estimated_check;

ALTER TABLE teams
  ADD CONSTRAINT teams_wristbands_estimated_check
  CHECK (
    wristbands_estimated IS NULL
    OR wristbands_estimated BETWEEN 0 AND 500
  );

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_wristbands_actual_check;

ALTER TABLE teams
  ADD CONSTRAINT teams_wristbands_actual_check
  CHECK (
    wristbands_actual IS NULL
    OR wristbands_actual BETWEEN 0 AND 500
  );
