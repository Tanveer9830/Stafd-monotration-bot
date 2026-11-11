import { MonitoringCoverageLevel, StaffMonitoringStatus } from '../config/theme';

export type StaffRoleCategory =
  | 'TRIAL_STAFF'
  | 'JUNIOR_STAFF'
  | 'STAFF'
  | 'SENIOR_STAFF'
  | 'SUPPORT_TEAM'
  | 'HELPER'
  | 'MODERATOR'
  | 'SENIOR_MODERATOR'
  | 'ADMINISTRATOR'
  | 'MANAGEMENT'
  | 'CO_OWNER'
  | 'CUSTOM';

export const STAFF_ROLE_CATEGORIES: readonly StaffRoleCategory[] = Object.freeze([
  'TRIAL_STAFF',
  'JUNIOR_STAFF',
  'STAFF',
  'SENIOR_STAFF',
  'SUPPORT_TEAM',
  'HELPER',
  'MODERATOR',
  'SENIOR_MODERATOR',
  'ADMINISTRATOR',
  'MANAGEMENT',
  'CO_OWNER',
  'CUSTOM',
]);

export const STAFF_ROLE_CATEGORY_LABELS: Readonly<Record<StaffRoleCategory, string>> = Object.freeze({
  TRIAL_STAFF: 'Trial Staff',
  JUNIOR_STAFF: 'Junior Staff',
  STAFF: 'Staff',
  SENIOR_STAFF: 'Senior Staff',
  SUPPORT_TEAM: 'Support Team',
  HELPER: 'Helper',
  MODERATOR: 'Moderator',
  SENIOR_MODERATOR: 'Senior Moderator',
  ADMINISTRATOR: 'Administrator',
  MANAGEMENT: 'Management',
  CO_OWNER: 'Co-Owner',
  CUSTOM: 'Custom Staff Role',
});

export type FeatureKey =
  | 'roster_sync'
  | 'scheduled_scanning'
  | 'manual_scanning'
  | 'ticket_monitoring'
  | 'ticket_integrations'
  | 'activity_monitoring'
  | 'inactivity_detection'
  | 'inactivity_reports'
  | 'approval_notifications'
  | 'warning_delivery'
  | 'daily_reports'
  | 'weekly_reports'
  | 'monthly_reports'
  | 'analytics'
  | 'chart_generation'
  | 'animated_assets'
  | 'presence_monitoring';

export const ALL_FEATURE_KEYS: readonly FeatureKey[] = Object.freeze([
  'roster_sync',
  'scheduled_scanning',
  'manual_scanning',
  'ticket_monitoring',
  'ticket_integrations',
  'activity_monitoring',
  'inactivity_detection',
  'inactivity_reports',
  'approval_notifications',
  'warning_delivery',
  'daily_reports',
  'weekly_reports',
  'monthly_reports',
  'analytics',
  'chart_generation',
  'animated_assets',
  'presence_monitoring',
]);

export const FEATURE_LABELS: Readonly<Record<FeatureKey, string>> = Object.freeze({
  roster_sync: 'Staff Roster Synchronization',
  scheduled_scanning: 'Scheduled Roster Scanning',
  manual_scanning: 'Manual Roster Scanning',
  ticket_monitoring: 'Ticket Monitoring Engine',
  ticket_integrations: 'Third-Party Ticket Integrations',
  activity_monitoring: 'Staff Activity Monitoring',
  inactivity_detection: 'Inactivity Detection Engine',
  inactivity_reports: 'Inactivity Incident Reports',
  approval_notifications: 'Warning Approval Notifications',
  warning_delivery: 'Official Staff Warning DM Delivery',
  daily_reports: 'Automated Daily Reports',
  weekly_reports: 'Automated Weekly Reports',
  monthly_reports: 'Automated Monthly Reports',
  analytics: 'Performance Analytics Engine',
  chart_generation: 'Visual Chart Generation',
  animated_assets: 'Animated Visual Assets (GIFs)',
  presence_monitoring: 'Optional Discord Presence Monitoring',
});

export const DEFAULT_FEATURE_STATES: Readonly<Record<FeatureKey, boolean>> = Object.freeze({
  roster_sync: true,
  scheduled_scanning: true,
  manual_scanning: true,
  ticket_monitoring: true,
  ticket_integrations: true,
  activity_monitoring: true,
  inactivity_detection: true,
  inactivity_reports: true,
  approval_notifications: true,
  warning_delivery: true,
  daily_reports: true,
  weekly_reports: true,
  monthly_reports: true,
  analytics: true,
  chart_generation: true,
  animated_assets: true,
  presence_monitoring: false,
});

