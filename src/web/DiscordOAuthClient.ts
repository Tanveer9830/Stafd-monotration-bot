import crypto from 'node:crypto';
import { IRelationalDatabase } from '../database/connection';

export interface DiscordOAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar: string | null;
}

export interface DiscordOAuthGuild {
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
  icon: string | null;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase?: string;
}

export class DiscordOAuthClient {
  private readonly db: IRelationalDatabase;
  private readonly config: OAuthConfig;
  private readonly apiBase: string;

  constructor(db: IRelationalDatabase, config: OAuthConfig) {
    this.db = db;
    this.config = config;
    this.apiBase = config.apiBase ?? 'https://discord.com/api/v10';
  }

  public get isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri);
  }

  public createAuthorizeUrl(returnTo = '/'): { url: string; state: string } {
    if (!this.isConfigured) {
      throw new Error('Discord OAuth2 is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and OAUTH2_REDIRECT_URI.');
    }
    const state = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    this.db.run(
      `INSERT INTO website_oauth_states (state, return_to, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      [state, returnTo.slice(0, 300), now.toISOString(), new Date(now.getTime() + 600_000).toISOString()],
    );
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
      prompt: 'consent',
    });
    return { url: `https://discord.com/oauth2/authorize?${params.toString()}`, state };
  }

  public consumeState(state: string): string | null {
    const row = this.db.get<{ state: string; return_to: string | null; expires_at: string; consumed_at: string | null }>(
      'SELECT state, return_to, expires_at, consumed_at FROM website_oauth_states WHERE state = ?',
      [state],
    );
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) return null;
    this.db.run('UPDATE website_oauth_states SET consumed_at = ? WHERE state = ?', [
      new Date().toISOString(),
      state,
    ]);
    return row.return_to ?? '/';
  }

  public cleanupStates(): void {
    this.db.run('DELETE FROM website_oauth_states WHERE expires_at <= ?', [new Date().toISOString()]);
  }

  public async exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });
    const res = await fetch(`${this.apiBase}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Discord OAuth token exchange failed (${res.status}). Check the client secret and redirect URI.`);
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('Discord OAuth token exchange returned no access token.');
    return data.access_token;
  }

  public async fetchUser(accessToken: string): Promise<DiscordOAuthUser> {
    const res = await fetch(`${this.apiBase}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Discord user lookup failed (${res.status}).`);
    return (await res.json()) as DiscordOAuthUser;
  }

  public async fetchUserGuilds(accessToken: string): Promise<DiscordOAuthGuild[]> {
    const res = await fetch(`${this.apiBase}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Discord guild lookup failed (${res.status}).`);
    return (await res.json()) as DiscordOAuthGuild[];
  }

  public avatarUrl(user: DiscordOAuthUser): string | null {
    if (!user.avatar) return null;
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
}
