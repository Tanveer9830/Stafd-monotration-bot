# TANVEER STAFF MONITOR — INSTALLATION & DEVELOPER PORTAL GUIDE

**Project:** TANVEER STAFF MONITOR  
**Creator:** MADE BY TANVEER | Discord: `tanveer5637`  
**Permanent Global Owner ID:** `1131248987173814336`  
**Permanent Footer:** `⚡ Made by Tanveer | Discord: tanveer5637`

---

## 1. Prerequisites

- **Node.js:** `v20.x` or `v22.x` LTS (64-bit)
- **Build Tools (for `better-sqlite3` native C++ compilation if prebuild unavailable):** `gcc`, `g++`, `make`, `python3`
- **Fonts (recommended on headless Linux for crisp PNG/PDF charts):** `fonts-dejavu-core` (`sudo apt-get install -y fonts-dejavu-core build-essential python3`)

---

## 2. Discord Developer Portal Configuration

1. Open [https://discord.com/developers/applications](https://discord.com/developers/applications) and select or create your application (`TANVEER STAFF MONITOR`).
2. Copy the **Application ID** (`DISCORD_CLIENT_ID`).
3. Navigate to the **Bot** tab:
   - Reset/copy your **Bot Token** (`DISCORD_TOKEN`) — keep it strictly confidential.
   - Configure **Privileged Gateway Intents**:
     - **Server Members Intent (`GuildMembers`):** **ENABLED** *(Required for complete configured staff roster synchronization, detecting role additions/removals, and preserving historical records when staff leave).*
     - **Presence Intent (`GuildPresences`):** **OPTIONAL / OFF by default** *(Online status never counts as work; enable only if you toggle `presence_monitoring=true`).*
     - **Message Content Intent (`MessageContent`):** **OPTIONAL / OFF by default** *(Embeds, channel events, audit logs, and metadata work without it; enable only if you want deeper word-count & duplicate-text filtering on plain-text ticket replies).*
4. Navigate to **OAuth2 → URL Generator**:
   - **Scopes:** `bot`, `applications.commands`
   - **Bot Permissions (Least-Privilege Set):**
     - `View Channels`
     - `Send Messages`
     - `Send Messages in Threads`
     - `Embed Links`
     - `Attach Files` *(for PNG, CSV, PDF reports and animated GIF / PNG banners)*
     - `Read Message History` *(for baseline & ticket history inspection)*
     - `View Audit Log` *(for observing approved Discord moderation actions)*
     - `Use External Emojis` *(for custom Application Emojis)*

---

## 3. Safe Interactive Setup

```bash
npm install
npm run setup
npm run build
npm run deploy:commands
npm start
```

### Installer Safety Guarantees
- `npm run setup` **never** overwrites an existing `.env` file.
- `npm run setup` **never** overwrites or erases an existing SQLite database (`./data/tanveer-monitor.sqlite`).
- `GLOBAL_OWNER_ID` is permanently locked in code to `1131248987173814336`.

---

## 4. Custom Emoji Upload Procedure

Custom emoji `128x128` PNG and animated GIF assets are pre-generated in `assets/emojis/` alongside `assets/emojis/emoji-manifest.json`.

- **Automatic Application Emoji Upload (Recommended):**
  Once `.env` has valid `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, run:
  ```bash
  npm run upload:emojis
  ```
  This uploads `tsm_owner`, `tsm_scanning`, `tsm_active`, etc. to your Discord Application's Developer Portal Emoji tab via REST API v10 and writes the real `<:tsm_name:id>` / `<a:tsm_name:id>` strings into `assets/emojis/emoji-manifest.json`.
- **Manual Upload Option:**
  Open **Discord Developer Portal → Your App → Emojis**, upload files from `assets/emojis/tsm_*.png` / `.gif`, and paste the real `<:name:id>` tags into `assets/emojis/emoji-manifest.json`.
- **Automatic Fallback:** Any unconfigured or unavailable emoji automatically falls back to validated Unicode emojis — fake IDs are never used.
