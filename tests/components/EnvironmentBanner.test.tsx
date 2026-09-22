// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { EnvironmentBanner } from '@/components/EnvironmentBanner';

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('EnvironmentBanner', () => {
  it('renders the label when set', () => {
    renderWithMantine(<EnvironmentBanner label="TEST ENVIRONMENT" />);
    expect(screen.getByText('TEST ENVIRONMENT')).toBeInTheDocument();
  });

  it('renders nothing when label is null', () => {
    renderWithMantine(<EnvironmentBanner label={null} />);
    expect(screen.queryByTestId('environment-banner')).not.toBeInTheDocument();
  });
});
