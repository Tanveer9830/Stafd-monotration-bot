import http, { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PlatformContainer } from '../container';
import { WebApi, toHttpError } from './WebApi';
import { DiscordOAuthClient } from './DiscordOAuthClient';
import { DatabaseWebProvider, DiscordJsWebProvider, WebDiscordProvider } from './DiscordWebProvider';
import { WebSessionService } from './WebSessionService';
import { createAppLogger } from '../utils/logger';
import {
  RequestContext,
  SESSION_COOKIE,
  clearCookie,
  clientIp,
  isMutating,
  parseCookies,
  readJsonBody,
  redirect,
  sameOrigin,
  securityHeaders,
  sendError,
  sendJson,
  serializeCookie,
  setCookie,
} from './http';

export interface WebServerOptions {
  container: PlatformContainer;
  host?: string;
  port?: number;
  baseUrl?: string;
  publicDir?: string;
  discordClient?: unknown;
  oauth?: DiscordOAuthClient | null;
  secureCookies?: boolean;
  trustProxy?: boolean;
}

export interface StartedWebServer {
  server: http.Server;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  public check(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
  }

  public prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolvePublicDir(explicit?: string): string {
  const candidates = [
    explicit,
    path.resolve(process.cwd(), 'public'),
    path.resolve(__dirname, '../../public'),
    path.resolve(__dirname, '../../../../public'),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return path.resolve(process.cwd(), 'public');
}

function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value.slice(0, 300);
}

export function createWebRequestHandler(options: WebServerOptions): http.RequestListener {
  const { container } = options;
  const log = createAppLogger(container.config.logLevel);
  const publicDir = resolvePublicDir(options.publicDir);
  const baseUrl = options.baseUrl ?? container.config.webBaseUrl;
  const secureCookies =
    options.secureCookies ??
    (container.config.cookieSecure === 'true' ||
      (container.config.cookieSecure === 'auto' && baseUrl.startsWith('https://')));
  const trustProxy = options.trustProxy ?? container.config.webTrustProxy;
  const sessionService = new WebSessionService(container.db, container.audit);
  const oauth = options.oauth ?? null;
  const api = new WebApi();
  const limiter = new RateLimiter();
  const allowedHosts = [baseUrl];

  let provider: WebDiscordProvider;
  if (options.discordClient) {
    provider = new DiscordJsWebProvider(options.discordClient as never, container.roster);
  } else {
    provider = new DatabaseWebProvider(container.db, container.guildConfig, container.roster);
  }
  container.authz.setOwnershipProvider({
    getGuildOwnerId: (guildId: string) => provider.getGuildOwnerId(guildId),
  });

  const apiDeps = { container, provider, sessionService };
  const cleanupTimer = setInterval(() => {
    limiter.prune();
    try {
      sessionService.cleanupExpired();
      oauth?.cleanupStates();
    } catch (err) {
      log.warn({ err }, 'Web cleanup pass failed');
    }
  }, 15 * 60_000);
  cleanupTimer.unref?.();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    securityHeaders(res);
    const ip = clientIp(req, trustProxy);
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      sendError(res, 400, 'Malformed request URL.');
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const session = sessionService.resolveSession(token);

    const ctx: RequestContext = {
      req,
      res,
      url,
      params: {},
      session,
      ip,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      cookies,
      body: {},
    };

    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    try {
      // ---------------------------------------------------------------- OAuth
      if (pathname === '/auth/login' && method === 'GET') {
        if (!limiter.check(`login:${ip}`, 20, 60_000)) {
          sendError(res, 429, 'Too many sign-in attempts. Wait a minute and try again.');
          return;
        }
        if (!oauth || !oauth.isConfigured) {
          redirect(res, '/?auth_error=oauth_not_configured');
          return;
        }
        const { url: authorizeUrl } = oauth.createAuthorizeUrl(sanitizeReturnTo(url.searchParams.get('return')));
        redirect(res, authorizeUrl);
        return;
      }

      if (pathname === '/auth/callback' && method === 'GET') {
        if (!oauth || !oauth.isConfigured) {
          redirect(res, '/?auth_error=oauth_not_configured');
          return;
        }
        const state = url.searchParams.get('state') ?? '';
        const code = url.searchParams.get('code') ?? '';
        const returnTo = oauth.consumeState(state);
        if (returnTo === null) {
          container.audit.log({
            guildId: null,
            actorUserId: 'UNKNOWN',
            actionCategory: 'WEB_SESSION',
            actionType: 'OAUTH_STATE_REJECTED',
            metadata: { ipHash: null },
          });
          redirect(res, '/?auth_error=invalid_state');
          return;
        }
        if (!code) {
          redirect(res, '/?auth_error=access_denied');
          return;
        }
        try {
          const accessToken = await oauth.exchangeCode(code);
          const user = await oauth.fetchUser(accessToken);
          const ttlHours = container.settings.getNumber('web_session_hours');
          const created = sessionService.createSession(
            { id: user.id, username: user.username, globalName: user.global_name ?? null, avatarUrl: oauth.avatarUrl(user) },
            { ttlHours, ip, userAgent: ctx.userAgent },
          );
          setCookie(
            res,
            serializeCookie(SESSION_COOKIE, created.token, {
              maxAgeSeconds: ttlHours * 3600,
              secure: secureCookies,
              httpOnly: true,
              sameSite: 'Lax',
            }),
          );
          redirect(res, returnTo);
        } catch (err) {
          log.warn({ err }, 'Discord OAuth callback failed');
          redirect(res, `/?auth_error=${encodeURIComponent(err instanceof Error ? err.message : 'oauth_failed')}`);
        }
        return;
      }

      if (pathname === '/auth/logout' && method === 'POST') {
        if (!sameOrigin(req, allowedHosts)) {
          sendError(res, 403, 'Cross-origin logout blocked.');
          return;
        }
        if (session) {
          const provided = req.headers['x-csrf-token'];
          const csrf = Array.isArray(provided) ? provided[0] : provided;
          if (!csrf || csrf !== session.csrfToken) {
            sendError(res, 403, 'CSRF validation failed.');
            return;
          }
        }
        if (token) sessionService.revokeByToken(token, 'User signed out');
        clearCookie(res, SESSION_COOKIE, secureCookies);
        sendJson(res, 200, { ok: true, data: { signedOut: true } });
        return;
      }

      // ------------------------------------------------------------------ SSE
      if (pathname === '/api/events' && method === 'GET') {
        if (!session) {
          sendError(res, 401, 'Authentication required.');
          return;
        }
        const guildId = url.searchParams.get('guildId') ?? '';
        try {
          const access = await container.authz.resolveGuildAccess(session.user_id, guildId);
          if (!access.localScopes.has('SERVER_VIEW_TICKETS') && !access.localScopes.has('SERVER_VIEW_OVERVIEW')) {
            throw new Error('Forbidden');
          }
        } catch {
          sendError(res, 403, 'You do not have access to this server stream.');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`retry: 5000\n\nevent: ready\ndata: ${JSON.stringify({ guildId, at: new Date().toISOString() })}\n\n`);
        let eventId = 0;
        const unsubscribe = container.eventBus.subscribe((event) => {
          if (event.guildId && event.guildId !== guildId) return;
          eventId += 1;
          res.write(`id: ${eventId}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => {
          if (!sessionService.resolveSession(token)) {
            res.write('event: auth_expired\ndata: {}\n\n');
            cleanup();
            res.end();
            return;
          }
          res.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
        }, 25_000);
        heartbeat.unref?.();
        let closed = false;
        function cleanup() {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        }
        req.on('close', cleanup);
        res.on('close', cleanup);
        return;
      }

      // ------------------------------------------------------------------ API
      if (pathname.startsWith('/api/')) {
        if (isMutating(method)) {
          if (!sameOrigin(req, allowedHosts)) {
            sendError(res, 403, 'Cross-origin request blocked.');
            return;
          }
          if (session && !limiter.check(`mutate:${session.user_id}`, 90, 60_000)) {
            sendError(res, 429, 'Too many changes in a short period. Please slow down.');
            return;
          }
          ctx.body = await readJsonBody(req);
        }
        await api.handle(ctx, apiDeps);
        return;
      }

      // -------------------------------------------------------------- logout page
      if (pathname === '/logout') {
        redirect(res, '/');
        return;
      }

      // ---------------------------------------------------------------- static
      if (method === 'GET' || method === 'HEAD') {
        const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(publicDir, safePath === '/' ? 'index.html' : safePath);
        if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const body = fs.readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
            'Content-Length': body.length,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
          });
          res.end(method === 'HEAD' ? undefined : body);
          return;
        }
        if (!path.extname(pathname)) {
          const indexPath = path.join(publicDir, 'index.html');
          if (fs.existsSync(indexPath)) {
            const body = fs.readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(method === 'HEAD' ? undefined : body);
            return;
          }
        }
        sendError(res, 404, 'Not found.');
        return;
      }

      sendError(res, 405, 'Method not allowed.');
    } catch (err) {
      const { status, message } = toHttpError(err);
      if (status >= 500) log.error({ err }, 'Website request failed');
      if (!res.headersSent) sendError(res, status, message);
      else res.end();
    }
  };
}

export async function startWebServer(options: WebServerOptions): Promise<StartedWebServer> {
  const host = options.host ?? options.container.config.webHost;
  const port = options.port ?? options.container.config.webPort;
  const baseUrl = options.baseUrl ?? options.container.config.webBaseUrl;
  const server = http.createServer(createWebRequestHandler({ ...options, host, port, baseUrl }));
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    host,
    port: actualPort,
    url: baseUrl,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        setTimeout(() => resolve(), 3000).unref?.();
      }),
  };
}

