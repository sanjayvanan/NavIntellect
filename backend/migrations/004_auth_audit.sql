-- Users, rotating refresh tokens and audit trail.
CREATE TYPE user_role AS ENUM ('admin', 'operator', 'viewer');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  role           user_role NOT NULL DEFAULT 'viewer',
  disabled       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,      -- sha256 of the opaque token; raw token never stored
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

ALTER TABLE zones  ADD CONSTRAINT zones_created_by_fk  FOREIGN KEY (created_by)      REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE alerts ADD CONSTRAINT alerts_ack_by_fk     FOREIGN KEY (acknowledged_by) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL,             -- e.g. zone.create, alert.ack, user.update
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at ON audit_log (created_at DESC);
