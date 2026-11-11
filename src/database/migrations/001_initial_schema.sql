-- ============================================================================
-- TANVEER STAFF MONITOR — MIGRATION 001: COMPLETE PRODUCTION SCHEMA
-- Creator: MADE BY TANVEER | Discord: tanveer5637
-- ============================================================================

-- 1. Global Singleton Configuration
CREATE TABLE IF NOT EXISTS global_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  global_approval_policy TEXT NOT NULL DEFAULT 'ANY_AUTHORIZED_REVIEWER'
    CHECK (global_approval_policy IN ('GLOBAL_OWNER_REQUIRED','ANY_AUTHORIZED_REVIEWER','TWO_PERSON_APPROVAL','GLOBAL_AND_SERVER_OWNER')),
  allow_guild_policy_override INTEGER NOT NULL DEFAULT 1 CHECK (allow_guild_policy_override IN (0, 1)),
  min_at_risk_hours INTEGER NOT NULL DEFAULT 6,
  max_at_risk_hours INTEGER NOT NULL DEFAULT 168,
  min_inactive_hours INTEGER NOT NULL DEFAULT 12,
  max_inactive_hours INTEGER NOT NULL DEFAULT 336,
  min_escalation_hours INTEGER NOT NULL DEFAULT 24,
  max_escalation_hours INTEGER NOT NULL DEFAULT 720,
  default_scan_interval_minutes INTEGER NOT NULL DEFAULT 360,
  globally_disabled_features_json TEXT NOT NULL DEFAULT '[]',
  require_dm_fallback_alert INTEGER NOT NULL DEFAULT 1 CHECK (require_dm_fallback_alert IN (0, 1)),
  rate_limit_actions_per_minute INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO global_config (
  id,
  global_approval_policy,
  allow_guild_policy_override,
  min_at_risk_hours,
  max_at_risk_hours,
  min_inactive_hours,
  max_inactive_hours,
  min_escalation_hours,
  max_escalation_hours,
  default_scan_interval_minutes,
  globally_disabled_features_json,
  require_dm_fallback_alert,
  rate_limit_actions_per_minute,
  updated_at
) VALUES (
  1,
  'ANY_AUTHORIZED_REVIEWER',
  1,
  6,
  168,
  12,
  336,
  24,
  720,
  360,
  '[]',
  1,
  30,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

-- 2. Guild Configuration
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  guild_name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  alert_channel_id TEXT,
  log_channel_id TEXT,
  fallback_review_channel_id TEXT,
  support_work_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  at_risk_hours INTEGER NOT NULL DEFAULT 24 CHECK (at_risk_hours >= 1),
  inactive_hours INTEGER NOT NULL DEFAULT 48 CHECK (inactive_hours >= at_risk_hours),
  escalation_hours INTEGER NOT NULL DEFAULT 72 CHECK (escalation_hours >= inactive_hours),
  observation_baseline_hours INTEGER NOT NULL DEFAULT 24 CHECK (observation_baseline_hours >= 0),
  approval_policy_override TEXT
    CHECK (approval_policy_override IS NULL OR approval_policy_override IN ('GLOBAL_OWNER_REQUIRED','ANY_AUTHORIZED_REVIEWER','TWO_PERSON_APPROVAL','GLOBAL_AND_SERVER_OWNER')),
  warning_max_level INTEGER NOT NULL DEFAULT 3 CHECK (warning_max_level = 3),
  warning_expiry_days INTEGER NOT NULL DEFAULT 90 CHECK (warning_expiry_days >= 0),
  scan_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (scan_interval_minutes >= 15),
  installed_at TEXT NOT NULL,
  baseline_completed_at TEXT,
  updated_at TEXT NOT NULL
);

-- 3. Guild Feature Switches
CREATE TABLE IF NOT EXISTS guild_features (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, feature_key)
);

-- 4. Bot Administrators (Appointed strictly by Global Owner 1131248987173814336)
CREATE TABLE IF NOT EXISTS bot_admins (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  added_by TEXT NOT NULL CHECK (added_by = '1131248987173814336'),
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 5. Bot Admin Scopes
CREATE TABLE IF NOT EXISTS bot_admin_scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES bot_admins(user_id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('VIEW_GLOBAL_STATS','VIEW_GUILDS','INSPECT_DIAGNOSTICS','VIEW_AUDIT_LOGS','REVIEW_CASES')),
  guild_id TEXT,
  granted_by TEXT NOT NULL CHECK (granted_by = '1131248987173814336'),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, scope, guild_id)
);

