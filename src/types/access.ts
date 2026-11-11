/**
 * TANVEER STAFF MONITOR — centralized website permission vocabulary.
 * Every API route and live subscription is evaluated against these scopes on
 * the backend. Browser-submitted role names are never trusted.
 */

export const GLOBAL_SCOPES = [
  'GLOBAL_VIEW_ALL',
  'GLOBAL_ANALYTICS',
  'GLOBAL_MANAGE_ADMINS',
  'GLOBAL_MANAGE_GUILDS',
  'GLOBAL_MANAGE_ROLES',
  'GLOBAL_VIEW_AUDIT',
  'GLOBAL_SYSTEM',
  'GLOBAL_BACKUP',
  'GLOBAL_SECURITY',
  'GLOBAL_INTEGRATIONS',
] as const;

export const LOCAL_SCOPES = [
  'SERVER_VIEW_OVERVIEW',
  'SERVER_VIEW_STAFF',
  'SERVER_VIEW_TICKETS',
  'SERVER_VIEW_TRANSCRIPTS',
  'SERVER_VIEW_ANALYTICS',
  'SERVER_VIEW_AUDIT',
  'SERVER_EXPORT_REPORTS',
  'SERVER_MANAGE_STAFF',
  'SERVER_MANAGE_TICKETS',
  'SERVER_MANAGE_SETTINGS',
  'SERVER_MANAGE_ROLES',
  'SERVER_MANAGE_REVIEWS',
  'SERVER_MANAGE_WARNINGS',
  'SERVER_MANAGE_LEAVE',
  'SERVER_MANAGE_APPEALS',
  'SERVER_MANAGE_INTEGRATIONS',
  'STAFF_SELF_VIEW',
] as const;

export const ALL_SCOPES = [...GLOBAL_SCOPES, ...LOCAL_SCOPES] as const;

export type GlobalScope = (typeof GLOBAL_SCOPES)[number];
export type LocalScope = (typeof LOCAL_SCOPES)[number];
export type WebScope = GlobalScope | LocalScope;

export type WebRole =
  | 'GLOBAL_ADMIN'
  | 'SERVER_CO_OWNER'
  | 'SERVER_ADMIN'
  | 'SERVER_VIEWER'
  | 'STAFF_VIEWER';

export const WEB_ROLE_LABELS: Readonly<Record<WebRole, string>> = Object.freeze({
  GLOBAL_ADMIN: 'Global Administrator',
  SERVER_CO_OWNER: 'Server Co-owner',
  SERVER_ADMIN: 'Server Administrator',
  SERVER_VIEWER: 'Server Viewer',
  STAFF_VIEWER: 'Staff Viewer',
});

export const GLOBAL_ADMIN_SCOPES: readonly GlobalScope[] = Object.freeze([
  'GLOBAL_SYSTEM',
  'GLOBAL_BACKUP',
  'GLOBAL_INTEGRATIONS',
  'GLOBAL_VIEW_AUDIT',
  'GLOBAL_SECURITY',
  'GLOBAL_MANAGE_GUILDS',
  'GLOBAL_MANAGE_ROLES',
  'GLOBAL_VIEW_ALL',
  'GLOBAL_ANALYTICS',
  'GLOBAL_MANAGE_ADMINS',
]);

export const SERVER_CO_OWNER_SCOPES: readonly LocalScope[] = Object.freeze([
  'SERVER_VIEW_OVERVIEW',
  'SERVER_VIEW_STAFF',
  'SERVER_VIEW_TICKETS',
  'SERVER_VIEW_TRANSCRIPTS',
  'SERVER_VIEW_ANALYTICS',
  'SERVER_VIEW_AUDIT',
  'SERVER_EXPORT_REPORTS',
  'SERVER_MANAGE_STAFF',
  'SERVER_MANAGE_TICKETS',
  'SERVER_MANAGE_SETTINGS',
  'SERVER_MANAGE_ROLES',
  'SERVER_MANAGE_REVIEWS',
  'SERVER_MANAGE_WARNINGS',
  'SERVER_MANAGE_LEAVE',
  'SERVER_MANAGE_APPEALS',
  'SERVER_MANAGE_INTEGRATIONS',
  'STAFF_SELF_VIEW',
]);

export const SERVER_ADMIN_SCOPES: readonly LocalScope[] = Object.freeze([
  'SERVER_VIEW_OVERVIEW',
  'SERVER_VIEW_STAFF',
  'SERVER_VIEW_TICKETS',
  'SERVER_VIEW_ANALYTICS',
  'SERVER_EXPORT_REPORTS',
  'SERVER_MANAGE_STAFF',
  'SERVER_MANAGE_TICKETS',
  'SERVER_MANAGE_REVIEWS',
  'SERVER_MANAGE_WARNINGS',
  'SERVER_MANAGE_LEAVE',
]);

