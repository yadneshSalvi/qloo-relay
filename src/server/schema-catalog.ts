export const CATALOG_SCHEMA = `
ALTER TABLE relay.catalog_works ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES relay.sessions(id) ON DELETE CASCADE;
ALTER TABLE relay.catalog_works ADD COLUMN IF NOT EXISTS created_by_member_id text;
ALTER TABLE relay.catalog_works ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'shared' CHECK(visibility IN ('private','shared'));
CREATE INDEX IF NOT EXISTS catalog_scoped_visibility ON relay.catalog_works(session_id,created_by_member_id,visibility);
CREATE TABLE IF NOT EXISTS relay.catalog_searches (
  id uuid PRIMARY KEY, session_id uuid NOT NULL, member_id text NOT NULL,
  request_key text NOT NULL, command_hash text NOT NULL, query text NOT NULL, category text NOT NULL CHECK(category IN ('book','record','game')),
  status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  candidates jsonb NOT NULL DEFAULT '[]', error_code text, error_message text, cache text CHECK(cache IN ('hit','miss')),
  lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE,
  UNIQUE(session_id,member_id,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_one_active_search ON relay.catalog_searches(session_id,member_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS relay.catalog_selections (
  session_id uuid NOT NULL, member_id text NOT NULL, request_key text NOT NULL, command_hash text NOT NULL,
  search_id uuid NOT NULL REFERENCES relay.catalog_searches(id) ON DELETE CASCADE,
  work_id text NOT NULL REFERENCES relay.catalog_works(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,member_id,request_key),
  FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relay.catalog_query_cache (
  namespace text NOT NULL, query_hash text NOT NULL, candidates jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  PRIMARY KEY(namespace,query_hash)
);
ALTER TABLE relay.provider_calls ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE relay.provider_calls ADD COLUMN IF NOT EXISTS catalog_search_id uuid REFERENCES relay.catalog_searches(id) ON DELETE CASCADE;
INSERT INTO relay.schema_migrations(version) VALUES(7) ON CONFLICT DO NOTHING;
`;
