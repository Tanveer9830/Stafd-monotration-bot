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