-- 6. Guild Permission Assignments (Explicit User IDs and Role IDs — never by role name)
CREATE TABLE IF NOT EXISTS guild_permission_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('USER', 'ROLE')),
  target_id TEXT NOT NULL,
  permission_level TEXT NOT NULL CHECK (permission_level IN ('CO_OWNER','MANAGEMENT_REVIEWER','LEAVE_MANAGER','REPORT_VIEWER')),
  can_approve_warnings INTEGER NOT NULL DEFAULT 0 CHECK (can_approve_warnings IN (0, 1)),
  can_manage_leave INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_leave IN (0, 1)),
  can_view_reports INTEGER NOT NULL DEFAULT 1 CHECK (can_view_reports IN (0, 1)),
  can_configure_bot INTEGER NOT NULL DEFAULT 0 CHECK (can_configure_bot IN (0, 1)),
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (guild_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_perm_guild ON guild_permission_assignments(guild_id, permission_level);

-- 7. Configured Staff Roles
CREATE TABLE IF NOT EXISTS staff_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'TRIAL_STAFF','JUNIOR_STAFF','STAFF','SENIOR_STAFF','SUPPORT_TEAM',
    'HELPER','MODERATOR','SENIOR_MODERATOR','ADMINISTRATOR','MANAGEMENT','CO_OWNER','CUSTOM'
  )),
  custom_at_risk_hours INTEGER,
  custom_inactive_hours INTEGER,
  custom_escalation_hours INTEGER,
  is_monitored INTEGER NOT NULL DEFAULT 1 CHECK (is_monitored IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (guild_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_roles_guild ON staff_roles(guild_id, is_monitored);

-- 8. Persistent Staff Profiles (Historical records preserved on role loss or guild leave)
CREATE TABLE IF NOT EXISTS staff_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active_role_ids_json TEXT NOT NULL DEFAULT '[]',
  primary_category TEXT NOT NULL DEFAULT 'STAFF',
  first_registered_at TEXT NOT NULL,
  joined_staff_at TEXT NOT NULL,
  left_guild_at TEXT,
  role_removed_at TEXT,
  is_currently_staff INTEGER NOT NULL DEFAULT 1 CHECK (is_currently_staff IN (0, 1)),
  monitoring_status TEXT NOT NULL DEFAULT 'NEW_STAFF' CHECK (monitoring_status IN (
    'ACTIVE','AT_RISK','INACTIVE','ON_LEAVE','UNKNOWN','NEW_STAFF','INSUFFICIENT_WORKLOAD','MONITORING_ERROR'
  )),
  monitoring_coverage TEXT NOT NULL DEFAULT 'UNAVAILABLE' CHECK (monitoring_coverage IN ('FULL','PARTIAL','UNAVAILABLE')),
  presence_status TEXT,
  last_qualifying_work_at TEXT,
  last_ticket_activity_at TEXT,
  last_staff_work_at TEXT,
  assigned_tickets_count INTEGER NOT NULL DEFAULT 0,
  tickets_handled_count INTEGER NOT NULL DEFAULT 0,
  tickets_resolved_count INTEGER NOT NULL DEFAULT 0,
  current_workload INTEGER NOT NULL DEFAULT 0,
  avg_first_response_sec REAL,
  avg_response_sec REAL,
  avg_resolution_sec REAL,
  active_warnings_count INTEGER NOT NULL DEFAULT 0,
  total_warnings_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_guild_status ON staff_profiles(guild_id, is_currently_staff, monitoring_status);

-- 9. Staff Role History
CREATE TABLE IF NOT EXISTS staff_role_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('ADDED','REMOVED','SYNCED','LEFT_GUILD','REJOINED_GUILD')),
  role_id TEXT,
  role_name TEXT,
  previous_roles_json TEXT NOT NULL DEFAULT '[]',
  new_roles_json TEXT NOT NULL DEFAULT '[]',
  detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_role_hist_user ON staff_role_history(guild_id, user_id, detected_at DESC);

-- 10. Activity Events (Metadata & IDs only — never raw message bodies)
CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'TICKET_RESPONSE','TICKET_FIRST_RESPONSE','TICKET_RESOLUTION',
    'SUPPORT_WORK','MODERATION_ACTION','MANAGEMENT_WORK','CONFIGURED_WORK','NON_QUALIFYING_IGNORED'
  )),
  is_qualifying INTEGER NOT NULL CHECK (is_qualifying IN (0, 1)),
  classification_reason TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  ticket_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_guild_user_time ON activity_events(guild_id, user_id, is_qualifying, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_guild_time ON activity_events(guild_id, occurred_at DESC);

-- 11. Ticket Channels & Categories Configuration
CREATE TABLE IF NOT EXISTS ticket_channels_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('CHANNEL','CATEGORY','THREAD_PARENT')),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  adapter_type TEXT NOT NULL DEFAULT 'generic',
  custom_pattern TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (guild_id, channel_id)
);

