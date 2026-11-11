# TANVEER STAFF MONITOR — Ticket Integrations

Tickets are recorded in `ticket_records`; captured messages live in `ticket_messages`. Discord capture works without any third-party integration. Alternative ticket tools are supported through modular adapters registered in `src/tickets/`.

---

## 1. Discord ticket capture

1. Configure ticket categories/channels:
   ```text
   /ticket setup target:#tickets adapter:discord
   /ticket categories
   /ticket channels
   ```
2. The bot observes channel create/update/delete and messages in configured channels. It captures:
   - ticket channel ID, name, category and inferred ticket number
   - opener, claim/assignment, status, timestamps
   - author, content (if Message Content intent is enabled), attachments metadata, edits and deletes
3. If the **Message Content** intent is disabled, message rows are still recorded with `content_available = 0`; the dashboard shows an honest notice instead of fabricated text. Embeds and channel metadata remain available.
4. `/ticket diagnose` reports accessible/inaccessible channels and adapter limitations.

### Required Discord permissions

- View Channels
- Read Message History
- Send Messages / Embed Links / Attach Files (reports and alerts)
- Manage Channels only if the bot should create or archive ticket channels

---

## 2. Supported adapters

| Adapter ID | Purpose | Notes |
|---|---|---|
| `discord` / `generic` | Native Discord ticket channels and threads | Works with no third-party bot |
| `ticket-tool` | Ticket Tool-created channels | Detects known bot IDs and channel patterns; needs View + Read History |
| `tickets-v2` | Tickets v2-created channels | Same permission requirements |
| `custom` | Webhook/API or custom normalisation | Configure its JSON in the dashboard; the adapter reports unsupported events honestly |
| `webhook` | Inbound event bridge | Accepts normalised ticket events; requires a secret you control |

Adapters expose `supportedEvents` and `limitations`. The dashboard **Integrations → Adapter capabilities** panel reads these values from the registry; it does not invent capabilities.

---

## 3. Add an integration (website)

1. Sign in with `SERVER_MANAGE_INTEGRATIONS` (Server Co-Owner by default; Server Admin must be granted it).
2. Open **Integrations**.
3. Choose **Add integration**, select the adapter type, name it, then paste its JSON configuration.
4. Secrets are stored in `integration_configs.config_json` and are never returned to the browser. The list shows only field names.
5. Use **Test** to run diagnostics. The result includes coverage, accessible/inaccessible channel counts, adapter health and missing permissions.

Delete removes the configuration but keeps captured ticket history. Ticket history is always guild-scoped.

---

## 4. Five-minute first-responder automatic claim

- When a ticket opens, the first staff message is identified using the configured staff roles and channel permissions.
- A row is written to `ticket_claim_timers` with `execute_at = first_response + N minutes` (`ticket_auto_claim_minutes`, default 5, range 1–120).
- Timers are persisted in SQLite and resumed after a restart.
- The scheduler executes due timers with a guarded transition:
  - eligibility is rechecked in an update before claiming;
  - a conditional `PENDING → EXECUTED` transition makes the operation concurrency-safe;
  - if the ticket was manually claimed, closed or otherwise changed, the timer is marked `CANCELLED` with `TICKET_NO_LONGER_ELIGIBLE`.
- Manual claim and ticket close cancel the pending timer.
- Claim labels in the UI and API:
  - `AUTOMATIC` → “Automatic claim”
  - `MANUAL` → “Manual claim”
  - `NONE` → “Unclaimed”
- Every executed or cancelled timer is audited. Failed executions record `failure_reason` and can be inspected in **System Health** (`failedAutoClaims`).

The timer never punishes staff. It only records ownership credit for the **first responder** who already worked the ticket.

---

## 5. Conversation privacy

- Transcript access requires `SERVER_VIEW_TRANSCRIPTS`; each access is audited as `TICKET_TRANSCRIPT_ACCESSED`.
- Global Owners can see global audit logs, but transcript content remains subject to the same server route. There is no public transcript endpoint.
- `ticket_message_retention_days` defaults to 180 and is enforced by maintenance jobs. Set a shorter period if your privacy policy requires it.
- Message content is never sent in SSE events.
- Attachments are stored as metadata (name/size/URL where available), not downloaded by default.

---

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| Ticket created but no messages | Message Content intent; `Read Message History`; adapter channel configuration |
| Tickets missing entirely | Target category/channel registered with `/ticket channels`; bot can view the category |
| Auto-claim never fires | `ticket_auto_claim_minutes`; scheduler running; `ticket_claim_timers` status; staff role discovery |
| Manual claim did not cancel timer | Check the timer row and audit log; a restart during execution is safe and retried |
| Integration test shows `UNAVAILABLE` | Bot cannot view/read the configured channel, or adapter credentials are invalid |
| Ticket number search returns nothing | Run `/scan tickets` to backfill, and verify `ticket_number` in `ticket_records` |

For database-level inspection, use read-only SQLite queries; never edit ticket rows while the bot is running.
