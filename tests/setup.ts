import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// React Testing Library's automatic afterEach cleanup only self-registers
// when it detects vitest's `afterEach` on the global object, which isn't
// there with `globals: false` (this config's deliberate choice, so plain
// lib tests don't silently depend on injected globals) - so each rendered
// component tree is unmounted explicitly here instead, same effect.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia (https://github.com/jsdom/jsdom/issues/3522).
// Mantine's MantineProvider calls it on mount to track the OS color scheme -
// needed for any component test that renders a Mantine component, not just
// ones that care about theming.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
