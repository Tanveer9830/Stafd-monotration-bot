import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../src/config/branding';
import { loadAppConfig } from '../src/config/env';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

describe('Section 3 & 20: Absolute Global Owner, Multi-Tier Permissions & Guild Isolation', () => {
  let fx: RealDiskTestFixture;

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('grants Global Owner status strictly and exclusively to exact ID "1131248987173814336"', () => {
    expect(GLOBAL_OWNER_ID).toBe('1131248987173814336');
    expect(isPermanentGlobalOwner('1131248987173814336')).toBe(true);
    expect(fx.container.permissions.isGlobalOwner('1131248987173814336')).toBe(true);

    // Rejects similar strings, numbers, server owners, other admins, or username spoofs
    expect(isPermanentGlobalOwner(1131248987173814336 as unknown)).toBe(false);
    expect(isPermanentGlobalOwner(' 1131248987173814336 ')).toBe(false);
    expect(isPermanentGlobalOwner('999999999999999999')).toBe(false);
    expect(isPermanentGlobalOwner('tanveer5637')).toBe(false);

    // Env override cannot alter permanent Global Owner ID
    const cfg = loadAppConfig({
      NODE_ENV: 'test',
      GLOBAL_OWNER_ID: '888888888888888888',
      DATABASE_PATH: fx.dbPath,
    });
    expect(cfg.globalOwnerId).toBe('1131248987173814336');

    // Rejects /tmp database path in production mode
    expect(() =>
      loadAppConfig({
        NODE_ENV: 'production',
        DATABASE_PATH: '/tmp/ephemeral.sqlite',
      }),
    ).toThrow(/persistent storage/i);
  });

  it('prevents Discord Server Owners or Bot Admins from becoming Global Owner or appointing Bot Admins', () => {
    const guildId = '200000000000000001';
    const serverOwnerId = '300000000000000001';
    const botAdminId = '400000000000000001';
    const otherUserId = '500000000000000001';

    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Alpha Server', serverOwnerId);

    // Server Owner cannot access Global Owner capabilities or appoint Bot Admins
    expect(() =>
      fx.container.permissions.addBotAdmin(serverOwnerId, botAdminId, 'sub_admin'),
    ).toThrow(/Permanent Global Owner/i);

    expect(() =>
      fx.container.guildConfig.updateGlobalSecurityConfig(serverOwnerId, {
        globalApprovalPolicy: 'GLOBAL_OWNER_REQUIRED',
      }),
    ).toThrow(/Permanent Global Owner/i);

    // Only Global Owner can appoint Bot Admin
    const appointed = fx.container.permissions.addBotAdmin(
      GLOBAL_OWNER_ID,
      botAdminId,
      'trusted_helper',
      ['VIEW_GLOBAL_STATS'],
    );
    expect(appointed.user_id).toBe(botAdminId);

    // Appointed Bot Admin CANNOT appoint another Bot Admin or Global Owner
    expect(() =>
      fx.container.permissions.addBotAdmin(botAdminId, otherUserId, 'rogue_admin'),
    ).toThrow(/Permanent Global Owner/i);

    // Appointed Bot Admin CANNOT access Global Owner Panel
    const botAdminPerms = fx.container.permissions.evaluateGuildPermissions({
      userId: botAdminId,
      guildId,
      actualGuildOwnerId: serverOwnerId,
    });
    expect(botAdminPerms.isGlobalOwner).toBe(false);
    expect(botAdminPerms.canAccessGlobalPanel).toBe(false);
    expect(botAdminPerms.canManageBotAdmins).toBe(false);
  });

  it('automatically grants local admin rights to actual Discord Guild Owner and updates on ownership transfer', () => {
    const guildId = '200000000000000002';
    const originalOwner = '300000000000000010';
    const newOwner = '300000000000000020';

    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Transfer Server', originalOwner);

    const p1 = fx.container.permissions.evaluateGuildPermissions({
      userId: originalOwner,
      guildId,
      actualGuildOwnerId: originalOwner,
    });
    expect(p1.isServerOwner).toBe(true);
    expect(p1.canConfigureGuild).toBe(true);
    expect(p1.canApproveWarnings).toBe(true);

    // Simulate Discord server ownership transfer to newOwner
    const pAfterOld = fx.container.permissions.evaluateGuildPermissions({
      userId: originalOwner,
      guildId,
      actualGuildOwnerId: newOwner,
    });
    expect(pAfterOld.isServerOwner).toBe(false);
    expect(pAfterOld.canConfigureGuild).toBe(false);

    const pAfterNew = fx.container.permissions.evaluateGuildPermissions({
      userId: newOwner,
      guildId,
      actualGuildOwnerId: newOwner,
    });
    expect(pAfterNew.isServerOwner).toBe(true);
    expect(pAfterNew.canConfigureGuild).toBe(true);
  });

  it('grants Co-Owner & Reviewer permissions strictly via configured User IDs and Role IDs, never role names', () => {
    const guildId = '200000000000000003';
    const ownerId = '300000000000000030';
    const coOwnerUserId = '300000000000000031';
    const reviewerRoleId = '700000000000000001';
    const unconfiguredAdminRoleId = '700000000000000999'; // Even if named "Co-Owner" in Discord
    const roleHolderUserId = '300000000000000032';
    const spoofRoleUserId = '300000000000000033';

    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Reviewer Server', ownerId);

    const ownerCtx = { userId: ownerId, guildId, actualGuildOwnerId: ownerId };
    fx.container.permissions.setGuildPermissionAssignment(ownerCtx, {
      targetType: 'USER',
      targetId: coOwnerUserId,
      permissionLevel: 'CO_OWNER',
    });
    fx.container.permissions.setGuildPermissionAssignment(ownerCtx, {
      targetType: 'ROLE',
      targetId: reviewerRoleId,
      permissionLevel: 'MANAGEMENT_REVIEWER',
    });

    // User holding unconfigured role ID gets zero privileges
    const spoofPerms = fx.container.permissions.evaluateGuildPermissions({
      userId: spoofRoleUserId,
      guildId,
      actualGuildOwnerId: ownerId,
      memberRoleIds: [unconfiguredAdminRoleId],
    });
    expect(spoofPerms.canApproveWarnings).toBe(false);
    expect(spoofPerms.canConfigureGuild).toBe(false);

    // Configured Co-Owner User ID & Reviewer Role ID work properly
    const coOwnerPerms = fx.container.permissions.evaluateGuildPermissions({
      userId: coOwnerUserId,
      guildId,
      actualGuildOwnerId: ownerId,
    });
    expect(coOwnerPerms.isCoOwner).toBe(true);
    expect(coOwnerPerms.canApproveWarnings).toBe(true);
    expect(coOwnerPerms.canConfigureGuild).toBe(true);

    const roleReviewerPerms = fx.container.permissions.evaluateGuildPermissions({
      userId: roleHolderUserId,
      guildId,
      actualGuildOwnerId: ownerId,
      memberRoleIds: [reviewerRoleId],
    });
    expect(roleReviewerPerms.isManagementReviewer).toBe(true);
    expect(roleReviewerPerms.canApproveWarnings).toBe(true);
    expect(roleReviewerPerms.canConfigureGuild).toBe(false);
  });

  it('includes Global Owner in notifications across every server regardless of local role and deduplicates overlaps', () => {
    const guildId = '200000000000000004';
    const ownerId = '300000000000000040';
    const coOwnerRoleId = '700000000000000044';
    const localManagerId = '300000000000000041';

    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Global Notify Guild', ownerId);
    fx.container.permissions.setGuildPermissionAssignment(
      { userId: ownerId, guildId, actualGuildOwnerId: ownerId },
      { targetType: 'ROLE', targetId: coOwnerRoleId, permissionLevel: 'CO_OWNER' },
    );

    // Case A: Global Owner has NO local role in the server — still included!
    const recipientsA = fx.container.permissions.resolveDeduplicatedReviewRecipients(
      guildId,
      new Map([[coOwnerRoleId, [localManagerId]]]),
    );
    expect(recipientsA).toContain(GLOBAL_OWNER_ID);
    expect(recipientsA).toContain(ownerId);
    expect(recipientsA).toContain(localManagerId);

    // Case B: Global Owner ALSO holds local Co-Owner role AND is assigned directly — deduplicated to 1 entry!
    fx.container.permissions.setGuildPermissionAssignment(
      { userId: ownerId, guildId, actualGuildOwnerId: ownerId },
      { targetType: 'USER', targetId: GLOBAL_OWNER_ID, permissionLevel: 'MANAGEMENT_REVIEWER' },
    );
    const recipientsB = fx.container.permissions.resolveDeduplicatedReviewRecipients(
      guildId,
      new Map([[coOwnerRoleId, [GLOBAL_OWNER_ID, localManagerId]]]),
    );
    const globalOwnerOccurrences = recipientsB.filter((id) => id === GLOBAL_OWNER_ID).length;
    expect(globalOwnerOccurrences).toBe(1);
  });

  it('strictly enforces guild isolation so Guild A Owner cannot view or modify Guild B private records', async () => {
    const guildA = '200000000000000100';
    const ownerA = '300000000000000100';
    const guildB = '200000000000000200';
    const ownerB = '300000000000000200';
    const staffB = '600000000000000200';

    fx.container.guildConfig.ensureGuildRegistered(guildA, 'Server A', ownerA);
    fx.container.guildConfig.ensureGuildRegistered(guildB, 'Server B', ownerB);

    const warnB = await fx.container.warnings.issueWarning({
      guildId: guildB,
      staffUserId: staffB,
      reason: 'Server B private warning',
      issuedById: ownerB,
      approverId: ownerB,
      approverDisplayName: 'OwnerB',
    });

    // Guild A query sees 0 warnings from Guild B
    expect(fx.container.warnings.listWarnings(guildA)).toHaveLength(0);
    expect(fx.container.warnings.getWarningById(guildA, warnB.warning_id)).toBeUndefined();

    // Owner A attempting to act inside Guild B is blocked
    expect(() =>
      fx.container.permissions.assertGuildCapability(
        { userId: ownerA, guildId: guildB, actualGuildOwnerId: ownerB },
        'canViewReports',
        'CROSS_GUILD_READ',
      ),
    ).toThrow(/Access Denied/i);

    // Guild A audit logs do not leak Guild B warning audit entry
    const logsA = fx.container.audit.listGuildLogs(guildA);
    expect(logsA.some((l) => l.target_id === warnB.warning_id)).toBe(false);
  });
});
