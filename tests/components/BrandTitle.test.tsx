// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandTitle } from '@/components/BrandTitle';

// The actual XSS guard the security review (finding L3) put in place:
// `dangerouslySetInnerHTML` fires only when the caller explicitly passes
// `isHtml={true}` - true for the platform/env-var source
// (BRANDING_TITLE_HTML, operator-trusted config), false for anything
// sourced from tenant_branding. Nothing writes tenant_branding yet, so
// this is the guard a future tenant-settings UI would depend on -
// worth proving now, with a real injection payload, rather than only
// once something writes to that table.
describe('BrandTitle (components/BrandTitle.tsx, security review finding L3)', () => {
  const XSS_PAYLOAD = '<img src=x onerror="window.__pwned = true">';

  it('isHtml=false renders untrusted content as literal text, never executing markup', () => {
    render(<BrandTitle titleHtml={XSS_PAYLOAD} isHtml={false} />);

    // The payload's raw text is visible on the page...
    expect(screen.getByText(XSS_PAYLOAD)).toBeInTheDocument();
    // ...but never parsed as an element - no <img> was created, so its
    // onerror handler never had anything to fire on.
    expect(document.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('isHtml=true renders trusted platform config as real markup (the intended, operator-only path)', () => {
    render(<BrandTitle titleHtml="<b>Trusted Co</b>" isHtml={true} />);

    const bold = document.querySelector('b');
    expect(bold).not.toBeNull();
    expect(bold?.textContent).toBe('Trusted Co');
  });

  it('isHtml=false with ordinary text renders identically to before (no behavior change for the common case)', () => {
    render(<BrandTitle titleHtml="Plain Product Name" isHtml={false} />);
    expect(screen.getByText('Plain Product Name')).toBeInTheDocument();
  });
});
