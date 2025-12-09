-- 001_init.sql
CREATE TABLE IF NOT EXISTS game_state (
  id                 INTEGER PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'waiting', -- waiting|running|won|lost
  center_lat         DOUBLE PRECISION,
  center_lon         DOUBLE PRECISION,
  deadline_utc       TIMESTAMPTZ,
  active_start_index INTEGER NOT NULL DEFAULT 0,
  selected_sectors   INTEGER[] NOT NULL DEFAULT '{}',
  guesses_remaining  INTEGER NOT NULL DEFAULT 3,
  solution           JSONB,
  solution_revealed  BOOLEAN NOT NULL DEFAULT FALSE,
  hints              JSONB NOT NULL DEFAULT '[]',
  version            BIGINT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sectors      JSONB NOT NULL,          -- array[int] 0..12 in ring order
  animal       TEXT NOT NULL,           -- OAK|LEOPARD|ZEBRA|VULTURE
  count        INTEGER NOT NULL,
  game_version BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS commands_dedup (
  command_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO game_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
