import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// A real temp file, not ':memory:' or lookalikes - lib/db.ts's
// openDatabase() has no special case for that string (confirmed the
// hard way while writing tests/routes/password-reset-email-verification
// .test.ts: it becomes a literal file on disk via
// path.join(process.cwd(), dbPath)).
const testDbFile = path.resolve(dirname, `test-branding-title-trust-${process.pid}.db`);

// Security review finding L3: `titleHtml` is rendered via
// `dangerouslySetInnerHTML` only when `titleIsHtml` is true, and that
// must be true *only* for the platform/env-var source (BRANDING_TITLE_HTML,
// genuinely operator-trusted config a deployer sets, not user input) -
// never for anything that could ever trace back to a tenant. Nothing
// writes tenant_branding yet (this module's own comment), so this is
// forward-looking, but the trust-level *computation* is exactly the kind
// of logic a refactor could silently invert - e.g. defaulting a new field
// to `true` - with no test to catch it before a tenant-settings UI ever
// gets built on top of it.
describe('getBranding() titleIsHtml trust level (lib/branding.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('BRANDING_TITLE_HTML', '<b>My Product</b>');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    const fs = await import('node:fs/promises');
    for (const suffix of ['', '-shm', '-wal']) {
      await fs.unlink(testDbFile + suffix).catch(() => {});
    }
  });

  it('platform/env-var branding is always trusted as HTML (titleIsHtml: true)', async () => {
    vi.stubEnv('MULTI_TENANT', '');
    const { getBranding } = await import('@/lib/branding');

    const branding = getBranding();
    expect(branding.titleIsHtml).toBe(true);
    expect(branding.titleHtml).toBe('<b>My Product</b>');
  });

  it('self-hosted mode (no tenantId) always gets the trusted platform value, never a DB lookup', async () => {
    vi.stubEnv('MULTI_TENANT', 'true');
    const { getBranding } = await import('@/lib/branding');

    // No tenantId passed - getBranding()'s own early return for this
    // case, before ever touching getDb().
    const branding = getBranding(undefined);
    expect(branding.titleIsHtml).toBe(true);
  });

  it('a tenant with no tenant_branding row falls back to the platform value AND its trust level (true)', async () => {
    vi.stubEnv('MULTI_TENANT', 'true');
    vi.stubEnv('DB_ALLOW_INIT', 'true'); // fresh per-test file, no prior init step
    vi.stubEnv('DB_FILE', testDbFile);

    // No tenant_branding row will exist for a tenant id nothing ever
    // inserted - getBranding()'s own `if (!row) return platform;` path.
    const { getBranding } = await import('@/lib/branding');
    const branding = getBranding('tenant-with-no-branding-row');
    expect(branding.titleIsHtml).toBe(true);
  });
});
