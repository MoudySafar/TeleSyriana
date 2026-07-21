BEGIN;

CREATE OR REPLACE FUNCTION telesyriana_validate_team_member()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  team_project_id TEXT;
  team_supervisor_id TEXT;
  team_status_value TEXT;
  membership_status_value TEXT;
BEGIN
  SELECT project_id, supervisor_user_id, status
  INTO team_project_id, team_supervisor_id, team_status_value
  FROM teams
  WHERE id = NEW.team_id;

  IF team_project_id IS NULL OR team_status_value <> 'active' THEN
    RAISE EXCEPTION 'Team % is not active', NEW.team_id
      USING ERRCODE = '23514';
  END IF;

  SELECT status
  INTO membership_status_value
  FROM project_memberships
  WHERE user_id = NEW.user_id
    AND project_id = team_project_id;

  IF membership_status_value IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'User % has no active membership in team project %', NEW.user_id, team_project_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' AND team_supervisor_id IS NOT NULL THEN
    UPDATE project_memberships
    SET supervisor_user_id = team_supervisor_id,
        updated_at = NOW()
    WHERE user_id = NEW.user_id
      AND project_id = team_project_id
      AND status = 'active'
      AND role = 'agent';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_members_validate_membership ON team_members;
CREATE TRIGGER team_members_validate_membership
BEFORE INSERT OR UPDATE OF team_id, user_id, status ON team_members
FOR EACH ROW EXECUTE FUNCTION telesyriana_validate_team_member();

COMMIT;
