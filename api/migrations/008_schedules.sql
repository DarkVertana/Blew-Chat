CREATE TABLE bot_schedules (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 prompt TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('ai','command')),
 computer_id BIGINT REFERENCES computers(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('once','cron')),
 cron TEXT NOT NULL DEFAULT '',
 timezone TEXT NOT NULL,
 run_at TIMESTAMPTZ,
 next_run TIMESTAMPTZ,
 enabled BOOLEAN NOT NULL DEFAULT true,
 deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_schedules_due ON bot_schedules(next_run) WHERE enabled AND deleted_at IS NULL;
CREATE TABLE schedule_runs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 schedule_id BIGINT NOT NULL REFERENCES bot_schedules(id) ON DELETE CASCADE,
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL,
 title TEXT NOT NULL,
 prompt TEXT NOT NULL,
 due_at TIMESTAMPTZ NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 finished_at TIMESTAMPTZ,
 status TEXT NOT NULL CHECK(status IN ('running','complete','failed','cancelled')),
 error TEXT NOT NULL DEFAULT '',
 lease TEXT NOT NULL
);
CREATE UNIQUE INDEX schedule_one_active ON schedule_runs(schedule_id) WHERE status='running';
ALTER TABLE computer_tasks ADD COLUMN schedule_run_id BIGINT REFERENCES schedule_runs(id) ON DELETE SET NULL;
CREATE INDEX schedule_runs_bot ON schedule_runs(bot_id,id DESC);
