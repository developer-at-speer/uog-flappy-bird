ALTER TABLE players
  ADD COLUMN IF NOT EXISTS recovery_hash bytea UNIQUE;

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS runs_player_recent ON runs (player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS scores_run_id ON scores (run_id);
