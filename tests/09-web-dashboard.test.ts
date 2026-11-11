import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_OWNER_ID } from '../src/config/branding';
import { startWebServer, StartedWebServer } from '../src/web/WebServer';
import { WebSessionService } from '../src/web/WebSessionService';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: unknown;
}

describe('Website dashboard authentication, authorization and CSRF', () => {
  let fx: RealDiskTestFixture;
  let server: StartedWebServer | null = null;
  let origin = '';
  const guildId = '260000000000000001';
  const ownerId = '360000000000000001';

  beforeEach(async () => {
    fx = createRealSqliteTestFixture();
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Web Test Guild', ownerId);
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId: '760000000000000001',
      roleName: 'Moderator',
      category: 'MODERATOR',
    });
    fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: '660000000000000001', username: 'web_mod', displayName: 'Web Mod', roleIds: ['760000000000000001'] }],
      { nowIso: '2026-11-01T00:00:00.000Z' },
    );
    server = await startWebServer({
      container: fx.container,
      host: '127.0.0.1',
      port: 0,
      baseUrl: 'http://127.0.0.1',
      publicDir: undefined,
      secureCookies: false,
      trustProxy: false,
      oauth: null,
    });
    origin = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    if (server) await server.close();
    fx.cleanup();
  });

  async function request(path: string, options: { method?: string; cookie?: string; csrf?: string; body?: unknown } = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.csrf) headers['X-CSRF-Token'] = options.csrf;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });
    const body = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body, json };
  }

  function createSessionFor(userId: string, username: string) {
    const service = new WebSessionService(fx.container.db, fx.container.audit);
    const created = service.createSession({ id: userId, username, avatarUrl: null }, { ttlHours: 1 });
    return created;
  }

  it('serves the branded dashboard shell and public configuration without authentication', async () => {
    const page = await request('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('TANVEER STAFF MONITOR');
    expect(page.body).toContain('Made by Tanveer');

    const config = await request('/api/public/config');
    expect(config.status).toBe(200);
    const data = (config.json as { data: { oauthConfigured: boolean } }).data;
    expect(data.oauthConfigured).toBe(false);
  });

  it('rejects unauthenticated API access and requires CSRF for mutations', async () => {
    const unauthenticated = await request('/api/me');
    expect(unauthenticated.status).toBe(401);

    const session = createSessionFor(GLOBAL_OWNER_ID, 'tanveer');
    const cookie = `tsm_session=${session.token}`;

    const me = await request('/api/me', { cookie });
    expect(me.status).toBe(200);
    expect((me.json as { data: { isGlobalOwner: boolean; csrfToken: string } }).data.isGlobalOwner).toBe(true);

    const noCsrf = await request(`/api/guilds/${guildId}/reviews/RVW-1/approve`, {
      method: 'POST',
      cookie,
      body: {},
    });
    expect(noCsrf.status).toBe(403);

    const withCsrf = await request(`/api/guilds/${guildId}/overview`, {
      cookie,
      csrf: session.csrfToken,
    });
    expect(withCsrf.status).toBe(200);
    expect((withCsrf.json as { data: { guild: { id: string } } }).data.guild.id).toBe(guildId);
  });

  it('denies global data to non-owners and keeps server data isolated', async () => {
    const other = createSessionFor(ownerId, 'server-owner');
    const cookie = `tsm_session=${other.token}`;

    const global = await request('/api/global/overview', { cookie });
    expect(global.status).toBe(403);

    const ownGuild = await request(`/api/guilds/${guildId}/overview`, { cookie });
    expect(ownGuild.status).toBe(200);

    const unknownGuild = await request('/api/guilds/999999999999999999/overview', { cookie });
    expect([403, 404]).toContain(unknownGuild.status);
  });

  it('revokes a session immediately for subsequent requests', async () => {
    const session = createSessionFor(ownerId, 'server-owner');
    const cookie = `tsm_session=${session.token}`;
    expect((await request('/api/me', { cookie })).status).toBe(200);

    const service = new WebSessionService(fx.container.db, fx.container.audit);
    expect(service.revokeSession(session.session.session_id, 'test revocation')).toBe(true);

    expect((await request('/api/me', { cookie })).status).toBe(401);
  });

  it('loads every dashboard data endpoint as the Global Owner without a server error', async () => {
    const session = createSessionFor(GLOBAL_OWNER_ID, 'tanveer');
    const cookie = `tsm_session=${session.token}`;
    const paths = [
      '/api/me',
      '/api/global/overview',
      '/api/global/guilds',
      '/api/global/admins',
      '/api/global/stats',
      '/api/global/audit?limit=10',
      '/api/system/health',
      '/api/system/backups',
      '/api/system/sessions',
      '/api/system/security',
      '/api/system/diagnostics',
      `/api/guilds/${guildId}/overview`,
      `/api/guilds/${guildId}/health`,
      `/api/guilds/${guildId}/tickets`,
      `/api/guilds/${guildId}/tickets/search?q=1`,
      `/api/guilds/${guildId}/ticket-analytics`,
      `/api/guilds/${guildId}/staff`,
      `/api/guilds/${guildId}/staff/660000000000000001`,
      `/api/guilds/${guildId}/activity`,
      `/api/guilds/${guildId}/analytics?period=WEEKLY`,
      `/api/guilds/${guildId}/reviews`,
      `/api/guilds/${guildId}/warnings`,
      `/api/guilds/${guildId}/appeals`,
      `/api/guilds/${guildId}/leave`,
      `/api/guilds/${guildId}/staff-roles`,
      `/api/guilds/${guildId}/access`,
      `/api/guilds/${guildId}/settings`,
      `/api/guilds/${guildId}/integrations`,
      `/api/guilds/${guildId}/reports?period=WEEKLY`,
      `/api/guilds/${guildId}/reports/export?format=csv&period=WEEKLY`,
      `/api/guilds/${guildId}/audit`,
      `/api/guilds/${guildId}/notifications`,
      `/api/guilds/${guildId}/roles`,
      `/api/guilds/${guildId}/members?q=web`,
    ];
    for (const path of paths) {
      const res = await request(path, { cookie, csrf: session.csrfToken });
      expect(res.status, `${path}: ${res.body.slice(0, 300)}`).toBe(200);
    }
  });

  it('persists a role assignment and blocks self-promotion through the API', async () => {
    const session = createSessionFor(ownerId, 'server-owner');
    const cookie = `tsm_session=${session.token}`;
    const assigned = await request(`/api/guilds/${guildId}/access`, {
      method: 'POST',
      cookie,
      csrf: session.csrfToken,
      body: {
        userId: '660000000000000001',
        username: 'web_mod',
        role: 'SERVER_VIEWER',
        permissions: ['SERVER_VIEW_OVERVIEW', 'SERVER_VIEW_STAFF'],
        reason: 'test assignment',
      },
    });
    expect(assigned.status, assigned.body).toBe(201);

    const selfPromotion = await request(`/api/guilds/${guildId}/access`, {
      method: 'POST',
      cookie,
      csrf: session.csrfToken,
      body: {
        userId: ownerId,
        username: 'server-owner',
        role: 'SERVER_CO_OWNER',
        permissions: ['SERVER_MANAGE_ROLES'],
      },
    });
    expect(selfPromotion.status).toBe(400);
    expect(selfPromotion.body).toMatch(/self|promotion|denied/i);
  });

  it('blocks cross-origin mutations with a non-matching Origin header', async () => {
    const session = createSessionFor(GLOBAL_OWNER_ID, 'tanveer');
    const res = await fetch(`${origin}/api/guilds/${guildId}/settings`, {
      method: 'PATCH',
      headers: {
        Cookie: `tsm_session=${session.token}`,
        'X-CSRF-Token': session.csrfToken,
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ atRiskHours: 1 }),
    });
    expect(res.status).toBe(403);
  });
});
