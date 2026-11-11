import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { DatabaseBackupService } from '../database/backup';
import { emojis } from '../config/emojis';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { generateEntityId } from '../utils/ids';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const backupCommand: SlashCommandModule = {
  name: 'backup',
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Database backup and recovery (Global Owner only)')
    .addSubcommand((sub) => sub.setName('create').setDescription('Create an atomic database backup'))
    .addSubcommand((sub) => sub.setName('list').setDescription('List available backups'))
    .addSubcommand((sub) =>
      sub
        .setName('restore')
        .setDescription('Restore database from a backup file')
        .addStringOption((opt) =>
          opt.setName('filename').setDescription('Backup filename to restore').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('verify')
        .setDescription('Verify backup integrity')
        .addStringOption((opt) =>
          opt.setName('filename').setDescription('Backup filename to verify').setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    const actorId = interaction.user.id;

    // Global Owner only for all backup operations
    if (!isPermanentGlobalOwner(actorId)) {
      assertAuthorizedOrDenied({
        actorUserId: actorId,
        actorTag: interaction.user.tag,
        guildId: interaction.guildId ?? null,
        actionDescription: '/backup',
        requiredBy: 'GLOBAL_OWNER',
        audit: container.audit,
      });
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const meta = await container.backups.createBackup('global-owner-command');

      const backupId = generateEntityId('BAK');
      container.db.run(
        `INSERT INTO backup_records (backup_id, guild_id, filename, full_path, size_bytes, label, integrity_ok, created_by, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, 1, 1, ?, ?, ?)`,
        [backupId, meta.filename, meta.fullPath, meta.sizeBytes, GLOBAL_OWNER_ID, meta.createdAt, meta.createdAt],
      );

      container.audit.log({
        actorUserId: actorId,
        actionCategory: 'BACKUP',
        actionType: 'BACKUP_CREATED',
        targetType: 'BACKUP',
        targetId: backupId,
        after: meta,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Verified Atomic SQLite Backup Created`,
        tone: 'success',
        description:
          `**Filename:** \`${meta.filename}\`\n**Size:** ${meta.sizeBytes} bytes\n**Integrity Check:** OK\n**Backup ID:** \`${backupId}\``,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'list') {
      const backups = container.backups.listBackups();
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Available Backups (${backups.length})`,
        tone: 'cyan',
        description:
          backups.length === 0
            ? 'No backups available.'
            : backups
                .map(
                  (b) =>
                    `• \`${b.filename}\` — ${b.sizeBytes} bytes | Created: ${b.createdAt.slice(0, 10)} | Integrity: ${b.integrityOk ? 'OK' : 'FAILED'}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'restore') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const filename = interaction.options.getString('filename', true).trim();
      const backups = container.backups.listBackups();
      const backup = backups.find((b) => b.filename === filename);
      if (!backup) {
        throw new Error(`Backup file \`${filename}\` not found.`);
      }

      const dbPath = container.config.databasePath;
      const safetyDir = container.config.databaseBackupDir;
      const result = DatabaseBackupService.restoreFromBackupFile(backup.fullPath, dbPath, safetyDir);

      container.audit.log({
        actorUserId: actorId,
        actionCategory: 'BACKUP',
        actionType: 'BACKUP_RESTORED',
        targetType: 'BACKUP',
        targetId: filename,
        after: { restoredPath: result.restoredPath, snapshotPath: result.preRestoreSnapshotPath },
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Database Restored`,
        tone: 'success',
        description: `Database restored from \`${filename}\`.\nPre-restore snapshot: ${result.preRestoreSnapshotPath ?? 'None (no existing database)'}`,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'verify') {
      const filename = interaction.options.getString('filename', true).trim();
      const backups = container.backups.listBackups();
      const backup = backups.find((b) => b.filename === filename);
      if (!backup) {
        throw new Error(`Backup file \`${filename}\` not found.`);
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Backup Integrity Verification`,
        tone: backup.integrityOk ? 'success' : 'danger',
        description:
          `**Filename:** \`${backup.filename}\`\n**Size:** ${backup.sizeBytes} bytes\n**Integrity Check:** ${backup.integrityOk ? '✅ OK' : '❌ FAILED'}`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