export type ApprovalPolicy =
  | 'GLOBAL_OWNER_REQUIRED'
  | 'ANY_AUTHORIZED_REVIEWER'
  | 'TWO_PERSON_APPROVAL'
  | 'GLOBAL_AND_SERVER_OWNER';

export const APPROVAL_POLICY_LABELS: Readonly<Record<ApprovalPolicy, string>> = Object.freeze({
  GLOBAL_OWNER_REQUIRED: 'Global Owner Approval Required',
  ANY_AUTHORIZED_REVIEWER: 'Any Authorized Reviewer (First Valid Decision)',
  TWO_PERSON_APPROVAL: 'Two-Person Approval (Distinct Reviewers)',
  GLOBAL_AND_SERVER_OWNER: 'Global Owner + Server Owner Dual Approval',
});

export type LocalPermissionTier =
  | 'CO_OWNER'
  | 'MANAGEMENT_REVIEWER'
  | 'LEAVE_MANAGER'
  | 'REPORT_VIEWER';

export type BotAdminScope =
  | 'VIEW_GLOBAL_STATS'
  | 'VIEW_GUILDS'
  | 'INSPECT_DIAGNOSTICS'
  | 'VIEW_AUDIT_LOGS'
  | 'REVIEW_CASES';

export type ActivityEventType =
  | 'TICKET_RESPONSE'
  | 'TICKET_FIRST_RESPONSE'
  | 'TICKET_RESOLUTION'
  | 'SUPPORT_WORK'
  | 'MODERATION_ACTION'
  | 'MANAGEMENT_WORK'
  | 'CONFIGURED_WORK'
  | 'NON_QUALIFYING_IGNORED';

export type TicketStatus =
  | 'OPEN'
  | 'CLAIMED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED';

export type TicketEventType =
  | 'CREATED'
  | 'CLAIMED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'OWNERSHIP_CHANGED'
  | 'FIRST_RESPONSE'
  | 'STAFF_RESPONSE'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED';

export type InactivityIncidentStatus =
  | 'OPEN'
  | 'AT_RISK'
  | 'PENDING_REVIEW'
  | 'ESCALATED'
  | 'APPROVED_WARNING'
  | 'REJECTED'
  | 'EXCUSED'
  | 'AUTO_CANCELLED_RESUMED'
  | 'RESOLVED';

export type InactivitySeverity = 'AT_RISK_24H' | 'INACTIVE_48H' | 'ESCALATED_72H';

export type WarningReviewStatus =
  | 'PENDING'
  | 'DEFERRED'
  | 'AWAITING_SECOND_APPROVAL'
  | 'AWAITING_CONFIRMATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXCUSED'
  | 'CANCELLED';

export type WarningStatus = 'ACTIVE' | 'EXPIRED' | 'REMOVED' | 'APPEALED_OVERTURNED';

export type AppealStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface GlobalConfigRecord {
  id: number;
  global_approval_policy: ApprovalPolicy;
  allow_guild_policy_override: number;
  min_at_risk_hours: number;
  max_at_risk_hours: number;
  min_inactive_hours: number;
  max_inactive_hours: number;
  min_escalation_hours: number;
  max_escalation_hours: number;
  default_scan_interval_minutes: number;
  globally_disabled_features_json: string;
  require_dm_fallback_alert: number;
  rate_limit_actions_per_minute: number;
  updated_at: string;
}

export interface GuildConfigRecord {
  guild_id: string;
  guild_name: string;
  owner_id: string;
  alert_channel_id: string | null;
  log_channel_id: string | null;
  fallback_review_channel_id: string | null;
  support_work_channel_ids_json: string;
  at_risk_hours: number;
  inactive_hours: number;
  escalation_hours: number;
  observation_baseline_hours: number;
  approval_policy_override: ApprovalPolicy | null;
  warning_max_level: number;
  warning_expiry_days: number;
  scan_interval_minutes: number;
  installed_at: string;
  baseline_completed_at: string | null;
  updated_at: string;
}

export interface StaffRoleRecord {
  id: number;
  guild_id: string;
  role_id: string;
  role_name: string;
  category: StaffRoleCategory;
  custom_at_risk_hours: number | null;
  custom_inactive_hours: number | null;
  custom_escalation_hours: number | null;
  is_monitored: number;
  created_by: string;
  created_at: string;
}

