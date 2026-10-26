import { ACCESS_SCHEMA } from "./schema-access";
import { RUNTIME_SCHEMA } from "./schema-runtime";
import { CATALOG_SCHEMA } from "./schema-catalog";

/** One reversible, application-owned schema. No production data is touched outside relay. */
export const SCHEMA_UP = `
CREATE SCHEMA IF NOT EXISTS relay;
CREATE TABLE IF NOT EXISTS relay.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS relay.catalog_works (
  id text PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);
CREATE TABLE IF NOT EXISTS relay.sessions (
  id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, display_name text NOT NULL,
  terms jsonb NOT NULL, next_sequence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE TABLE IF NOT EXISTS relay.members (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
  id text NOT NULL, name text NOT NULL, initials text NOT NULL, bio text NOT NULL, color text NOT NULL,
  role text NOT NULL CHECK (role IN ('member','coordinator')), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (session_id,id)
);
CREATE TABLE IF NOT EXISTS relay.preference_versions (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0), seed_work_ids jsonb NOT NULL,
  novelty integer NOT NULL CHECK (novelty BETWEEN 0 AND 100), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id,version)
);
CREATE TABLE IF NOT EXISTS relay.items (
  session_id uuid NOT NULL, id text NOT NULL, work_id text NOT NULL REFERENCES relay.catalog_works(id),
  owner_id text NOT NULL, edition text NOT NULL, condition text NOT NULL CHECK (condition IN ('like-new','good','fair')),
  notes text NOT NULL, attested boolean NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('available','reserved','at_hub','exchanged','withdrawn','disputed')),
  held_by_proposal_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id,id), FOREIGN KEY (session_id,owner_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relay.evidence (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE, id uuid NOT NULL,
  kind text NOT NULL, source text NOT NULL CHECK (source IN ('authored-sample','live-qloo')),
  title text NOT NULL, summary text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS relay.approvals (
  session_id uuid NOT NULL, id uuid NOT NULL, member_id text NOT NULL,
  give_item_id text NOT NULL, receive_item_id text NOT NULL,
  give_version integer NOT NULL CHECK (give_version > 0), receive_version integer NOT NULL CHECK (receive_version > 0),
  terms_version text NOT NULL, terms_hash text NOT NULL, preference_rank integer NOT NULL CHECK (preference_rank BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('active','revoked','consumed','expired')),
  authored boolean NOT NULL, evidence_id uuid, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,id),
  FOREIGN KEY (session_id,member_id) REFERENCES relay.members(session_id,id) ON DELETE CASCADE,
  FOREIGN KEY (session_id,give_item_id) REFERENCES relay.items(session_id,id) ON DELETE CASCADE,
  FOREIGN KEY (session_id,receive_item_id) REFERENCES relay.items(session_id,id) ON DELETE CASCADE,
  FOREIGN KEY (session_id,evidence_id) REFERENCES relay.evidence(session_id,id),
  CHECK (give_item_id <> receive_item_id), CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_exact_approval ON relay.approvals
  (session_id,give_item_id,receive_item_id,give_version,receive_version,terms_hash) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS relay.proposals (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE, id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0), fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','reserved','handoff_ready','completed','withdrawn','expired','invalidated','disputed')),
  terms jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz, completed_at timestamptz, withdrawn_by text, withdrawal_reason text, repair_of uuid,
  PRIMARY KEY(session_id,id), UNIQUE(session_id,id,version),
  FOREIGN KEY(session_id,repair_of) REFERENCES relay.proposals(session_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_exact_proposal ON relay.proposals(session_id,fingerprint)
  WHERE status IN ('proposed','reserved','handoff_ready');
CREATE TABLE IF NOT EXISTS relay.proposal_legs (
  session_id uuid NOT NULL, proposal_id uuid NOT NULL, member_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), give_item_id text NOT NULL, receive_item_id text NOT NULL,
  approval_id uuid NOT NULL, give_version integer NOT NULL, receive_version integer NOT NULL,
  PRIMARY KEY(session_id,proposal_id,member_id), UNIQUE(session_id,proposal_id,ordinal),
  UNIQUE(session_id,proposal_id,give_item_id), UNIQUE(session_id,proposal_id,receive_item_id),
  FOREIGN KEY(session_id,proposal_id) REFERENCES relay.proposals(session_id,id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,member_id) REFERENCES relay.members(session_id,id),
  FOREIGN KEY(session_id,give_item_id) REFERENCES relay.items(session_id,id),
  FOREIGN KEY(session_id,receive_item_id) REFERENCES relay.items(session_id,id),
  FOREIGN KEY(session_id,approval_id) REFERENCES relay.approvals(session_id,id)
);
CREATE TABLE IF NOT EXISTS relay.confirmations (
  session_id uuid NOT NULL, proposal_id uuid NOT NULL, version integer NOT NULL,
  member_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,proposal_id,version,member_id),
  FOREIGN KEY(session_id,proposal_id,version) REFERENCES relay.proposals(session_id,id,version) ON DELETE CASCADE,
  FOREIGN KEY(session_id,proposal_id,member_id) REFERENCES relay.proposal_legs(session_id,proposal_id,member_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relay.item_reservations (
  session_id uuid NOT NULL, proposal_id uuid NOT NULL, item_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active','released','completed')), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,proposal_id,item_id),
  FOREIGN KEY(session_id,proposal_id,item_id) REFERENCES relay.proposal_legs(session_id,proposal_id,give_item_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_item_reservation ON relay.item_reservations(session_id,item_id) WHERE state = 'active';
CREATE TABLE IF NOT EXISTS relay.member_reservations (
  session_id uuid NOT NULL, proposal_id uuid NOT NULL, member_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active','released','completed')), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,proposal_id,member_id),
  FOREIGN KEY(session_id,proposal_id,member_id) REFERENCES relay.proposal_legs(session_id,proposal_id,member_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_member_reservation ON relay.member_reservations(session_id,member_id) WHERE state = 'active';
CREATE TABLE IF NOT EXISTS relay.handoff_receipts (
  session_id uuid NOT NULL, proposal_id uuid NOT NULL, item_id text NOT NULL, inspector_id text NOT NULL,
  condition_accepted boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
  PRIMARY KEY(session_id,proposal_id,item_id),
  FOREIGN KEY(session_id,proposal_id,item_id) REFERENCES relay.proposal_legs(session_id,proposal_id,give_item_id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,inspector_id) REFERENCES relay.members(session_id,id),
  CHECK (released_at IS NULL OR (condition_accepted AND released_at >= received_at))
);
CREATE TABLE IF NOT EXISTS relay.discovery_runs (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE, id uuid NOT NULL,
  data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS relay.saved_items (
  session_id uuid NOT NULL, item_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,item_id), FOREIGN KEY(session_id,item_id) REFERENCES relay.items(session_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relay.dismissals (
  session_id uuid NOT NULL, item_id text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,item_id), FOREIGN KEY(session_id,item_id) REFERENCES relay.items(session_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relay.domain_events (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE, id uuid NOT NULL,
  sequence bigint NOT NULL, type text NOT NULL, aggregate_id text NOT NULL, summary text NOT NULL,
  payload jsonb NOT NULL, payload_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,sequence), UNIQUE(session_id,id)
);
CREATE TABLE IF NOT EXISTS relay.outbox (
  session_id uuid NOT NULL, event_id uuid NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,event_id),
  FOREIGN KEY(session_id,event_id) REFERENCES relay.domain_events(session_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relay.idempotency_keys (
  session_id uuid NOT NULL REFERENCES relay.sessions(id) ON DELETE CASCADE, key text NOT NULL,
  command_hash text NOT NULL, notice text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,key)
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON relay.sessions(expires_at);
CREATE INDEX IF NOT EXISTS approvals_lookup ON relay.approvals(session_id,status);
CREATE INDEX IF NOT EXISTS proposals_lookup ON relay.proposals(session_id,status);
CREATE OR REPLACE FUNCTION relay.check_approval_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE giver text; receiver text;
BEGIN
  SELECT owner_id INTO giver FROM relay.items WHERE session_id=NEW.session_id AND id=NEW.give_item_id;
  SELECT owner_id INTO receiver FROM relay.items WHERE session_id=NEW.session_id AND id=NEW.receive_item_id;
  IF giver IS DISTINCT FROM NEW.member_id OR giver IS NOT DISTINCT FROM receiver THEN
    RAISE EXCEPTION 'exact approval must offer the member own item to a different member' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS exact_approval_ownership ON relay.approvals;
CREATE TRIGGER exact_approval_ownership BEFORE INSERT OR UPDATE ON relay.approvals FOR EACH ROW EXECUTE FUNCTION relay.check_approval_ownership();
INSERT INTO relay.schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay.schema_migrations WHERE version=2) THEN
    -- A session owns all these records. Defer cross-table references until the
    -- end of a transaction so an entire isolated session can cascade cleanly.
    ALTER TABLE relay.proposal_legs ALTER CONSTRAINT proposal_legs_session_id_member_id_fkey DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.proposal_legs ALTER CONSTRAINT proposal_legs_session_id_give_item_id_fkey DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.proposal_legs ALTER CONSTRAINT proposal_legs_session_id_receive_item_id_fkey DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.proposal_legs ALTER CONSTRAINT proposal_legs_session_id_approval_id_fkey DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.handoff_receipts ALTER CONSTRAINT handoff_receipts_session_id_inspector_id_fkey DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.approvals ALTER CONSTRAINT approvals_session_id_evidence_id_fkey DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE relay.proposals ALTER CONSTRAINT proposals_session_id_repair_of_fkey DEFERRABLE INITIALLY DEFERRED;
    INSERT INTO relay.schema_migrations(version) VALUES(2);
  END IF;
END $$;
ALTER TABLE relay.proposals ADD COLUMN IF NOT EXISTS dispute_kind text CHECK(dispute_kind IN ('condition','custody'));
INSERT INTO relay.schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
ALTER TABLE relay.idempotency_keys ADD COLUMN IF NOT EXISTS replacement_session_id uuid;
INSERT INTO relay.schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
` + ACCESS_SCHEMA + RUNTIME_SCHEMA + CATALOG_SCHEMA;

export const SCHEMA_DOWN = "DROP SCHEMA IF EXISTS relay CASCADE";
