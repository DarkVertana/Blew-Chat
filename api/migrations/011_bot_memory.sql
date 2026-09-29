CREATE TABLE bot_memory_exclusions (
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, source_id TEXT NOT NULL,
 PRIMARY KEY(bot_id,kind,source_id)
);
CREATE TABLE bot_memories (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, source_id TEXT NOT NULL, part INT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, attachment_id TEXT,
 occurred_at TIMESTAMPTZ NOT NULL, hidden BOOLEAN NOT NULL DEFAULT false,
 revision BIGINT NOT NULL DEFAULT 1, indexed_revision BIGINT NOT NULL DEFAULT 0,
 search TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple',title||' '||body)) STORED,
 UNIQUE(bot_id,kind,source_id,part)
);
CREATE INDEX bot_memories_search ON bot_memories USING GIN(search);
CREATE INDEX bot_memories_owner ON bot_memories(bot_id,occurred_at DESC) WHERE NOT hidden;
CREATE INDEX bot_memories_pending ON bot_memories(id) WHERE indexed_revision<>revision;
CREATE TABLE bot_memory_notes (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION remember_source(b BIGINT,k TEXT,s TEXT,t TEXT,content TEXT,at_time TIMESTAMPTZ,a TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO bot_memories(bot_id,kind,source_id,part,title,body,occurred_at,attachment_id,hidden)
 SELECT b,k,s,n,t,substring(content FROM n*1400+1 FOR 1600),at_time,a,
 EXISTS(SELECT 1 FROM bot_memory_exclusions WHERE bot_id=b AND kind=k AND source_id=s)
 FROM generate_series(0,greatest(0,(length(content)-1)/1400)) n
 ON CONFLICT(bot_id,kind,source_id,part) DO UPDATE SET
 title=EXCLUDED.title,body=EXCLUDED.body,occurred_at=EXCLUDED.occurred_at,attachment_id=EXCLUDED.attachment_id,
 revision=bot_memories.revision+1
 WHERE bot_memories.body IS DISTINCT FROM EXCLUDED.body OR bot_memories.title IS DISTINCT FROM EXCLUDED.title;
 DELETE FROM bot_memories WHERE bot_id=b AND kind=k AND source_id=s AND part>greatest(0,(length(content)-1)/1400);
END $$;
CREATE FUNCTION memory_turn() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM remember_source(NEW.bot_id,'user',NEW.id,'User message',NEW.user_text,NEW.started_at);
 IF NEW.status='complete' THEN
  PERFORM remember_source(NEW.bot_id,'assistant',NEW.id,'Bot reply',NEW.assistant_text,NEW.started_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER remember_turn AFTER INSERT OR UPDATE OF status,user_text,assistant_text ON bot_turns FOR EACH ROW EXECUTE FUNCTION memory_turn();
CREATE FUNCTION attachment_memory_text(d BYTEA,n TEXT,m TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
 IF m LIKE 'text/%' OR n ~* '\.(txt|md|csv|json|log|ts|tsx|js|jsx|py|go|rs|sh|yaml|yml|xml|html|css|sql)$' THEN
  RETURN 'File: '||n||E'\n'||convert_from(d,'UTF8');
 END IF;
 RETURN 'File: '||n||'. Binary contents require the original attachment or an approved Linux inspection. No contents have been inferred.';
EXCEPTION WHEN OTHERS THEN RETURN 'File: '||n||'. Contents require approved Linux inspection.';
END $$;
CREATE FUNCTION memory_attachment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.turn_id IS NOT NULL THEN PERFORM remember_source(NEW.bot_id,'file',NEW.id,NEW.name,attachment_memory_text(NEW.data,NEW.name,NEW.media_type),NEW.created_at,NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER remember_attachment AFTER INSERT OR UPDATE OF turn_id ON bot_attachments FOR EACH ROW EXECUTE FUNCTION memory_attachment();
CREATE FUNCTION memory_task() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('complete','failed','cancelled') THEN PERFORM remember_source(NEW.bot_id,'task',NEW.id::TEXT,NEW.title,'Status: '||NEW.status||E'\nCommand: '||NEW.command||E'\nOutput:\n'||NEW.output,COALESCE(NEW.started_at,NEW.created_at)); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER remember_task AFTER INSERT OR UPDATE OF status,output ON computer_tasks FOR EACH ROW EXECUTE FUNCTION memory_task();
CREATE FUNCTION memory_note() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM remember_source(NEW.bot_id,'note',NEW.id::TEXT,'Saved memory',NEW.text,NEW.created_at);
 RETURN NEW;
END $$;
CREATE TRIGGER remember_note AFTER INSERT OR UPDATE OF text ON bot_memory_notes FOR EACH ROW EXECUTE FUNCTION memory_note();
-- Backfill every stored conversation and file, not just the latest UI page.
SELECT remember_source(bot_id,'user',id,'User message',user_text,started_at) FROM bot_turns;
SELECT remember_source(bot_id,'assistant',id,'Bot reply',assistant_text,started_at) FROM bot_turns WHERE status='complete';
SELECT remember_source(bot_id,'file',id,name,attachment_memory_text(data,name,media_type),created_at,id) FROM bot_attachments WHERE turn_id IS NOT NULL;
SELECT remember_source(bot_id,'task',id::TEXT,title,'Status: '||status||E'\nCommand: '||command||E'\nOutput:\n'||output,COALESCE(started_at,created_at)) FROM computer_tasks WHERE status IN ('complete','failed','cancelled');
