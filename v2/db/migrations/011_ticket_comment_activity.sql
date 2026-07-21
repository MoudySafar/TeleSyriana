BEGIN;

CREATE OR REPLACE FUNCTION telesyriana_touch_ticket_from_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_ticket_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_ticket_id := OLD.ticket_id;
  ELSE
    parent_ticket_id := NEW.ticket_id;
  END IF;

  UPDATE tickets
  SET updated_at = NOW(),
      version = version + 1
  WHERE id = parent_ticket_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_comments_touch_ticket ON ticket_comments;
CREATE TRIGGER ticket_comments_touch_ticket
AFTER INSERT OR UPDATE OR DELETE ON ticket_comments
FOR EACH ROW EXECUTE FUNCTION telesyriana_touch_ticket_from_comment();

COMMIT;
