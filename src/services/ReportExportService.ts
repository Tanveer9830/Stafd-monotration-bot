import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import PDFDocument from 'pdfkit';
import { BRANDING, PERMANENT_EMBED_FOOTER } from '../config/branding';
import { THEME_HEX } from '../config/theme';
import { formatSecondsCompact } from '../utils/ids';
import { FeatureService } from './FeatureService';
import { GlobalAnalyticsReport, GuildAnalyticsReport } from './AnalyticsService';

const SYSTEM_FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];

function resolveAvailableFonts(): string[] {
  return SYSTEM_FONT_CANDIDATES.filter((p) => fs.existsSync(p));
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export class ReportExportService {
  private readonly features: FeatureService;

  constructor(features: FeatureService) {
    this.features = features;
  }

  public renderSvgToPng(svgMarkup: string): Buffer {
    const fontFiles = resolveAvailableFonts();
    const resvg = new Resvg(svgMarkup, {
      font: {
        fontFiles,
        loadSystemFonts: true,
        defaultFontFamily: 'DejaVu Sans',
      },
    });
    return Buffer.from(resvg.render().asPng());
  }

  /**
   * Generates a branded deep-purple & neon-cyan PNG analytics report for a server or individual staff member.
   */
  public exportGuildPngReport(report: GuildAnalyticsReport): Buffer {
    if (!this.features.isEnabled(report.guildId, 'chart_generation')) {
      throw new Error('Visual chart generation is currently disabled in server feature settings.');
    }

    const width = 1200;
    const height = 820;
    const totalStaff = Object.values(report.statusBreakdown).reduce((a, b) => a + b, 0);

    const bars: Array<{ label: string; value: number; color: string }> = [
      { label: 'ACTIVE', value: report.statusBreakdown.ACTIVE, color: THEME_HEX.greenSuccess },
      { label: 'AT RISK', value: report.statusBreakdown.AT_RISK, color: THEME_HEX.amberWarning },
      { label: 'INACTIVE', value: report.statusBreakdown.INACTIVE, color: THEME_HEX.redDanger },
      { label: 'ON LEAVE', value: report.statusBreakdown.ON_LEAVE, color: THEME_HEX.neonCyan },
      { label: 'LOW WORK', value: report.statusBreakdown.INSUFFICIENT_WORKLOAD, color: THEME_HEX.brightPurple },
      { label: 'UNKNOWN', value: report.statusBreakdown.UNKNOWN + report.statusBreakdown.NEW_STAFF, color: THEME_HEX.neutralGray },
    ];
    const maxBar = Math.max(1, ...bars.map((b) => b.value));

    const barSvg = bars
      .map((bar, idx) => {
        const x = 70 + idx * 92;
        const maxH = 170;
        const barH = Math.max(6, Math.round((bar.value / maxBar) * maxH));
        const y = 435 - barH;
        return `
          <rect x="${x}" y="${y}" width="58" height="${barH}" rx="6" fill="${bar.color}" />
          <text x="${x + 29}" y="${y - 8}" text-anchor="middle" fill="#F8FAFC" font-size="14" font-weight="bold">${bar.value}</text>
          <text x="${x + 29}" y="458" text-anchor="middle" fill="#CBD5E1" font-size="11">${escapeXml(bar.label)}</text>
        `;
      })
      .join('');

    const topRows = report.staffRows.slice(0, 6);
    const tableRowsSvg =
      topRows.length === 0
        ? `<text x="70" y="575" fill="#94A3B8" font-size="14">No configured staff members recorded for this scope yet.</text>`
        : topRows
            .map((r, i) => {
              const rowY = 562 + i * 32;
              return `
                <rect x="55" y="${rowY - 19}" width="1090" height="27" rx="4" fill="${i % 2 === 0 ? '#291745' : '#24133D'}" />
                <text x="70" y="${rowY}" fill="#F8FAFC" font-size="13" font-weight="bold">${escapeXml(r.username.slice(0, 20))}</text>
                <text x="270" y="${rowY}" fill="#22D3EE" font-size="12">${escapeXml(r.monitoringStatus)}</text>
                <text x="455" y="${rowY}" fill="#F8FAFC" font-size="13">${r.ticketsAssigned} / ${r.ticketsHandled} / ${r.ticketsResolved}</text>
                <text x="645" y="${rowY}" fill="#CBD5E1" font-size="13">${escapeXml(formatSecondsCompact(r.firstResponseSec))}</text>
                <text x="785" y="${rowY}" fill="#A855F7" font-size="13">${r.workConsistencyPct}%</text>
                <text x="880" y="${rowY}" fill="#CBD5E1" font-size="12">${escapeXml(r.fairnessNote.slice(0, 34))}</text>
              `;
            })
            .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${THEME_HEX.deepMidnight}" />
          <stop offset="100%" stop-color="#140A24" />
        </linearGradient>
        <linearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${THEME_HEX.primaryViolet}" />
          <stop offset="100%" stop-color="#3B1566" />
        </linearGradient>
      </defs>

      <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
      <rect x="30" y="24" width="1140" height="96" rx="14" fill="url(#hdrGrad)" stroke="${THEME_HEX.neonCyan}" stroke-width="1.5" />

      <text x="58" y="64" fill="#F8FAFC" font-family="DejaVu Sans" font-size="26" font-weight="bold">${escapeXml(BRANDING.projectName)} — ${escapeXml(report.periodType)} ANALYTICS</text>
      <text x="58" y="95" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="15">Server: ${escapeXml(report.guildName)} (${escapeXml(report.guildId)})  •  Coverage: ${escapeXml(report.coverageLevel)}  •  ${escapeXml(BRANDING.creatorIdentity)}</text>

      <!-- KPI Cards -->
      <rect x="30" y="140" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="52" y="170" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">MONITORED STAFF</text>
      <text x="52" y="208" fill="#F8FAFC" font-family="DejaVu Sans" font-size="30" font-weight="bold">${totalStaff}</text>
      <text x="145" y="206" fill="${THEME_HEX.greenSuccess}" font-family="DejaVu Sans" font-size="14">${report.statusBreakdown.ACTIVE} Active</text>

      <rect x="320" y="140" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="342" y="170" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">TICKETS (OPENED / HANDLED / RES)</text>
      <text x="342" y="208" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="26" font-weight="bold">${report.ticketMetrics.openedInPeriod} / ${report.ticketMetrics.handledInPeriod} / ${report.ticketMetrics.resolvedInPeriod}</text>

      <rect x="610" y="140" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="632" y="170" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">AVG FIRST RESPONSE / RESOLVE</text>
      <text x="632" y="208" fill="${THEME_HEX.brightPurple}" font-family="DejaVu Sans" font-size="23" font-weight="bold">${escapeXml(formatSecondsCompact(report.ticketMetrics.avgFirstResponseSec))} / ${escapeXml(formatSecondsCompact(report.ticketMetrics.avgResolutionSec))}</text>

      <rect x="900" y="140" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="922" y="170" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">ACTIVE WARNINGS (1 / 2 / 3)</text>
      <text x="922" y="208" fill="${THEME_HEX.amberWarning}" font-family="DejaVu Sans" font-size="26" font-weight="bold">${report.warningMetrics.level1Active} / ${report.warningMetrics.level2Active} / ${report.warningMetrics.level3Active}</text>

      <!-- Roster Status Chart Panel -->
      <rect x="30" y="248" width="620" height="230" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="55" y="278" fill="#F8FAFC" font-family="DejaVu Sans" font-size="16" font-weight="bold">Roster Activity Status Distribution</text>
      ${barSvg}

      <!-- Review Outcomes Panel -->
      <rect x="670" y="248" width="500" height="230" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="695" y="278" fill="#F8FAFC" font-family="DejaVu Sans" font-size="16" font-weight="bold">Human Review &amp; Workload Fairness Summary</text>
      <text x="695" y="315" fill="#CBD5E1" font-family="DejaVu Sans" font-size="14">Pending Reviews: <tspan fill="${THEME_HEX.amberWarning}" font-weight="bold">${report.reviewOutcomes.pending}</tspan></text>
      <text x="695" y="345" fill="#CBD5E1" font-family="DejaVu Sans" font-size="14">Approved Warnings: <tspan fill="${THEME_HEX.redDanger}" font-weight="bold">${report.reviewOutcomes.approved}</tspan>   |   Rejected: <tspan fill="#F8FAFC" font-weight="bold">${report.reviewOutcomes.rejected}</tspan></text>
      <text x="695" y="375" fill="#CBD5E1" font-family="DejaVu Sans" font-size="14">Marked Excused: <tspan fill="${THEME_HEX.greenSuccess}" font-weight="bold">${report.reviewOutcomes.excused}</tspan>   |   Auto-Cancelled: <tspan fill="${THEME_HEX.neonCyan}" font-weight="bold">${report.reviewOutcomes.cancelled}</tspan></text>
      <text x="695" y="412" fill="#CBD5E1" font-family="DejaVu Sans" font-size="14">Available Workload Opportunities: <tspan fill="${THEME_HEX.neonCyan}" font-weight="bold">${report.ticketMetrics.availableWorkload}</tspan></text>
      <text x="695" y="444" fill="#94A3B8" font-family="DejaVu Sans" font-size="12">Window: ${escapeXml(report.fromIso.slice(0, 10))} to ${escapeXml(report.toIso.slice(0, 10))}</text>

      <!-- Staff Breakdown Table -->
      <rect x="30" y="495" width="1140" height="265" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="55" y="525" fill="#F8FAFC" font-family="DejaVu Sans" font-size="16" font-weight="bold">Fairness-Adjusted Staff Performance Snapshot</text>
      <text x="70" y="542" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">STAFF</text>
      <text x="270" y="542" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">STATUS</text>
      <text x="455" y="542" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">ASGN / HNDL / RES</text>
      <text x="645" y="542" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">1ST RESP</text>
      <text x="785" y="542" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">CONSISTENCY</text>
      <text x="880" y="542" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">FAIRNESS CONTEXT</text>
      ${tableRowsSvg}

      <!-- Permanent Footer -->
      <rect x="30" y="772" width="1140" height="34" rx="8" fill="#180C2B" stroke="${THEME_HEX.primaryViolet}" />
      <polygon points="56,781 49,791 55,791 52,799 61,788 55,788" fill="${THEME_HEX.neonCyan}" />
      <text x="70" y="794" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="14" font-weight="bold">${escapeXml(PERMANENT_EMBED_FOOTER)}</text>
      <text x="1148" y="794" text-anchor="end" fill="#94A3B8" font-family="DejaVu Sans" font-size="12">Generated ${escapeXml(report.generatedAt)}</text>
    </svg>`;

    return this.renderSvgToPng(svg);
  }

  public exportGlobalPngReport(report: GlobalAnalyticsReport): Buffer {
    const width = 1200;
    const height = 720;

    const rowsSvg =
      report.guildSummaries.length === 0
        ? `<text x="70" y="420" fill="#94A3B8" font-size="14">No registered Discord servers yet.</text>`
        : report.guildSummaries
            .slice(0, 7)
            .map((g, i) => {
              const y = 410 + i * 32;
              return `
                <rect x="55" y="${y - 19}" width="1090" height="27" rx="4" fill="${i % 2 === 0 ? '#291745' : '#24133D'}" />
                <text x="70" y="${y}" fill="#F8FAFC" font-size="13" font-weight="bold">${escapeXml(g.guildName.slice(0, 28))} (${escapeXml(g.guildId)})</text>
                <text x="470" y="${y}" fill="#22D3EE" font-size="13">${g.staffCount}</text>
                <text x="580" y="${y}" fill="#22C55E" font-size="13">${g.activeCount}</text>
                <text x="690" y="${y}" fill="#EF4444" font-size="13">${g.inactiveCount}</text>
                <text x="810" y="${y}" fill="#F8FAFC" font-size="13">${g.ticketsTotal}</text>
                <text x="940" y="${y}" fill="#F59E0B" font-size="13">${g.pendingReviews}</text>
                <text x="1060" y="${y}" fill="#A855F7" font-size="13">${g.warningsActive}</text>
              `;
            })
            .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="${THEME_HEX.deepMidnight}" />
      <rect x="30" y="24" width="1140" height="92" rx="14" fill="${THEME_HEX.primaryViolet}" stroke="${THEME_HEX.neonCyan}" stroke-width="1.5" />
      <text x="58" y="64" fill="#F8FAFC" font-family="DejaVu Sans" font-size="26" font-weight="bold">${escapeXml(BRANDING.projectName)} — GLOBAL OWNER REPORT</text>
      <text x="58" y="93" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="15">Cross-Server Executive Telemetry  •  ${escapeXml(BRANDING.creatorIdentity)}</text>

      <rect x="30" y="138" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="52" y="168" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">REGISTERED SERVERS</text>
      <text x="52" y="206" fill="#F8FAFC" font-family="DejaVu Sans" font-size="30" font-weight="bold">${report.totalGuilds}</text>

      <rect x="320" y="138" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="342" y="168" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">GLOBAL STAFF ROSTER</text>
      <text x="342" y="206" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="30" font-weight="bold">${report.totalStaff}</text>

      <rect x="610" y="138" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="632" y="168" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">TICKETS MONITORED / HANDLED</text>
      <text x="632" y="206" fill="${THEME_HEX.brightPurple}" font-family="DejaVu Sans" font-size="28" font-weight="bold">${report.totalTicketsMonitored} / ${report.totalTicketsHandled}</text>

      <rect x="900" y="138" width="270" height="90" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="922" y="168" fill="#CBD5E1" font-family="DejaVu Sans" font-size="13">PENDING REVIEWS / WARNINGS</text>
      <text x="922" y="206" fill="${THEME_HEX.amberWarning}" font-family="DejaVu Sans" font-size="28" font-weight="bold">${report.pendingReviews} / ${report.totalWarnings}</text>

      <rect x="30" y="250" width="1140" height="82" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="55" y="282" fill="#F8FAFC" font-family="DejaVu Sans" font-size="15" font-weight="bold">Global Status Totals</text>
      <text x="55" y="312" fill="#CBD5E1" font-family="DejaVu Sans" font-size="14">Active: ${report.statusBreakdown.ACTIVE}  |  At-Risk: ${report.statusBreakdown.AT_RISK}  |  Inactive: ${report.statusBreakdown.INACTIVE}  |  On Leave: ${report.statusBreakdown.ON_LEAVE}  |  Insufficient Workload: ${report.statusBreakdown.INSUFFICIENT_WORKLOAD}  |  Unknown/New: ${report.statusBreakdown.UNKNOWN + report.statusBreakdown.NEW_STAFF}  |  Monitoring Errors: ${report.monitoringErrors}</text>

      <rect x="30" y="350" width="1140" height="295" rx="12" fill="${THEME_HEX.surfaceCard}" stroke="${THEME_HEX.surfaceBorder}" />
      <text x="55" y="378" fill="#F8FAFC" font-family="DejaVu Sans" font-size="16" font-weight="bold">Registered Server Breakdown</text>
      <text x="70" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">SERVER</text>
      <text x="470" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">STAFF</text>
      <text x="580" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">ACTIVE</text>
      <text x="690" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">INACTIVE</text>
      <text x="810" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">TICKETS</text>
      <text x="940" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">REVIEWS</text>
      <text x="1060" y="394" fill="#94A3B8" font-family="DejaVu Sans" font-size="11">WARNINGS</text>
      ${rowsSvg}

      <rect x="30" y="662" width="1140" height="36" rx="8" fill="#180C2B" stroke="${THEME_HEX.primaryViolet}" />
      <text x="55" y="685" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="14" font-weight="bold">${escapeXml(PERMANENT_EMBED_FOOTER)}</text>
      <text x="1148" y="685" text-anchor="end" fill="#94A3B8" font-family="DejaVu Sans" font-size="12">Generated ${escapeXml(report.generatedAt)}</text>
    </svg>`;

    return this.renderSvgToPng(svg);
  }

  /**
   * Generates an RFC-4180 compliant CSV export with permanent Tanveer branding.
   */
  public exportGuildCsvReport(report: GuildAnalyticsReport): Buffer {
    const lines: string[] = [
      `# ${BRANDING.projectName} — ${BRANDING.creatorIdentity}`,
      `# ${PERMANENT_EMBED_FOOTER}`,
      `# Server: ${report.guildName} (${report.guildId}) | Period: ${report.periodType} (${report.fromIso} to ${report.toIso}) | Coverage: ${report.coverageLevel}`,
      [
        'user_id',
        'username',
        'display_name',
        'role_category',
        'monitoring_status',
        'monitoring_coverage',
        'tickets_assigned',
        'tickets_handled',
        'tickets_resolved',
        'reopened_tickets',
        'first_response_sec',
        'avg_response_sec',
        'avg_resolution_sec',
        'current_workload',
        'recent_activity_7d',
        'long_term_activity_30d',
        'work_consistency_pct',
        'active_warnings',
        'fairness_note',
      ].join(','),
    ];

    for (const r of report.staffRows) {
      lines.push(
        [
          escapeCsvField(r.userId),
          escapeCsvField(r.username),
          escapeCsvField(r.displayName),
          escapeCsvField(r.primaryCategory),
          escapeCsvField(r.monitoringStatus),
          escapeCsvField(r.monitoringCoverage),
          escapeCsvField(r.ticketsAssigned),
          escapeCsvField(r.ticketsHandled),
          escapeCsvField(r.ticketsResolved),
          escapeCsvField(r.reopenedTickets),
          escapeCsvField(r.firstResponseSec !== null ? Math.round(r.firstResponseSec) : ''),
          escapeCsvField(r.avgResponseSec !== null ? Math.round(r.avgResponseSec) : ''),
          escapeCsvField(r.avgResolutionSec !== null ? Math.round(r.avgResolutionSec) : ''),
          escapeCsvField(r.currentWorkload),
          escapeCsvField(r.recentActivity7d),
          escapeCsvField(r.longTermActivity30d),
          escapeCsvField(r.workConsistencyPct),
          escapeCsvField(r.activeWarnings),
          escapeCsvField(r.fairnessNote),
        ].join(','),
      );
    }

    lines.push(`# Footer: ${PERMANENT_EMBED_FOOTER}`);
    return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
  }

  public exportGlobalCsvReport(report: GlobalAnalyticsReport): Buffer {
    const lines: string[] = [
      `# ${BRANDING.projectName} — GLOBAL REPORT (${BRANDING.creatorIdentity})`,
      `# ${PERMANENT_EMBED_FOOTER}`,
      ['guild_id', 'guild_name', 'staff_count', 'active_count', 'inactive_count', 'tickets_total', 'pending_reviews', 'warnings_active'].join(','),
    ];

    for (const g of report.guildSummaries) {
      lines.push(
        [
          escapeCsvField(g.guildId),
          escapeCsvField(g.guildName),
          escapeCsvField(g.staffCount),
          escapeCsvField(g.activeCount),
          escapeCsvField(g.inactiveCount),
          escapeCsvField(g.ticketsTotal),
          escapeCsvField(g.pendingReviews),
          escapeCsvField(g.warningsActive),
        ].join(','),
      );
    }

    lines.push(`# Footer: ${PERMANENT_EMBED_FOOTER}`);
    return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
  }

  /**
   * Generates a multi-section branded PDF report (embedding the chart graphic when enabled)
   * with permanent Tanveer branding on every page.
   */
  public async exportGuildPdfReport(report: GuildAnalyticsReport): Promise<Buffer> {
    let chartPng: Buffer | null = null;
    if (this.features.isEnabled(report.guildId, 'chart_generation')) {
      chartPng = this.exportGuildPngReport(report);
    }

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `${BRANDING.projectName} — ${report.guildName} (${report.periodType})`,
          Author: `${BRANDING.creatorIdentity} (${BRANDING.creatorDiscordUsername})`,
          Subject: PERMANENT_EMBED_FOOTER,
        },
      });

      const dejavuBold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
      const dejavuReg = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
      const hasCustomFonts = fs.existsSync(dejavuBold) && fs.existsSync(dejavuReg);
      if (hasCustomFonts) {
        doc.registerFont('TSM-Bold', dejavuBold);
        doc.registerFont('TSM-Regular', dejavuReg);
      }
      const boldFont = hasCustomFonts ? 'TSM-Bold' : 'Helvetica-Bold';
      const regFont = hasCustomFonts ? 'TSM-Regular' : 'Helvetica';

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const drawFooter = () => {
        const bottomY = doc.page.height - 36;
        doc.save();
        doc.rect(40, bottomY - 6, doc.page.width - 80, 24).fill('#211238');
        doc
          .fillColor('#22D3EE')
          .font(boldFont)
          .fontSize(9)
          .text(PERMANENT_EMBED_FOOTER, 52, bottomY, { lineBreak: false });
        doc.restore();
      };

      // Header Banner
      doc.rect(40, 36, doc.page.width - 80, 66).fill('#7B2FBE');
      doc
        .fillColor('#F8FAFC')
        .font(boldFont)
        .fontSize(18)
        .text(`${BRANDING.projectName} — ${report.periodType} REPORT`, 54, 49);
      doc
        .fillColor('#22D3EE')
        .font(regFont)
        .fontSize(10)
        .text(
          `${BRANDING.creatorIdentity} | Server: ${report.guildName} (${report.guildId}) | Coverage: ${report.coverageLevel}`,
          54,
          75,
        );

      doc.moveDown(2.5);
      doc.y = 116;

      // Summary Metrics
      doc
        .fillColor('#1E293B')
        .font(boldFont)
        .fontSize(12)
        .text('Executive Summary', 40, doc.y);
      doc.moveDown(0.4);
      doc
        .font(regFont)
        .fontSize(10)
        .fillColor('#334155')
        .text(
          `Period: ${report.fromIso.slice(0, 10)} to ${report.toIso.slice(0, 10)}  |  Active: ${report.statusBreakdown.ACTIVE}, At-Risk: ${report.statusBreakdown.AT_RISK}, Inactive: ${report.statusBreakdown.INACTIVE}, On Leave: ${report.statusBreakdown.ON_LEAVE}, Low Workload: ${report.statusBreakdown.INSUFFICIENT_WORKLOAD}`,
        )
        .text(
          `Tickets — Opened: ${report.ticketMetrics.openedInPeriod}, Handled: ${report.ticketMetrics.handledInPeriod}, Resolved: ${report.ticketMetrics.resolvedInPeriod}, Reopened: ${report.ticketMetrics.reopenedTotal}, Available Workload: ${report.ticketMetrics.availableWorkload}`,
        )
        .text(
          `Warnings Active (1/2/3): ${report.warningMetrics.level1Active}/${report.warningMetrics.level2Active}/${report.warningMetrics.level3Active}  |  Reviews (Pending/Approved/Rejected/Excused): ${report.reviewOutcomes.pending}/${report.reviewOutcomes.approved}/${report.reviewOutcomes.rejected}/${report.reviewOutcomes.excused}`,
        );

      if (chartPng) {
        doc.moveDown(0.8);
        doc.image(chartPng, 40, doc.y, { width: doc.page.width - 80 });
        doc.y += 360;
      } else {
        doc.moveDown(1);
      }

      doc
        .fillColor('#1E293B')
        .font(boldFont)
        .fontSize(12)
        .text('Staff Performance & Fairness Detail', 40, doc.y);
      doc.moveDown(0.4);

      if (report.staffRows.length === 0) {
        doc.font(regFont).fontSize(10).fillColor('#64748B').text('No staff profiles registered in this scope.');
      } else {
        for (const row of report.staffRows) {
          if (doc.y > doc.page.height - 90) {
            drawFooter();
            doc.addPage();
          }
          doc
            .font(boldFont)
            .fontSize(9.5)
            .fillColor('#211238')
            .text(
              `${row.displayName} (@${row.username} | ${row.userId}) — [${row.monitoringStatus}]`,
              40,
              doc.y,
            );
          doc
            .font(regFont)
            .fontSize(9)
            .fillColor('#475569')
            .text(
              `Assigned: ${row.ticketsAssigned} | Handled: ${row.ticketsHandled} | Resolved: ${row.ticketsResolved} | 1st Resp: ${formatSecondsCompact(row.firstResponseSec)} | Consistency: ${row.workConsistencyPct}% | Warnings: ${row.activeWarnings}/3 | ${row.fairnessNote}`,
              48,
              doc.y,
            );
          doc.moveDown(0.35);
        }
      }

      drawFooter();
      doc.end();
    });
  }

  public async exportGlobalPdfReport(report: GlobalAnalyticsReport): Promise<Buffer> {
    const chartPng = this.exportGlobalPngReport(report);

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `${BRANDING.projectName} — Global Executive Report`,
          Author: `${BRANDING.creatorIdentity} (${BRANDING.creatorDiscordUsername})`,
          Subject: PERMANENT_EMBED_FOOTER,
        },
      });

      const dejavuBold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
      const dejavuReg = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
      const hasCustomFonts = fs.existsSync(dejavuBold) && fs.existsSync(dejavuReg);
      if (hasCustomFonts) {
        doc.registerFont('TSM-Bold', dejavuBold);
        doc.registerFont('TSM-Regular', dejavuReg);
      }
      const boldFont = hasCustomFonts ? 'TSM-Bold' : 'Helvetica-Bold';
      const regFont = hasCustomFonts ? 'TSM-Regular' : 'Helvetica';

      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(40, 36, doc.page.width - 80, 64).fill('#7B2FBE');
      doc
        .fillColor('#F8FAFC')
        .font(boldFont)
        .fontSize(18)
        .text(`${BRANDING.projectName} — GLOBAL OWNER REPORT`, 54, 50);
      doc
        .fillColor('#22D3EE')
        .font(regFont)
        .fontSize(10)
        .text(`${BRANDING.creatorIdentity} | Total Servers: ${report.totalGuilds} | Total Staff: ${report.totalStaff}`, 54, 75);

      doc.image(chartPng, 40, 118, { width: doc.page.width - 80 });

      const bottomY = doc.page.height - 36;
      doc.rect(40, bottomY - 6, doc.page.width - 80, 24).fill('#211238');
      doc
        .fillColor('#22D3EE')
        .font(boldFont)
        .fontSize(9)
        .text(PERMANENT_EMBED_FOOTER, 52, bottomY, { lineBreak: false });

      doc.end();
    });
  }
}
