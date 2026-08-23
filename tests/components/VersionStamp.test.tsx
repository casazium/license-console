// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { VersionStamp } from '@/components/VersionStamp';

// Smoke test for the jsdom + React Testing Library harness itself, using
// the simplest real component in the app (no data fetching, no context
// providers beyond the MantineProvider every Mantine component needs) -
// proves the component-testing path works end to end so a future test
// can extend it, not a claim that this one component was a coverage risk
// on its own.
function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('VersionStamp', () => {
  it('renders the version prefixed with "v"', () => {
    renderWithMantine(<VersionStamp version="1.2.3" gitSha="abcdef1" />);
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
  });

  it('puts the full commit sha in the title attribute', () => {
    renderWithMantine(<VersionStamp version="1.2.3" gitSha="abcdef1" />);
    expect(screen.getByText('v1.2.3')).toHaveAttribute('title', 'commit abcdef1');
  });
});
