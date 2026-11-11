-- ============================================================================
-- TANVEER STAFF MONITOR — MIGRATION 003: PLATFORM UPGRADE
-- Creator: MADE BY TANVEER | Discord: tanveer5637
-- Adds: ticket conversation capture, five-minute first-responder auto-claim,
--       website sessions/roles, scan history and system settings.
-- All tables remain strictly guild-scoped where guild data is stored.
-- ============================================================================

-- 31. Ticket ledger extensions -------------------------------------------------
ALTER TABLE ticket_records ADD COLUMN ticket_number TEXT;
ALTER TABLE ticket_records ADD COLUMN claim_type TEXT;
ALTER TABLE ticket_records ADD COLUMN claim_at TEXT;
ALTER TABLE ticket_records ADD COLUMN last_activity_at TEXT;
ALTER TABLE ticket_records ADD COLUMN last_responder_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ticket_records_number
  ON ticket_records(guild_id, ticket_number);
CREATE INDEX IF NOT EXISTS idx_ticket_records_external
  ON ticket_records(guild_id, external_ticket_ref);
CREATE INDEX IF NOT EXISTS idx_ticket_records_updated
  ON ticket_records(guild_id, updated_at DESC);

UPDATE ticket_records
   SET ticket_number = COALESCE(
     NULLIF(external_ticket_ref, ''),
     NULLIF(replace(replace(channel_name, 'ticket-', ''), '#', ''), ''),
     substr(channel_id, -6)
   )
 WHERE ticket_number IS NULL;

UPDATE ticket_records
   SET last_activity_at = COALESCE(last_activity_at, updated_at, opened_at)
 WHERE last_activity_at IS NULL;

-- 32. Captured ticket conversation -------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES ticket_records(ticket_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  author_user_id TEXT,
  author_name TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (author_type IN ('STAFF','CREATOR','OTHER','SYSTEM')),
  content TEXT,
  content_available INTEGER NOT NULL DEFAULT 0 CHECK (content_available IN (0, 1)),
  attachment_count INTEGER NOT NULL DEFAULT 0,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  embed_count INTEGER NOT NULL DEFAULT 0,
  is_edited INTEGER NOT NULL DEFAULT 0 CHECK (is_edited IN (0, 1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  sent_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE (guild_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket
  ON ticket_messages(guild_id, ticket_id, sent_at ASC);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_message
  ON ticket_messages(guild_id, message_id);

-- 33. Five-minute first-responder automatic claim timers ----------------------
CREATE TABLE IF NOT EXISTS ticket_claim_timers (
  timer_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES ticket_records(ticket_id) ON DELETE CASCADE,
  first_responder_user_id TEXT NOT NULL,
  first_response_at TEXT NOT NULL,
  execute_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','EXECUTED','CANCELLED','FAILED')),
  cancel_reason TEXT,
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  executed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_timer_pending_ticket
  ON ticket_claim_timers(ticket_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_claim_timer_due
  ON ticket_claim_timers(status, execute_at);

-- 34. Website sessions (only SHA-256 digests of session tokens are stored) ----
CREATE TABLE IF NOT EXISTS website_sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_website_sessions_user
  ON website_sessions(user_id, revoked_at, expires_at);

-- 35. Short-lived OAuth2 state values ----------------------------------------
CREATE TABLE IF NOT EXISTS website_oauth_states (
  state TEXT PRIMARY KEY,
  return_to TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

-- 36. Website role assignments (Access & Roles) ------------------------------
-- guild_id NULL = platform/global assignment. Every local assignment is strictly
-- scoped to one guild and is validated again on every request.
CREATE TABLE IF NOT EXISTS web_role_assignments (
  assignment_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  guild_id TEXT REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'GLOBAL_ADMIN','SERVER_CO_OWNER','SERVER_ADMIN','SERVER_VIEWER','STAFF_VIEWER'
  )),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED','EXPIRED')),
  assigned_by TEXT NOT NULL,
  assigned_by_name TEXT,
  assigned_at TEXT NOT NULL,
  expires_at TEXT,
  last_access_at TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_roles_user
  ON web_role_assignments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_web_roles_guild
  ON web_role_assignments(guild_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_roles_unique_active
  ON web_role_assignments(user_id, IFNULL(guild_id, 'GLOBAL'), role)
  WHERE status IN ('ACTIVE','SUSPENDED');

-- 37. Staff role discovery scan history --------------------------------------
CREATE TABLE IF NOT EXISTS scan_history (
  scan_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL CHECK (scan_type IN ('STAFF','TICKETS','FULL','ROLES','SYSTEM')),
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('MANUAL','SCHEDULED','ROLE_DISCOVERY','STARTUP')),
  actor_user_id TEXT,
  roles_selected_json TEXT NOT NULL DEFAULT '[]',
  members_scanned INTEGER NOT NULL DEFAULT 0,
  staff_discovered INTEGER NOT NULL DEFAULT 0,
  newly_registered INTEGER NOT NULL DEFAULT 0,
  existing_profiles INTEGER NOT NULL DEFAULT 0,
  multi_role_members INTEGER NOT NULL DEFAULT 0,
  unmatched_roles_json TEXT NOT NULL DEFAULT '[]',
  errors_json TEXT NOT NULL DEFAULT '[]',
  coverage_level TEXT NOT NULL DEFAULT 'UNAVAILABLE'
    CHECK (coverage_level IN ('FULL','PARTIAL','UNAVAILABLE')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_history_guild
  ON scan_history(guild_id, started_at DESC);

-- 38. Platform key/value settings (never stores tokens or credentials) --------
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO system_settings (key, value, updated_by, updated_at) VALUES
  ('ticket_auto_claim_minutes', '5', 'SYSTEM', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ticket_message_retention_days', '180', 'SYSTEM', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('web_session_hours', '168', 'SYSTEM', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('monitoring_paused_globally', 'false', 'SYSTEM', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 39. Daily statistics extensions -------------------------------------------
ALTER TABLE daily_statistics ADD COLUMN tickets_claimed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_statistics ADD COLUMN auto_claimed_tickets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_statistics ADD COLUMN manual_claimed_tickets INTEGER NOT NULL DEFAULT 0;
