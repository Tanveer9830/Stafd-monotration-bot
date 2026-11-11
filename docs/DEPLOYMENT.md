# TANVEER STAFF MONITOR — PRODUCTION DEPLOYMENT GUIDE

Supports **Ubuntu VPS**, **Pterodactyl Node.js Hosting**, and **Local Development**.

---

## 1. Ubuntu 22.04 / 24.04 VPS Deployment (`systemd`)

```bash
# 1. Install Node.js 22 LTS & build/font packages
sudo apt-get update
sudo apt-get install -y curl git build-essential python3 fonts-dejavu-core
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Create dedicated non-root system user
sudo useradd --system --create-home --shell /usr/sbin/nologin tanveerbot
sudo mkdir -p /opt/tanveer-staff-monitor
sudo chown -R tanveerbot:tanveerbot /opt/tanveer-staff-monitor

# 3. Clone repository & install dependencies
cd /opt/tanveer-staff-monitor
sudo -u tanveerbot git clone https://github.com/Tanveer9830/Stafd-monotration-bot.git .
sudo -u tanveerbot npm install
sudo -u tanveerbot cp .env.example .env
sudo -u tanveerbot chmod 600 .env
# Edit /opt/tanveer-staff-monitor/.env with DISCORD_TOKEN and DISCORD_CLIENT_ID

# 4. Run database migrations, generate assets & build production bundle
sudo -u tanveerbot npm run migrate
sudo -u tanveerbot npm run generate:assets
sudo -u tanveerbot npm run build
sudo -u tanveerbot npm run deploy:commands

# 5. Enable & start systemd service
sudo cp deploy/tanveer-staff-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tanveer-staff-monitor
sudo systemctl status tanveer-staff-monitor
```

---

## 2. Pterodactyl Node.js Hosting Deployment

1. **Docker Image Selection:** Select `ghcr.io/parkervcp/yolks:nodejs_22` (or `nodejs_20`).
2. **Persistent Storage Path:** Pterodactyl mounts `/home/container` persistently. Keep `DATABASE_PATH=./data/tanveer-monitor.sqlite` and `DATABASE_BACKUP_DIR=./data/backups` so SQLite lives inside `/home/container/data/` (never `/tmp`!).
3. **Upload Files / Git Pull:** Pull this repository into `/home/container`.
4. **Environment Variables (Startup Tab or `.env`):**
   - `DISCORD_TOKEN` = `<your_bot_token>`
   - `DISCORD_CLIENT_ID` = `<your_application_id>`
   - `GLOBAL_OWNER_ID` = `1131248987173814336`
   - `DATABASE_PATH` = `./data/tanveer-monitor.sqlite`
   - `NODE_ENV` = `production`
5. **Additional Node Packages / Build:**
   - First boot / build command:
     ```bash
     npm install && npm run migrate && npm run generate:assets && npm run build && node dist/index.js
     ```
   - Subsequent fast-restart startup command:
     ```bash
     node dist/index.js
     ```
   *(If your Pterodactyl container restricts internet access to `nodejs.org` during native build and already includes local headers in `/usr/local/include/node`, set `npm_config_nodedir=/usr/local` before `npm install`.)*

---

## 3. Local Development

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, and optional DISCORD_DEV_GUILD_ID
npm install
npm run migrate
npm run generate:assets
npm run dev
```

Run automated tests anytime with:
```bash
npm test
```

---

## 4. Website dashboard in production

The dashboard runs inside the same `dist/index.js` process. No second service is required.

### Required environment

```env
WEB_ENABLED=true
WEB_HOST=127.0.0.1     # or 0.0.0.0 if exposing directly
WEB_PORT=3000
WEB_BASE_URL=https://staff.example.com
DISCORD_CLIENT_SECRET=...
OAUTH2_REDIRECT_URI=https://staff.example.com/auth/callback
COOKIE_SECURE=auto
WEB_TRUST_PROXY=true   # only behind a trusted reverse proxy
```

Add `https://staff.example.com/auth/callback` to Discord Developer Portal → OAuth2 → Redirects.

### Caddy

```caddy
staff.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy handles TLS certificates automatically. Keep the Node process bound to `127.0.0.1`.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name staff.example.com;
    # ssl_certificate / ssl_certificate_key ...
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api/events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

### Firewall

If you bind directly to `0.0.0.0`, open only the dashboard port (and never expose SQLite or the backup directory):

```bash
sudo ufw allow 3000/tcp   # example only; prefer a reverse proxy with TLS
```

### systemd

The existing `deploy/tanveer-staff-monitor.service` starts the bot and dashboard together. After changing `WEB_*` variables:

```bash
sudo systemctl restart tanveer-staff-monitor
sudo journalctl -u tanveer-staff-monitor -f
```

### Backups before upgrades

```bash
npm run backup
npm run migrate
npm run build
sudo systemctl restart tanveer-staff-monitor
```

Migration 003 adds ticket transcript, claim timer, session and web-role tables. It is additive; existing guild/staff/ticket records are preserved. Always take a verified backup first.

### Pterodactyl

- Allocate an extra port for `WEB_PORT` and set `WEB_BASE_URL` to the public URL mapped to that allocation.
- Reverse proxy TLS is strongly recommended; otherwise set `COOKIE_SECURE=false` only for trusted private networks.
- The database must live on the server's persistent volume (not the container temp directory).
