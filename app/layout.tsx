import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';

import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { EnvironmentBanner } from '@/components/EnvironmentBanner';
import { getBranding } from '@/lib/branding';
import { environmentLabel } from '@/lib/config';
import { getSession } from '@/lib/session';
import { theme } from '@/lib/theme';

// A function, not a static object: reads branding per-request (via
// getBranding()) so a changed BRANDING_FAVICON_URL takes effect without a
// rebuild, consistent with the rest of branding.
//
// SaaS-B3: this layout wraps both pre-auth pages (/login, /signup - no
// session, by definition) and the authenticated app (always has one, per
// proxy.ts) - getSession() (not requireSession(), which would throw for
// the pre-auth case) resolves which branding applies. An anonymous
// visitor, or any self-hosted request, always gets the platform/env-var
// branding; a logged-in SaaS session gets its own tenant's.
export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession();
  const branding = getBranding(session?.tenantId);

  return {
    title: 'License Console',
    description: 'Admin console for the Casazium license server',
    icons: branding.faviconUrl ? { icon: branding.faviconUrl } : undefined,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const branding = getBranding(session?.tenantId);

  // --brand-color is set once here and inherited by every page (CSS custom
  // properties cascade through the DOM) - title markup and buttons can both
  // reference `var(--brand-color)` instead of hardcoding the same value in
  // multiple places, so a single BRANDING_COLOR keeps them in sync.
  const brandColorStyle = { '--brand-color': branding.color } as CSSProperties;

  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      {/*
        suppressHydrationWarning: some browser extensions (e.g. ColorZilla)
        inject attributes like cz-shortcut-listen onto <body> before React
        hydrates, which otherwise logs a false-positive hydration-mismatch
        warning. Scoped to this element only - doesn't hide real mismatches
        elsewhere in the tree. <html> already does the same for Mantine's
        color-scheme script.
      */}
      <body style={brandColorStyle} suppressHydrationWarning>
        <MantineProvider theme={theme}>
          <EnvironmentBanner label={environmentLabel()} />
          <Notifications />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
