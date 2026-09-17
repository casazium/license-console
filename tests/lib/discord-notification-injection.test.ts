import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordNotificationProvider } from '@/lib/notifications/discord-provider';

// Regression test for a real, already-fixed injection vulnerability
// (TASK_ACCOUNT_NOTIFICATIONS.md's adversarial review): signup's own
// validation (EMAIL_RE in app/api/signup/route.ts) only rejects
// whitespace and a second '@' - a string like
// "a[x](https://evil.example)@b.co" is a *valid* signup email under it,
// and Discord renders [text](url) masked links, spoilers, and other
// markdown inside embed fields. Before the fix, that email would have
// reached the operator's own Discord channel as a clickable masked link
// to an attacker-controlled URL, not as the literal text the account
// actually signed up with. sanitizeForDiscord() (lib/notifications/
// discord-provider.ts) is not exported - this suite exercises it only
// through the real notify() call, the same path production traffic
// takes, so a future refactor that changes the escaping approach but
// breaks the guarantee still fails here.
describe('Discord notification injection escaping (lib/notifications/discord-provider.ts)', () => {
  beforeEach(() => {
    vi.stubEnv('NOTIFY_WEBHOOK_URL', 'https://discord.example.com/webhook');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function captureEmbedField(event: Parameters<ReturnType<typeof createDiscordNotificationProvider>['notify']>[0]) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createDiscordNotificationProvider();
    await provider.notify(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    return body.embeds[0].fields[0].value as string;
  }

  it('the exact masked-link injection payload found by review is neutralized, not rendered as a link', async () => {
    const maliciousEmail = 'a[x](https://evil.example)@b.co';

    const fieldValue = await captureEmbedField({ type: 'account.created', email: maliciousEmail });

    // The literal, unescaped [text](url) sequence must never survive -
    // that's what Discord would render as a clickable masked link.
    expect(fieldValue).not.toContain('[x](https://evil.example)');
    // Every markdown-special character from the original string is
    // present but backslash-escaped, so Discord displays it as plain
    // text - including the '@' in the domain, since '@' is itself one
    // of the escaped characters (defense against a bare @mention too).
    expect(fieldValue).toBe('a\\[x\\]\\(https://evil.example\\)\\@b.co');
  });

  it('escapes every Discord markdown special character, not just brackets/parens', async () => {
    const email = '*bold*_italic_~~strike~~`code`||spoiler||@everyone#channel';

    const fieldValue = await captureEmbedField({ type: 'account.created', email });

    // None of the raw markdown-triggering characters survive unescaped.
    for (const char of ['*', '_', '~', '`', '|', '@', '#']) {
      expect(fieldValue).not.toMatch(new RegExp(`(?<!\\\\)\\${char}`));
    }
  });

  it('strips Unicode bidi-override control characters that could visually disguise injected text', async () => {
    // U+202E (RIGHT-TO-LEFT OVERRIDE) - could otherwise reverse the
    // visual order of following text regardless of markdown escaping.
    const email = 'a‮gnp.evil@b.co';

    const fieldValue = await captureEmbedField({ type: 'account.created', email });

    expect(fieldValue).not.toContain('‮');
  });

  it('requests allowed_mentions: {parse: []} on every notification, as defense in depth against escaping bypass', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createDiscordNotificationProvider();
    await provider.notify({ type: 'login', email: '@everyone' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('account.deleted carries no email at all, only accountId (PII scope, not just an escaping concern)', async () => {
    const fieldValue = await captureEmbedField({ type: 'account.deleted', accountId: 'acct_123' });

    expect(fieldValue).toBe('acct\\_123');
  });
});
