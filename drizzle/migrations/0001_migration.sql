ALTER TABLE public.accounts ADD COLUMN banned_until timestamptz;
CREATE TABLE public.account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.account_sessions(account_id);
GRANT ALL ON public.account_sessions TO service_role;
ALTER TABLE public.account_sessions ENABLE ROW LEVEL SECURITY;