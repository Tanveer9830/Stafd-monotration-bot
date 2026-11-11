'use strict';

/* ============================================================================
   TANVEER STAFF MONITOR — dashboard client
   Every number and row rendered here comes from a real API response. There are
   no sample datasets, demo statistics or placeholder handlers.
   ========================================================================== */

const state = {
  me: null,
  csrf: null,
  guildId: null,
  guild: null,
  page: 'overview',
  param: null,
  stream: null,
  streamGuild: null,
  pageData: {},
  modalOpen: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STATUS_LABELS = {
  ACTIVE: 'Active',
  AT_RISK: 'At risk',
  INACTIVE: 'Inactive',
  ON_LEAVE: 'On leave',
  UNKNOWN: 'Unknown',
  NEW_STAFF: 'New staff',
  INSUFFICIENT_WORKLOAD: 'Insufficient workload',
  MONITORING_ERROR: 'Monitoring error',
};
const STATUS_TONE = {
  ACTIVE: 'green',
  AT_RISK: 'amber',
  INACTIVE: 'red',
  ON_LEAVE: 'cyan',
  UNKNOWN: 'slate',
  NEW_STAFF: 'purple',
  INSUFFICIENT_WORKLOAD: 'amber',
  MONITORING_ERROR: 'red',
};
const ROLE_LABELS = {
  GLOBAL_OWNER: 'Global Owner',
  GLOBAL_ADMIN: 'Global Administrator',
  SERVER_OWNER: 'Server Owner',
  SERVER_CO_OWNER: 'Server Co-Owner',
  SERVER_ADMIN: 'Server Admin',
  SERVER_VIEWER: 'Server Viewer',
  STAFF_VIEWER: 'Staff Viewer',
  NONE: 'No website role',
};
const SCOPE_LABELS = {
  GLOBAL_VIEW_ALL: 'View all servers',
  GLOBAL_MANAGE_ADMINS: 'Manage administrators',
  GLOBAL_ANALYTICS: 'Global analytics',
  GLOBAL_VIEW_AUDIT: 'Global audit logs',
  GLOBAL_SYSTEM: 'System health & diagnostics',
  GLOBAL_BACKUP: 'Backups & recovery',
  GLOBAL_SECURITY: 'Sessions & security',
  GLOBAL_ANNOUNCE: 'Platform announcements',
  SERVER_VIEW_OVERVIEW: 'Server overview',
  SERVER_VIEW_STAFF: 'View staff',
  SERVER_MANAGE_STAFF: 'Manage staff roster',
  SERVER_VIEW_TICKETS: 'View tickets',
  SERVER_MANAGE_TICKETS: 'Manage tickets',
  SERVER_VIEW_TRANSCRIPTS: 'View transcripts',
  SERVER_VIEW_ANALYTICS: 'View analytics',
  SERVER_MANAGE_REVIEWS: 'Manage reviews',
  SERVER_MANAGE_WARNINGS: 'Manage warnings',
  SERVER_MANAGE_APPEALS: 'Manage appeals',
  SERVER_MANAGE_LEAVE: 'Manage leave',
  SERVER_MANAGE_SETTINGS: 'Manage settings',
  SERVER_MANAGE_ROLES: 'Manage access & roles',
  SERVER_VIEW_AUDIT: 'View audit log',
  SERVER_EXPORT_REPORTS: 'Export reports',
  SERVER_MANAGE_INTEGRATIONS: 'Manage integrations',
  STAFF_SELF_VIEW: 'View own staff record',
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, withTime
    ? { year: '2-digit', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: '2-digit' });
}

function relTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function dur(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function hours(value) {
  if (value === null || value === undefined) return '—';
  return `${num(value)}h`;
}

function initials(name) {
  return String(name ?? '?')
    .replace(/[^a-z0-9 ]/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

function badge(text, tone = 'slate') {
  return `<span class="badge ${esc(tone)}">${esc(text)}</span>`;
}

function statusBadge(status) {
  const key = String(status ?? 'UNKNOWN').toUpperCase();
  return badge(STATUS_LABELS[key] ?? key.replace(/_/g, ' '), STATUS_TONE[key] ?? 'slate');
}

function roleBadge(role) {
  const key = String(role ?? 'NONE');
  const tone = key === 'GLOBAL_OWNER' ? 'red'
    : key === 'GLOBAL_ADMIN' ? 'purple'
      : key === 'SERVER_OWNER' ? 'cyan'
        : key === 'SERVER_CO_OWNER' ? 'purple'
          : key === 'SERVER_ADMIN' ? 'amber' : 'slate';
  return badge(ROLE_LABELS[key] ?? key.replace(/_/g, ' '), tone);
}

function pageHead(title, subtitle, actions = '') {
  return `<div class="page-head">
    <div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

function statCard(label, value, sub, accent = 'purple') {
  return `<div class="card stat accent-${accent}">
    <span class="label">${esc(label)}</span>
    <span class="value">${esc(value)}</span>
    ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}
  </div>`;
}

function card(title, body, actions = '') {
  return `<section class="card">
    ${title ? `<div class="card-title"><h3>${esc(title)}</h3><div>${actions}</div></div>` : ''}
    ${body}
  </section>`;
}

function emptyState(title, detail) {
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(detail)}</div>`;
}

function loadingCards(count = 4) {
  return `<div class="grid cols-4">${Array.from({ length: count }, () => '<div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:10px;height:26px;width:60%"></div></div>').join('')}</div>`;
}

function toast(message, tone = 'info') {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4600);
}

function setView(html) {
  const view = $('#view');
  view.innerHTML = html;
  view.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openModal(title, bodyHtml, onSubmit) {
  state.modalOpen = true;
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = `${bodyHtml}${onSubmit ? `<div class="modal-actions"><button class="btn ghost" data-close="modal">Cancel</button><button class="btn primary" id="modalSubmit">Save</button></div>` : ''}`;
  $('#modalRoot').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (onSubmit) {
    const form = $('#modalForm');
    const submit = async () => {
      const button = $('#modalSubmit');
      button.disabled = true;
      try {
        const values = form ? Object.fromEntries(new FormData(form).entries()) : {};
        await onSubmit(values);
        closeModal();
      } catch (err) {
        toast(err.message || 'The change could not be saved.', 'error');
      } finally {
        button.disabled = false;
      }
    };
    $('#modalSubmit').addEventListener('click', submit);
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      const first = form.querySelector('input:not([type=hidden]), select, textarea');
      if (first) setTimeout(() => first.focus(), 60);
    }
  }
}

function closeModal() {
  state.modalOpen = false;
  $('#modalRoot').classList.add('hidden');
  document.body.style.overflow = '';
  $('#modalBody').innerHTML = '';
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (res.status === 401) {
    if (!options.silent401) showAuth(null, 'Your session expired. Sign in with Discord again.');
    throw new Error('Session expired.');
  }
  if (!res.ok || !payload || payload.ok === false) {
    const message = payload?.error || `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return payload.data;
}

function debounce(fn, wait = 320) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function downloadBase64(base64, filename, mime) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i가) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

function guild() {
  return state.me?.guilds?.find((g) => g.guild_id === state.guildId) ?? null;
}

function can(scope) {
  if (state.me?.isGlobalOwner) return true;
  return Boolean(guild()?.scopes?.includes(scope));
}

function requireCan(scope) {
  if (can(scope)) return true;
  setView(pageHead('Access Denied', 'This page requires a permission your website role does not include.') + `<div class="error-box">You need <code class="code">${esc(scope)}</code> in this server. Ask the Server Owner to review Access &amp; Roles.</div>`);
  return false;
}

function auditCell(log) {
  return `<div>${esc((log.action_type || '').replace(/_/g, ' '))}</div><span class="sub">${esc(log.action_category || '')}</span>`;
}

/* ============================================================================
   AUTH
   ========================================================================== */
async function showAuth(config, message) {
  $('#boot').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  const body = $('#authBody');
  let cfg = config;
  if (!cfg) {
    try { cfg = await api('/api/public/config'); } catch { cfg = { oauthConfigured: false }; }
  }
  if (!cfg.oauthConfigured) {
    body.innerHTML = `
      <div class="warn-box mb-0">
        <strong>Discord OAuth2 is not configured yet.</strong><br />
        Set these values in <code class="code">.env</code> and restart the bot, then reload this page:
      </div>
      <ul class="setup-list">
        <li><code class="code">DISCORD_CLIENT_ID</code> — your application client ID</li>
        <li><code class="code">DISCORD_CLIENT_SECRET</code> — OAuth2 client secret (never commit it)</li>
        <li><code class="code">WEB_BASE_URL</code> — public URL, e.g. <code class="code">https://staff.example.com</code></li>
        <li><code class="code">OAUTH2_REDIRECT_URI</code> — <code class="code">${esc(location.origin)}/auth/callback</code></li>
      </ul>
      <p class="small muted">In the Discord Developer Portal → OAuth2 → Redirects, add the exact redirect URL above.</p>
      ${message ? `<div class="error-box">${esc(message)}</div>` : ''}`;
    return;
  }
  body.innerHTML = `
    ${message ? `<div class="warn-box">${esc(message)}</div>` : ''}
    <p class="muted">Sign in with Discord to verify your identity. Your permissions are checked on every request against live Discord ownership and dashboard role assignments.</p>
    <button class="btn-discord" id="discordLogin">Continue with Discord</button>
    <p class="small muted mt-16 mb-0">We request <code class="code">identify</code> and <code class="code">guilds</code> only. The dashboard never receives your Discord password.</p>`;
  $('#discordLogin').addEventListener('click', () => {
    location.href = '/auth/login?return=' + encodeURIComponent(location.hash || '/');
  });
}

async function loadApp() {
  try {
    const me = await api('/api/me');
    state.me = me;
    state.csrf = me.csrfToken;
    $('#boot').classList.add('hidden');
    $('#authScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderChrome();
    await route(true);
  } catch (err) {
    if (err.message !== 'Session expired.') {
      $('#boot').classList.add('hidden');
      showAuth(null, err.message);
    }
  }
}

function renderChrome() {
  const me = state.me;
  $('#userName').textContent = me.user.username;
  $('#userRole').textContent = me.isGlobalOwner ? 'Permanent Global Owner' : (me.assignments.length ? ROLE_LABELS[me.assignments[0].role] : 'Verified Discord user');
  const avatar = $('#userAvatar');
  if (me.user.avatarUrl) { avatar.src = me.user.avatarUrl; avatar.style.display = ''; }
  else { avatar.style.display = 'none'; }
  $('#rolePill').textContent = me.isGlobalOwner ? 'GLOBAL OWNER' : (state.guild?.role ? ROLE_LABELS[state.guild.role]?.toUpperCase() : 'USER');

  const select = $('#guildSelect');
  select.innerHTML = `<option value="">Global / no server</option>${me.guilds.map((g) => `<option value="${esc(g.guild_id)}">${esc(g.guild_name)}</option>`).join('')}`;
  select.value = state.guildId || '';
  select.onchange = () => {
    if (!select.value) { location.hash = '#/global/overview'; return; }
    const target = me.guilds.find((g) => g.guild_id === select.value);
    const firstPage = target?.scopes.includes('SERVER_VIEW_OVERVIEW') ? 'overview'
      : target?.scopes.includes('SERVER_VIEW_TICKETS') ? 'tickets'
        : target?.scopes.includes('SERVER_VIEW_STAFF') ? 'staff' : 'my-profile';
    location.hash = `#/g/${select.value}/${firstPage}`;
  };
  renderNav();
}

function navItem(href, icon, label, active) {
  return `<a href="${esc(href)}" class="${active ? 'active' : ''}"><span class="ico">${icon}</span>${esc(label)}</a>`;
}

function renderNav() {
  const me = state.me;
  const nav = $('#nav');
  if (!me) return;
  const isOwner = me.isGlobalOwner;
  const g = guild();
  const hash = location.hash || '';
  const globalPages = [
    ['overview', '◎', 'Overview', isOwner || me.globalScopes.includes('GLOBAL_VIEW_ALL')],
    ['guilds', '▦', 'Servers', isOwner || me.globalScopes.includes('GLOBAL_VIEW_ALL')],
    ['analytics', '◫', 'Global analytics', isOwner || me.globalScopes.includes('GLOBAL_ANALYTICS')],
    ['admins', '♛', 'Administrators', isOwner || me.globalScopes.includes('GLOBAL_MANAGE_ADMINS')],
    ['audit', '☰', 'Global audit', isOwner || me.globalScopes.includes('GLOBAL_VIEW_AUDIT')],
    ['sessions', '◉', 'Sessions & security', true],
    ['health', '✚', 'System health', isOwner || me.globalScopes.includes('GLOBAL_SYSTEM')],
    ['backups', '▣', 'Backups', isOwner || me.globalScopes.includes('GLOBAL_BACKUP')],
  ];
  let html = `<div class="nav-group"><div class="nav-title">Platform</div>`;
  for (const [page, icon, label, allowed] of globalPages) {
    if (!allowed) continue;
    html += navItem(`#/global/${page}`, icon, label, hash.startsWith(`#/global/${page}`));
  }
  html += `</div>`;

  if (g) {
    const guildPages = [
      ['overview', '◎', 'Server overview', g.scopes.includes('SERVER_VIEW_OVERVIEW')],
      ['tickets', '🎫', 'Ticket browser', g.scopes.includes('SERVER_VIEW_TICKETS')],
      ['staff', '👥', 'Staff monitor', g.scopes.includes('SERVER_VIEW_STAFF')],
      ['my-profile', '◈', 'My staff record', g.scopes.includes('STAFF_SELF_VIEW') || g.scopes.includes('SERVER_VIEW_STAFF')],
      ['activity', '⚡', 'Activity timeline', g.scopes.includes('SERVER_VIEW_STAFF')],
      ['analytics', '◫', 'Analytics', g.scopes.includes('SERVER_VIEW_ANALYTICS')],
      ['reviews', '☑', 'Human reviews', g.scopes.includes('SERVER_MANAGE_REVIEWS')],
      ['warnings', '⚠', 'Warnings', g.scopes.includes('SERVER_VIEW_STAFF') || g.scopes.includes('SERVER_MANAGE_WARNINGS')],
      ['appeals', '⚖', 'Appeals', g.scopes.includes('SERVER_MANAGE_APPEALS')],
      ['leave', '☾', 'Leave', g.scopes.includes('SERVER_MANAGE_LEAVE') || g.scopes.includes('STAFF_SELF_VIEW')],
      ['staff-roles', '◆', 'Staff roles', g.scopes.includes('SERVER_MANAGE_STAFF')],
      ['access', '🛡', 'Access & roles', g.scopes.includes('SERVER_MANAGE_ROLES')],
      ['settings', '⚙', 'Settings', g.scopes.includes('SERVER_MANAGE_SETTINGS') || g.scopes.includes('SERVER_VIEW_OVERVIEW')],
      ['integrations', '⇄', 'Integrations', g.scopes.includes('SERVER_MANAGE_INTEGRATIONS') || g.scopes.includes('SERVER_VIEW_TICKETS')],
      ['reports', '⇩', 'Reports', g.scopes.includes('SERVER_VIEW_ANALYTICS') || g.scopes.includes('SERVER_EXPORT_REPORTS')],
      ['audit', '☰', 'Audit log', g.scopes.includes('SERVER_VIEW_AUDIT')],
      ['notifications', '🔔', 'Notifications', g.scopes.includes('SERVER_VIEW_OVERVIEW')],
    ];
    html += `<div class="nav-group"><div class="nav-title">${esc(g.guild_name)} <span class="count">•</span></div>`;
    for (const [page, icon, label, allowed] of guildPages) {
      if (!allowed) continue;
      html += navItem(`#/g/${g.guild_id}/${page}`, icon, label, hash.startsWith(`#/g/${g.guild_id}/${page}`));
    }
    html += `</div>`;
  } else if (me.guilds.length) {
    html += `<div class="nav-group"><div class="nav-title">Your servers</div>`;
    for (const g2 of me.guilds) {
      html += navItem(`#/g/${g2.guild_id}/overview`, '▸', g2.guild_name, false);
    }
    html += `</div>`;
  }
  nav.innerHTML = html;
}

async function refreshChromeMeta() {
  const g = guild();
  $('#guildMeta').innerHTML = g
    ? `${roleBadge(g.role)} ${g.is_staff ? '<span class="chip">Staff</span>' : ''}`
    : (state.me?.isGlobalOwner ? '<span class="chip">Permanent Global Owner</span>' : 'Select a server to open its tools.');
  if (g) {
    try {
      const data = await api(`/api/guilds/${g.guild_id}/overview`);
      state.guildData = data;
      if (data.guild?.ownershipVerified === false && !state.me.isGlobalOwner) {
        $('#guildMeta').innerHTML += ` <span class="chip" title="Discord ownership could not be revalidated">stored owner</span>`;
      }
    } catch { /* overview may be unavailable for self-service staff */ }
  }
}

/* ============================================================================
   ROUTER
   ========================================================================== */
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'g' && parts[1]) {
    const page = parts[2] || 'overview';
    const param = parts[3] || null;
    return { guildId: parts[1], page, param, global: false };
  }
  if (parts[0] === 'global') return { guildId: null, page: parts[1] || 'overview', param: null, global: true };
  return { guildId: null, page: parts[0] || '', param: parts[1] || null, global: true };
}

