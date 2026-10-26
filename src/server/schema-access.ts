/** Invite capabilities are stored only as hashes; private events never seed people or consent. */
export const ACCESS_SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay.schema_migrations WHERE version=5) THEN
    ALTER TABLE relay.sessions ADD COLUMN mode text NOT NULL DEFAULT 'sample' CHECK(mode IN ('sample','private'));
    ALTER TABLE relay.preference_versions ADD COLUMN member_id text NOT NULL DEFAULT 'you';
    ALTER TABLE relay.preference_versions DROP CONSTRAINT preference_versions_pkey;
    ALTER TABLE relay.preference_versions ADD PRIMARY KEY(session_id,member_id,version);
    ALTER TABLE relay.preference_versions ADD FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.saved_items ADD COLUMN member_id text NOT NULL DEFAULT 'you';
    ALTER TABLE relay.saved_items DROP CONSTRAINT saved_items_pkey;
    ALTER TABLE relay.saved_items ADD PRIMARY KEY(session_id,member_id,item_id);
    ALTER TABLE relay.saved_items ADD FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.dismissals ADD COLUMN member_id text NOT NULL DEFAULT 'you';
    ALTER TABLE relay.dismissals DROP CONSTRAINT dismissals_pkey;
    ALTER TABLE relay.dismissals ADD PRIMARY KEY(session_id,member_id,item_id);
    ALTER TABLE relay.dismissals ADD FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.discovery_runs ADD COLUMN member_id text NOT NULL DEFAULT 'you';
    ALTER TABLE relay.discovery_runs ADD FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.evidence ADD COLUMN member_id text;
    ALTER TABLE relay.evidence ADD FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.evidence DROP CONSTRAINT evidence_source_check;
    ALTER TABLE relay.evidence ADD CHECK(source IN ('authored-sample','live-qloo','participant-recorded'));
    CREATE TABLE relay.access_sessions (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
      member_id text NOT NULL, token_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL, revoked_at timestamptz,
      FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      CHECK(expires_at>created_at)
    );
    CREATE INDEX access_sessions_members ON relay.access_sessions(session_id,member_id);
    CREATE TABLE relay.community_invites (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
      token_hash text UNIQUE NOT NULL, label text NOT NULL, role text NOT NULL CHECK(role IN ('member','coordinator')),
      created_by text NOT NULL, creation_key text NOT NULL, command_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
      used_at timestamptz, used_by text, access_id uuid REFERENCES relay.access_sessions(id) DEFERRABLE INITIALLY DEFERRED,
      join_key_hash text, join_command_hash text,
      FOREIGN KEY(session_id,created_by) REFERENCES relay.members(session_id,id) DEFERRABLE INITIALLY DEFERRED,
      UNIQUE(session_id,creation_key), CHECK(expires_at>created_at), CHECK((used_at IS NULL)=(used_by IS NULL))
    );
    CREATE TABLE relay.access_bootstraps (
      source_token_hash text NOT NULL, key text NOT NULL, command_hash text NOT NULL,
      target_session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
      access_id uuid NOT NULL REFERENCES relay.access_sessions(id) ON DELETE CASCADE,
      PRIMARY KEY(source_token_hash,key)
    );
    INSERT INTO relay.schema_migrations(version) VALUES(5);
  END IF;
END $$;
`;
