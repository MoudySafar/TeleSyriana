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
  membership_role_value TEXT;
  membership_supervisor_id TEXT;
  conflicting_team_id TEXT;
BEGIN
  SELECT project_id, supervisor_user_id, status
  INTO team_project_id, team_supervisor_id, team_status_value
  FROM teams
  WHERE id = NEW.team_id;

  IF team_project_id IS NULL OR team_status_value <> 'active' THEN
    RAISE EXCEPTION 'Team % is not active', NEW.team_id
      USING ERRCODE = '23514';
  END IF;

  SELECT status, role, supervisor_user_id
  INTO membership_status_value, membership_role_value, membership_supervisor_id
  FROM project_memberships
  WHERE user_id = NEW.user_id
    AND project_id = team_project_id;

  IF membership_status_value IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'User % has no active membership in team project %', NEW.user_id, team_project_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    SELECT tm.team_id INTO conflicting_team_id
    FROM team_members tm
    INNER JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = NEW.user_id
      AND tm.status = 'active'
      AND t.project_id = team_project_id
      AND t.status = 'active'
      AND tm.team_id <> NEW.team_id
    LIMIT 1;

    IF conflicting_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'User % is already active in team % for project %', NEW.user_id, conflicting_team_id, team_project_id
        USING ERRCODE = '23514';
    END IF;

    IF membership_role_value = 'agent'
       AND membership_supervisor_id IS NOT NULL
       AND team_supervisor_id IS NOT NULL
       AND membership_supervisor_id <> team_supervisor_id THEN
      RAISE EXCEPTION 'Agent % is assigned to a different Supervisor in project %', NEW.user_id, team_project_id
        USING ERRCODE = '23514';
    END IF;

    IF membership_role_value = 'agent' AND team_supervisor_id IS NOT NULL THEN
      UPDATE project_memberships
      SET supervisor_user_id = team_supervisor_id,
          updated_at = NOW()
      WHERE user_id = NEW.user_id
        AND project_id = team_project_id
        AND status = 'active'
        AND role = 'agent';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