async function route(initial = false) {
  if (!state.me) return;
  const r = parseHash();
  if (!r.page) {
    const target = state.me.isGlobalOwner ? '#/global/overview'
      : state.me.guilds[0] ? `#/g/${state.me.guilds[0].guild_id}/${state.me.guilds[0].scopes.includes('SERVER_VIEW_OVERVIEW') ? 'overview' : 'tickets'}`
        : '#/global/sessions';
    location.hash = target;
    return;
  }
  state.guildId = r.guildId;
  state.page = r.page;
  state.param = r.param;
  state.guild = guild();
  $('#guildSelect').value = r.guildId || '';
  $('#crumbRoot').textContent = r.guildId ? (state.guild?.guild_name ?? 'Server') : 'Platform';
  $('#crumbPage').textContent = pageTitle(r.page);
  $('#rolePill').textContent = state.me.isGlobalOwner ? 'GLOBAL OWNER' : ROLE_LABELS[state.guild?.role]?.toUpperCase() ?? 'USER';
  $('#sidebar').classList.remove('open');
  renderNav();
  refreshChromeMeta();
  connectStream(r.guildId);

  try {
    if (r.guildId) await renderGuildPage(r.page, r.param);
    else await renderGlobalPage(r.page);
  } catch (err) {
    setView(pageHead('Unable to load this page', 'The dashboard reported an error. Nothing shown below is cached or simulated.')
      + `<div class="error-box">${esc(err.message)}</div><div class="mt-16"><a class="btn" href="">Reload dashboard</a></div>`);
  }
  if (initial) $('#view').focus();
}

function pageTitle(page) {
  return ({
    overview: 'Overview', tickets: 'Tickets', 'ticket-detail': 'Ticket detail', staff: 'Staff monitor',
    'staff-profile': 'Staff profile', 'my-profile': 'My staff record', activity: 'Activity', analytics: 'Analytics',
    reviews: 'Human reviews', warnings: 'Warnings', appeals: 'Appeals', leave: 'Leave', settings: 'Settings',
    'staff-roles': 'Staff roles', access: 'Access & roles', integrations: 'Integrations', reports: 'Reports',
    audit: 'Audit', notifications: 'Notifications', guilds: 'Servers', admins: 'Administrators',
    sessions: 'Sessions & security', health: 'System health', backups: 'Backups', global: 'Global',
  })[page] || page.replace(/-/g, ' ');
}

function connectStream(guildId) {
  if (state.streamGuild === guildId && state.stream) return;
  if (state.stream) { state.stream.close(); state.stream = null; }
  state.streamGuild = guildId;
  if (!guildId) { setLive(false, 'No live scope'); return; }
  const es = new EventSource(`/api/events?guildId=${encodeURIComponent(guildId)}`);
  state.stream = es;
  es.addEventListener('ready', () => setLive(true, 'Live'));
  es.addEventListener('ping', () => setLive(true, 'Live'));
  es.addEventListener('auth_expired', () => { es.close(); showAuth(null, 'Your session expired.'); });
  es.addEventListener('update', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    handleLiveEvent(payload);
  });
  es.onerror = () => {
    setLive(false, 'Reconnecting…');
    if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (state.stream === es) connectStream(guildId); }, 8000);
  };
}

function setLive(ok, label) {
  const el = $('#liveState');
  el.classList.toggle('offline', !ok);
  el.innerHTML = `<span class="dot"></span> ${esc(label)}`;
}

const liveRefresh = debounce(() => {
  if (state.modalOpen) return;
  if (['tickets', 'ticket-detail', 'overview', 'activity', 'staff', 'reviews'].includes(state.page)) route(false);
}, 900);

function handleLiveEvent(event) {
  const type = String(event.type || '');
  if (type.includes('ticket.created')) toast('New ticket captured.', 'success');
  else if (type.includes('ticket.auto_claimed')) toast('Five-minute timer claimed a ticket automatically.', 'success');
  else if (type.includes('ticket.claimed')) toast('A ticket was claimed.', 'info');
  else if (type.includes('scan')) toast('Monitoring scan completed.', 'info');
  else if (type.includes('auto_claim.cancelled')) toast('Automatic claim timer cancelled.', 'info');
  else if (type.includes('staff.status')) toast('A staff monitoring status changed.', 'info');
  liveRefresh();
}

/* ============================================================================
   GLOBAL PAGES
   ========================================================================== */
async function renderGlobalPage(page) {
  switch (page) {
    case 'overview': return renderGlobalOverview();
    case 'guilds': return renderGlobalGuilds();
    case 'admins': return renderGlobalAdmins();
    case 'analytics': return renderGlobalAnalytics();
    case 'audit': return renderGlobalAudit();
    case 'sessions': return renderSessions();
    case 'health': return renderSystemHealth();
    case 'backups': return renderBackups();
    default:
      setView(pageHead('Page not found', 'That platform page does not exist.') + emptyState('Unknown page', 'Use the navigation to open a real dashboard page.'));
  }
}

function breakdownHtml(breakdown) {
  const entries = Object.entries(breakdown || {});
  if (!entries.length) return emptyState('No staff records yet', 'Run a staff scan in Discord to populate monitoring status.');
  const total = entries.reduce((sum, [, v]) => sum + Number(v || 0), 0) || 1;
  return `<div class="col">${entries.map(([key, value]) => `
    <div>
      <div class="row between small"><span>${statusBadge(key)}</span><span>${num(value)} · ${Math.round((Number(value) / total) * 100)}%</span></div>
      <div class="progress mt-8"><span style="width:${Math.max(1, (Number(value) / total) * 100)}%"></span></div>
    </div>`).join('')}</div>`;
}