export interface StaffProfileRecord {
  id: number;
  guild_id: string;
  user_id: string;
  username: string;
  display_name: string;
  active_role_ids_json: string;
  primary_category: StaffRoleCategory;
  first_registered_at: string;
  joined_staff_at: string;
  left_guild_at: string | null;
  role_removed_at: string | null;
  is_currently_staff: number;
  monitoring_status: StaffMonitoringStatus;
  monitoring_coverage: MonitoringCoverageLevel;
  presence_status: string | null;
  last_qualifying_work_at: string | null;
  last_ticket_activity_at: string | null;
  last_staff_work_at: string | null;
  assigned_tickets_count: number;
  tickets_handled_count: number;
  tickets_resolved_count: number;
  current_workload: number;
  avg_first_response_sec: number | null;
  avg_response_sec: number | null;
  avg_resolution_sec: number | null;
  active_warnings_count: number;
  total_warnings_count: number;
  updated_at: string;
}

export interface TicketRecord {
  ticket_id: string;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  ticket_number: string | null;
  claim_type: 'MANUAL' | 'AUTOMATIC' | 'NONE' | null;
  claim_at: string | null;
  last_activity_at: string | null;
  last_responder_user_id: string | null;
  parent_category_id: string | null;
  is_thread: number;
  external_ticket_ref: string | null;
  adapter_source: string;
  opener_user_id: string | null;
  claimed_by_user_id: string | null;
  assigned_to_user_id: string | null;
  resolved_by_user_id: string | null;
  status: TicketStatus;
  opened_at: string;
  first_staff_response_at: string | null;
  first_response_staff_id: string | null;
  first_response_sec: number | null;
  resolved_at: string | null;
  closed_at: string | null;
  resolution_sec: number | null;
  reopened_count: number;
  staff_message_count: number;
  meaningful_response_count: number;
  updated_at: string;
}

export interface InactivityIncidentRecord {
  incident_id: string;
  guild_id: string;
  staff_user_id: string;
  status: InactivityIncidentStatus;
  severity: InactivitySeverity;
  inactivity_hours: number;
  last_qualifying_activity_at: string | null;
  last_ticket_activity_at: string | null;
  available_workload_count: number;
  monitoring_coverage: MonitoringCoverageLevel;
  reason_summary: string;
  suggested_warning_level: number;
  detected_at: string;
  escalated_at: string | null;
  resolved_at: string | null;
  cancellation_reason: string | null;
  updated_at: string;
}

export interface ReviewSnapshotData {
  staffUsername: string;
  staffDisplayName: string;
  staffUserId: string;
  guildId: string;
  guildName: string;
  staffRoles: string[];
  lastQualifyingActivityAt: string | null;
  lastTicketActivityAt: string | null;
  inactivityHours: number;
  ticketsHandled: number;
  ticketsResolved: number;
  assignedTickets: number;
  availableWorkload: number;
  monitoringCoverage: MonitoringCoverageLevel;
  activeWarningsCount: number;
  totalWarningsCount: number;
  reasonForReview: string;
  suggestedWarningLevel: number;
}

export interface WarningReviewRecord {
  review_id: string;
  incident_id: string | null;
  guild_id: string;
  staff_user_id: string;
  status: WarningReviewStatus;
  required_policy: ApprovalPolicy;
  suggested_level: number;
  proposed_reason: string | null;
  proposed_note: string | null;
  snapshot_json: string;
  first_approver_id: string | null;
  first_approver_name: string | null;
  first_approved_at: string | null;
  pending_confirmer_id: string | null;
  final_actor_id: string | null;
  final_actor_name: string | null;
  final_note: string | null;
  deferred_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface WarningRecord {
  warning_id: string;
  guild_id: string;
  staff_user_id: string;
  review_id: string | null;
  incident_id: string | null;
  warning_level: number;
  status: WarningStatus;
  reason: string;
  management_note: string | null;
  issued_by_id: string;
  approver_id: string;
  approver_display_name: string;
  approved_at: string;
  dm_delivered: number;
  dm_error: string | null;
  fallback_notified: number;
  expires_at: string | null;
  removed_by_id: string | null;
  removed_reason: string | null;
  removed_at: string | null;
  requires_management_review: number;
}

export interface WarningAppealRecord {
  appeal_id: string;
  warning_id: string;
  guild_id: string;
  staff_user_id: string;
  appeal_reason: string;
  status: AppealStatus;
  submitted_at: string;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  decided_at: string | null;
}

export interface ApprovedLeaveRecord {
  leave_id: string;
  guild_id: string;
  staff_user_id: string;
  status: LeaveStatus;
  reason: string;
  requested_by_id: string;
  approved_by_id: string | null;
  start_at: string;
  end_at: string;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}