-- 12. Ticket Records
CREATE TABLE IF NOT EXISTS ticket_records (
  ticket_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  parent_category_id TEXT,
  is_thread INTEGER NOT NULL DEFAULT 0 CHECK (is_thread IN (0, 1)),
  external_ticket_ref TEXT,
  adapter_source TEXT NOT NULL DEFAULT 'generic',
  opener_user_id TEXT,
  claimed_by_user_id TEXT,
  assigned_to_user_id TEXT,
  resolved_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLAIMED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','REOPENED')),
  opened_at TEXT NOT NULL,
  first_staff_response_at TEXT,
  first_response_staff_id TEXT,
  first_response_sec REAL,
  resolved_at TEXT,
  closed_at TEXT,
  resolution_sec REAL,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  staff_message_count INTEGER NOT NULL DEFAULT 0,
  meaningful_response_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_records_guild_status ON ticket_records(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_records_channel ON ticket_records(guild_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_ticket_records_assigned ON ticket_records(guild_id, assigned_to_user_id);

-- 13. Ticket Events (Deduplicated via source_event_id)
CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES ticket_records(ticket_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  actor_user_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CREATED','CLAIMED','ASSIGNED','REASSIGNED','OWNERSHIP_CHANGED',
    'FIRST_RESPONSE','STAFF_RESPONSE','RESOLVED','CLOSED','REOPENED'
  )),
  source_event_id TEXT UNIQUE,
  details_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_guild_actor ON ticket_events(guild_id, actor_user_id, occurred_at DESC);

-- 14. Ticket Assignments
CREATE TABLE IF NOT EXISTS ticket_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES ticket_records(ticket_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('CLAIMED','ASSIGNED','REASSIGNED','COLLABORATOR')),
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  unassigned_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  completed_meaningful_work INTEGER NOT NULL DEFAULT 0 CHECK (completed_meaningful_work IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_ticket_assign_staff ON ticket_assignments(guild_id, staff_user_id, is_current);

-- 15. Inactivity Incidents
CREATE TABLE IF NOT EXISTS inactivity_incidents (
  incident_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'OPEN','AT_RISK','PENDING_REVIEW','ESCALATED','APPROVED_WARNING',
    'REJECTED','EXCUSED','AUTO_CANCELLED_RESUMED','RESOLVED'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('AT_RISK_24H','INACTIVE_48H','ESCALATED_72H')),
  inactivity_hours REAL NOT NULL,
  last_qualifying_activity_at TEXT,
  last_ticket_activity_at TEXT,
  available_workload_count INTEGER NOT NULL DEFAULT 0,
  monitoring_coverage TEXT NOT NULL CHECK (monitoring_coverage IN ('FULL','PARTIAL','UNAVAILABLE')),
  reason_summary TEXT NOT NULL,
  suggested_warning_level INTEGER NOT NULL DEFAULT 1 CHECK (suggested_warning_level BETWEEN 1 AND 3),
  detected_at TEXT NOT NULL,
  escalated_at TEXT,
  resolved_at TEXT,
  cancellation_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_guild_staff ON inactivity_incidents(guild_id, staff_user_id, status);

-- 16. Persistent Warning Reviews
CREATE TABLE IF NOT EXISTS warning_reviews (
  review_id TEXT PRIMARY KEY,
  incident_id TEXT REFERENCES inactivity_incidents(incident_id) ON DELETE SET NULL,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING','DEFERRED','AWAITING_SECOND_APPROVAL','AWAITING_CONFIRMATION',
    'APPROVED','REJECTED','EXCUSED','CANCELLED'
  )),
  required_policy TEXT NOT NULL CHECK (required_policy IN (
    'GLOBAL_OWNER_REQUIRED','ANY_AUTHORIZED_REVIEWER','TWO_PERSON_APPROVAL','GLOBAL_AND_SERVER_OWNER'
  )),
  suggested_level INTEGER NOT NULL DEFAULT 1 CHECK (suggested_level BETWEEN 1 AND 3),
  proposed_reason TEXT,
  proposed_note TEXT,
  snapshot_json TEXT NOT NULL,
  first_approver_id TEXT,
  first_approver_name TEXT,
  first_approved_at TEXT,
  pending_confirmer_id TEXT,
  final_actor_id TEXT,
  final_actor_name TEXT,
  final_note TEXT,
  deferred_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_guild_status ON warning_reviews(guild_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_staff ON warning_reviews(guild_id, staff_user_id, status);

-- 17. Official Warnings
CREATE TABLE IF NOT EXISTS warnings (
  warning_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  review_id TEXT REFERENCES warning_reviews(review_id) ON DELETE SET NULL,
  incident_id TEXT REFERENCES inactivity_incidents(incident_id) ON DELETE SET NULL,
  warning_level INTEGER NOT NULL CHECK (warning_level BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REMOVED','APPEALED_OVERTURNED')),
  reason TEXT NOT NULL,
  management_note TEXT,
  issued_by_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  approver_display_name TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  dm_delivered INTEGER NOT NULL DEFAULT 0 CHECK (dm_delivered IN (0, 1)),
  dm_error TEXT,
  fallback_notified INTEGER NOT NULL DEFAULT 0 CHECK (fallback_notified IN (0, 1)),
  expires_at TEXT,
  removed_by_id TEXT,
  removed_reason TEXT,
  removed_at TEXT,
  requires_management_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_management_review IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_warnings_guild_staff ON warnings(guild_id, staff_user_id, status);

-- 18. Warning Appeals
CREATE TABLE IF NOT EXISTS warning_appeals (
  appeal_id TEXT PRIMARY KEY,
  warning_id TEXT NOT NULL REFERENCES warnings(warning_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  appeal_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  submitted_at TEXT NOT NULL,
  decided_by_id TEXT,
  decided_by_name TEXT,
  decision_note TEXT,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_appeals_guild_status ON warning_appeals(guild_id, status);

-- 19. Approved Leave Management
CREATE TABLE IF NOT EXISTS approved_leave (
  leave_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','ACTIVE','COMPLETED','REJECTED','CANCELLED')),
  reason TEXT NOT NULL,
  requested_by_id TEXT NOT NULL,
  approved_by_id TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_guild_staff ON approved_leave(guild_id, staff_user_id, status);

-- 20. Notification History & Persistent Global Inbox (Deduplicated via dedup_key)
CREATE TABLE IF NOT EXISTS notification_history (
  notification_id TEXT PRIMARY KEY,
  guild_id TEXT,
  recipient_user_id TEXT NOT NULL,
  is_global_inbox INTEGER NOT NULL DEFAULT 0 CHECK (is_global_inbox IN (0, 1)),
  notification_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  reference_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  delivery_channel TEXT NOT NULL CHECK (delivery_channel IN ('DM','CHANNEL_FALLBACK','GLOBAL_INBOX_ONLY')),
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
  error_message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notification_history(recipient_user_id, is_global_inbox, created_at DESC);

-- 21. Monitoring Health & Coverage History
CREATE TABLE IF NOT EXISTS monitoring_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  component TEXT NOT NULL CHECK (component IN (
    'SCHEDULER','ROSTER_SYNC','TICKET_ENGINE','TICKET_ADAPTER','PERMISSION_COVERAGE','DM_DELIVERY','DATABASE'
  )),
  status TEXT NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','ERROR')),
  coverage_level TEXT NOT NULL DEFAULT 'FULL' CHECK (coverage_level IN ('FULL','PARTIAL','UNAVAILABLE')),
  accessible_channels INTEGER NOT NULL DEFAULT 0,
  inaccessible_channels INTEGER NOT NULL DEFAULT 0,
  error_details TEXT,
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_guild_time ON monitoring_health(guild_id, checked_at DESC);

-- 22. Persistent Scheduler Locks & Restart Recovery State
CREATE TABLE IF NOT EXISTS scheduler_locks (
  lock_name TEXT PRIMARY KEY,
  holder_id TEXT,
  acquired_at TEXT,
  expires_at TEXT,
  last_run_at TEXT,
  next_run_at TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_error TEXT
);

-- 23. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  guild_id TEXT,
  actor_user_id TEXT NOT NULL,
  actor_tag TEXT,
  action_category TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_guild_time ON audit_logs(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_logs(actor_user_id, created_at DESC);

-- 24. Daily Aggregated Statistics
CREATE TABLE IF NOT EXISTS daily_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  stat_date TEXT NOT NULL,
  total_staff INTEGER NOT NULL DEFAULT 0,
  active_staff INTEGER NOT NULL DEFAULT 0,
  at_risk_staff INTEGER NOT NULL DEFAULT 0,
  inactive_staff INTEGER NOT NULL DEFAULT 0,
  on_leave_staff INTEGER NOT NULL DEFAULT 0,
  unknown_staff INTEGER NOT NULL DEFAULT 0,
  insufficient_workload_staff INTEGER NOT NULL DEFAULT 0,
  error_staff INTEGER NOT NULL DEFAULT 0,
  tickets_opened INTEGER NOT NULL DEFAULT 0,
  tickets_handled INTEGER NOT NULL DEFAULT 0,
  tickets_resolved INTEGER NOT NULL DEFAULT 0,
  tickets_reopened INTEGER NOT NULL DEFAULT 0,
  avg_first_response_sec REAL,
  avg_resolution_sec REAL,
  warnings_issued INTEGER NOT NULL DEFAULT 0,
  reviews_created INTEGER NOT NULL DEFAULT 0,
  qualifying_events_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (guild_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_guild_date ON daily_statistics(guild_id, stat_date DESC);
