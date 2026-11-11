import { IRelationalDatabase } from '../database/connection';
import { ChannelPermissionCheck } from '../tickets/ITicketAdapter';
import { logger } from '../utils/logger';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { GuildMemberSnapshot } from './RosterService';
import { GuildScanReport, ScannerService } from './ScannerService';
import { SystemSettingsService } from './SystemSettingsService';

export interface LiveGuildScanContext {
  liveMembers?: readonly GuildMemberSnapshot[];
  livePermissionChecks?: readonly ChannelPermissionCheck[];
  roleHoldersMap?: ReadonlyMap<string, readonly string[]>;
}

export type LiveGuildContextProvider = (guildId: string) => Promise<LiveGuildScanContext>;

export class SchedulerService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly scanner: ScannerService;
  private readonly settings: SystemSettingsService | null;
  private timer: NodeJS.Timeout | null = null;
  private contextProvider: LiveGuildContextProvider | null = null;
  private isTickRunning = false;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    scanner: ScannerService,
    settings: SystemSettingsService | null = null,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.scanner = scanner;
    this.settings = settings;
  }

  public setLiveContextProvider(provider: LiveGuildContextProvider): void {
    this.contextProvider = provider;
  }

  /**
   * Ensures every registered guild has a persistent schedule entry in `scheduler_locks`,
   * preserving existing `next_run_at` across bot restarts.
   */
  public initializeSchedules(nowIso = new Date().toISOString()): void {
    const guilds = this.guildConfig.listAllGuilds();
    const nowMs = Date.parse(nowIso);

    for (const guild of guilds) {
      const lockName = `guild-scan:${guild.guild_id}`;
      const existing = this.db.get<{ next_run_at: string | null }>(
        'SELECT next_run_at FROM scheduler_locks WHERE lock_name = ?',
        [lockName],
      );

      if (!existing || !existing.next_run_at) {
        const nextRunIso = new Date(nowMs + guild.scan_interval_minutes * 60_000).toISOString();
        this.db.run(
          `INSERT INTO scheduler_locks (lock_name, next_run_at, run_count)
           VALUES (?, ?, 0)
           ON CONFLICT(lock_name) DO UPDATE SET
             next_run_at = COALESCE(scheduler_locks.next_run_at, excluded.next_run_at)`,
          [lockName, nextRunIso],
        );
      }
    }
  }

  /**
   * Evaluates all guild schedules and executes any due scans safely without overlap.
   */
  public async runDueTasks(nowIso = new Date().toISOString()): Promise<GuildScanReport[]> {
    if (this.isTickRunning) {
      return [];
    }
    if (this.settings?.getBoolean('monitoring_paused_globally')) {
      logger.warn('Scheduled scans skipped: global monitoring pause is active');
      return [];
    }
    this.isTickRunning = true;
    const reports: GuildScanReport[] = [];

    try {
      this.initializeSchedules(nowIso);
      const guilds = this.guildConfig.listAllGuilds();

      for (const guild of guilds) {
        if (!this.features.isEnabled(guild.guild_id, 'scheduled_scanning')) {
          continue;
        }

        const lockName = `guild-scan:${guild.guild_id}`;
        const schedule = this.db.get<{
          next_run_at: string | null;
          holder_id: string | null;
          expires_at: string | null;
        }>('SELECT next_run_at, holder_id, expires_at FROM scheduler_locks WHERE lock_name = ?', [lockName]);

        if (!schedule?.next_run_at || schedule.next_run_at > nowIso) {
          continue;
        }

        let liveCtx: LiveGuildScanContext = {};
        if (this.contextProvider) {
          try {
            liveCtx = await this.contextProvider(guild.guild_id);
          } catch (err) {
            logger.error({ err, guildId: guild.guild_id }, 'Error fetching live Discord context during scheduled scan');
          }
        }

        try {
          const report = await this.scanner.scanGuildRoster(guild.guild_id, {
            trigger: 'SCHEDULED',
            nowIso,
            liveMembers: liveCtx.liveMembers,
            livePermissionChecks: liveCtx.livePermissionChecks,
            roleHoldersMap: liveCtx.roleHoldersMap,
          });
          if (!report.skippedByLock) {
            reports.push(report);
          }
        } catch (err) {
          logger.error({ err, guildId: guild.guild_id }, 'Scheduled guild scan failed');
        }
      }
    } finally {
      this.isTickRunning = false;
    }

    return reports;
  }

  public start(tickSeconds = 60): void {
    if (this.timer) return;
    this.initializeSchedules();
    // Run immediate startup recovery check for any scans missed while offline
    void this.runDueTasks().catch((err) => {
      logger.error({ err }, 'Startup recovery scan check error');
    });

    this.timer = setInterval(() => {
      void this.runDueTasks().catch((err) => {
        logger.error({ err }, 'Periodic scheduler tick error');
      });
    }, Math.max(10, tickSeconds) * 1000);
    this.timer.unref?.();
    logger.info({ tickSeconds }, 'Persistent roster scan scheduler started');
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Persistent roster scan scheduler stopped');
    }
  }

  public getSchedulerStatus(): Array<{
    lock_name: string;
    last_run_at: string | null;
    next_run_at: string | null;
    run_count: number;
    last_status: string | null;
    last_error: string | null;
  }> {
    return this.db.all(
      `SELECT lock_name, last_run_at, next_run_at, run_count, last_status, last_error
       FROM scheduler_locks ORDER BY lock_name ASC`,
    );
  }
}
