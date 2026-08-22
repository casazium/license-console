// scripts/notify-expiring.mjs
//
// Lifecycle email alerts (BETA_LAUNCH_STATUS.md §4). Until now the only
// signal a hosted tenant ever got about a license about to expire, or
// their own plan quota filling up, was noticing it themselves on the
// dashboard - nothing proactive existed at all. An independent Opus
// priority check (asked to review the remaining §4 backlog against the
// actual code, not the doc's own wording) picked this as the strongest
// next item after account-settings password/email change: it's the one
// gap where harm happens silently and lands on a THIRD PARTY - a
// tenant's own customer gets locked out when a license they're actively
// using lapses and nobody was watching the dashboard that week.
//
// Design (scoped down from "webhooks" to email alerts specifically,
// per that same review): a scheduled script, not a new always-on
// service, mirroring backup-db.mjs's own Coolify "Scheduled Task"
// pattern exactly - same plain-.mjs-no-framework shape, same reuse of
// already-configured service env vars.
//
// Cross-repo data flow, and why it's ONE HTTP call, not decrypt-and-
// call-per-tenant: casazium/license owns every license_keys/tenants row
// (who's expiring, who's near quota); this console owns every accounts
// row (which email address a tenant_id maps to) and the only
// EmailProvider integration either repo has. The two could be joined by
// decrypting each tenant's own tenant_api_key_encrypted (lib/crypto.ts)
// and calling GET /list-licenses + GET /billing/status once per tenant -
// but that's N HTTP round trips for something achievable in one, and
// more importantly it would need this plain .mjs script to import
// TypeScript app code (lib/crypto.ts, lib/email/*.ts) that nothing else
// in scripts/ does today, on a Node version (22.16.0, the repo's own
// pinned production version) not confirmed to support that without an
// experimental flag - not worth the risk for a production cron job.
// Instead, casazium/license exposes ONE new admin-gated extract endpoint
// (GET /admin/expiring-licenses, that repo's own §159/API.md) that
// returns every tenant's expiring licenses and quota-warning status in
// a single call; this script just cross-references by tenant_id against
// its own local `accounts` table. No decrypt, no per-tenant auth, no TS
// import.
//
// A genuinely new, distinct credential (NOTIFICATIONS_EXTRACT_KEY, that
// repo's own require-notifications-extract-key.js) - not a reuse of
// REPORT_EXTRACT_KEY, whose own design is explicitly "no-PII, aggregate
// counts only." This endpoint returns real per-license PII (the license
// key, issued_to), which that credential was never scoped to expose.
//
// Deliberately self-contained, not importing lib/email/*.ts - the email-
// sending logic here is a small, intentional duplicate of
// resend-provider.ts's own send() shape (plain fetch POST to Resend's
// API), for the same "no TS import from a plain script" reason above.
//
// Usage (mirrors backup-db.mjs's own env-var-reuse convention):
//   LICENSE_API_URL=https://license.example.com/v1 \
//   NOTIFICATIONS_EXTRACT_KEY=... \
//   node scripts/notify-expiring.mjs
// DB_FILE, EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM are the same
// service env vars the app itself already needs - reused here, not
// re-specified.

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = process.env.DB_FILE || './data/console.db';
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);

const licenseApiUrl = process.env.LICENSE_API_URL;
const notificationsExtractKey = process.env.NOTIFICATIONS_EXTRACT_KEY;

// Same re-notify cadence for a sustained quota warning - see the
// notification_log usage below for why this only applies to quota,
// never to an expiring license (which only ever needs one heads-up,
// full stop, since a given license only crosses the expiry window once).
const QUOTA_RENOTIFY_DAYS = 7;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Mirrors lib/email/resend-provider.ts's own send() shape and
// lib/email/stub-provider.ts's own log-instead-of-send fallback -
// intentionally duplicated, not imported (see this file's own header
// comment for why). Both are exercised: EMAIL_PROVIDER unset/'stub' logs
// instead of sending, so this script is exercisable end-to-end without
// a real Resend account, same reasoning stub-provider.ts's own header
// comment gives for the app's own default.
async function sendEmail(to, subject, html) {
  const provider = process.env.EMAIL_PROVIDER || 'stub';

  if (provider === 'stub') {
    console.log(`[stub-email] ${subject} for ${to}`);
    return;
  }

  if (provider !== 'resend') {
    throw new Error(`EMAIL_PROVIDER=${provider} has no implementation in this script.`);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: RESEND_API_KEY');
  }
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API responded with ${res.status}: ${body}`);
  }
}

function expiringLicenseEmail(license) {
  const daysLeft = Math.max(1, Math.ceil((new Date(license.expires_at).getTime() - Date.now()) / 86_400_000));
  return {
    subject: `A license expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html:
      `<p>One of your licenses is expiring soon:</p>` +
      `<ul>` +
      `<li>Key: ${escapeHtml(license.key)}</li>` +
      `<li>Product: ${escapeHtml(license.product_id)}</li>` +
      `<li>Issued to: ${escapeHtml(license.issued_to)}</li>` +
      `<li>Expires: ${escapeHtml(license.expires_at)}</li>` +
      `</ul>` +
      `<p>If this license is still in use, issue a replacement before it lapses - there's no automatic renewal.</p>`,
  };
}

function quotaWarningEmail(warning) {
  const pct = Math.round((warning.licensesUsed / warning.licenseLimit) * 100);
  return {
    subject: `You're at ${pct}% of your license quota`,
    html:
      `<p>You've issued ${warning.licensesUsed} of your ${warning.licenseLimit}-license` +
      ` ${escapeHtml(warning.plan || 'free')} plan limit.</p>` +
      `<p>Once you reach the limit, issuing a new license will be blocked until you upgrade` +
      ` your plan or revoke an existing one.</p>`,
  };
}

