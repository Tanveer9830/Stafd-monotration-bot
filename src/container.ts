import { AppConfig, loadAppConfig } from './config/env';
import { DatabaseBackupService } from './database/backup';
import { SqliteDatabase } from './database/connection';
import { MigrationRunner } from './database/migrator';
import { ActivityClassifierService } from './services/ActivityClassifierService';
import { AuthzService } from './services/AuthzService';
import { AutoClaimService } from './services/AutoClaimService';
import { PlatformEventBus } from './services/PlatformEventBus';
import { SystemSettingsService } from './services/SystemSettingsService';
import { WebRoleService } from './services/WebRoleService';
import { AnalyticsService } from './services/AnalyticsService';
import { AuditService } from './services/AuditService';
import { FeatureService } from './services/FeatureService';
import { GuildConfigService } from './services/GuildConfigService';
import { LeaveService } from './services/LeaveService';
import { IDiscordDeliveryAdapter, NotificationService } from './services/NotificationService';
import { PermissionService } from './services/PermissionService';
import { RateLimiterService } from './services/RateLimiterService';
import { ReportExportService } from './services/ReportExportService';
import { ReviewService } from './services/ReviewService';
import { RosterService } from './services/RosterService';
import { ScannerService } from './services/ScannerService';
import { StaffDiscoveryService } from './services/StaffDiscoveryService';
import { StaffDiscoverySessionService } from './services/StaffDiscoverySessionService';
import { SchedulerService } from './services/SchedulerService';
import { TicketService } from './services/TicketService';
import { WarningService } from './services/WarningService';

export interface PlatformContainer {
  readonly config: AppConfig;
  readonly db: SqliteDatabase;
  readonly migrator: MigrationRunner;
  readonly backups: DatabaseBackupService;
  readonly audit: AuditService;
  readonly guildConfig: GuildConfigService;
  readonly features: FeatureService;
  readonly permissions: PermissionService;
  readonly rateLimiter: RateLimiterService;
  readonly roster: RosterService;
  readonly classifier: ActivityClassifierService;
  readonly tickets: TicketService;
  readonly leave: LeaveService;
  readonly notifications: NotificationService;
  readonly warnings: WarningService;
  readonly reviews: ReviewService;
  readonly scanner: ScannerService;
  readonly staffDiscovery: StaffDiscoveryService;
  readonly discoverySessions: StaffDiscoverySessionService;
  readonly scheduler: SchedulerService;
  readonly analytics: AnalyticsService;
  readonly reportExporter: ReportExportService;
  readonly webRoles: WebRoleService;
  readonly authz: AuthzService;
  readonly settings: SystemSettingsService;
  readonly eventBus: PlatformEventBus;
  readonly autoClaim: AutoClaimService;
  shutdown(): void;
}

export function createPlatformContainer(
  customConfig?: AppConfig,
  deliveryAdapter?: IDiscordDeliveryAdapter,
): PlatformContainer {
  const config = customConfig ?? loadAppConfig();
  const db = new SqliteDatabase(config.databasePath);
  const migrator = new MigrationRunner(db);
  migrator.runMigrations();

  const backups = new DatabaseBackupService(db, config.databaseBackupDir);
  const audit = new AuditService(db);
  const guildConfig = new GuildConfigService(db, audit);
  const features = new FeatureService(db, guildConfig, audit);
  const permissions = new PermissionService(db, guildConfig, audit);
  const rateLimiter = new RateLimiterService();
  const roster = new RosterService(db, guildConfig, features, audit);
  const classifier = new ActivityClassifierService(db, guildConfig, features, roster);
  const tickets = new TicketService(db, guildConfig, features, roster, classifier, audit);
  const leave = new LeaveService(db, guildConfig, audit);
  const notifications = new NotificationService(db, guildConfig, deliveryAdapter);
  const warnings = new WarningService(db, guildConfig, features, permissions, notifications, audit);
  const reviews = new ReviewService(
    db,
    guildConfig,
    features,
    permissions,
    roster,
    tickets,
    leave,
    warnings,
    notifications,
    classifier,
    audit,
  );
  const staffDiscovery = new StaffDiscoveryService(db, guildConfig, roster, audit);
  const discoverySessions = new StaffDiscoverySessionService();
  const scanner = new ScannerService(
    db,
    guildConfig,
    features,
    roster,
    tickets,
    leave,
    warnings,
    reviews,
    audit,
  );
  const settings = new SystemSettingsService(db, audit);
  const scheduler = new SchedulerService(db, guildConfig, features, scanner, settings);
  const analytics = new AnalyticsService(db, guildConfig, features, roster, tickets);
  const reportExporter = new ReportExportService(features);
  const eventBus = new PlatformEventBus();
  const webRoles = new WebRoleService(db, guildConfig, audit);
  const authz = new AuthzService(db, guildConfig, webRoles, audit);
  const autoClaim = new AutoClaimService(db, tickets, roster, audit, settings, eventBus);
  tickets.setEventListener((event) => {
    eventBus.publish({
      type: event.type,
      guildId: event.guildId,
      ticketId: event.ticketId,
      at: event.at,
      data: event.data,
    });
  });

  return {
    config,
    db,
    migrator,
    backups,
    audit,
    guildConfig,
    features,
    permissions,
    rateLimiter,
    roster,
    classifier,
    tickets,
    leave,
    notifications,
    warnings,
    reviews,
    scanner,
    staffDiscovery,
    discoverySessions,
    scheduler,
    analytics,
    reportExporter,
    webRoles,
    authz,
    settings,
    eventBus,
    autoClaim,
    shutdown(): void {
      scheduler.stop();
      autoClaim.stop();
      db.close();
    },
  };
}
