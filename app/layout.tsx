import '@mantine/core/styles.css';
import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';

export const metadata: Metadata = {
  title: 'License Console',
  description: 'Admin console for the Casazium license server',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <MantineProvider>{children}</MantineProvider>
      </body>
    </html>
  );
}
