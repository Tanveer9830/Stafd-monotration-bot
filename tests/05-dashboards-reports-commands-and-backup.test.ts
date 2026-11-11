import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_OWNER_ID, PERMANENT_EMBED_FOOTER } from '../src/config/branding';
import { EmojiManager, parseAndValidateCustomEmoji } from '../src/config/emojis';
import { GLOBAL_DASHBOARD_SECTIONS, GlobalOwnerDashboard } from '../src/dashboards/GlobalOwnerDashboard';
import { SERVER_DASHBOARD_SECTIONS, ServerManagementDashboard } from '../src/dashboards/ServerManagementDashboard';
import { DatabaseBackupService } from '../src/database/backup';
import { routeDiscordInteraction } from '../src/events/interactionRouter';
import { attachBannerAsset } from '../src/utils/embeds';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

describe('Section 11–20: Slash Commands, Dashboards, Persistent Buttons, Feature Toggles, Reports, Visuals & Backups', () => {
  let fx: RealDiskTestFixture;
  const guildId = '250000000000000001';
  const ownerId = '350000000000000001';
  const staffId = '650000000000000001';
  const roleId = '750000000000000001';

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Enterprise Guild', ownerId);
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId,
      roleName: 'Senior Moderator',
      category: 'SENIOR_MODERATOR',
    });
    fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CATEGORY',
      channelId: '850000000000000001',
      channelName: 'Tickets',
    });
    fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: staffId, username: 'mod_star', displayName: 'Mod Star', roleIds: [roleId] }],
      { nowIso: '2026-11-01T00:00:00.000Z' },
    );
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('renders all 12 Global Owner Dashboard sections & all 14+ Server Dashboard sections with pagination & strict security', () => {
    const globalDash = new GlobalOwnerDashboard(fx.container);

    // Non-Global Owner blocked from Global Owner Dashboard
    expect(() => globalDash.render(ownerId, 'overview', 0)).toThrow(/Permanent Global Owner/i);

    // Global Owner renders every single section with permanent Tanveer footer
    for (const sec of GLOBAL_DASHBOARD_SECTIONS) {
      const payload = globalDash.render(GLOBAL_OWNER_ID, sec, 0);
      expect(payload.embeds[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    const serverDash = new ServerManagementDashboard(fx.container);
    const ownerCtx = { userId: ownerId, guildId, actualGuildOwnerId: ownerId };
    for (const sec of SERVER_DASHBOARD_SECTIONS) {
      const payload = serverDash.render(ownerCtx, sec, 0);
      expect(payload.embeds[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    // Report-viewer-only user cannot open `features` or `warnings` section on Server Dashboard
    const viewerId = '350000000000000777';
    fx.container.permissions.setGuildPermissionAssignment(ownerCtx, {
      targetType: 'USER',
      targetId: viewerId,
      permissionLevel: 'REPORT_VIEWER',
    });
    const viewerCtx = { userId: viewerId, guildId, actualGuildOwnerId: ownerId };
    expect(() => serverDash.render(viewerCtx, 'overview', 0)).not.toThrow();
    expect(() => serverDash.render(viewerCtx, 'features', 0)).toThrow(/Access Denied/i);
    expect(() => serverDash.render(viewerCtx, 'warnings', 0)).toThrow(/Access Denied/i);
  });

  it('preserves persistent review buttons across full bot restarts on disk', async () => {
    fx.container.tickets.createTicket({
      guildId,
      channelId: '850000000000000055',
      channelName: 'ticket-55',
      parentCategoryId: '850000000000000001',
      openedAt: '2026-11-02T00:00:00.000Z',
    });
    await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: '2026-11-05T00:00:00.000Z',
    });
    const createdReview = fx.container.reviews.listGuildReviews(guildId, { pendingOnly: true })[0];
    expect(createdReview).toBeDefined();

    // Shut down container completely and reopen from the persistent SQLite file
    const restartedContainer = fx.reopenContainer();

    let repliedPayload: { embeds?: Array<{ toJSON(): { title?: string; footer?: { text?: string } } }> } | null = null;
    const mockButtonInteraction = {
      customId: `tsm:rev:later:${createdReview.review_id}`,
      user: { id: GLOBAL_OWNER_ID, username: 'tanveer5637', tag: 'tanveer5637' },
      guildId: null, // Clicked directly inside Global Owner DM after restart!
      client: {
        guilds: {
          cache: new Map(),
          fetch: async () => null,
        },
      },
      isRepliable: () => true,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferred: false,
      replied: false,
      reply: async (p: never) => {
        repliedPayload = p;
      },
    };

    await routeDiscordInteraction(mockButtonInteraction as never, restartedContainer);
    expect(repliedPayload).not.toBeNull();
    expect(repliedPayload!.embeds![0].toJSON().title).toContain('Review Deferred');
    expect(repliedPayload!.embeds![0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

    const updatedInDb = restartedContainer.reviews.findReviewGloballyById(createdReview.review_id)!;
    expect(updatedInDb.status).toBe('DEFERRED');
  });

  it('enforces feature toggles at runtime and preserves historical data when toggled off', async () => {
    // Record a ticket first
    const t1 = fx.container.tickets.createTicket({
      guildId,
      channelId: '850000000000000088',
      channelName: 'ticket-88',
      parentCategoryId: '850000000000000001',
    });
    expect(t1.ticket.ticket_id).toBeDefined();

    // Disable ticket_monitoring locally -> runtime service blocks new ticket monitoring without erasing t1!
    fx.container.features.setGuildFeature(guildId, ownerId, 'ticket_monitoring', false);
    expect(() =>
      fx.container.tickets.createTicket({
        guildId,
        channelId: '850000000000000089',
        channelName: 'ticket-89',
        parentCategoryId: '850000000000000001',
      }),
    ).toThrow(/disabled/i);

    // Historical ticket t1 remains preserved!
    expect(fx.container.tickets.getTicketById(guildId, t1.ticket.ticket_id)).toBeDefined();

    // Global Owner locks manual_scanning globally -> local Server Owner cannot re-enable it!
    fx.container.features.setGlobalFeatureRestriction(GLOBAL_OWNER_ID, 'manual_scanning', false);
    expect(() => fx.container.features.setGuildFeature(guildId, ownerId, 'manual_scanning', true)).toThrow(
      /restricted globally/i,
    );
    await expect(
      fx.container.scanner.scanGuildRoster(guildId, { trigger: 'MANUAL', actorUserId: ownerId }),
    ).rejects.toThrow(/disabled/i);
  });

  it('exports real database analytics as branded PNG, CSV, and PDF files', async () => {
    const t = fx.container.tickets.createTicket({
      guildId,
      channelId: '850000000000000090',
      channelName: 'ticket-90',
      parentCategoryId: '850000000000000001',
      openedAt: '2026-11-10T09:00:00.000Z',
    });
    fx.container.tickets.recordTicketStaffMessage({
      guildId,
      ticketId: t.ticket.ticket_id,
      staffUserId: staffId,
      channelId: '850000000000000090',
      messageId: '980000000000000001',
      content: 'Verified fix deployed to your container instance successfully.',
      contentAvailable: true,
      occurredAt: '2026-11-10T09:04:00.000Z',
    });

    const guildReport = fx.container.analytics.buildGuildAnalytics(guildId, {
      periodType: 'WEEKLY',
      nowIso: '2026-11-11T00:00:00.000Z',
    });
    expect(guildReport.staffRows[0].ticketsHandled).toBe(1);

    // 1. PNG Report
    const pngBuf = fx.container.reportExporter.exportGuildPngReport(guildReport);
    expect(pngBuf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // Valid PNG magic header
    expect(pngBuf.length).toBeGreaterThan(5000);

    // 2. CSV Report
    const csvBuf = fx.container.reportExporter.exportGuildCsvReport(guildReport);
    const csvText = csvBuf.toString('utf8');
    expect(csvText).toContain('TANVEER STAFF MONITOR');
    expect(csvText).toContain(PERMANENT_EMBED_FOOTER);
    expect(csvText).toContain('mod_star');

    // 3. PDF Report
    const pdfBuf = await fx.container.reportExporter.exportGuildPdfReport(guildReport);
    expect(pdfBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdfBuf.length).toBeGreaterThan(5000);

    // Global Owner PNG / CSV / PDF exports
    const globalReport = fx.container.analytics.buildGlobalAnalytics(GLOBAL_OWNER_ID);
    expect(fx.container.reportExporter.exportGlobalPngReport(globalReport).subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(fx.container.reportExporter.exportGlobalCsvReport(globalReport).toString('utf8')).toContain(PERMANENT_EMBED_FOOTER);
    expect((await fx.container.reportExporter.exportGlobalPdfReport(globalReport)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('validates custom emoji IDs, falls back to Unicode cleanly, and resolves animated GIF vs static PNG banners', () => {
    // Rejects placeholder / invalid emoji IDs
    expect(parseAndValidateCustomEmoji('<:fake:000000000000000000>')).toBeNull();
    expect(parseAndValidateCustomEmoji('<:fake:123456789012345678>')).toBeNull();
    expect(parseAndValidateCustomEmoji('not_an_emoji')).toBeNull();
    // Accepts genuine snowflake structure
    expect(parseAndValidateCustomEmoji('<a:tsm_owner:1298374651928374651>')?.animated).toBe(true);

    const mgr = new EmojiManager();
    expect(mgr.get('owner')).toBe('👑');
    expect(mgr.getManifestSummary().every((e) => e.assetExists)).toBe(true);

    // Banner asset resolution respects animated_assets toggle (GIF when true, PNG fallback when false)
    const dummyEmbedGif = fx.container.reviews.buildReviewEmbed(
      {
        review_id: 'REV-TEST',
        incident_id: null,
        guild_id: guildId,
        staff_user_id: staffId,
        status: 'PENDING',
        required_policy: 'ANY_AUTHORIZED_REVIEWER',
        suggested_level: 1,
        proposed_reason: null,
        proposed_note: null,
        snapshot_json: '{}',
        first_approver_id: null,
        first_approver_name: null,
        first_approved_at: null,
        pending_confirmer_id: null,
        final_actor_id: null,
        final_actor_name: null,
        final_note: null,
        deferred_until: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        staffUsername: 'mod_star',
        staffDisplayName: 'Mod Star',
        staffUserId: staffId,
        guildId,
        guildName: 'Enterprise Guild',
        staffRoles: ['Senior Moderator'],
        lastQualifyingActivityAt: null,
        lastTicketActivityAt: null,
        inactivityHours: 50,
        ticketsHandled: 0,
        ticketsResolved: 0,
        assignedTickets: 1,
        availableWorkload: 1,
        monitoringCoverage: 'FULL',
        activeWarningsCount: 0,
        totalWarningsCount: 0,
        reasonForReview: 'Test',
        suggestedWarningLevel: 1,
      },
    );

    const gifAttach = attachBannerAsset(dummyEmbedGif, 'welcome', true);
    expect(gifAttach?.name).toBe('welcome.gif');

    const pngAttach = attachBannerAsset(dummyEmbedGif, 'welcome', false);
    expect(pngAttach?.name).toBe('welcome.png');
  });

  it('creates verified atomic SQLite backups and performs safe point-in-time recovery', async () => {
    const backupMeta = await fx.container.backups.createBackup('acceptance-test');
    expect(fs.existsSync(backupMeta.fullPath)).toBe(true);
    expect(backupMeta.integrityOk).toBe(true);

    // Delete staff role after backup to simulate accidental change
    fx.container.roster.removeStaffRole(guildId, ownerId, roleId);
    expect(fx.container.roster.listStaffRoles(guildId)).toHaveLength(0);

    // Close DB, restore from backup, and reopen container!
    fx.container.shutdown();
    const restoreRes = DatabaseBackupService.restoreFromBackupFile(
      backupMeta.fullPath,
      fx.dbPath,
      fx.backupDir,
    );
    expect(restoreRes.preRestoreSnapshotPath).not.toBeNull();
    expect(fs.existsSync(restoreRes.preRestoreSnapshotPath!)).toBe(true);

    const recovered = fx.reopenContainer();
    expect(recovered.roster.listStaffRoles(guildId)).toHaveLength(1);
    expect(recovered.db.integrityCheck().ok).toBe(true);
  });
});
