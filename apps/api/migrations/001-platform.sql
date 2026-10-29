CREATE TABLE IF NOT EXISTS vos_tenants (
  id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vos_accounts (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vos_tenant_members (
  tenant_id uuid NOT NULL REFERENCES vos_tenants(id), account_id uuid NOT NULL REFERENCES vos_accounts(id),
  role text NOT NULL CHECK(role IN ('OWNER','ADMIN')), PRIMARY KEY(tenant_id,account_id)
);
CREATE TABLE IF NOT EXISTS vos_servers (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES vos_tenants(id), name text NOT NULL,
  agent_hash text NOT NULL UNIQUE, player_login boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '{}', last_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS vos_server_members (
  tenant_id uuid NOT NULL, server_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES vos_accounts(id),
  role text NOT NULL CHECK(role IN ('ADMIN')), PRIMARY KEY(server_id,account_id),
  FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS vos_sessions (
  token_hash text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('ADMIN','PLAYER')), actor_id uuid NOT NULL,
  tenant_id uuid, server_id uuid, display_name text NOT NULL, expires_at timestamptz NOT NULL,
  reauthenticated_at timestamptz,
  FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id),
  CHECK ((kind='ADMIN' AND server_id IS NULL AND tenant_id IS NULL) OR (kind='PLAYER' AND server_id IS NOT NULL AND tenant_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS vos_messages (
  tenant_id uuid NOT NULL, server_id uuid NOT NULL, message_id uuid NOT NULL,
  type text NOT NULL, source text NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL, player_id uuid, encrypted_payload text NOT NULL,
  PRIMARY KEY(tenant_id,server_id,message_id), FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS vos_messages_time ON vos_messages(tenant_id,server_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS vos_messages_player ON vos_messages(tenant_id,server_id,player_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS vos_messages_type ON vos_messages(tenant_id,server_id,type,occurred_at DESC);
CREATE TABLE IF NOT EXISTS vos_latest (
  tenant_id uuid NOT NULL, server_id uuid NOT NULL, kind text NOT NULL, entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL, encrypted_payload text NOT NULL,
  PRIMARY KEY(tenant_id,server_id,kind,entity_id), FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS vos_actions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, server_id uuid NOT NULL, actor_id uuid NOT NULL,
  operation text NOT NULL, kind text NOT NULL, risk text NOT NULL, state text NOT NULL,
  correlation_id uuid NOT NULL, encrypted_result text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS vos_actions_time ON vos_actions(tenant_id,server_id,created_at DESC);
CREATE TABLE IF NOT EXISTS vos_audit (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, server_id uuid NOT NULL, actor_id uuid NOT NULL,
  operation text NOT NULL, outcome text NOT NULL, correlation_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS vos_audit_time ON vos_audit(tenant_id,server_id,created_at DESC);
CREATE TABLE IF NOT EXISTS vos_alerts (
  tenant_id uuid NOT NULL, server_id uuid NOT NULL, rule text NOT NULL, active boolean NOT NULL,
  value double precision NOT NULL, acknowledged_by uuid, first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,server_id,rule), FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS vos_privacy_requests (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, server_id uuid NOT NULL, player_id uuid NOT NULL,
  kind text NOT NULL, state text NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,server_id) REFERENCES vos_servers(tenant_id,id)
);
