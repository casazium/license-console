// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { VersionCompatibilityBanner } from '@/components/VersionCompatibilityBanner';
import { MIN_COMPATIBLE_SERVER_VERSION } from '@/lib/version';

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('VersionCompatibilityBanner', () => {
  it('names both the minimum compatible version and the connected server version', () => {
    renderWithMantine(<VersionCompatibilityBanner serverVersion="1.4.0" />);
    const banner = screen.getByTestId('version-compatibility-banner');
    expect(banner).toHaveTextContent(MIN_COMPATIBLE_SERVER_VERSION);
    expect(banner).toHaveTextContent('1.4.0');
  });

  it('frames the mismatch as a warning, not an error', () => {
    renderWithMantine(<VersionCompatibilityBanner serverVersion="1.4.0" />);
    expect(screen.getByTestId('version-compatibility-banner')).toHaveTextContent(
      'This is a warning, not an error'
    );
  });
});
