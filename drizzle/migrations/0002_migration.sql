CREATE TABLE public.app_config (name text PRIMARY KEY, value text NOT NULL);
GRANT ALL ON public.app_config TO service_role;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.app_db(p_key text, p_op text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  new_id uuid;
BEGIN
  IF p_key IS NULL OR NOT EXISTS (
    SELECT 1 FROM app_config WHERE name = 'bridge_key_sha256'
      AND value = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  CASE p_op
  WHEN 'account_by_username' THEN
    SELECT to_jsonb(x) INTO r FROM (SELECT id, password_hash, banned_until FROM accounts WHERE username = p_args->>'username') x;
  WHEN 'account_by_id' THEN
    SELECT to_jsonb(x) INTO r FROM (SELECT id, username, all_sites, allowed_sites, banned_until FROM accounts WHERE id = (p_args->>'id')::uuid) x;
  WHEN 'list_accounts' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at), '[]'::jsonb) INTO r FROM (
      SELECT a.id, a.username, a.all_sites, a.allowed_sites, a.created_at, a.banned_until,
        (SELECT count(*) FROM account_sessions s WHERE s.account_id = a.id AND s.last_seen > (p_args->>'since')::timestamptz)::int AS devices
      FROM accounts a) x;
  WHEN 'create_account' THEN
    BEGIN
      INSERT INTO accounts (username, password_hash, all_sites, allowed_sites)
      VALUES (p_args->>'username', p_args->>'password_hash', (p_args->>'all_sites')::boolean,
        ARRAY(SELECT jsonb_array_elements_text(p_args->'allowed_sites')));
      r := '{"ok":true}';
    EXCEPTION WHEN unique_violation THEN
      r := '{"ok":false,"error":"taken"}';
    END;
  WHEN 'update_account' THEN
    UPDATE accounts SET all_sites = (p_args->>'all_sites')::boolean,
      allowed_sites = ARRAY(SELECT jsonb_array_elements_text(p_args->'allowed_sites')),
      password_hash = coalesce(p_args->>'password_hash', password_hash)
    WHERE id = (p_args->>'id')::uuid;
  WHEN 'delete_account' THEN
    DELETE FROM accounts WHERE id = (p_args->>'id')::uuid;
  WHEN 'set_ban' THEN
    UPDATE accounts SET banned_until = (p_args->>'until')::timestamptz WHERE id = (p_args->>'id')::uuid;
  WHEN 'sessions_delete_device' THEN
    DELETE FROM account_sessions WHERE account_id = (p_args->>'account_id')::uuid AND device_id = p_args->>'device_id';
  WHEN 'sessions_active_count' THEN
    SELECT to_jsonb(count(*)::int) INTO r FROM account_sessions
      WHERE account_id = (p_args->>'account_id')::uuid AND last_seen > (p_args->>'since')::timestamptz;
  WHEN 'session_create' THEN
    INSERT INTO account_sessions (account_id, device_id) VALUES ((p_args->>'account_id')::uuid, p_args->>'device_id') RETURNING id INTO new_id;
    r := to_jsonb(new_id);
  WHEN 'sessions_delete_account' THEN
    DELETE FROM account_sessions WHERE account_id = (p_args->>'account_id')::uuid;
  WHEN 'session_delete' THEN
    DELETE FROM account_sessions WHERE id = (p_args->>'id')::uuid;
  WHEN 'session_get' THEN
    SELECT to_jsonb(x) INTO r FROM (SELECT account_id, last_seen FROM account_sessions WHERE id = (p_args->>'id')::uuid) x;
  WHEN 'session_touch' THEN
    UPDATE account_sessions SET last_seen = now() WHERE id = (p_args->>'id')::uuid;
  ELSE
    RAISE EXCEPTION 'unknown op %', p_op;
  END CASE;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.app_db(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_db(text, text, jsonb) TO anon, authenticated, service_role;