export const SERVER_VIEWER_SCOPES: readonly LocalScope[] = Object.freeze([
  'SERVER_VIEW_OVERVIEW',
  'SERVER_VIEW_STAFF',
  'SERVER_VIEW_ANALYTICS',
  'STAFF_SELF_VIEW',
]);

export const STAFF_VIEWER_SCOPES: readonly LocalScope[] = Object.freeze([
  'STAFF_SELF_VIEW',
]);

export const ROLE_DEFAULT_SCOPES: Readonly<Record<WebRole, readonly WebScope[]>> = Object.freeze({
  GLOBAL_ADMIN: Object.freeze(['GLOBAL_SYSTEM'] as GlobalScope[]),
  SERVER_CO_OWNER: SERVER_CO_OWNER_SCOPES,
  SERVER_ADMIN: SERVER_ADMIN_SCOPES,
  SERVER_VIEWER: SERVER_VIEWER_SCOPES,
  STAFF_VIEWER: STAFF_VIEWER_SCOPES,
});

export const ROLE_ALLOWED_SCOPES: Readonly<Record<WebRole, readonly WebScope[]>> = Object.freeze({
  GLOBAL_ADMIN: GLOBAL_ADMIN_SCOPES,
  SERVER_CO_OWNER: SERVER_CO_OWNER_SCOPES,
  SERVER_ADMIN: SERVER_ADMIN_SCOPES,
  SERVER_VIEWER: SERVER_VIEWER_SCOPES,
  STAFF_VIEWER: STAFF_VIEWER_SCOPES,
});

/** Roles each web role may grant to other members (Global Owner bypasses). */
export const GRANTABLE_ROLES: Readonly<Record<WebRole, readonly WebRole[]>> = Object.freeze({
  GLOBAL_ADMIN: [],
  SERVER_CO_OWNER: ['SERVER_ADMIN', 'SERVER_VIEWER', 'STAFF_VIEWER'],
  SERVER_ADMIN: ['SERVER_VIEWER', 'STAFF_VIEWER'],
  SERVER_VIEWER: [],
  STAFF_VIEWER: [],
});

export const OWNER_LOCAL_SCOPES: readonly LocalScope[] = Object.freeze([...LOCAL_SCOPES]);

export function isGlobalScope(scope: string): scope is GlobalScope {
  return (GLOBAL_SCOPES as readonly string[]).includes(scope);
}

export function isLocalScope(scope: string): scope is LocalScope {
  return (LOCAL_SCOPES as readonly string[]).includes(scope);
}

export function isWebScope(scope: string): scope is WebScope {
  return isGlobalScope(scope) || isLocalScope(scope);
}

export function isWebRole(value: string): value is WebRole {
  return Object.prototype.hasOwnProperty.call(WEB_ROLE_LABELS, value);
}

export function sanitizeScopes(input: readonly string[]): WebScope[] {
  return Array.from(new Set(input.filter(isWebScope)));
}

export interface PermissionMatrixRow {
  action: string;
  globalOwner: string;
  globalAdmin: string;
  serverOwner: string;
  serverCoOwner: string;
  serverAdmin: string;
  viewer: string;
}

export const PERMISSION_MATRIX: readonly PermissionMatrixRow[] = Object.freeze([
  { action: 'View all servers', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'No', serverCoOwner: 'No', serverAdmin: 'No', viewer: 'No' },
  { action: 'Global analytics', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'No', serverCoOwner: 'No', serverAdmin: 'No', viewer: 'No' },
  { action: 'View own server', globalOwner: 'Yes', globalAdmin: 'Scoped', serverOwner: 'Yes', serverCoOwner: 'Granted scope', serverAdmin: 'Granted scope', viewer: 'Granted scope' },
  { action: 'Manage own server', globalOwner: 'Yes', globalAdmin: 'Scoped', serverOwner: 'Yes', serverCoOwner: 'Granted scope', serverAdmin: 'Granted scope', viewer: 'No' },
  { action: 'Manage local roles', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'Yes', serverCoOwner: 'Only if granted', serverAdmin: 'Only if granted', viewer: 'No' },
  { action: 'Add local admin', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'Yes', serverCoOwner: 'Only if granted', serverAdmin: 'No by default', viewer: 'No' },
  { action: 'Add local co-owner', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'Yes', serverCoOwner: 'No by default', serverAdmin: 'No', viewer: 'No' },
  { action: 'Manage global admins', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'No', serverCoOwner: 'No', serverAdmin: 'No', viewer: 'No' },
  { action: 'Change Global Owner', globalOwner: 'No', globalAdmin: 'No', serverOwner: 'No', serverCoOwner: 'No', serverAdmin: 'No', viewer: 'No' },
  { action: 'View other servers', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'No', serverCoOwner: 'No', serverAdmin: 'No', viewer: 'No' },
  { action: 'View all conversations globally', globalOwner: 'Yes', globalAdmin: 'No', serverOwner: 'No', serverCoOwner: 'No', serverAdmin: 'No', viewer: 'No' },
]);
