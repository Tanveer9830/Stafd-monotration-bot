import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { ResolvedWebSession } from './WebSessionService';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  session: ResolvedWebSession | null;
  ip: string;
  userAgent: string;
  cookies: Record<string, string>;
  body: unknown;
}

export const SESSION_COOKIE = 'tsm_session';

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function setCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookie]);
  }
}

export function clearCookie(res: ServerResponse, name: string, secure = false): void {
  setCookie(res, serializeCookie(name, '', { maxAgeSeconds: 0, secure }));
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self' https://*.e2b.app",
  );
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, message: string, details?: unknown): void {
  sendJson(res, status, { ok: false, error: message, ...(details !== undefined ? { details } : {}) });
}

export function sendBinary(
  res: ServerResponse,
  status: number,
  buffer: Buffer,
  contentType: string,
  filename?: string,
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...(filename ? { 'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"` } : {}),
  });
  res.end(buffer);
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export async function readJsonBody(req: IncomingMessage, limitBytes = 256_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limitBytes) {
      throw Object.assign(new Error('Request body too large.'), { statusCode: 413 });
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function isMutating(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

export function sameOrigin(req: IncomingMessage, allowedHosts: readonly string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients still need the CSRF token
  try {
    const originUrl = new URL(origin);
    const host = req.headers.host ?? '';
    if (originUrl.host === host) return true;
    return allowedHosts.some((allowed) => {
      try {
        return new URL(allowed).host === originUrl.host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function asString(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 100) : [];
}

export function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function pagination(url: URL, defaultPageSize = 25): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(asNumber(url.searchParams.get('page'), 1)));
  const pageSize = Math.min(100, Math.max(1, Math.floor(asNumber(url.searchParams.get('pageSize'), defaultPageSize))));
  return { page, pageSize };
}
