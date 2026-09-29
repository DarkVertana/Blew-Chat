ALTER TABLE bot_turns ADD COLUMN reply_to TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX bot_turns_form_answer ON bot_turns(bot_id,reply_to) WHERE reply_to<>'' AND status<>'failed';
