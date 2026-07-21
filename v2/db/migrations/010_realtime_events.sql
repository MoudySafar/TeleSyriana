BEGIN;

CREATE OR REPLACE FUNCTION telesyriana_notify_project_event(
  p_project_id TEXT,
  p_event_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_project_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_notify(
    'telesyriana_events',
    json_build_object(
      'projectId', p_project_id,
      'type', p_event_type,
      'entityType', p_entity_type,
      'entityId', p_entity_id,
      'at', NOW()
    )::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION telesyriana_notify_ticket_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value RECORD;
BEGIN
  row_value := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM telesyriana_notify_project_event(
    row_value.project_id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'ticket.created'
      WHEN TG_OP = 'DELETE' THEN 'ticket.deleted'
      ELSE 'ticket.updated'
    END,
    'ticket',
    row_value.id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS tickets_realtime_notify ON tickets;
CREATE TRIGGER tickets_realtime_notify
AFTER INSERT OR UPDATE OR DELETE ON tickets
FOR EACH ROW EXECUTE FUNCTION telesyriana_notify_ticket_event();

CREATE OR REPLACE FUNCTION telesyriana_notify_ticket_comment_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value RECORD;
  project_value TEXT;
BEGIN
  row_value := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT project_id INTO project_value FROM tickets WHERE id = row_value.ticket_id;
  PERFORM telesyriana_notify_project_event(
    project_value,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'ticket.comment_created'
      WHEN TG_OP = 'DELETE' THEN 'ticket.comment_deleted'
      ELSE 'ticket.comment_updated'
    END,
    'ticket_comment',
    row_value.id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS ticket_comments_realtime_notify ON ticket_comments;
CREATE TRIGGER ticket_comments_realtime_notify
AFTER INSERT OR UPDATE OR DELETE ON ticket_comments
FOR EACH ROW EXECUTE FUNCTION telesyriana_notify_ticket_comment_event();

CREATE OR REPLACE FUNCTION telesyriana_notify_chat_message_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value RECORD;
  project_value TEXT;
BEGIN
  row_value := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT project_id INTO project_value FROM chat_channels WHERE id = row_value.channel_id;
  PERFORM telesyriana_notify_project_event(
    project_value,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'chat.message_created'
      WHEN TG_OP = 'DELETE' THEN 'chat.message_deleted'
      ELSE 'chat.message_updated'
    END,
    'chat_message',
    row_value.id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_realtime_notify ON chat_messages;
CREATE TRIGGER chat_messages_realtime_notify
AFTER INSERT OR UPDATE OR DELETE ON chat_messages
FOR EACH ROW EXECUTE FUNCTION telesyriana_notify_chat_message_event();

CREATE OR REPLACE FUNCTION telesyriana_notify_chat_reaction_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value RECORD;
  project_value TEXT;
  channel_value TEXT;
BEGIN
  row_value := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT channel_id INTO channel_value FROM chat_messages WHERE id = row_value.message_id;
  SELECT project_id INTO project_value FROM chat_channels WHERE id = channel_value;
  PERFORM telesyriana_notify_project_event(
    project_value,
    CASE WHEN TG_OP = 'DELETE' THEN 'chat.reaction_deleted' ELSE 'chat.reaction_changed' END,
    'chat_reaction',
    row_value.message_id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS chat_reactions_realtime_notify ON chat_reactions;
CREATE TRIGGER chat_reactions_realtime_notify
AFTER INSERT OR DELETE ON chat_reactions
FOR EACH ROW EXECUTE FUNCTION telesyriana_notify_chat_reaction_event();

CREATE OR REPLACE FUNCTION telesyriana_notify_job_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value RECORD;
BEGIN
  row_value := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM telesyriana_notify_project_event(
    row_value.project_id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'job.created'
      WHEN TG_OP = 'DELETE' THEN 'job.deleted'
      ELSE 'job.updated'
    END,
    'job',
    row_value.id
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS jobs_realtime_notify ON jobs;
CREATE TRIGGER jobs_realtime_notify
AFTER INSERT OR UPDATE OR DELETE ON jobs
FOR EACH ROW EXECUTE FUNCTION telesyriana_notify_job_event();

COMMIT;
