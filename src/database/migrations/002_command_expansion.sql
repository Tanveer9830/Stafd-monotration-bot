-- ============================================================================
-- TANVEER STAFF MONITOR — MIGRATION 002: COMMAND EXPANSION SCHEMA
-- Creator: MADE BY TANVEER | Discord: tanveer5637
-- Purpose: Adds tables for expanded slash-command roots (/admin, /server,
--          /activity, /monitor, /scan, /integration, /appeal, /leave,
--          /analytics, /report, /security, /logs, /backup, /system,
--          /notification, /help) and strict permission enforcement.
-- ============================================================================

-- 25. Integration Configurations — third-party ticket integrations per guild
CREATE TABLE IF NOT EXISTS integration_configs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL CHECK (integration_type IN ('ticket-tool', 'tickets-v2', 'custom', 'webhook', 'discord')),
  external_id TEXT,
  external_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, integration_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_configs_guild ON integration_configs(guild_id, integration_type);

-- 26. Backup Records — database backup and recovery history
CREATE TABLE IF NOT EXISTS backup_records (
  backup_id TEXT PRIMARY KEY,
  guild_id TEXT,
  filename TEXT NOT NULL,
  full_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT 'manual',
  integrity_ok INTEGER NOT NULL DEFAULT 0 CHECK (integrity_ok IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_records_guild ON backup_records(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records(created_at DESC);

-- 27. Notification Configurations — per-guild notification routing
CREATE TABLE IF NOT EXISTS notification_configs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('warning_dm', 'warning_level_3', 'inactivity_review', 'review_cancelled', 'leave_approved', 'leave_rejected', 'system_alert', 'audit_alert')),
  delivery_channel TEXT NOT NULL CHECK (delivery_channel IN ('DM', 'CHANNEL_FALLBACK', 'GLOBAL_INBOX_ONLY', 'DISABLED')),
  channel_id TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_configs_guild ON notification_configs(guild_id);

-- 28. Report Schedules — scheduled report generation
CREATE TABLE IF NOT EXISTS report_schedules (
  schedule_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM')),
  format TEXT NOT NULL CHECK (format IN ('PNG', 'CSV', 'PDF')),
  channel_id TEXT,
  recipient_user_id TEXT,
  cron_expression TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_guild ON report_schedules(guild_id, is_active);

-- 29. Staff Role Discovery — configured staff roles for automatic discovery
--    (extends staff_roles with discovery-specific metadata; uses role_id as stable key)
CREATE TABLE IF NOT EXISTS staff_discovery_configs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'STAFF' CHECK (category IN (
    'TRIAL_STAFF','JUNIOR_STAFF','STAFF','SENIOR_STAFF','SUPPORT_TEAM',
    'HELPER','MODERATOR','SENIOR_MODERATOR','ADMINISTRATOR','MANAGEMENT','CO_OWNER','CUSTOM'
  )),
  is_discovery_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_discovery_enabled IN (0, 1)),
  auto_register INTEGER NOT NULL DEFAULT 1 CHECK (auto_register IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_discovery_guild ON staff_discovery_configs(guild_id, is_discovery_enabled);

-- 30. Command Permission Overrides — per-command permission overrides
CREATE TABLE IF NOT EXISTS command_permission_overrides (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  command_name TEXT NOT NULL,
  subcommand_name TEXT,
  allowed_user_ids_json TEXT NOT NULL DEFAULT '[]',
  allowed_role_ids_json TEXT NOT NULL DEFAULT '[]',
  owner_only INTEGER NOT NULL DEFAULT 1 CHECK (owner_only IN (0, 1)),
  global_owner_only INTEGER NOT NULL DEFAULT 0 CHECK (global_owner_only IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, command_name, subcommand_name)
);

CREATE INDEX IF NOT EXISTS idx_command_perm_overrides_guild ON command_permission_overrides(guild_id, command_name);
