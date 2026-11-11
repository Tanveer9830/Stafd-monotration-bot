/**
 * TANVEER STAFF MONITOR — PREMIUM VISUAL DESIGN SYSTEM
 * Deep-purple & neon-cyan visual identity palette.
 */

export const THEME_HEX = Object.freeze({
  primaryViolet: '#7B2FBE',
  deepMidnight: '#211238',
  brightPurple: '#A855F7',
  neonCyan: '#22D3EE',
  greenSuccess: '#22C55E',
  amberWarning: '#F59E0B',
  redDanger: '#EF4444',
  neutralGray: '#64748B',
  softWhite: '#F8FAFC',
  mutedText: '#CBD5E1',
  surfaceCard: '#2D1A4A',
  surfaceBorder: '#4C2882',
});

export const THEME_COLORS = Object.freeze({
  primaryViolet: 0x7b2fbe,
  deepMidnight: 0x211238,
  brightPurple: 0xa855f7,
  neonCyan: 0x22d3ee,
  greenSuccess: 0x22c55e,
  amberWarning: 0xf59e0b,
  redDanger: 0xef4444,
  neutralGray: 0x64748b,
});

export type StaffMonitoringStatus =
  | 'ACTIVE'
  | 'AT_RISK'
  | 'INACTIVE'
  | 'ON_LEAVE'
  | 'UNKNOWN'
  | 'NEW_STAFF'
  | 'INSUFFICIENT_WORKLOAD'
  | 'MONITORING_ERROR';

export const STATUS_DISPLAY_LABELS: Readonly<Record<StaffMonitoringStatus, string>> = Object.freeze({
  ACTIVE: '🟢 ACTIVE',
  AT_RISK: '🟡 AT RISK',
  INACTIVE: '🔴 INACTIVE',
  ON_LEAVE: '🔵 ON LEAVE',
  UNKNOWN: '⚪ UNKNOWN',
  NEW_STAFF: '🆕 NEW STAFF',
  INSUFFICIENT_WORKLOAD: '🟠 INSUFFICIENT WORKLOAD',
  MONITORING_ERROR: '🚨 MONITORING ERROR',
});

export type MonitoringCoverageLevel = 'FULL' | 'PARTIAL' | 'UNAVAILABLE';

export const COVERAGE_DISPLAY_LABELS: Readonly<Record<MonitoringCoverageLevel, string>> = Object.freeze({
  FULL: '🟢 FULL',
  PARTIAL: '🟡 PARTIAL',
  UNAVAILABLE: '🔴 UNAVAILABLE',
});

export function renderProgressBar(current: number, total: number, length = 12): string {
  const safeTotal = total <= 0 ? 1 : total;
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * length);
  const empty = Math.max(0, length - filled);
  const pct = Math.round(ratio * 100);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`;
}
