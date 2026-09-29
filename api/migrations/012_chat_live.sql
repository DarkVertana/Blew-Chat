CREATE FUNCTION notify_chat_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_notify('blew_chat',NEW.bot_id::TEXT);
 RETURN NEW;
END $$;
CREATE TRIGGER live_chat_turn AFTER INSERT OR UPDATE ON bot_turns FOR EACH ROW EXECUTE FUNCTION notify_chat_change();
CREATE TRIGGER live_chat_task AFTER INSERT OR UPDATE ON computer_tasks FOR EACH ROW EXECUTE FUNCTION notify_chat_change();