async function fetchExtract() {
  if (!licenseApiUrl || !notificationsExtractKey) {
    throw new Error(
      'LICENSE_API_URL and NOTIFICATIONS_EXTRACT_KEY are both required. ' +
        'Usage: LICENSE_API_URL=https://license.example.com/v1 NOTIFICATIONS_EXTRACT_KEY=... node scripts/notify-expiring.mjs'
    );
  }
  const url = `${licenseApiUrl.replace(/\/+$/, '')}/admin/expiring-licenses`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${notificationsExtractKey}` } });
  if (!res.ok) {
    throw new Error(`GET /admin/expiring-licenses responded with ${res.status}`);
  }
  return res.json();
}

// A raw, self-opened connection, not lib/db.ts's shared getDb() -
// same reasoning as backup-db.mjs/check-db-integrity.mjs's own identical
// choice: this is a short-lived, standalone script, not the long-running
// Next.js process, and importing a .ts module here isn't viable (see
// this file's own header comment).
//
// notification_log isn't in schema.sql - nothing else in this app reads
// or writes it, so there's no reason for the app's own boot-time schema
// application to know about it. Created here, on every run, the same
// CREATE TABLE IF NOT EXISTS convention as every other table in this
// repo.
function openDb() {
  const db = new Database(absoluteDbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS notification_log (
      id TEXT PRIMARY KEY,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  return db;
}

async function main() {
  const { expiringLicenses, quotaWarnings } = await fetchExtract();

  const db = openDb();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // tenant_id -> email. Only verified, non-revoked accounts - an
    // unverified signup email isn't confirmed to belong to whoever
    // controls that tenant (security review finding: someone can sign up
    // with a third party's address, never verify it, issue licenses, and
    // this script would otherwise mail that address real license-key/
    // issued_to PII with no proof they're entitled to see it). Excluding
    // tenant_revoked_at IS NOT NULL too - a revoked tenant's own console
    // access is already gone; there's nothing actionable a lifecycle
    // email could tell them.
    //
    // Last row wins if a tenant somehow has more than one account (not
    // possible today - one account per tenant, per signup/route.ts - but
    // this doesn't assume that stays true forever).
    const accountsByTenant = new Map();
    for (const row of db
      .prepare(
        'SELECT tenant_id, email FROM accounts WHERE email_verified_at IS NOT NULL AND tenant_revoked_at IS NULL'
      )
      .all()) {
      accountsByTenant.set(row.tenant_id, row.email);
    }

    const alreadySent = db.prepare('SELECT 1 FROM notification_log WHERE id = ?');
    const markSent = db.prepare(
      'INSERT INTO notification_log (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET sent_at = CURRENT_TIMESTAMP'
    );

    for (const license of expiringLicenses) {
      const email = accountsByTenant.get(license.tenant_id);
      if (!email) {
        console.warn(`No verified account found for tenant ${license.tenant_id} - skipping license ${license.key}`);
        continue;
      }
      // Per-license, not time-windowed - a given license only ever
      // crosses into the expiry window once, so one email, ever, is the
      // whole point (not a recurring nag every day it stays inside the
      // window).
      const logId = `expiring:${license.tenant_id}:${license.key}`;
      if (alreadySent.get(logId)) {
        skipped++;
        continue;
      }
      const { subject, html } = expiringLicenseEmail(license);
      // Security review finding: an unguarded throw here used to abort
      // the whole run, and since `expiringLicenses` is returned in a
      // deterministic order, one permanently-failing recipient (a bounced
      // address, a Resend error) would sit at a fixed position and block
      // every tenant after it on EVERY subsequent run, forever - already-
      // written notification_log rows are durable (better-sqlite3
      // autocommits per statement), so nothing upstream of the failure
      // was actually lost, but nothing downstream ever got a chance to
      // send either. One bad recipient should cost this script one
      // notification, not the rest of the run.
      try {
        await sendEmail(email, subject, html);
        markSent.run(logId);
        sent++;
      } catch (err) {
        console.error(`Failed to send expiring-license notice for tenant ${license.tenant_id}:`, err);
        failed++;
      }
    }

    for (const warning of quotaWarnings) {
      const email = accountsByTenant.get(warning.tenant_id);
      if (!email) {
        console.warn(`No verified account found for tenant ${warning.tenant_id} - skipping quota warning`);
        continue;
      }
      const logId = `quota:${warning.tenant_id}`;
      const existing = db.prepare('SELECT sent_at FROM notification_log WHERE id = ?').get(logId);
      if (existing) {
        const ageMs = Date.now() - new Date(`${existing.sent_at}Z`).getTime();
        if (ageMs < QUOTA_RENOTIFY_DAYS * 24 * 60 * 60 * 1000) {
          skipped++;
          continue;
        }
      }
      const { subject, html } = quotaWarningEmail(warning);
      try {
        await sendEmail(email, subject, html);
        markSent.run(logId);
        sent++;
      } catch (err) {
        console.error(`Failed to send quota-warning notice for tenant ${warning.tenant_id}:`, err);
        failed++;
      }
    }
  } finally {
    db.close();
  }

  console.log(`Lifecycle alerts: ${sent} sent, ${skipped} skipped (already notified), ${failed} failed.`);
  // Non-zero exit on any individual failure - a scheduled task's own
  // monitoring (Coolify's own run-history/alerting) should still surface
  // a bad run, even though a single failed recipient no longer blocks
  // everyone after them (see the try/catch above).
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('notify-expiring failed:', err);
  process.exit(1);
});
