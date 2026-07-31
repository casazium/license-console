import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';

import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { getBranding } from '@/lib/branding';

export const metadata: Metadata = {
  title: 'License Console',
  description: 'Admin console for the Casazium license server',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const branding = getBranding();

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
      <body style={brandColorStyle}>
        <MantineProvider>
          <Notifications />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
