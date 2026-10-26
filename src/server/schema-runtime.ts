/** Runtime schema is additive; no provider response or secret is needed to migrate. */
export const RUNTIME_SCHEMA = `
CREATE TABLE IF NOT EXISTS relay.catalog_mappings (
  work_id text PRIMARY KEY REFERENCES relay.catalog_works(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL, entity_type text NOT NULL,
  entity_name text NOT NULL, query text NOT NULL,
  verified_at timestamptz NOT NULL, verification text NOT NULL,
  source text NOT NULL CHECK(source='live-qloo'),
  evidence jsonb NOT NULL DEFAULT '{}',
  CHECK(entity_type IN ('urn:entity:book','urn:entity:artist','urn:entity:videogame'))
);
CREATE TABLE IF NOT EXISTS relay.agent_jobs (
  session_id uuid NOT NULL, id uuid PRIMARY KEY, member_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','succeeded','partial','failed','cancelled','stale')),
  stage text NOT NULL DEFAULT 'queued', input jsonb NOT NULL,
  checkpoint jsonb NOT NULL DEFAULT '{}', report jsonb,
  error_code text, error_message text,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  lease_token uuid, lease_until timestamptz, cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,id),
  FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_active_per_member ON relay.agent_jobs(session_id,member_id)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS agent_queue_claim ON relay.agent_jobs(created_at) WHERE status='queued';
CREATE TABLE IF NOT EXISTS relay.agent_events (
  job_id uuid NOT NULL REFERENCES relay.agent_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL, stage text NOT NULL, message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,sequence)
);
CREATE TABLE IF NOT EXISTS relay.provider_calls (
  id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES relay.agent_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('qloo','openai')),
  operation text NOT NULL, state text NOT NULL CHECK(state IN ('started','succeeded','failed','uncertain')),
  input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  CHECK(input_tokens>=0 AND output_tokens>=0)
);
CREATE INDEX IF NOT EXISTS provider_daily_budget ON relay.provider_calls(provider,created_at);
CREATE INDEX IF NOT EXISTS provider_run_budget ON relay.provider_calls(job_id,provider);
CREATE TABLE IF NOT EXISTS relay.qloo_cache (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
  cache_key text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, PRIMARY KEY(session_id,cache_key)
);
CREATE TABLE IF NOT EXISTS relay.qloo_query_cache (
  namespace text NOT NULL, cache_key text NOT NULL, response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  PRIMARY KEY(namespace,cache_key)
);
CREATE TABLE IF NOT EXISTS relay.qloo_query_claims (
  namespace text NOT NULL, cache_key text NOT NULL, job_id uuid NOT NULL REFERENCES relay.agent_jobs(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL, lease_until timestamptz NOT NULL,
  PRIMARY KEY(namespace,cache_key)
);
CREATE TABLE IF NOT EXISTS relay.worker_heartbeats (
  worker_id text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO relay.schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
`;