async function renderGlobalOverview() {
  setView(pageHead('Global overview', 'Cross-server health, staff coverage and review workload. Visible only to the Global Owner or an explicitly granted global viewer.')
    + '<div id="gBody">' + loadingCards(4) + '</div>');
  const data = await api('/api/global/overview');
  const t = data.totals;
  const guildRows = data.guilds.map((g) => `
    <tr class="clickable" data-guild="${esc(g.guildId)}">
      <td><strong>${esc(g.guildName)}</strong><span class="sub">${esc(g.guildId)}</span></td>
      <td>${num(g.staffCount)} <span class="sub">${num(g.activeCount)} active · ${num(g.inactiveCount)} inactive</span></td>
      <td>${num(g.ticketsTotal)}</td>
      <td>${g.pendingReviews ? badge(g.pendingReviews + ' pending', 'amber') : badge('Clear', 'green')}</td>
      <td>${badge(String(g.health), g.health === 'ERROR' ? 'red' : g.health === 'HEALTHY' ? 'green' : 'amber')}</td>
      <td class="small muted">${g.lastScanAt ? fmtDate(g.lastScanAt) : 'No scan yet'}</td>
    </tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-4">
      ${statCard('Registered servers', num(t.guilds), 'Guilds with stored configuration', 'purple')}
      ${statCard('Monitored staff', num(t.staff), 'Current staff profiles', 'cyan')}
      ${statCard('Tickets monitored', num(t.ticketsMonitored), `${num(t.ticketsHandled)} handled · ${num(t.ticketsResolved)} resolved`, 'green')}
      ${statCard('Pending human reviews', num(t.pendingReviews), 'No warning is issued automatically', 'amber')}
    </div>
    <div class="grid cols-4 mt-16">
      ${statCard('Active warnings', num(t.activeWarnings), 'Across every server', 'red')}
      ${statCard('Monitoring errors', num(t.monitoringErrors), 'Require operator attention', 'red')}
      ${statCard('Automatic claim window', num(data.autoClaimMinutes) + ' min', 'First-responder timer', 'purple')}
      ${statCard('Generated', fmtDate(data.generatedAt), 'Live database query', 'slate')}
    </div>
    <div class="split mt-16">
      ${card('Server health', guildRows ? `<div class="table-wrap"><table><thead><tr><th>Server</th><th>Staff</th><th>Tickets</th><th>Reviews</th><th>Health</th><th>Last scan</th></tr></thead><tbody>${guildRows}</tbody></table></div>` : emptyState('No servers registered', 'Invite the bot to a Discord server and run /server setup.'))}
      <div class="col">
        ${card('Staff status distribution', breakdownHtml(data.statusBreakdown))}
        ${card('Alerts', data.alerts.length ? `<div class="col">${data.alerts.map((a) => `<div class="info-box" style="border-color:${a.level === 'error' ? 'rgba(239,68,68,.45)' : a.level === 'warning' ? 'rgba(245,158,11,.4)' : 'rgba(34,211,238,.28)'}"><strong>${esc(a.title)}</strong><div class="small mt-8">${esc(a.detail)}</div></div>`).join('')}</div>` : emptyState('No alerts', 'No monitoring errors or pending review bottlenecks.'))}
      </div>
    </div>`;
  $$('#gBody tr[data-guild]').forEach((row) => row.addEventListener('click', () => {
    const gid = row.dataset.guild;
    const target = state.me.guilds.find((g) => g.guild_id === gid);
    location.hash = target ? `#/g/${gid}/${target.scopes.includes('SERVER_VIEW_OVERVIEW') ? 'overview' : 'tickets'}` : '#/global/guilds';
  }));
}

async function renderGlobalGuilds() {
  setView(pageHead('Servers', 'Every server the platform has registered, with live counts from the database.') + '<div id="gBody">' + loadingCards(3) + '</div>');
  const data = await api('/api/global/guilds');
  const rows = data.guilds.map((g) => `
    <tr>
      <td><strong>${esc(g.guild_name)}</strong><span class="sub mono">${esc(g.guild_id)}</span></td>
      <td class="mono">${esc(g.owner_id)}</td>
      <td>${num(g.staff_count)}</td>
      <td>${num(g.tickets_total)} <span class="sub">${num(g.tickets_open)} open</span></td>
      <td>${g.pending_reviews ? badge(g.pending_reviews + ' pending', 'amber') : '—'}</td>
      <td>${num(g.staff_roles)}</td>
      <td class="small">${g.thresholds.at_risk}h / ${g.thresholds.inactive}h / ${g.thresholds.escalation}h</td>
      <td class="small muted">${fmtDate(g.installed_at)}</td>
    </tr>`).join('');
  $('#gBody').innerHTML = card('Registered servers', rows
    ? `<div class="table-wrap"><table><thead><tr><th>Server</th><th>Stored owner ID</th><th>Staff</th><th>Tickets</th><th>Reviews</th><th>Staff roles</th><th>Thresholds</th><th>Installed</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState('No servers yet', 'Invite the bot and run /server setup to register a server.'));
}

async function renderGlobalAdmins() {
  setView(pageHead('Administrators', 'Global Administrator assignments are explicit, scoped and time-limited. They never inherit cross-server data by default.')
    + (state.me.isGlobalOwner ? '<div class="page-actions mt-8"><button class="btn primary" id="addGlobalAdmin">＋ Assign Global Administrator</button></div>' : '')
    + '<div id="gBody">' + loadingCards(3) + '</div>');
  const data = await api('/api/global/admins');
  const webRows = data.webAdmins.map((a) => `
    <tr>
      <td><strong>${esc(a.username)}</strong><span class="sub mono">${esc(a.userId)}</span></td>
      <td>${roleBadge(a.role)}</td>
      <td>${(a.permissions || []).map((p) => `<span class="chip" title="${esc(p)}">${esc(SCOPE_LABELS[p] || p)}</span>`).join(' ') || '<span class="muted">No scopes</span>'}</td>
      <td>${badge(a.status, a.status === 'ACTIVE' ? 'green' : a.status === 'SUSPENDED' ? 'amber' : 'slate')}</td>
      <td class="small">${a.expiresAt ? fmtDate(a.expiresAt) : 'Never'}<span class="sub">${esc(a.assignedBy || '')}</span></td>
      <td class="right"><button class="btn sm danger" data-revoke-admin="${esc(a.assignmentId)}">Revoke</button></td>
    </tr>`).join('');
  const legacyRows = data.legacyAdmins.map((a) => `
    <tr><td><strong>${esc(a.username)}</strong><span class="sub mono">${esc(a.userId)}</span></td>
    <td>${(a.scopes || []).map((s) => `<span class="chip">${esc(SCOPE_LABELS[s] || s)}</span>`).join(' ') || '—'}</td>
    <td class="small muted">${fmtDate(a.createdAt)}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-2">
      ${card('Website role assignments', webRows ? `<div class="table-wrap"><table><thead><tr><th>Administrator</th><th>Role</th><th>Scopes</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>${webRows}</tbody></table></div>` : emptyState('No Global Administrators', 'The Permanent Global Owner is immutable and is not listed here.'))}
      ${card('Legacy bot administrators', legacyRows ? `<div class="table-wrap"><table><thead><tr><th>Administrator</th><th>Scopes</th><th>Created</th></tr></thead><tbody>${legacyRows}</tbody></table></div>` : emptyState('None', 'No legacy /owner admins are stored.'))}
    </div>
    <div class="info-box mt-16">Scope catalogue available for assignment: ${data.assignableScopes.map((s) => `<span class="chip" title="${esc(s)}">${esc(SCOPE_LABELS[s] || s)}</span>`).join(' ')}</div>`;
  const addAdminBtn = $('#addGlobalAdmin');
  if (addAdminBtn) addAdminBtn.addEventListener('click', () => openGlobalAdminModal(data));
  $$('[data-revoke-admin]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Revoke this Global Administrator immediately? Active sessions lose access on their next request.')) return;
    try {
      await api(`/api/global/admins/${encodeURIComponent(b.dataset.revokeAdmin)}`, { method: 'DELETE', body: { reason: 'Revoked from Global Administrators page' } });
      toast('Global Administrator revoked.', 'success');
      route(false);
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function openGlobalAdminModal(data) {
  const scopeChecks = data.assignableScopes.map((s) => `
    <label class="check-row"><input type="checkbox" name="scope_${esc(s)}" value="${esc(s)}" />
      <span class="txt"><strong>${esc(SCOPE_LABELS[s] || s)}</strong><small>${esc(s)}</small></span></label>`).join('');
  openModal('Assign Global Administrator', `
    <form id="modalForm">
      <div class="form-grid">
        <div class="field"><label for="gaUser">Discord user ID</label><input class="input" id="gaUser" name="userId" required placeholder="e.g. 123456789012345678" /></div>
        <div class="field"><label for="gaName">Display name (label only)</label><input class="input" id="gaName" name="username" placeholder="Team member" /></div>
      </div>
      <div class="field"><label>Explicit scopes</label>${scopeChecks}
        <div class="hint">Global Administrator never receives server data automatically. Grant only what is needed.</div></div>
      <div class="field"><label for="gaExpiry">Expires at (optional)</label><input class="input" id="gaExpiry" name="expiresAt" type="datetime-local" /></div>
      <div class="field"><label for="gaReason">Reason</label><input class="input" id="gaReason" name="reason" placeholder="Why is this access being granted?" /></div>
    </form>`, async (values) => {
    const permissions = data.assignableScopes.filter((s) => values[`scope_${s}`]);
    if (!permissions.length) throw new Error('Select at least one explicit scope.');
    await api('/api/global/admins', { method: 'POST', body: {
      userId: values.userId.trim(), username: values.username?.trim(), role: 'GLOBAL_ADMIN', permissions,
      expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null, reason: values.reason,
    } });
    toast('Global Administrator assigned.', 'success');
    route(false);
  });
}

async function renderGlobalAnalytics() {
  setView(pageHead('Global analytics', 'Aggregated platform statistics. If statistics are disabled for a server, this page reports that instead of inventing values.')
    + '<div id="gBody">' + loadingCards(4) + '</div>');
  const data = await api('/api/global/stats');
  const rows = data.guildSummaries.map((g) => `
    <tr><td><strong>${esc(g.guildName)}</strong><span class="sub mono">${esc(g.guildId)}</span></td>
    <td>${num(g.staffCount)}</td><td>${num(g.activeCount)}</td><td>${num(g.inactiveCount)}</td>
    <td>${num(g.ticketsTotal)}</td><td>${num(g.pendingReviews)}</td><td>${num(g.warningsActive)}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-4">
      ${statCard('Total staff', num(data.totalStaff), `${num(data.totalGuilds)} servers`, 'purple')}
      ${statCard('Tickets monitored', num(data.totalTicketsMonitored), `${num(data.totalTicketsHandled)} handled`, 'cyan')}
      ${statCard('Resolved', num(data.totalTicketsResolved), 'Across all servers', 'green')}
      ${statCard('Monitoring errors', num(data.monitoringErrors), 'Data-quality exceptions', 'red')}
    </div>
    <div class="split mt-16">
      ${card('Guild comparison', `<div class="table-wrap"><table><thead><tr><th>Server</th><th>Staff</th><th>Active</th><th>Inactive</th><th>Tickets</th><th>Reviews</th><th>Warnings</th></tr></thead><tbody>${rows}</tbody></table></div>`)}
      ${card('Status distribution', breakdownHtml(data.statusBreakdown))}
    </div>
    <div class="info-box mt-16">Reporting window: <strong>${fmtDate(data.fromIso)}</strong> → <strong>${fmtDate(data.toIso)}</strong>. Generated ${fmtDate(data.generatedAt)}.</div>`;
}

async function renderGlobalAudit() {
  setView(pageHead('Global audit log', 'Security-sensitive actions across the platform. Guild-scoped audit logs remain isolated inside each server.')
    + '<div class="toolbar"><div class="search grow"><input class="input" id="auditFilter" placeholder="Filter by action, actor or guild ID" /></div><button class="btn" id="auditRefresh">Refresh</button></div>'
    + '<div id="gBody"></div>');
  const data = await api('/api/global/audit?limit=100');
  state.pageData.audit = data.logs;
  const draw = (filter = '') => {
    const q = filter.toLowerCase();
    const rows = state.pageData.audit.filter((l) => !q || JSON.stringify(l).toLowerCase().includes(q)).map((l) => `
      <tr><td class="small muted nowrap">${fmtDate(l.created_at)}</td>
      <td>${auditCell(l)}</td>
      <td class="mono">${esc(l.actor_user_id || 'SYSTEM')}<span class="sub">${esc(l.actor_tag || '')}</span></td>
      <td>${l.guild_id ? `<span class="mono">${esc(l.guild_id)}</span>` : '<span class="chip">global</span>'}</td>
      <td class="mono small">${esc(l.target_id || '—')}</td></tr>`).join('');
    $('#gBody').innerHTML = card('', rows ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Guild</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No audit entries', 'No matching actions have been recorded.'));
  };
  draw();
  $('#auditFilter').addEventListener('input', (e) => draw(e.target.value));
  $('#auditRefresh').addEventListener('click', () => route(false));
}

async function renderSessions() {
  setView(pageHead('Sessions & security', 'Server-side sessions, immediate revocation and security posture. Revoking a session takes effect on the next request or SSE heartbeat.')
    + '<div id="gBody">' + loadingCards(3) + '</div>');
  const data = await api('/api/system/sessions');
  let security = null;
  if (state.me.isGlobalOwner || state.me.globalScopes.includes('GLOBAL_SECURITY')) {
    try { security = await api('/api/system/security'); } catch { security = null; }
  }
  const rows = data.sessions.map((s) => `
    <tr>
      <td><strong>${esc(s.username)}</strong><span class="sub mono">${esc(s.user_id)}</span>${s.current ? ' ' + badge('this session', 'cyan') : ''}</td>
      <td class="small">${fmtDate(s.created_at)}<span class="sub">seen ${relTime(s.last_seen_at)}</span></td>
      <td class="small">${fmtDate(s.expires_at)}</td>
      <td class="small muted">${esc((s.user_agent || 'unknown client').slice(0, 70))}</td>
      <td>${s.revoked_at ? badge('revoked', 'red') : badge('active', 'green')}</td>
      <td class="right">${s.revoked_at ? '' : `<button class="btn sm danger" data-revoke-session="${esc(s.session_id)}">Revoke</button>`}</td>
    </tr>`).join('');
  $('#gBody').innerHTML = `
    ${card(data.canSeeAll ? 'All website sessions' : 'Your website sessions', rows
      ? `<div class="table-wrap"><table><thead><tr><th>User</th><th>Signed in</th><th>Expires</th><th>Client</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : emptyState('No sessions', 'No active sessions are stored.'))}
    ${security ? `<div class="grid cols-3 mt-16">
      ${statCard('Active sessions', num(security.sessions), 'Server-side, revocable', 'cyan')}
      ${statCard('Global administrators', num(security.globalAdmins.length), 'Explicitly scoped', 'purple')}
      ${statCard('Unauthorized attempts', num(security.recentUnauthorized.length), 'Recorded in audit', 'red')}
    </div>
    <div class="mt-16">${card('Recent unauthorized attempts', security.recentUnauthorized.length
      ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead><tbody>${security.recentUnauthorized.map((l) => `<tr><td class="small">${fmtDate(l.created_at)}</td><td class="mono">${esc(l.actor_user_id)}</td><td>${auditCell(l)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('No unauthorized attempts', 'Every request so far passed authorization.'))}</div>` : ''}`;
  $$('[data-revoke-session]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Revoke this session now?')) return;
    try {
      await api(`/api/system/sessions/${encodeURIComponent(b.dataset.revokeSession)}`, { method: 'DELETE' });
      toast('Session revoked.', 'success');
      if (b.closest('tr')?.textContent.includes('this session')) { showAuth(null, 'You signed out that session.'); return; }
      route(false);
    } catch (err) { toast(err.message, 'error'); }
  }));
}

async function renderSystemHealth() {
  setView(pageHead('System health', 'Database integrity, schema migrations, scheduler state, monitoring health and platform settings.')
    + '<div id="gBody">' + loadingCards(4) + '</div>');
  const d = await api('/api/system/health');
  const migrationRows = (d.migrations || []).map((m) => `<tr><td class="mono">${esc(m.version ?? m.filename ?? m)}</td><td>${m.applied_at ? fmtDate(m.applied_at) : ''}</td></tr>`).join('');
  const healthRows = (d.health || []).map((h) => `<tr><td>${esc(h.component)}</td><td>${h.guild_id ? `<span class="mono">${esc(h.guild_id)}</span>` : 'global'}</td><td>${badge(h.status, h.status === 'OK' ? 'green' : h.status === 'ERROR' ? 'red' : 'amber')}</td><td>${esc(h.coverage_level)}</td><td class="small muted">${fmtDate(h.checked_at)}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-4">
      ${statCard('Uptime', Math.round(d.uptimeSeconds / 3600) + 'h', 'Process uptime', 'green')}
      ${statCard('Database', d.database.integrity?.ok === false ? 'ATTENTION' : 'OK', d.database.driver || '', d.database.integrity?.ok === false ? 'red' : 'cyan')}
      ${statCard('Event listeners', num(d.eventListeners), 'Live SSE subscribers + internal', 'purple')}
      ${statCard('Pending auto-claims', num(d.pendingAutoClaims), `${num(d.failedAutoClaims)} failed`, d.failedAutoClaims ? 'red' : 'amber')}
    </div>
    <div class="grid cols-2 mt-16">
      ${card('Runtime', `<dl class="kv">
        <dt>Node</dt><dd>${esc(d.node)}</dd>
        <dt>Memory RSS</dt><dd>${num(d.memoryRssMb)} MB</dd>
        <dt>Database</dt><dd class="mono">${esc(d.database.path)}</dd>
        <dt>Schema migrations</dt><dd>${num((d.migrations || []).length)} applied</dd>
        <dt>Integrations active</dt><dd>${(d.integrations || []).map((i) => `${esc(i.integration_type)} (${num(i.cnt)})`).join(', ') || 'None'}</dd>
        <dt>Intents</dt><dd>Members ${d.intents.guildMembers ? '✓' : '✗'} · Presence ${d.intents.presence ? '✓' : '✗'} · Message content ${d.intents.messageContent ? '✓' : '✗'}</dd>
      </dl>`)}
      ${card('Scheduler locks', Array.isArray(d.scheduler) && d.scheduler.length ? `<div class="table-wrap"><table><thead><tr><th>Task</th><th>Last run</th><th>Next run</th><th>Runs</th><th>Status</th></tr></thead><tbody>${d.scheduler.map((l) => `<tr><td class="mono">${esc(l.lock_name)}</td><td class="small">${fmtDate(l.last_run_at)}</td><td class="small">${fmtDate(l.next_run_at)}</td><td>${num(l.run_count)}</td><td>${badge(l.last_status || 'idle', l.last_status === 'SUCCESS' ? 'green' : l.last_status === 'ERROR' ? 'red' : 'slate')}${l.last_error ? `<span class="sub">${esc(l.last_error)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No scheduler locks recorded yet.</p>')}
    </div>
    <div class="split mt-16">
      ${card('Monitoring health', healthRows ? `<div class="table-wrap"><table><thead><tr><th>Component</th><th>Guild</th><th>Status</th><th>Coverage</th><th>Checked</th></tr></thead><tbody>${healthRows}</tbody></table></div>` : emptyState('No health checks yet', 'Run /scan now or wait for the six-hour scheduler.'))}
      ${card('Applied migrations', migrationRows ? `<div class="table-wrap"><table><thead><tr><th>Migration</th><th>Applied</th></tr></thead><tbody>${migrationRows}</tbody></table></div>` : emptyState('No migrations recorded', 'The migration runner will apply schema files on startup.'))}
    </div>
    ${(state.me.isGlobalOwner || state.me.globalScopes.includes('GLOBAL_SECURITY')) ? `<div class="mt-16">${card('Platform controls', `<form id="systemSettingsForm"><div class="form-grid">
      <div class="field"><label for="setAutoClaim">Automatic claim window (minutes)</label><input class="input" id="setAutoClaim" name="ticket_auto_claim_minutes" type="number" min="1" max="120" value="${esc(settingValue(d.settings, 'ticket_auto_claim_minutes'))}" /><div class="hint">Persistent first-responder timers. Manual claim or close cancels.</div></div>
      <div class="field"><label for="setRetention">Transcript retention (days)</label><input class="input" id="setRetention" name="ticket_message_retention_days" type="number" min="1" max="3650" value="${esc(settingValue(d.settings, 'ticket_message_retention_days'))}" /></div>
      <div class="field"><label for="setSession">Session lifetime (hours)</label><input class="input" id="setSession" name="web_session_hours" type="number" min="1" max="720" value="${esc(settingValue(d.settings, 'web_session_hours'))}" /><div class="hint">New sessions only. Revoke existing sessions below.</div></div>
      <div class="field"><label for="setPaused">Monitoring paused globally</label><select class="input" id="setPaused" name="monitoring_paused_globally"><option value="false" ${settingValue(d.settings, 'monitoring_paused_globally') === 'false' ? 'selected' : ''}>No — monitoring active</option><option value="true" ${settingValue(d.settings, 'monitoring_paused_globally') === 'true' ? 'selected' : ''}>Yes — pause scheduled scans</option></select></div>
    </div><button class="btn primary" type="submit">Save platform settings</button></form>`)}</div>` : ''}`;
  const settingsForm = $('#systemSettingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(settingsForm);
      try {
        for (const [key, value] of form.entries()) {
          await api('/api/system/settings', { method: 'PATCH', body: { key, value: String(value) } });
        }
        toast('Platform settings saved and audited.', 'success');
        renderSystemHealth();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

function settingValue(settings, key) {
  return settings?.find((s) => s.key === key)?.value ?? '';
}

async function renderBackups() {
  setView(pageHead('Backups & recovery', 'SQLite online backups with integrity verification. Secrets are never included in database backups.')
    + '<div class="page-actions mt-8"><button class="btn primary" id="createBackup">＋ Create backup</button></div>'
    + '<div id="gBody">' + loadingCards(3) + '</div>');
  const d = await api('/api/system/backups');
  const rows = d.backups.map((b) => `<tr><td class="mono">${esc(b.filename)}</td><td>${(b.sizeBytes / 1024).toFixed(1)} KB</td><td>${badge(b.integrityOk ? 'verified' : 'check failed', b.integrityOk ? 'green' : 'red')}</td><td class="small muted">${fmtDate(b.createdAt)}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="info-box mb-0">Database: <span class="mono">${esc(d.databasePath)}</span>. Restore steps are documented in <code class="code">docs/BACKUP_AND_RECOVERY.md</code>.</div>
    <div class="mt-16">${card('Available backups', rows ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Size</th><th>Integrity</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No backups yet', 'Create one now, or set BACKUP_INTERVAL_HOURS for scheduled backups.'))}</div>`;
  $('#createBackup').addEventListener('click', () => openModal('Create database backup', `
    <form id="modalForm"><div class="field"><label for="bLabel">Label</label><input class="input" id="bLabel" name="label" value="manual-web" maxlength="60" /></div>
    <p class="small muted">The backup is written to your configured backup directory and verified before the record is returned.</p></form>`, async (values) => {
    await api('/api/system/backups', { method: 'POST', body: { label: values.label || 'manual-web' } });
    toast('Backup created and verified.', 'success');
    route(false);
  }));
}

/* ============================================================================
   GUILD PAGES
   ========================================================================== */
async function renderGuildPage(page, param) {
  switch (page) {
    case 'overview': return renderGuildOverview();
    case 'tickets': return renderTickets();
    case 'ticket-detail': return renderTicketDetail(param);
    case 'staff': return renderStaff();
    case 'staff-profile': return renderStaffProfile(param, false);
    case 'my-profile': return renderStaffProfile(state.me.user.id, true);
    case 'activity': return renderActivity();
    case 'analytics': return renderGuildAnalytics();
    case 'reviews': return renderReviews();
    case 'warnings': return renderWarnings();
    case 'appeals': return renderAppeals();
    case 'leave': return renderLeave();
    case 'staff-roles': return renderStaffRoles();
    case 'access': return renderAccess();
    case 'settings': return renderSettings();
    case 'integrations': return renderIntegrations();
    case 'reports': return renderReports();
    case 'audit': return renderGuildAudit();
    case 'notifications': return renderNotifications();
    default: setView(pageHead('Page not found', 'That server page does not exist.'));
  }
}

function ticketStatusBadge(status) {
  const key = String(status || '').toUpperCase();
  const tone = ['RESOLVED', 'CLOSED'].includes(key) ? 'green'
    : ['REOPENED'].includes(key) ? 'red'
      : ['CLAIMED', 'ASSIGNED', 'IN_PROGRESS'].includes(key) ? 'cyan' : 'amber';
  return badge(key.replace(/_/g, ' '), tone);
}

function claimBadge(type) {
  const key = String(type || 'NONE').toUpperCase();
  if (key === 'AUTOMATIC') return badge('Automatic claim', 'purple');
  if (key === 'MANUAL') return badge('Manual claim', 'cyan');
  return badge('Unclaimed', 'slate');
}

async function renderGuildOverview() {
  setView(pageHead('Server overview', 'Live accountability snapshot for this Discord server.')
    + '<div id="gBody">' + loadingCards(4) + '</div>');
  const d = await api(`/api/guilds/${state.guildId}/overview`);
  state.pageData.overview = d;
  const t = d.tickets;
  const recent = d.recentTickets.map((x) => `
    <tr class="clickable" data-ticket="${esc(x.ticket_id)}">
      <td><strong>#${esc(x.ticket_number || x.ticket_id)}</strong><span class="sub">${esc(x.channel_name || '')}</span></td>
      <td>${ticketStatusBadge(x.status)}</td>
      <td>${claimBadge(x.claim_type)}<span class="sub">${esc(x.assigned_name || '—')}</span></td>
      <td class="small muted">${relTime(x.opened_at)}</td>
      <td class="small">${x.first_response_sec != null ? dur(x.first_response_sec) : '—'}</td>
    </tr>`).join('');
  const scans = d.scans.map((s) => `<tr><td>${esc(s.scan_type.replace(/_/g, ' '))}</td><td>${badge(s.coverage_level, s.coverage_level === 'FULL' ? 'green' : 'amber')}</td><td>${num(s.staff_discovered)}</td><td>${num(s.newly_registered)}</td><td class="small muted">${fmtDate(s.completed_at)}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-4">
      ${statCard('Monitorable staff', num(d.staff.total), Object.entries(d.staff.breakdown).map(([k, v]) => `${STATUS_LABELS[k] ?? k}: ${v}`).join(' · ') || 'No staff scanned', 'purple')}
      ${statCard('Tickets monitored', num(t.totalTickets), `${num(t.openTickets)} open · ${num(t.unclaimed)} unclaimed`, 'cyan')}
      ${statCard('Pending reviews', num(d.pendingReviews), 'Warnings require human approval', d.pendingReviews ? 'amber' : 'green')}
      ${statCard('Active warnings', num(d.activeWarnings), `${num(d.leave.length)} staff on leave`, d.activeWarnings ? 'red' : 'green')}
    </div>
    <div class="grid cols-4 mt-16">
      ${statCard('Avg first response', dur(t.avgFirstResponseSec), 'Official first responder', 'cyan')}
      ${statCard('Avg resolution', dur(t.avgResolutionSec), 'Resolved tickets', 'green')}
      ${statCard('Auto-claimed', num(t.autoClaimed), `${num(t.pendingAutoClaims)} timer(s) pending`, 'purple')}
      ${statCard('Ownership', d.guild.ownershipVerified ? 'Verified live' : 'Stored owner', d.access.role ? ROLE_LABELS[d.access.role] : 'Website role', d.guild.ownershipVerified ? 'green' : 'amber')}
    </div>
    <div class="split mt-16">
      ${card('Recent tickets', recent ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Status</th><th>Claim</th><th>Opened</th><th>First response</th></tr></thead><tbody>${recent}</tbody></table></div>` : emptyState('No tickets captured yet', 'Configure ticket channels in Settings → Integrations, or use /ticket setup.'), `<a class="btn sm ghost" href="#/g/${state.guildId}/tickets">Open browser</a>`)}
      <div class="col">
        ${card('Thresholds', `<dl class="kv">
          <dt>At risk</dt><dd>${hours(d.guild.thresholds.atRisk)}</dd>
          <dt>Inactive</dt><dd>${hours(d.guild.thresholds.inactive)}</dd>
          <dt>Escalation</dt><dd>${hours(d.guild.thresholds.escalation)}</dd>
          <dt>Scan interval</dt><dd>${num(d.guild.thresholds.scanIntervalMinutes)} min</dd>
          <dt>Observation baseline</dt><dd>${hours(d.guild.thresholds.observationBaselineHours)}</dd>
          <dt>Health</dt><dd>${d.health ? badge(d.health.status, d.health.status === 'ERROR' ? 'red' : 'green') : 'No check yet'}</dd>
        </dl>`)}
        ${card('Latest scans', scans ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Coverage</th><th>Found</th><th>New</th><th>When</th></tr></thead><tbody>${scans}</tbody></table></div>` : '<p class="muted small">No scan history yet. Run /scan now in Discord.</p>')}
      </div>
    </div>
    <div class="grid cols-2 mt-16">
      ${card('Quick actions', `<div class="row wrap">
        <a class="btn sm" href="#/g/${state.guildId}/tickets">Ticket browser</a>
        <a class="btn sm" href="#/g/${state.guildId}/reviews">Human reviews (${num(d.pendingReviews)})</a>
        <a class="btn sm" href="#/g/${state.guildId}/staff">Staff monitor</a>
        <a class="btn sm" href="#/g/${state.guildId}/access">Access &amp; roles</a>
      </div><p class="small muted mt-16 mb-0">Automatic claim window: <strong>${num(d.autoClaimMinutes)} minutes</strong>. Timers survive restarts and are cancelled by a manual claim or ticket close.</p>`)}
      ${card('Active leave', d.leave.length ? `<div class="table-wrap"><table><thead><tr><th>Staff ID</th><th>From</th><th>To</th><th>Status</th></tr></thead><tbody>${d.leave.map((l) => `<tr><td class="mono">${esc(l.staff_user_id)}</td><td class="small">${fmtDate(l.start_at)}</td><td class="small">${fmtDate(l.end_at)}</td><td>${badge(l.status, l.status === 'APPROVED' ? 'green' : 'amber')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No active leave', 'Approved leave pauses inactivity scoring.'))}
    </div>`;
  $$('#gBody tr[data-ticket]').forEach((row) => row.addEventListener('click', () => { location.hash = `#/g/${state.guildId}/tickets/${row.dataset.ticket}`; }));
}

async function renderTickets(filtersOverride) {
  if (!requireCan('SERVER_VIEW_TICKETS')) return;
  const f = filtersOverride || state.ticketFilters || { status: 'ACTIVE', claim: 'ALL', search: '', page: 1 };
  state.ticketFilters = f;
  setView(pageHead('Ticket browser', 'Search captured conversations, claim labels and response performance. Transcript content requires the transcript permission.')
    + `<div class="toolbar">
      <div class="search grow"><input class="input" id="ticketSearch" placeholder="Search ticket number, name or opener" value="${esc(f.search || '')}" /></div>
      <select class="input" id="ticketStatus" style="max-width:170px">
        ${[['ACTIVE', 'Active (all open)'], ['OPEN', 'Waiting for staff'], ['UNCLAIMED', 'Unclaimed'], ['CLAIMED', 'Claimed'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed'], ['ALL', 'All statuses']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="input" id="ticketClaim" style="max-width:170px">
        ${[['ALL', 'Any claim type'], ['UNCLAIMED', 'Unclaimed'], ['AUTOMATIC', 'Automatic claim'], ['MANUAL', 'Manual claim']].map(([v, l]) => `<option value="${v}" ${f.claim === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="btn primary" id="ticketApply">Apply</button>
    </div>
    <div id="gBody"></div>`);
  const params = new URLSearchParams({ status: f.status === 'ALL' ? '' : f.status, claim: f.claim, search: f.search || '', page: String(f.page || 1), pageSize: '25' });
  const d = await api(`/api/guilds/${state.guildId}/tickets?${params.toString()}`);
  const rows = d.tickets.map((x) => `
    <tr class="clickable" data-ticket="${esc(x.ticket_id)}">
      <td><strong>#${esc(x.ticket_number || x.ticket_id)}</strong><span class="sub">${esc(x.channel_name || x.channel_id)}</span></td>
      <td>${ticketStatusBadge(x.status)}</td>
      <td>${claimBadge(x.claim_type)}<span class="sub">${esc(x.assigned_name || 'Unassigned')}</span></td>
      <td class="small">${esc(x.opener_user_id || '—')}</td>
      <td class="small">${x.first_responder_name ? esc(x.first_responder_name) : '—'}<span class="sub">${x.first_response_sec != null ? dur(x.first_response_sec) : 'no response'}</span></td>
      <td class="small muted">${fmtDate(x.opened_at)}</td>
      <td class="small">${x.last_activity_at ? relTime(x.last_activity_at) : '—'}</td>
    </tr>`).join('');
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  $('#gBody').innerHTML = card('', rows ? `
    <div class="row between mb-0"><span class="small muted">${num(d.total)} ticket(s) · ${d.canViewTranscripts ? 'transcript access granted' : 'transcript access not granted'}</span></div>
    <div class="table-wrap mt-8"><table><thead><tr><th>Ticket</th><th>Status</th><th>Claim</th><th>Opener</th><th>First responder</th><th>Opened</th><th>Last activity</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pagination"><button class="btn sm ghost" id="prevPage" ${d.page <= 1 ? 'disabled' : ''}>← Prev</button><span>Page ${d.page} of ${pages}</span><button class="btn sm ghost" id="nextPage" ${d.page >= pages ? 'disabled' : ''}>Next →</button></div>`
    : emptyState('No tickets match', 'Adjust the filters or capture tickets through a configured ticket channel.'));

  const apply = () => {
    state.ticketFilters = {
      status: $('#ticketStatus').value,
      claim: $('#ticketClaim').value,
      search: $('#ticketSearch').value.trim(),
      page: 1,
    };
    renderTickets(state.ticketFilters);
  };
  $('#ticketApply').addEventListener('click', apply);
  $('#ticketSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  $$('#gBody tr[data-ticket]').forEach((row) => row.addEventListener('click', () => { location.hash = `#/g/${state.guildId}/tickets/${row.dataset.ticket}`; }));
  const prev = $('#prevPage'); const next = $('#nextPage');
  if (prev) prev.addEventListener('click', () => { state.ticketFilters = { ...f, page: Math.max(1, d.page - 1) }; renderTickets(state.ticketFilters); });
  if (next) next.addEventListener('click', () => { state.ticketFilters = { ...f, page: d.page + 1 }; renderTickets(state.ticketFilters); });
}

async function renderTicketDetail(ticketId) {
  if (!requireCan('SERVER_VIEW_TICKETS')) return;
  if (!ticketId) { location.hash = `#/g/${state.guildId}/tickets`; return; }
  setView(pageHead('Ticket detail', 'Loading captured conversation and event timeline…') + '<div id="gBody">' + loadingCards(3) + '</div>');
  const d = await api(`/api/guilds/${state.guildId}/tickets/${encodeURIComponent(ticketId)}`);
  const t = d.ticket;
  const messages = d.messages.map((mInt) => {
    const m = mInt;
    return `<div class="msg ${m.author_type === 'STAFF' ? 'staff' : m.author_type === 'SYSTEM' ? 'system' : ''}">
      <div class="meta"><strong>${esc(m.author_name || m.author_user_id || m.author_type)}</strong><span>${fmtDate(m.sent_at)}${m.is_edited ? ' · edited' : ''}${m.is_deleted ? ' · deleted' : ''}</span></div>
      <div class="body">${m.content_available ? esc(m.content) : '<em>Content not captured — enable Message Content intent or transcript capture.</em>'}</div>
      ${m.attachment_count ? `<div class="small muted mt-8">📎 ${num(m.attachment_count)} attachment(s) recorded</div>` : ''}
    </div>`;
  }).join('');
  const events = d.events.map((e) => `<div class="tl-item"><strong>${esc(e.event_type.replace(/_/g, ' '))}</strong><div class="when">${fmtDate(e.occurred_at)}${e.actor_name ? ' · ' + esc(e.actor_name) : e.actor_user_id ? ' · ' + esc(e.actor_user_id) : ''}</div></div>`).join('');
  const assignments = d.assignments.map((a) => `<tr><td>${esc(a.staff_name || a.staff_user_id)}</td><td>${badge(a.assignment_type, 'cyan')}</td><td class="small muted">${fmtDate(a.assigned_at)}</td><td>${a.is_current ? badge('current', 'green') : '—'}</td></tr>`).join('');
  const canClaim = state.guild && state.guild.is_staff && !t.claimed_by_user_id;
  const actions = [];
  if (canClaim) actions.push('<button class="btn primary" id="actClaim">Claim ticket</button>');
  if (t.claimed_by_user_id === state.me.user.id || d.permissions.canManageTickets) actions.push('<button class="btn ghost" id="actUnclaim">Unclaim</button>');
  if (d.permissions.canManageTickets) {
    actions.push('<button class="btn" id="actAssign">Assign / reassign</button>');
    actions.push('<button class="btn success" id="actResolve">Resolve</button>');
    actions.push('<button class="btn danger" id="actClose">Close</button>');
    if (['CLOSED', 'RESOLVED'].includes(t.status)) actions.push('<button class="btn" id="actReopen">Reopen</button>');
  }
  setView(`
    <div class="page-head">
      <div>
        <div class="row gap-8 wrap"><h1>Ticket #${esc(t.ticket_number || t.ticket_id)}</h1>${ticketStatusBadge(t.status)} ${claimBadge(t.claim_type)}</div>
        <p>${esc(t.channel_name || t.channel_id)} · opened ${fmtDate(t.opened_at)} · source ${esc(t.adapter_source || 'discord')}</p>
      </div>
      <div class="page-actions"><a class="btn ghost" href="#/g/${state.guildId}/tickets">← Back to browser</a>${actions.join('')}</div>
    </div>
    <div id="gBody">
      <div class="ticket-grid">
        <div class="col">
          ${card('Captured conversation', d.transcriptDenied
            ? '<div class="warn-box">Transcript access is not granted for your role. Ticket metadata and timeline remain visible.</div>'
            : (messages || emptyState('No captured messages', 'No messages have been captured for this ticket yet.')))}
          ${card('Event timeline', events ? `<div class="timeline">${events}</div>` : emptyState('No events recorded', 'Ticket events appear here as claims and status changes occur.'))}
        </div>
        <div class="col">
          ${card('Ticket facts', `<dl class="kv">
            <dt>Database ID</dt><dd class="mono">${esc(t.ticket_id)}</dd>
            <dt>Status</dt><dd>${ticketStatusBadge(t.status)}</dd>
            <dt>Claim type</dt><dd>${claimBadge(t.claim_type)}</dd>
            <dt>Claimed at</dt><dd>${fmtDate(t.claim_at)}</dd>
            <dt>Assigned to</dt><dd>${esc(t.assigned_name || t.assigned_to_user_id || 'Unassigned')}</dd>
            <dt>First responder</dt><dd>${esc(t.first_responder_name || t.first_response_staff_id || '—')}</dd>
            <dt>First response</dt><dd>${dur(t.first_response_sec)}</dd>
            <dt>Resolution</dt><dd>${dur(t.resolution_sec)}</dd>
            <dt>Reopened</dt><dd>${num(t.reopened_count)}×</dd>
            <dt>Staff messages</dt><dd>${num(t.staff_message_count)}</dd>
            <dt>Last activity</dt><dd>${fmtDate(t.last_activity_at)}</dd>
          </dl>${d.pendingAutoClaim ? `<div class="info-box mt-16">Automatic claim timer scheduled for <strong>${fmtDate(d.pendingAutoClaim.execute_at)}</strong>.</div>` : ''}`)}
          ${card('Assignment history', assignments ? `<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Type</th><th>Assigned</th><th>State</th></tr></thead><tbody>${assignments}</tbody></table></div>` : '<p class="muted small">No assignment history.</p>')}
        </div>
      </div>
    </div>`);

  const action = async (name, body) => {
    try {
      await api(`/api/guilds/${state.guildId}/tickets/${encodeURIComponent(ticketId)}/${name}`, { method: 'POST', body: body || {} });
      toast('Ticket updated.', 'success');
      renderTicketDetail(ticketId);
    } catch (err) { toast(err.message, 'error'); }
  };
  const claimBtn = $('#actClaim'); if (claimBtn) claimBtn.addEventListener('click', () => action('claim'));
  const unclaimBtn = $('#actUnclaim'); if (unclaimBtn) unclaimBtn.addEventListener('click', () => action('unclaim'));
  const resolveBtn = $('#actResolve'); if (resolveBtn) resolveBtn.addEventListener('click', () => action('resolve'));
  const closeBtn = $('#actClose'); if (closeBtn) closeBtn.addEventListener('click', () => { if (confirm('Close this ticket?')) action('close'); });
  const reopenBtn = $('#actReopen'); if (reopenBtn) reopenBtn.addEventListener('click', () => action('reopen'));
  const assignBtn = $('#actAssign');
  if (assignBtn) assignBtn.addEventListener('click', async () => {
    try {
      const staff = await api(`/api/guilds/${state.guildId}/staff?pageSize=100`);
      openModal('Assign ticket', `<form id="modalForm"><div class="field"><label for="assignStaff">Active staff member</label>
        ${staff.staff.length ? `<select class="input" id="assignStaff" name="staffUserId" required>${staff.staff.map((s) => `<option value="${esc(s.user_id)}">${esc(s.display_name)} (${esc(s.monitoring_status)})</option>`).join('')}</select>` : '<div class="warn-box">No active staff profiles are available.</div>'}
      </div></form>`, staff.staff.length ? async (values) => {
        await api(`/api/guilds/${state.guildId}/tickets/${encodeURIComponent(ticketId)}/assign`, { method: 'POST', body: { staffUserId: values.staffUserId } });
        toast('Ticket assigned.', 'success');
        renderTicketDetail(ticketId);
      } : null);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function renderStaff() {
  if (!requireCan('SERVER_VIEW_STAFF')) return;
  const f = state.staffFilters || { status: '', search: '', includeFormer: false, page: 1 };
  state.staffFilters = f;
  setView(pageHead('Staff monitor', 'Monitoring status is evidence-based. Review outcomes require a human decision; no automatic punishment is ever issued.')
    + `<div class="toolbar">
      <div class="search grow"><input class="input" id="staffSearch" placeholder="Search staff display name, username or user ID" value="${esc(f.search || '')}" /></div>
      <select class="input" id="staffStatus" style="max-width:200px"><option value="">All statuses</option>${Object.keys(STATUS_LABELS).map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
      <label class="check-row" style="margin:0;padding:7px 10px"><input type="checkbox" id="staffFormer" ${f.includeFormer ? 'checked' : ''}/><span class="txt"><strong class="small">Include former staff</strong></span></label>
      <button class="btn primary" id="staffApply">Apply</button>
    </div><div id="gBody"></div>`);
  const params = new URLSearchParams({ page: String(f.page || 1), pageSize: '50', includeFormer: f.includeFormer ? 'true' : 'false' });
  if (f.status) params.set('status', f.status);
  if (f.search) params.set('search', f.search);
  const d = await api(`/api/guilds/${state.guildId}/staff?${params.toString()}`);
  const rows = d.staff.map((s) => `
    <tr class="clickable" data-staff="${esc(s.user_id)}">
      <td><div class="user-cell"><span class="avatar">${esc(initials(s.display_name))}</span><span><strong>${esc(s.display_name)}</strong><span class="sub">${esc(s.username)}</span></span></div></td>
      <td>${statusBadge(s.monitoring_status)}<span class="sub">${esc(s.monitoring_coverage)} coverage</span></td>
      <td class="small">${(s.role_names || []).slice(0, 3).map((r) => `<span class="chip">${esc(r)}</span>`).join(' ') || '—'}${s.role_names?.length > 3 ? `<span class="sub">+${s.role_names.length - 3} more</span>` : ''}</td>
      <td>${num(s.current_workload)}</td>
      <td>${num(s.tickets_handled_count)}<span class="sub">${num(s.tickets_resolved_count)} resolved</span></td>
      <td>${s.avg_first_response_sec != null ? dur(s.avg_first_response_sec) : '—'}</td>
      <td>${s.last_qualifying_work_at ? relTime(s.last_qualifying_work_at) : '—'}</td>
      <td>${s.active_warnings_count ? badge(s.active_warnings_count + ' active', 'red') : '—'}</td>
    </tr>`).join('');
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  $('#gBody').innerHTML = card('', rows ? `
    <div class="small muted">${num(d.total)} staff record(s)${f.includeFormer ? ' including former staff' : ''}.</div>
    <div class="table-wrap mt-8"><table><thead><tr><th>Member</th><th>Status</th><th>Roles</th><th>Workload</th><th>Handled</th><th>Avg first response</th><th>Last work</th><th>Warnings</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pagination"><button class="btn sm ghost" id="prevStaff" ${d.page <= 1 ? 'disabled' : ''}>← Prev</button><span>Page ${d.page} of ${pages}</span><button class="btn sm ghost" id="nextStaff" ${d.page >= pages ? 'disabled' : ''}>Next →</button></div>`
    : emptyState('No staff records', 'Configure staff roles and run a sync/scan in Discord to discover staff.'));
  const apply = () => {
    state.staffFilters = { status: $('#staffStatus').value, search: $('#staffSearch').value.trim(), includeFormer: $('#staffFormer').checked, page: 1 };
    renderStaff();
  };
  $('#staffApply').addEventListener('click', apply);
  $('#staffSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  $$('#gBody tr[data-staff]').forEach((row) => row.addEventListener('click', () => { location.hash = `#/g/${state.guildId}/staff/${row.dataset.staff}`; }));
  const prev = $('#prevStaff'); const next = $('#nextStaff');
  if (prev) prev.addEventListener('click', () => { state.staffFilters = { ...f, page: d.page - 1 }; renderStaff(); });
  if (next) next.addEventListener('click', () => { state.staffFilters = { ...f, page: d.page + 1 }; renderStaff(); });
}

async function renderStaffProfile(userId, isSelf) {
  if (!userId) { location.hash = `#/g/${state.guildId}/staff`; return; }
  setView(pageHead(isSelf ? 'My staff record' : 'Staff profile', 'Loading verified staff, activity, warning and leave records…') + '<div id="gBody">' + loadingCards(3) + '</div>');
  const d = await api(`/api/guilds/${state.guildId}/staff/${encodeURIComponent(userId)}`);
  const p = d.profile;
  const actRows = d.activity.map((a) => `<div class="tl-item"><strong>${esc(a.event_type.replace(/_/g, ' '))}</strong> ${a.is_qualifying ? badge('qualifying', 'green') : badge('non-qualifying', 'slate')}<div class="when">${fmtDate(a.occurred_at)} · ${esc(a.classification_reason || '')}</div></div>`).join('');
  const warnRows = d.warnings.map((w) => `<tr><td>${badge('Level ' + w.warning_level, w.warning_level >= 3 ? 'red' : w.warning_level === 2 ? 'amber' : 'slate')}</td><td class="small">${esc(w.reason)}</td><td>${badge(w.status, w.status === 'ACTIVE' ? 'red' : 'slate')}</td><td class="small muted">${fmtDate(w.approved_at)}</td><td>${w.status === 'ACTIVE' ? `<button class="btn sm ghost" data-appeal="${esc(w.warning_id)}">Appeal</button>` : ''}</td></tr>`).join('');
  const leaveRows = d.leave.map((l) => `<tr><td class="small">${fmtDate(l.start_at)}</td><td class="small">${fmtDate(l.end_at)}</td><td>${badge(l.status, l.status === 'APPROVED' ? 'green' : l.status === 'REJECTED' ? 'red' : 'amber')}</td><td class="small muted">${esc(l.reason || '')}</td></tr>`).join('');
  const ticketRows = d.tickets.map((t) => `<tr><td class="mono">#${esc(t.ticket_number || t.ticket_id)}</td><td>${ticketStatusBadge(t.status)}</td><td>${claimBadge(t.claim_type)}</td><td class="small muted">${fmtDate(t.opened_at)}</td></tr>`).join('');
  setView(`
    <div class="page-head">
      <div class="row gap-16 wrap">
        <span class="avatar" style="width:54px;height:54px;font-size:18px">${esc(initials(p.display_name))}</span>
        <div><div class="row gap-8 wrap"><h1>${esc(p.display_name)}</h1>${statusBadge(p.monitoring_status)}</div>
        <p>@${esc(p.username)} · ${esc(p.user_id)} · ${isSelf ? 'your own record' : 'staff profile'} · ${esc(p.monitoring_coverage)} coverage</p></div>
      </div>
      <div class="page-actions">${isSelf ? `<button class="btn" id="requestLeave">☾ Request leave</button>` : ''}${can('SERVER_MANAGE_WARNINGS') && !isSelf ? `<button class="btn danger" id="issueWarning">⚠ Issue warning</button>` : ''}</div>
    </div>
    <div id="gBody">
      <div class="grid cols-4">
        ${statCard('Current workload', num(p.current_workload), 'Assigned active tickets', 'cyan')}
        ${statCard('Tickets handled', num(p.tickets_handled_count), `${num(p.tickets_resolved_count)} resolved`, 'purple')}
        ${statCard('Avg first response', dur(p.avg_first_response_sec), 'Official responder credit', 'green')}
        ${statCard('Active warnings', num(p.active_warnings_count), `${num(p.total_warnings_count)} total issued`, p.active_warnings_count ? 'red' : 'green')}
      </div>
      <div class="split mt-16">
        <div class="col">
          ${card('Recent activity evidence', actRows ? `<div class="timeline">${actRows}</div>` : emptyState('No activity events', 'No qualifying or non-qualifying activity has been captured yet.'))}
          ${card('Recent tickets', ticketRows ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Status</th><th>Claim</th><th>Opened</th></tr></thead><tbody>${ticketRows}</tbody></table></div>` : '<p class="muted small">No ticket work recorded for this member.</p>')}
        </div>
        <div class="col">
          ${card('Staff record', `<dl class="kv">
            <dt>Monitoring</dt><dd>${statusBadge(p.monitoring_status)}</dd>
            <dt>Coverage</dt><dd>${esc(p.monitoring_coverage)}</dd>
            <dt>Primary category</dt><dd>${esc(p.primary_category || '—')}</dd>
            <dt>Current staff</dt><dd>${p.is_currently_staff ? 'Yes' : 'No (former)'}</dd>
            <dt>Roles</dt><dd>${(p.role_names || []).map((r) => `<span class="chip">${esc(r)}</span>`).join(' ') || '—'}</dd>
            <dt>Staff since</dt><dd>${fmtDate(p.joined_staff_at)}</dd>
            <dt>Last qualifying work</dt><dd>${fmtDate(p.last_qualifying_work_at)}</dd>
            <dt>Last ticket activity</dt><dd>${fmtDate(p.last_ticket_activity_at)}</dd>
            <dt>Avg resolution</dt><dd>${dur(p.avg_resolution_sec)}</dd>
          </dl>`)}
          ${card('Warnings', warnRows ? `<div class="table-wrap"><table><thead><tr><th>Level</th><th>Reason</th><th>Status</th><th>Issued</th><th></th></tr></thead><tbody>${warnRows}</tbody></table></div>` : '<p class="muted small">No warnings recorded.</p>')}
          ${card('Leave history', leaveRows ? `<div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Status</th><th>Reason</th></tr></thead><tbody>${leaveRows}</tbody></table></div>` : '<p class="muted small">No leave requests recorded.</p>')}
        </div>
      </div>
    </div>`);

  $$('[data-appeal]').forEach((b) => b.addEventListener('click', () => openModal('Submit warning appeal', `
    <form id="modalForm"><div class="field"><label for="appealReason">Why should this warning be reviewed?</label><textarea class="input" id="appealReason" name="reason" required minlength="5" maxlength="1000"></textarea></div>
    <p class="small muted">A manager must review your appeal. Submitting an appeal does not remove the warning automatically.</p></form>`, async (values) => {
    await api(`/api/guilds/${state.guildId}/appeals/submit`, { method: 'POST', body: { warningId: b.dataset.appeal, reason: values.reason } });
    toast('Appeal submitted for human review.', 'success');
    renderStaffProfile(userId, isSelf);
  })));
  const reqBtn = $('#requestLeave');
  if (reqBtn) reqBtn.addEventListener('click', () => openLeaveRequestModal(userId));
  const warnBtn = $('#issueWarning');
  if (warnBtn) warnBtn.addEventListener('click', () => openWarningModal(userId));
}

async function renderActivity() {
  if (!requireCan('SERVER_VIEW_STAFF')) return;
  const selected = state.activityUser || '';
  setView(pageHead('Activity timeline', 'Raw qualifying and non-qualifying staff evidence. Classification reasons are stored per event.')
    + `<div class="toolbar"><select class="input" id="activityUser" style="max-width:320px"><option value="">All staff</option></select><button class="btn" id="activityApply">Load</button></div><div id="gBody"></div>`);
  let staff = { staff: [] };
  try { staff = await api(`/api/guilds/${state.guildId}/staff?pageSize=100`); } catch { staff = { staff: [] }; }
  const select = $('#activityUser');
  select.innerHTML = `<option value="">All staff</option>${staff.staff.map((s) => `<option value="${esc(s.user_id)}" ${selected === s.user_id ? 'selected' : ''}>${esc(s.display_name)}</option>`).join('')}`;
  const load = async () => {
    const uid = select.value;
    state.activityUser = uid;
    const d = await api(`/api/guilds/${state.guildId}/activity?limit=100${uid ? `&userId=${encodeURIComponent(uid)}` : ''}`);
    const rows = d.events.map((e) => `<tr><td class="small muted nowrap">${fmtDate(e.occurred_at)}</td><td>${esc(e.staff_name || e.user_id)}</td><td>${esc(e.event_type.replace(/_/g, ' '))}</td><td>${e.is_qualifying ? badge('qualifying', 'green') : badge('non-qualifying', 'slate')}</td><td class="small muted">${esc(e.classification_reason || '—')}</td><td class="mono small">${esc(e.ticket_id || e.channel_id || '')}</td></tr>`).join('');
    $('#gBody').innerHTML = card('', rows ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Staff</th><th>Event</th><th>Qualifying</th><th>Reason</th><th>Ticket / channel</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No activity captured', 'Activity events appear when staff work in monitored ticket channels.'));
  };
  $('#activityApply').addEventListener('click', load);
  select.addEventListener('change', load);
  await load();
}

async function renderGuildAnalytics() {
  if (!requireCan('SERVER_VIEW_ANALYTICS')) return;
  const period = state.analyticsPeriod || 'WEEKLY';
  setView(pageHead('Server analytics', 'Fairness-adjusted workload and response performance. Staff on leave and new staff are protected from inactivity scoring.')
    + `<div class="toolbar">${['DAILY', 'WEEKLY', 'MONTHLY'].map((p) => `<button class="btn ${p === period ? 'primary' : 'ghost'}" data-period="${p}">${p[0] + p.slice(1).toLowerCase()}</button>`).join('')}<span class="muted small">Server scope only — never global data.</span></div><div id="gBody"></div>`);
  const d = await api(`/api/guilds/${state.guildId}/analytics?period=${period}`);
  const r = d.report;
  const staffRows = d.staff.map((s) => `<tr><td><strong>${esc(s.displayName || s.staff_name || s.userId)}</strong><span class="sub">${esc(s.primaryCategory || '')}</span></td>
    <td>${statusBadge(s.monitoringStatus)}</td><td>${num(s.currentWorkload)}</td><td>${num(s.ticketsHandled)}</td><td>${num(s.ticketsResolved)}</td>
    <td>${s.firstResponseSec != null ? dur(s.firstResponseSec) : '—'}</td><td>${s.avgResolutionSec != null ? dur(s.avgResolutionSec) : '—'}</td>
    <td>${num(s.recentActivity7d)}</td><td class="small">${num(s.workConsistencyPct)}%</td><td class="small muted">${esc(s.fairnessNote || '')}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-4">
      ${statCard('Opened in period', num(r.ticketMetrics.openedInPeriod), `${fmtDate(r.fromIso, false)} → ${fmtDate(r.toIso, false)}`, 'purple')}
      ${statCard('Handled', num(r.ticketMetrics.handledInPeriod), `${num(r.ticketMetrics.resolvedInPeriod)} resolved`, 'cyan')}
      ${statCard('Avg first response', dur(r.ticketMetrics.avgFirstResponseSec), `${num(r.ticketMetrics.availableWorkload)} available workload`, 'green')}
      ${statCard('Avg resolution', dur(r.ticketMetrics.avgResolutionSec), `${num(r.ticketMetrics.reopenedTotal)} reopen(s)`, 'amber')}
    </div>
    <div class="split mt-16">
      ${card('Staff fairness & performance', staffRows ? `<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Status</th><th>Workload</th><th>Handled</th><th>Resolved</th><th>First resp.</th><th>Avg res.</th><th>7d activity</th><th>Consistency</th><th>Fairness note</th></tr></thead><tbody>${staffRows}</tbody></table></div>` : emptyState('No staff data', 'No staff profiles are available for this period.'))}
      <div class="col">
        ${card('Status distribution', breakdownHtml(r.statusBreakdown))}
        ${card('Warnings & reviews', `<dl class="kv">
          <dt>Level 1 active</dt><dd>${num(r.warningMetrics.level1Active)}</dd>
          <dt>Level 2 active</dt><dd>${num(r.warningMetrics.level2Active)}</dd>
          <dt>Level 3 active</dt><dd>${num(r.warningMetrics.level3Active)}</dd>
          <dt>Issued in period</dt><dd>${num(r.warningMetrics.issuedInPeriod)}</dd>
          <dt>Reviews pending</dt><dd>${num(r.reviewOutcomes.pending)}</dd>
          <dt>Approved / rejected</dt><dd>${num(r.reviewOutcomes.approved)} / ${num(r.reviewOutcomes.rejected)}</dd>
          <dt>Excused / cancelled</dt><dd>${num(r.reviewOutcomes.excused)} / ${num(r.reviewOutcomes.cancelled)}</dd>
        </dl>`)}
        ${card('Coverage', `<p class="small">Monitoring coverage: ${badge(r.coverageLevel, r.coverageLevel === 'FULL' ? 'green' : 'amber')}</p><p class="small muted mb-0">Generated ${fmtDate(r.generatedAt)}. Partial coverage is reported honestly rather than extrapolated.</p>`)}
      </div>
    </div>`;
  $$('[data-period]').forEach((b) => b.addEventListener('click', () => { state.analyticsPeriod = b.dataset.period; renderGuildAnalytics(); }));
}

async function renderReviews() {
  if (!requireCan('SERVER_MANAGE_REVIEWS')) return;
  const pendingOnly = state.reviewPendingOnly !== false;
  setView(pageHead('Human reviews', 'The bot only suggests. A manager must approve every warning, and high-severity cases require final confirmation.')
    + `<div class="toolbar"><button class="btn ${pendingOnly ? 'primary' : 'ghost'}" id="reviewPending">Pending only</button><button class="btn ${!pendingOnly ? 'primary' : 'ghost'}" id="reviewAll">All reviews</button><button class="btn ghost" id="reviewRefresh">Refresh</button></div><div id="gBody"></div>`);
  const d = await api(`/api/guilds/${state.guildId}/reviews?pendingOnly=${pendingOnly}`);
  const cards = d.reviews.map((r) => `
    <div class="card">
      <div class="row between wrap">
        <div><div class="row gap-8 wrap"><strong>${esc(r.staff_name || r.staff_user_id)}</strong>${badge(r.status, r.status === 'PENDING' ? 'amber' : r.status === 'APPROVED' ? 'green' : 'slate')}</div>
        <p class="small muted mb-0">Suggested level ${r.suggested_level ?? '—'} · policy ${esc(r.required_policy || '—')} · created ${fmtDate(r.created_at)}</p></div>
        <span class="mono small muted">${esc(r.review_id)}</span>
      </div>
      <div class="divider"></div>
      <p class="small"><strong>Proposed reason:</strong> ${esc(r.proposed_reason || '—')}</p>
      ${r.snapshot ? `<details class="small"><summary class="muted">Evidence snapshot</summary><pre class="mono" style="white-space:pre-wrap;max-height:200px;overflow:auto">${esc(JSON.stringify(r.snapshot, null, 2))}</pre></details>` : ''}
      ${r.deferred_until ? `<div class="info-box small">Deferred until ${fmtDate(r.deferred_until)}</div>` : ''}
      ${r.status === 'PENDING' ? `<div class="row wrap mt-16">
        <button class="btn success" data-review="approve" data-id="${esc(r.review_id)}">Approve</button>
        <button class="btn danger" data-review="reject" data-id="${esc(r.review_id)}">Reject</button>
        <button class="btn ghost" data-review="later" data-id="${esc(r.review_id)}">Later</button>
        <button class="btn ghost" data-review="cancel" data-id="${esc(r.review_id)}">Cancel</button>
        <button class="btn ghost" data-review="excuse" data-id="${esc(r.review_id)}">Excuse</button>
      </div>` : ''}
    </div>`).join('');
  $('#gBody').innerHTML = cards ? `<div class="grid cols-2">${cards}</div>` : emptyState('No reviews', pendingOnly ? 'No reviews await a human decision.' : 'No review history is stored.');
  $('#reviewPending').addEventListener('click', () => { state.reviewPendingOnly = true; renderReviews(); });
  $('#reviewAll').addEventListener('click', () => { state.reviewPendingOnly = false; renderReviews(); });
  $('#reviewRefresh').addEventListener('click', () => renderReviews());
  $$('[data-review]').forEach((b) => b.addEventListener('click', () => handleReviewAction(b.dataset.id, b.dataset.review)));
}

async function handleReviewAction(reviewId, action) {
  if (action === 'approve') {
    try {
      const res = await api(`/api/guilds/${state.guildId}/reviews/${encodeURIComponent(reviewId)}/approve`, { method: 'POST', body: {} });
      if (res.stage === 'AWAITING_FINAL_CONFIRMATION') {
        openModal('Final confirmation required', `<div class="warn-box">${esc(res.message || 'This warning requires a final confirmation.')}</div>
          <p class="small">Review <span class="mono">${esc(reviewId)}</span> · suggested level ${esc(res.review?.suggested_level ?? '—')}</p>
          <p class="small muted">Confirming records the warning and notifies the staff member. This is the last human check.</p>`, async () => {
          const done = await api(`/api/guilds/${state.guildId}/reviews/${encodeURIComponent(reviewId)}/confirm`, { method: 'POST', body: {} });
          toast(done.autoCancelledReason ? 'Warning was auto-cancelled by policy.' : 'Warning issued after final human confirmation.', 'success');
          renderReviews();
        });
      } else if (res.stage === 'AWAITING_SECOND_APPROVAL') {
        toast(res.message || 'A second approver is required.', 'info');
        renderReviews();
      } else if (res.stage === 'AUTO_CANCELLED') {
        toast(res.message || 'The review was auto-cancelled.', 'info');
        renderReviews();
      } else {
        toast(res.message || 'Review approved.', 'success');
        renderReviews();
      }
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  if (action === 'reject') {
    openModal('Reject review', `<form id="modalForm"><div class="field"><label for="rejectNote">Decision note</label><textarea class="input" id="rejectNote" name="note" maxlength="500" placeholder="Explain why this review is rejected"></textarea></div>
      <p class="small muted">Rejecting records the human decision. No warning is issued.</p></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/reviews/${encodeURIComponent(reviewId)}/reject`, { method: 'POST', body: { note: values.note } });
      toast('Review rejected.', 'success'); renderReviews();
    });
    return;
  }
  if (action === 'later') {
    openModal('Defer review', `<form id="modalForm"><div class="field"><label for="deferHours">Defer for hours</label><input class="input" id="deferHours" name="hours" type="number" min="1" max="168" value="12" /></div>
      <div class="field"><label for="deferNote">Note</label><input class="input" id="deferNote" name="note" maxlength="500" /></div></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/reviews/${encodeURIComponent(reviewId)}/later`, { method: 'POST', body: { hours: Number(values.hours), note: values.note } });
      toast('Review deferred.', 'success'); renderReviews();
    });
    return;
  }
  if (action === 'cancel') {
    openModal('Cancel review', `<form id="modalForm"><div class="field"><label for="cancelReason">Cancellation reason</label><textarea class="input" id="cancelReason" name="reason" required minlength="3" maxlength="500"></textarea></div></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/reviews/${encodeURIComponent(reviewId)}/cancel`, { method: 'POST', body: { reason: values.reason } });
      toast('Review cancelled.', 'success'); renderReviews();
    });
    return;
  }
  if (action === 'excuse') {
    openModal('Excuse review', `<form id="modalForm"><div class="field"><label for="excuseNote">Reason (human decision)</label><textarea class="input" id="excuseNote" name="note" maxlength="500"></textarea></div></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/reviews/${encodeURIComponent(reviewId)}/excuse`, { method: 'POST', body: { note: values.note } });
      toast('Review excused.', 'success'); renderReviews();
    });
  }
}

async function renderWarnings() {
  if (!requireCan('SERVER_VIEW_STAFF')) return;
  const d = await api(`/api/guilds/${state.guildId}/warnings`);
  setView(pageHead('Warnings', 'Warnings are only created after human review. They never trigger automatic kicks, bans or demotions.')
    + (d.canManage ? '<div class="page-actions mt-8"><button class="btn danger" id="newWarning">＋ Issue warning</button></div>' : '')
    + '<div id="gBody"></div>');
  const rows = d.warnings.map((w) => `<tr>
    <td>${badge('Level ' + w.warning_level, w.warning_level >= 3 ? 'red' : w.warning_level === 2 ? 'amber' : 'slate')}</td>
    <td><strong>${esc(w.staff_name || w.staff_user_id)}</strong></td>
    <td class="small">${esc(w.reason)}</td>
    <td>${badge(w.status, w.status === 'ACTIVE' ? 'red' : 'slate')}</td>
    <td class="small muted">${fmtDate(w.approved_at || w.created_at)}</td>
    <td class="small muted">${esc(w.removed_reason || '')}</td>
    <td class="right">${d.canManage && w.status === 'ACTIVE' ? `<button class="btn sm danger" data-remove-warning="${esc(w.warning_id)}">Remove</button>` : ''}</td>
  </tr>`).join('');
  $('#gBody').innerHTML = card('', rows ? `<div class="table-wrap"><table><thead><tr><th>Level</th><th>Staff</th><th>Reason</th><th>Status</th><th>Issued</th><th>Removal</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No warnings', 'No warnings have been issued in this server.'));
  const newBtn = $('#newWarning');
  if (newBtn) newBtn.addEventListener('click', () => openWarningModal());
  $$('[data-remove-warning]').forEach((b) => b.addEventListener('click', () => {
    openModal('Remove warning', `<form id="modalForm"><div class="field"><label for="removeReason">Removal reason</label><textarea class="input" id="removeReason" name="reason" required minlength="3" maxlength="500"></textarea></div>
      <p class="small muted">The warning is marked removed and the removal is recorded in the audit log.</p></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/warnings/${encodeURIComponent(b.dataset.removeWarning)}`, { method: 'DELETE', body: { reason: values.reason } });
      toast('Warning removed.', 'success'); renderWarnings();
    });
  }));
}

async function openWarningModal(preselectUserId) {
  let staff = { staff: [] };
  try { staff = await api(`/api/guilds/${state.guildId}/staff?pageSize=100`); } catch { staff = { staff: [] }; }
  openModal('Issue warning after human review', `<form id="modalForm">
    <div class="field"><label for="warnStaff">Staff member</label><select class="input" id="warnStaff" name="staffUserId" required>
      ${staff.staff.map((s) => `<option value="${esc(s.user_id)}" ${preselectUserId === s.user_id ? 'selected' : ''}>${esc(s.display_name)} — ${esc(s.monitoring_status)}</option>`).join('')}</select></div>
    <div class="form-grid">
      <div class="field"><label for="warnLevel">Warning level</label><select class="input" id="warnLevel" name="level"><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option></select></div>
      <div class="field"><label for="warnNote">Management note (optional)</label><input class="input" id="warnNote" name="note" maxlength="500" /></div>
    </div>
    <div class="field"><label for="warnReason">Reason shown to the staff member</label><textarea class="input" id="warnReason" name="reason" required minlength="3" maxlength="1000"></textarea></div>
    <div class="warn-box">This action records a warning immediately because you are confirming a human decision. It will not trigger any automatic punishment.</div>
  </form>`, staff.staff.length ? async (values) => {
    await api(`/api/guilds/${state.guildId}/warnings`, { method: 'POST', body: { staffUserId: values.staffUserId, level: Number(values.level), reason: values.reason, note: values.note } });
    toast('Warning issued and audited.', 'success');
    if (state.page === 'warnings') renderWarnings();
    else if (state.page === 'staff-profile') route(false);
  } : null);
}

async function renderAppeals() {
  if (!requireCan('SERVER_MANAGE_APPEALS')) return;
  const status = state.appealStatus || 'PENDING';
  setView(pageHead('Appeals', 'Staff appeals are human-reviewed. Approving an appeal removes the warning and records the decision.')
    + `<div class="toolbar">${['PENDING', 'APPROVED', 'REJECTED'].map((s) => `<button class="btn ${s === status ? 'primary' : 'ghost'}" data-appeal-status="${s}">${s[0] + s.slice(1).toLowerCase()}</button>`).join('')}</div><div id="gBody"></div>`);
  const d = await api(`/api/guilds/${state.guildId}/appeals?status=${status}`);
  const rows = d.appeals.map((a) => `<tr>
    <td><strong>${esc(a.staff_name || a.staff_user_id)}</strong><span class="sub mono">${esc(a.warning_id)}</span></td>
    <td class="small">${esc(a.appeal_reason)}</td>
    <td>${badge(a.status, a.status === 'PENDING' ? 'amber' : a.status === 'APPROVED' ? 'green' : 'red')}</td>
    <td class="small muted">${fmtDate(a.submitted_at)}</td>
    <td class="small">${esc(a.decided_by_name || '')}</td>
    <td class="right">${a.status === 'PENDING' ? `<button class="btn sm success" data-decide="approve" data-id="${esc(a.appeal_id)}">Approve</button> <button class="btn sm danger" data-decide="reject" data-id="${esc(a.appeal_id)}">Reject</button>` : ''}</td>
  </tr>`).join('');
  $('#gBody').innerHTML = card('', rows ? `<div class="table-wrap"><table><thead><tr><th>Staff / warning</th><th>Appeal</th><th>Status</th><th>Submitted</th><th>Decided by</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No appeals', `No ${status.toLowerCase()} appeals are stored.`));
  $$('[data-appeal-status]').forEach((b) => b.addEventListener('click', () => { state.appealStatus = b.dataset.appealStatus; renderAppeals(); }));
  $$('[data-decide]').forEach((b) => b.addEventListener('click', () => {
    const approve = b.dataset.decide === 'approve';
    openModal(approve ? 'Approve appeal' : 'Reject appeal', `<form id="modalForm"><div class="field"><label for="appealNote">Decision note</label><textarea class="input" id="appealNote" name="note" maxlength="500" required>${approve ? 'Appeal approved after human review.' : 'Appeal rejected after human review.'}</textarea></div></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/appeals/${encodeURIComponent(b.dataset.id)}/${b.dataset.decide}`, { method: 'POST', body: { note: values.note } });
      toast(approve ? 'Appeal approved; warning removed.' : 'Appeal rejected.', 'success');
      renderAppeals();
    });
  }));
}

function openLeaveRequestModal(staffUserId) {
  openModal('Request leave', `<form id="modalForm">
    <div class="form-grid">
      <div class="field"><label for="leaveStart">Start</label><input class="input" id="leaveStart" name="startAt" type="datetime-local" required /></div>
      <div class="field"><label for="leaveEnd">End</label><input class="input" id="leaveEnd" name="endAt" type="datetime-local" required /></div>
    </div>
    <div class="field"><label for="leaveReason">Reason</label><textarea class="input" id="leaveReason" name="reason" required minlength="3" maxlength="1000"></textarea></div>
    <p class="small muted">Approved leave pauses inactivity scoring for the period.</p></form>`, async (values) => {
    const start = new Date(values.startAt);
    const end = new Date(values.endAt);
    if (!(start < end)) throw new Error('Leave end must be after the start.');
    await api(`/api/guilds/${state.guildId}/leave/request`, { method: 'POST', body: {
      staffUserId: staffUserId || state.me.user.id, reason: values.reason, startAt: start.toISOString(), endAt: end.toISOString(),
    } });
    toast('Leave request submitted.', 'success');
    route(false);
  });
}

async function renderLeave() {
  const d = await api(`/api/guilds/${state.guildId}/leave`);
  setView(pageHead('Leave', 'Approved leave pauses inactivity scoring. Staff can request leave for themselves; managers approve or reject.')
    + '<div class="page-actions mt-8"><button class="btn primary" id="newLeave">＋ Request leave</button></div>'
    + '<div id="gBody"></div>');
  const rows = d.leave.map((l) => `<tr>
    <td><strong>${esc(l.staff_name || l.staff_user_id)}</strong></td>
    <td class="small">${fmtDate(l.start_at)}</td><td class="small">${fmtDate(l.end_at)}</td>
    <td class="small muted">${esc(l.reason || '—')}</td>
    <td>${badge(l.status, l.status === 'APPROVED' ? 'green' : l.status === 'REJECTED' ? 'red' : 'amber')}</td>
    <td class="right">${d.canManage && l.status === 'PENDING' ? `<button class="btn sm success" data-leave="approve" data-id="${esc(l.leave_id)}">Approve</button> <button class="btn sm danger" data-leave="reject" data-id="${esc(l.leave_id)}">Reject</button>` : ''}</td>
  </tr>`).join('');
  $('#gBody').innerHTML = card('', rows ? `<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Start</th><th>End</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No leave records', 'Submit a leave request to pause inactivity scoring.'));
  $('#newLeave').addEventListener('click', () => openLeaveRequestModal(state.me.user.id));
  $$('[data-leave]').forEach((b) => b.addEventListener('click', () => {
    const approve = b.dataset.leave === 'approve';
    openModal(approve ? 'Approve leave' : 'Reject leave', `<form id="modalForm"><div class="field"><label for="leaveDecision">${approve ? 'Note (optional)' : 'Rejection reason'}</label><textarea class="input" id="leaveDecision" name="note" maxlength="500" ${approve ? '' : 'required'}></textarea></div></form>`, async (values) => {
      await api(`/api/guilds/${state.guildId}/leave/${encodeURIComponent(b.dataset.id)}/${b.dataset.leave}`, { method: 'POST', body: approve ? { note: values.note } : { reason: values.note } });
      toast(approve ? 'Leave approved.' : 'Leave rejected.', 'success');
      renderLeave();
    });
  }));
}

/* ================================ STAFF ROLES ============================== */
async function renderStaffRoles() {
  if (!requireCan('SERVER_MANAGE_STAFF')) return;
  const d = await api(`/api/guilds/${state.guildId}/staff-roles`);
  const storageKey = `tsm.roleSelection.${state.guildId}`;
  let selected = [];
  try { selected = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { selected = []; }
  selected = selected.filter((id) => d.discordRoles.some((r) => r.id === id));
  state.roleSelected = new Set(selected);
  state.roleSearch = state.roleSearch || '';
  state.rolePage = state.rolePage || 0;
  setView(pageHead('Staff roles & discovery', 'Select the Discord roles that define staff. Multi-role selection is deduplicated, persisted and paginated for large servers.')
    + '<div id="gBody"></div>');
  const persist = () => localStorage.setItem(storageKey, JSON.stringify([...state.roleSelected]));
  const draw = () => {
    const search = state.roleSearch.toLowerCase();
    const filtered = d.discordRoles.filter((r) => !search || r.name.toLowerCase().includes(search) || r.id.includes(search));
    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (state.rolePage >= totalPages) state.rolePage = 0;
    const pageRoles = filtered.slice(state.rolePage * pageSize, (state.rolePage + 1) * pageSize);
    const configuredRows = d.configured.map((c) => `<tr>
      <td><strong>${esc(c.role_name)}</strong><span class="sub mono">${esc(c.role_id)}</span></td>
      <td>${badge(c.category.replace(/_/g, ' '), 'purple')}</td>
      <td>${c.custom_at_risk_hours ? c.custom_at_risk_hours + 'h' : 'default'} / ${c.custom_inactive_hours ? c.custom_inactive_hours + 'h' : 'default'} / ${c.custom_escalation_hours ? c.custom_escalation_hours + 'h' : 'default'}</td>
      <td>${c.is_monitored ? badge('monitored', 'green') : badge('paused', 'slate')}</td>
      <td class="right"><button class="btn sm danger" data-remove-role="${esc(c.role_id)}">Remove</button></td>
    </tr>`).join('');
    $('#gBody').innerHTML = `
      <div class="grid cols-2">
        ${card(`Discord roles (${num(d.discordRoles.length)})`, `
          <div class="toolbar"><div class="search grow"><input class="input" id="roleSearch" placeholder="Search role name or ID" value="${esc(state.roleSearch)}" /></div>
          <button class="btn sm ghost" id="roleSelectPage">Select page</button><button class="btn sm ghost" id="roleClear">Clear all</button></div>
          <div class="selector-list">${pageRoles.length ? pageRoles.map((r) => `<label class="selector-item"><input type="checkbox" data-role="${esc(r.id)}" ${state.roleSelected.has(r.id) ? 'checked' : ''}/><span class="role-dot" style="background:#${(r.color || 0).toString(16).padStart(6, '0')}"></span><span class="grow">${esc(r.name)}<span class="sub mono">${esc(r.id)}</span></span></label>`).join('') : '<div class="empty">No roles match.</div>'}</div>
          <div class="pagination"><button class="btn sm ghost" id="rolePrev" ${state.rolePage <= 0 ? 'disabled' : ''}>← Prev</button><span>Page ${state.rolePage + 1} of ${totalPages}</span><button class="btn sm ghost" id="roleNext" ${state.rolePage >= totalPages - 1 ? 'disabled' : ''}>Next →</button></div>
          <div class="field mt-16"><label for="roleCategory">Category for newly selected roles</label><select class="input" id="roleCategory">${d.categories.map((c) => `<option value="${esc(c)}">${esc(c.replace(/_/g, ' '))}</option>`).join('')}</select></div>
          <div class="row between mt-8"><span class="small muted">${state.roleSelected.size} role(s) selected</span><button class="btn primary" id="roleAdd">Add selected roles</button></div>
          <div class="info-box mt-16">Selection persists in this browser. Newly discovered members are marked <strong>NEW STAFF</strong> until the observation baseline completes.</div>`)}
        ${card('Configured staff roles', configuredRows ? `<div class="table-wrap"><table><thead><tr><th>Role</th><th>Category</th><th>Thresholds</th><th>State</th><th></th></tr></thead><tbody>${configuredRows}</tbody></table></div>` : emptyState('No staff roles configured', 'Select Discord roles on the left and add them.'), `<button class="btn sm" id="scanSelected">Scan selected roles</button>`)}
      </div>
      <div id="scanReport" class="mt-16"></div>
      <div class="mt-16">${card('Coverage & discovery notes', `<div class="grid cols-3">
        ${statCard('Discord roles visible', num(d.discordRoles.length), 'Includes role IDs', 'cyan')}
        ${statCard('Monitored roles', num(d.configured.length), 'Deduplicated by role ID', 'purple')}
        ${statCard('Coverage model', d.configured.length ? 'READY' : 'NOT CONFIGURED', 'Website scans report partial coverage honestly', d.configured.length ? 'green' : 'amber')}
      </div><div class="info-box mt-16">Role discovery covers every role visible to the bot, including servers with 100+ roles. Website scans use the bot cache; run <code class="code">/staff sync</code> in Discord for a full member fetch and complete coverage report.</div>`)}</div>`;

    $('#roleSearch').addEventListener('input', debounce((e) => { state.roleSearch = e.target.value; state.rolePage = 0; draw(); }, 220));
    $$('[data-role]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) state.roleSelected.add(cb.dataset.role); else state.roleSelected.delete(cb.dataset.role);
      persist();
      const counter = $('#gBody .row.between .small.muted');
      if (counter) counter.textContent = `${state.roleSelected.size} role(s) selected`;
    }));
    $('#roleSelectPage').addEventListener('click', () => { pageRoles.forEach((r) => state.roleSelected.add(r.id)); persist(); draw(); });
    $('#roleClear').addEventListener('click', () => { state.roleSelected.clear(); persist(); draw(); });
    $('#rolePrev').addEventListener('click', () => { state.rolePage -= 1; draw(); });
    $('#roleNext').addEventListener('click', () => { state.rolePage += 1; draw(); });
    $('#roleAdd').addEventListener('click', async () => {
      const chosen = [...state.roleSelected].filter((id) => !d.configured.some((c) => c.role_id === id));
      if (!chosen.length) { toast('Every selected role is already configured.', 'info'); return; }
      const category = $('#roleCategory').value;
      try {
        for (const roleId of chosen) {
          const role = d.discordRoles.find((r) => r.id === roleId);
          await api(`/api/guilds/${state.guildId}/staff-roles`, { method: 'POST', body: { roleId, roleName: role?.name || roleId, category } });
        }
        toast(`${chosen.length} staff role(s) added.`, 'success');
        renderStaffRoles();
      } catch (err) { toast(err.message, 'error'); }
    });
    $('#scanSelected').addEventListener('click', async () => {
      const roleIds = [...state.roleSelected].length ? [...state.roleSelected] : d.configured.map((c) => c.role_id);
      if (!roleIds.length) { toast('Select or configure at least one staff role first.', 'error'); return; }
      try {
        const res = await api(`/api/guilds/${state.guildId}/staff-roles/scan`, { method: 'POST', body: { roleIds } });
        const r = res.report;
        $('#scanReport').innerHTML = card('Latest website scan', `<div class="grid cols-4">
          ${statCard('Members scanned', num(r.membersScanned ?? 0), 'Visible to the bot cache', 'cyan')}
          ${statCard('Staff discovered', num(r.staffDiscovered ?? 0), `${num(r.existingProfiles ?? 0)} existing profiles`, 'green')}
          ${statCard('Newly registered', num(r.newlyRegistered ?? 0), 'Marked NEW STAFF', 'purple')}
          ${statCard('Coverage', String(r.coverageLevel || 'PARTIAL'), 'Cache-based scan', 'amber')}
        </div>${(r.unmatchedRoles || []).length ? `<div class="warn-box mt-16">Roles with no members: ${r.unmatchedRoles.map(esc).join(', ')}</div>` : ''}${r.fetchWarning ? `<div class="warn-box mt-16">${esc(r.fetchWarning)}</div>` : ''}`);
        toast('Website staff scan completed.', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
    $$('[data-remove-role]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Stop monitoring this role? Existing staff history is preserved.')) return;
      try {
        await api(`/api/guilds/${state.guildId}/staff-roles/${encodeURIComponent(b.dataset.removeRole)}`, { method: 'DELETE' });
        toast('Staff role removed from monitoring.', 'success');
        renderStaffRoles();
      } catch (err) { toast(err.message, 'error'); }
    }));
  };
  draw();
}

/* ================================ ACCESS ================================== */
async function renderAccess() {
  if (!requireCan('SERVER_MANAGE_ROLES')) return;
  const d = await api(`/api/guilds/${state.guildId}/access`);
  state.accessData = d;
  const rows = d.assignments.map((a) => {
    const self = a.user_id === state.me.user.id;
    return `<tr class="${self ? 'access-self' : ''}">
      <td><strong>${esc(a.username)}</strong><span class="sub mono">${esc(a.user_id)}</span>${self ? ' ' + badge('you', 'cyan') : ''}</td>
      <td>${roleBadge(a.role)}</td>
      <td>${(a.permissions || []).map((p) => `<span class="chip" title="${esc(p)}">${esc(SCOPE_LABELS[p] || p)}</span>`).join(' ') || '<span class="muted small">No scopes</span>'}</td>
      <td>${badge(a.status, a.status === 'ACTIVE' ? 'green' : a.status === 'SUSPENDED' ? 'amber' : 'slate')}</td>
      <td class="small">${a.expires_at ? fmtDate(a.expires_at) : 'Never'}<span class="sub">by ${esc(a.assigned_by_name || a.assigned_by)}</span></td>
      <td class="small muted">${a.last_access_at ? relTime(a.last_access_at) : 'never'}</td>
      <td class="right nowrap">${self ? '<span class="small muted">self-edit blocked</span>' : `
        <button class="btn sm ghost" data-edit="${esc(a.assignment_id)}">Edit</button>
        ${a.status === 'SUSPENDED' ? `<button class="btn sm success" data-resume="${esc(a.assignment_id)}">Resume</button>` : `<button class="btn sm ghost" data-suspend="${esc(a.assignment_id)}">Suspend</button>`}
        <button class="btn sm danger" data-revoke="${esc(a.assignment_id)}">Remove</button>`}</td>
    </tr>`;
  }).join('');
  const templateCards = d.roleTemplates.filter((t) => t.role !== 'GLOBAL_ADMIN').map((t) => `<div class="role-card">
    <h4>${esc(t.label)}</h4><p>${esc(t.grantableHere ? 'Grantable by your role' : 'Owner-only')}</p>
    <div class="scopes">${t.defaultPermissions.map((s) => `<span>${esc(SCOPE_LABELS[s] || s)}</span>`).join('')}</div>
  </div>`).join('');
  const matrixRows = d.matrix.map((m) => `<tr><td>${esc(m.action)}</td><td>${esc(m.globalOwner)}</td><td>${esc(m.globalAdmin)}</td><td>${esc(m.serverOwner)}</td><td>${esc(m.serverCoOwner)}</td><td>${esc(m.serverAdmin)}</td><td>${esc(m.viewer)}</td></tr>`).join('');
  setView(pageHead('Access & roles', 'Assign, edit, suspend or revoke website roles with explicit scopes and expiry. Self-promotion and privilege escalation are blocked server-side and audited.')
    + `<div class="page-actions mt-8"><button class="btn primary" id="addAccess">＋ Assign role</button><a class="btn ghost" href="#/g/${state.guildId}/audit">Audit history</a></div>`
    + `<div class="info-box">Your role: ${roleBadge(d.actorKind)} ${d.isServerOwner ? badge('verified server owner', 'green') : ''} · Assignable roles: ${d.assignableRoles.map((r) => `<span class="chip">${esc(ROLE_LABELS[r] || r)}</span>`).join(' ')}</div>`
    + `<div class="mt-16">${card('Role assignments', rows ? `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Scopes</th><th>Status</th><th>Expiry</th><th>Last access</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No website role assignments', 'The Server Owner always keeps full access and is not listed as an assignment.'))}</div>`
    + `<div class="mt-16">${card('Role templates', `<div class="grid cols-3">${templateCards}</div>`)}</div>`
    + `<div class="mt-16">${card('Permission matrix', `<div class="table-wrap"><table><thead><tr><th>Action</th><th>Global Owner</th><th>Global Admin</th><th>Server Owner</th><th>Server Co-Owner</th><th>Server Admin</th><th>Viewer</th></tr></thead><tbody>${matrixRows}</tbody></table></div>`)}</div>`);

  $('#addAccess').addEventListener('click', () => openAccessModal());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const assignment = d.assignments.find((a) => a.assignment_id === b.dataset.edit);
    openAccessEditModal(assignment);
  }));
  $$('[data-revoke]').forEach((b) => b.addEventListener('click', () => confirmAccessAction(b.dataset.revoke, 'revoke')));
  $$('[data-suspend]').forEach((b) => b.addEventListener('click', () => confirmAccessAction(b.dataset.suspend, 'suspend')));
  $$('[data-resume]').forEach((b) => b.addEventListener('click', () => confirmAccessAction(b.dataset.resume, 'resume')));
}

function scopeCheckboxes(scopes, selected = [], idPrefix = 'scope') {
  return scopes.map((s) => `<label class="check-row"><input type="checkbox" id="${idPrefix}_${esc(s)}" name="${idPrefix === 'scope' ? 'scope_' : 'edit_'}${esc(s)}" value="${esc(s)}" ${selected.includes(s) ? 'checked' : ''}/>
    <span class="txt"><strong>${esc(SCOPE_LABELS[s] || s)}</strong><small>${esc(s)}</small></span></label>`).join('');
}

function openAccessModal() {
  const d = state.accessData;
  const roles = d.assignableRoles.filter((r) => r !== 'GLOBAL_ADMIN');
  const templates = new Map(d.roleTemplates.map((t) => [t.role, t]));
  const first = roles[0];
  openModal('Assign website role', `
    <form id="modalForm">
      <div class="field"><label for="accessMemberSearch">Discord member</label>
        <input class="input" id="accessMemberSearch" placeholder="Search display name, username or user ID" autocomplete="off" />
        <div id="memberResults" class="search-results hidden"></div>
        <input type="hidden" name="userId" id="accessUserId" /><input type="hidden" name="username" id="accessUsername" />
        <div id="selectedMember" class="small muted mt-8">No member selected.</div>
      </div>
      <div class="field"><label for="accessRole">Website role</label><select class="input" id="accessRole" name="role">${roles.map((r) => `<option value="${esc(r)}" ${r === first ? 'selected' : ''}>${esc(ROLE_LABELS[r] || r)}</option>`).join('')}</select></div>
      <div class="field"><label>Explicit scopes</label><div id="scopeBox">${scopeCheckboxes(templates.get(first)?.allowedPermissions || [], templates.get(first)?.defaultPermissions || [])}</div>
        <div class="hint">Only scopes allowed for the selected role can be granted. The server owner's full access is never derived from this form.</div></div>
      <div class="form-grid">
        <div class="field"><label for="accessExpires">Expires at (optional)</label><input class="input" id="accessExpires" name="expiresAt" type="datetime-local" /></div>
        <div class="field"><label for="accessReason">Reason</label><input class="input" id="accessReason" name="reason" maxlength="500" placeholder="Why is this access needed?" /></div>
      </div>
    </form>`, async (values) => {
    if (!values.userId) throw new Error('Select a Discord member from the search results.');
    const permissions = (templates.get(values.role)?.allowedPermissions || []).filter((s) => values[`scope_${s}`]);
    if (!permissions.length) throw new Error('Select at least one scope.');
    await api(`/api/guilds/${state.guildId}/access`, { method: 'POST', body: {
      userId: values.userId, username: values.username, role: values.role, permissions,
      expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null, reason: values.reason,
    } });
    toast('Role assigned and audited.', 'success');
    renderAccess();
  });

  const roleSelect = $('#accessRole');
  roleSelect.addEventListener('change', () => {
    const t = templates.get(roleSelect.value);
    $('#scopeBox').innerHTML = scopeCheckboxes(t?.allowedPermissions || [], t?.defaultPermissions || []);
  });

  const searchInput = $('#accessMemberSearch');
  const renderResults = (members) => {
    const box = $('#memberResults');
    if (!members.length) { box.innerHTML = '<div class="selector-item muted">No matching server members.</div>'; box.classList.remove('hidden'); return; }
    box.innerHTML = members.map((m) => `<button type="button" data-pick-member="${esc(m.id)}" data-pick-name="${esc(m.displayName)}"><span class="avatar">${esc(initials(m.displayName))}</span><span>${esc(m.displayName)}<span class="sub mono">${esc(m.id)}</span></span></button>`).join('');
    box.classList.remove('hidden');
    $$('[data-pick-member]', box).forEach((b) => b.addEventListener('click', () => {
      $('#accessUserId').value = b.dataset.pickMember;
      $('#accessUsername').value = b.dataset.pickName;
      $('#selectedMember').innerHTML = `Selected: <strong>${esc(b.dataset.pickName)}</strong> <span class="mono">${esc(b.dataset.pickMember)}</span>`;
      box.classList.add('hidden');
    }));
  };
  const doSearch = debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { $('#memberResults').classList.add('hidden'); return; }
    try {
      const res = await api(`/api/guilds/${state.guildId}/members?q=${encodeURIComponent(q)}`);
      renderResults(res.members);
    } catch (err) { $('#memberResults').innerHTML = `<div class="selector-item muted">${esc(err.message)}</div>`; $('#memberResults').classList.remove('hidden'); }
  }, 350);
  searchInput.addEventListener('input', doSearch);
}

function openAccessEditModal(assignment) {
  const d = state.accessData;
  const template = d.roleTemplates.find((t) => t.role === assignment.role);
  if (!template) { toast('No editable template for this role.', 'error'); return; }
  openModal(`Edit ${ROLE_LABELS[assignment.role] || assignment.role}`, `
    <form id="modalForm">
      <p class="small"><strong>${esc(assignment.username)}</strong> <span class="mono">${esc(assignment.user_id)}</span></p>
      <div class="field"><label>Explicit scopes</label>${scopeCheckboxes(template.allowedPermissions, assignment.permissions, 'edit')}</div>
      <div class="field"><label for="editExpires">Expires at</label><input class="input" id="editExpires" name="expiresAt" type="datetime-local" value="${assignment.expires_at ? new Date(assignment.expires_at).toISOString().slice(0, 16) : ''}" /></div>
      <div class="field"><label for="editReason">Reason</label><input class="input" id="editReason" name="reason" maxlength="500" /></div>
      <p class="small muted">Changes take effect on the affected user's next request. Escalation beyond your own role or the role template is rejected.</p>
    </form>`, async (values) => {
    const permissions = template.allowedPermissions.filter((s) => values[`edit_${s}`]);
    await api(`/api/guilds/${state.guildId}/access/${encodeURIComponent(assignment.assignment_id)}`, { method: 'PATCH', body: {
      permissions, expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null, reason: values.reason,
    } });
    toast('Role assignment updated.', 'success');
    renderAccess();
  });
}

function confirmAccessAction(id, action) {
  const labels = { revoke: 'Remove role', suspend: 'Suspend access', resume: 'Resume access' };
  openModal(labels[action], `<form id="modalForm"><div class="field"><label for="accessActionReason">Reason</label><textarea class="input" id="accessActionReason" name="reason" required minlength="3" maxlength="500"></textarea></div>
    <p class="small muted">${action === 'revoke' ? 'The assignment is revoked immediately and the user is audited out on their next request.' : 'The change is recorded in the audit log.'}</p></form>`, async (values) => {
    if (action === 'revoke') {
      await api(`/api/guilds/${state.guildId}/access/${encodeURIComponent(id)}`, { method: 'DELETE', body: { reason: values.reason } });
    } else {
      await api(`/api/guilds/${state.guildId}/access/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { reason: values.reason } });
    }
    toast(`Access ${action === 'revoke' ? 'revoked' : action === 'suspend' ? 'suspended' : 'resumed'}.`, 'success');
    renderAccess();
  });
}

/* ================================ SETTINGS ================================ */
async function renderSettings() {
  if (!requireCan('SERVER_VIEW_OVERVIEW')) return;
  const d = await api(`/api/guilds/${state.guildId}/settings`);
  const locked = !d.canManage ? 'disabled' : '';
  setView(pageHead('Server settings', d.canManage ? 'Thresholds, channels, monitoring pauses and feature toggles. Changes are audited.' : 'Read-only view. You need SERVER_MANAGE_SETTINGS to change these values.')
    + `<form id="settingsForm"><div class="split">
      <div class="col">
        ${card('Monitoring thresholds', `<div class="form-grid">
          <div class="field"><label for="atRisk">At risk after (hours)</label><input class="input" id="atRisk" name="atRiskHours" type="number" min="1" max="720" value="${Number(d.guild.atRiskHours)}" ${locked} /></div>
          <div class="field"><label for="inactive">Inactive after (hours)</label><input class="input" id="inactive" name="inactiveHours" type="number" min="1" max="720" value="${Number(d.guild.inactiveHours)}" ${locked} /></div>
          <div class="field"><label for="escalation">Escalation after (hours)</label><input class="input" id="escalation" name="escalationHours" type="number" min="1" max="1440" value="${Number(d.guild.escalationHours)}" ${locked} /></div>
          <div class="field"><label for="baseline">Observation baseline (hours)</label><input class="input" id="baseline" name="observationBaselineHours" type="number" min="0" max="168" value="${Number(d.guild.observationBaselineHours)}" ${locked} /></div>
          <div class="field"><label for="scanInterval">Scan interval (minutes)</label><input class="input" id="scanInterval" name="scanIntervalMinutes" type="number" min="60" max="1440" value="${Number(d.guild.scanIntervalMinutes)}" ${locked} /></div>
          <div class="field"><label>Warning expiry</label><input class="input" value="${num(d.guild.warningExpiryDays)} days" disabled /></div>
        </div><div class="hint">Defaults are 24h at risk, 48h inactive and 72h escalation. Scans run every six hours by default.</div>`)}
        ${card('Channels', `<div class="form-grid">
          <div class="field"><label for="alertChannel">Alert channel ID</label><input class="input" id="alertChannel" name="alertChannelId" value="${esc(d.guild.alertChannelId || '')}" placeholder="Channel ID" ${locked} /></div>
          <div class="field"><label for="logChannel">Audit log channel ID</label><input class="input" id="logChannel" name="logChannelId" value="${esc(d.guild.logChannelId || '')}" placeholder="Channel ID" ${locked} /></div>
          <div class="field"><label for="reviewChannel">Fallback review channel ID</label><input class="input" id="reviewChannel" name="fallbackReviewChannelId" value="${esc(d.guild.fallbackReviewChannelId || '')}" placeholder="Channel ID" ${locked} /></div>
          <div class="field"><label>Support work channels</label><input class="input" value="${(d.guild.supportWorkChannelIds || []).join(', ') || 'Not configured'}" disabled /></div>
        </div><div class="hint">Configure channel IDs in Discord with /settings inactivity and /server setup. Leave blank to clear a channel.</div>`)}
      </div>
      <div class="col">
        ${card('Feature toggles', `<div class="col">${d.features.map((f) => `<label class="check-row"><input type="checkbox" name="feature_${esc(f.key)}" ${f.effectiveEnabled ? 'checked' : ''} ${locked || f.globallyDisabled ? 'disabled' : ''}/>
          <span class="txt"><strong>${esc(f.label)}</strong><small>${f.globallyDisabled ? 'Restricted globally by the Global Owner' : f.guildEnabled ? 'Enabled for this server' : 'Disabled for this server'}</small></span></label>`).join('')}</div>`)}
        ${card('Platform defaults', `<dl class="kv">
          <dt>Auto-claim window</dt><dd>${num(d.globalSettings.autoClaimMinutes)} minutes</dd>
          <dt>Transcript retention</dt><dd>${num(d.globalSettings.retentionDays)} days</dd>
          <dt>Baseline completed</dt><dd>${d.guild.baselineCompletedAt ? fmtDate(d.guild.baselineCompletedAt) : 'Not yet'}</dd>
          <dt>Approval policy</dt><dd>${esc(d.guild.approvalPolicyOverride || 'Platform default')}</dd>
        </dl><p class="small muted mb-0">Platform defaults are managed by the Global Owner in System health → settings.</p>`)}
        ${d.canManage ? `<div class="card"><button class="btn primary" type="submit" id="saveSettings">Save settings</button><p class="small muted mt-8 mb-0">Saving reinitializes the scheduler so new intervals apply immediately.</p></div>` : ''}
      </div>
    </div></form>`);

  if (!d.canManage) return;
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const body = {
      atRiskHours: Number(form.get('atRiskHours')),
      inactiveHours: Number(form.get('inactiveHours')),
      escalationHours: Number(form.get('escalationHours')),
      observationBaselineHours: Number(form.get('observationBaselineHours')),
      scanIntervalMinutes: Number(form.get('scanIntervalMinutes')),
      alertChannelId: form.get('alertChannelId') || null,
      logChannelId: form.get('logChannelId') || null,
      fallbackReviewChannelId: form.get('fallbackReviewChannelId') || null,
      features: d.features.filter((f) => !f.globallyDisabled).map((f) => ({ key: f.key, enabled: Boolean(form.get(`feature_${f.key}`)) })),
    };
    if (!(body.atRiskHours < body.inactiveHours && body.inactiveHours < body.escalationHours)) {
      toast('Thresholds must increase: at-risk < inactive < escalation.', 'error');
      return;
    }
    try {
      await api(`/api/guilds/${state.guildId}/settings`, { method: 'PATCH', body });
      toast('Settings saved and audited.', 'success');
      renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ============================== INTEGRATIONS ============================== */
async function renderIntegrations() {
  if (!requireCan('SERVER_VIEW_TICKETS')) return;
  const d = await api(`/api/guilds/${state.guildId}/integrations`);
  const rows = d.integrations.map((i) => `<tr>
    <td><strong>${esc(i.external_name)}</strong><span class="sub mono">${esc(i.id)}</span></td>
    <td>${badge(i.integration_type, 'purple')}</td>
    <td>${i.is_active ? badge('active', 'green') : badge('inactive', 'slate')}</td>
    <td class="small muted">${Object.keys(i.config || {}).map((k) => `<span class="chip">${esc(k)}</span>`).join(' ') || 'No public fields'}</td>
    <td class="small muted">${fmtDate(i.updated_at)}</td>
    <td class="right">${d.canManage ? `<button class="btn sm ghost" data-test-integration="${esc(i.id)}">Test</button><button class="btn sm danger" data-delete-integration="${esc(i.id)}">Remove</button>` : ''}</td>
  </tr>`).join('');
  const adapterCards = d.adapters.map((a) => `<div class="role-card">
    <h4>${esc(a.displayName)}</h4><p class="mono">${esc(a.id)}</p>
    <div class="scopes">${(a.supportedEvents || []).map((e) => `<span>${esc(e)}</span>`).join('')}</div>
    ${(a.limitations || []).length ? `<p class="small muted mt-8 mb-0">${a.limitations.map(esc).join(' · ')}</p>` : ''}
  </div>`).join('');
  const channelRows = d.ticketChannels.map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.id)}</td><td>${badge(c.targetType || c.target_type || '—', 'slate')}</td><td>${esc(c.adapter || c.adapter_type || 'discord')}</td></tr>`).join('');
  setView(pageHead('Ticket integrations', 'Modular adapters capture conversations from Discord and supported ticket tools. Diagnostics report real API and permission coverage.')
    + (d.canManage ? '<div class="page-actions mt-8"><button class="btn primary" id="addIntegration">＋ Add integration</button><button class="btn ghost" id="runDiagnostics">Run diagnostics</button></div>' : '')
    + `<div class="mt-16">${card('Configured integrations', rows ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>State</th><th>Config fields</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No integrations', 'Discord capture works without an integration. Add a ticket-tool adapter only if you use one.'))}</div>`
    + `<div class="mt-16">${card('Ticket channels', channelRows ? `<div class="table-wrap"><table><thead><tr><th>Channel</th><th>ID</th><th>Target</th><th>Adapter</th></tr></thead><tbody>${channelRows}</tbody></table></div>` : '<p class="muted small">No ticket channels configured. Use /ticket channels in Discord to add them.</p>')}</div>`
    + `<div class="mt-16">${card('Adapter capabilities', `<div class="grid cols-3">${adapterCards || emptyState('No adapters registered', 'The adapter registry is empty.')}</div>`)}</div>`
    + '<div id="diagBody" class="mt-16"></div>');

  if (d.canManage) {
    $('#addIntegration').addEventListener('click', () => openModal('Add ticket integration', `<form id="modalForm">
      <div class="form-grid">
        <div class="field"><label for="intType">Integration type</label><select class="input" id="intType" name="type">${['ticket-tool', 'tickets-v2', 'custom', 'webhook', 'discord'].map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label for="intName">Display name</label><input class="input" id="intName" name="name" maxlength="80" required /></div>
      </div>
      <div class="field"><label for="intConfig">Adapter configuration (JSON)</label><textarea class="input mono" id="intConfig" name="config" placeholder='{"apiKey":"..."}'>{\n  \n}</textarea>
        <div class="hint">Secrets are stored server-side and never returned to the browser after saving.</div></div>
      </form>`, async (values) => {
      let config = {};
      try { config = values.config?.trim() ? JSON.parse(values.config) : {}; } catch { throw new Error('Configuration must be valid JSON.'); }
      await api(`/api/guilds/${state.guildId}/integrations`, { method: 'POST', body: { type: values.type, name: values.name, config } });
      toast('Integration saved.', 'success');
      renderIntegrations();
    }));
    $('#runDiagnostics').addEventListener('click', async () => {
      try {
        const res = await api(`/api/guilds/${state.guildId}/integrations/test`, { method: 'POST', body: {} });
        const r = res.report;
        $('#diagBody').innerHTML = card('Diagnostics', `<div class="grid cols-3">
          ${statCard('Coverage', String(r.coverageLevel), 'Based on permission checks', r.coverageLevel === 'FULL' ? 'green' : 'amber')}
          ${statCard('Accessible', num(r.accessibleCount), 'Ticket channels readable', 'green')}
          ${statCard('Inaccessible', num(r.inaccessibleCount), 'Permission gaps', r.inaccessibleCount ? 'red' : 'green')}
        </div><div class="table-wrap mt-16"><table><thead><tr><th>Adapter</th><th>Health</th><th>Coverage</th><th>Missing permissions</th><th>Channel issues</th></tr></thead><tbody>${(r.adapterReports || []).map((a) => `<tr><td>${esc(a.adapterName || a.adapterId || '—')}<span class="sub mono">${esc(a.adapterId || '')}</span></td><td>${badge(a.healthy ? 'healthy' : 'attention', a.healthy ? 'green' : 'red')}</td><td>${badge(a.coverageLevel || '—', a.coverageLevel === 'FULL' ? 'green' : 'amber')}</td><td class="small muted">${(a.missingPermissions || []).map(esc).join(', ') || 'None'}</td><td class="small muted">${(a.channelIssues || []).map(esc).join('; ') || 'None'}</td></tr>`).join('')}</tbody></table></div>`);
        toast('Diagnostics completed.', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
    $$('[data-test-integration]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await api(`/api/guilds/${state.guildId}/integrations/${encodeURIComponent(b.dataset.testIntegration)}/test`, { method: 'POST', body: {} });
        toast(`Diagnostics: ${res.report.coverageLevel} coverage (${res.report.accessibleCount} accessible).`, 'info');
      } catch (err) { toast(err.message, 'error'); }
    }));
    $$('[data-delete-integration]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this integration? Captured ticket history is preserved.')) return;
      try {
        await api(`/api/guilds/${state.guildId}/integrations/${encodeURIComponent(b.dataset.deleteIntegration)}`, { method: 'DELETE' });
        toast('Integration removed.', 'success');
        renderIntegrations();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }
}

/* ================================ REPORTS ================================= */
async function renderReports() {
  if (!requireCan('SERVER_VIEW_ANALYTICS')) return;
  const period = state.reportPeriod || 'WEEKLY';
  setView(pageHead('Reports', 'Guild-scoped reports and exports. Global analytics are available only to the Global Owner.')
    + `<div class="toolbar">${['DAILY', 'WEEKLY', 'MONTHLY'].map((p) => `<button class="btn ${p === period ? 'primary' : 'ghost'}" data-report-period="${p}">${p[0] + p.slice(1).toLowerCase()}</button>`).join('')}</div><div id="gBody"></div>`);
  const d = await api(`/api/guilds/${state.guildId}/reports?period=${period}`);
  const r = d.report;
  const staffRows = r.staffRows.map((s) => `<tr><td>${esc(s.displayName)}</td><td>${statusBadge(s.monitoringStatus)}</td><td>${num(s.ticketsHandled)}</td><td>${num(s.ticketsResolved)}</td><td>${s.avgResolutionSec != null ? dur(s.avgResolutionSec) : '—'}</td><td class="small muted">${esc(s.fairnessNote)}</td></tr>`).join('');
  $('#gBody').innerHTML = `
    <div class="grid cols-4">
      ${statCard('Period', `${fmtDate(r.fromIso, false)}`, `to ${fmtDate(r.toIso, false)}`, 'purple')}
      ${statCard('Tickets opened', num(r.ticketMetrics.openedInPeriod), `${num(r.ticketMetrics.resolvedInPeriod)} resolved`, 'cyan')}
      ${statCard('Warnings issued', num(r.warningMetrics.issuedInPeriod), `${num(r.reviewOutcomes.pending)} reviews pending`, 'amber')}
      ${statCard('Coverage', String(r.coverageLevel), 'Reported honestly', r.coverageLevel === 'FULL' ? 'green' : 'amber')}
    </div>
    <div class="mt-16">${card('Report', `<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Status</th><th>Handled</th><th>Resolved</th><th>Avg resolution</th><th>Fairness note</th></tr></thead><tbody>${staffRows || '<tr><td colspan="6" class="muted">No staff rows for this period.</td></tr>'}</tbody></table></div>
      <div class="row wrap mt-16">${d.canExport ? `<button class="btn primary" data-export="csv">⇩ CSV</button><button class="btn" data-export="png">⇩ PNG</button><button class="btn" data-export="pdf">⇩ PDF</button>` : '<span class="muted small">Export permission (SERVER_EXPORT_REPORTS) is not granted for your role.</span>'}</div>`)}</div>`;
  $$('[data-report-period]').forEach((b) => b.addEventListener('click', () => { state.reportPeriod = b.dataset.reportPeriod; renderReports(); }));
  $$('[data-export]').forEach((b) => b.addEventListener('click', async () => {
    const format = b.dataset.export;
    b.disabled = true;
    try {
      const res = await api(`/api/guilds/${state.guildId}/reports/export?format=${format}&period=${period}`);
      const mime = format === 'csv' ? 'text/csv' : format === 'png' ? 'image/png' : 'application/pdf';
      downloadBase64(res.base64, res.filename, mime);
      toast(`${format.toUpperCase()} export prepared.`, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  }));
}

/* ================================= AUDIT ================================== */
async function renderGuildAudit() {
  if (!requireCan('SERVER_VIEW_AUDIT')) return;
  const category = state.auditCategory || '';
  setView(pageHead('Server audit log', 'Isolated to this server. Transcript access, role changes, warning decisions and settings changes are recorded.')
    + `<div class="toolbar"><input class="input" id="auditCategory" placeholder="Filter category, e.g. TICKET or WEB_ROLE" value="${esc(category)}" style="max-width:320px" /><button class="btn" id="auditApply">Apply</button></div><div id="gBody"></div>`);
  const d = await api(`/api/guilds/${state.guildId}/audit?limit=100${category ? `&category=${encodeURIComponent(category)}` : ''}`);
  const rows = d.logs.map((l) => `<tr><td class="small muted nowrap">${fmtDate(l.created_at)}</td><td>${auditCell(l)}</td><td class="mono small">${esc(l.actor_user_id || 'SYSTEM')}<span class="sub">${esc(l.actor_tag || '')}</span></td><td class="mono small">${esc(l.target_id || '—')}</td><td class="small muted">${esc(JSON.stringify(l.metadata_json || {}).slice(0, 120))}</td></tr>`).join('');
  $('#gBody').innerHTML = card('', rows ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Metadata</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No audit entries', 'No server actions have been recorded yet.'));
  $('#auditApply').addEventListener('click', () => { state.auditCategory = $('#auditCategory').value.trim(); renderGuildAudit(); });
}

async function renderNotifications() {
  if (!requireCan('SERVER_VIEW_OVERVIEW')) return;
  const d = await api(`/api/guilds/${state.guildId}/notifications`);
  const rows = d.notifications.map((n) => `<tr><td class="small muted">${fmtDate(n.created_at)}</td><td><strong>${esc(n.title)}</strong><span class="sub">${esc(n.summary || '')}</span></td><td>${badge(n.notification_type.replace(/_/g, ' '), 'purple')}</td><td>${n.delivered ? badge('delivered', 'green') : badge('queued', 'amber')}</td><td>${n.is_read ? badge('read', 'slate') : badge('unread', 'cyan')}</td></tr>`).join('');
  setView(pageHead('Notifications', 'Delivery history for alerts and review requests addressed to your account in this server.')
    + card('', rows ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Notification</th><th>Type</th><th>Delivery</th><th>Read</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No notifications', 'Notifications appear here when the bot sends you an alert or review request.')));
}

/* ============================================================================
   BOOTSTRAP
   ========================================================================== */
function wireShell() {
  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#refreshBtn').addEventListener('click', () => route(false));
  $('#userMenuBtn').addEventListener('click', () => $('#userMenu').classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#userChip')) $('#userMenu').classList.add('hidden');
    const closer = e.target.closest('[data-close="modal"]');
    if (closer) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.modalOpen) closeModal();
  });
  $('#userMenu').addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    $('#userMenu').classList.add('hidden');
    if (action === 'logout') {
      try {
        await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': state.csrf } });
      } catch { /* cookie clearing is best effort */ }
      state.me = null;
      location.hash = '';
      location.reload();
    } else if (action === 'open-sessions') {
      location.hash = '#/global/sessions';
    }
  });
  window.addEventListener('hashchange', () => { if (state.me) route(false); });
}

async function boot() {
  wireShell();
  const params = new URLSearchParams(location.search);
  const authError = params.get('auth_error');
  if (authError) {
    history.replaceState(null, '', location.pathname + location.hash);
  }
  let config = null;
  try { config = await api('/api/public/config'); } catch { config = null; }
  let me = null;
  try { me = await api('/api/me'); } catch (err) { me = null; }
  if (!me) {
    await showAuth(config, authError === 'oauth_not_configured'
      ? 'Discord OAuth2 is not configured. Complete the setup steps below.'
      : authError ? decodeURIComponent(authError) : null);
    return;
  }
  state.me = me;
  state.csrf = me.csrfToken;
  $('#boot').classList.add('hidden');
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderChrome();
  await route(true);
}

document.addEventListener('DOMContentLoaded', boot);
