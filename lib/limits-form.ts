/**
 * Shared limits-editing form model, used by both IssueLicenseForm.tsx
 * (issuing a new license) and LicenseActions.tsx's EditTermsButton
 * (editing an existing one) - factored out here rather than duplicated
 * so casazium/license's own ALLOWED_LIMIT_KEYS allow-list
 * (src/lib/validateLicenseLimits.js) has exactly one place to update on
 * this side if it ever changes.
 */

import type { LicenseLimits } from './license-client';

// Mirrors casazium/license's own ALLOWED_LIMIT_KEYS numeric subset
// exactly - `features` is handled separately since it's the one
// array-of-strings exception on that same allow-list, not a NumberInput.
export const NUMERIC_LIMIT_FIELDS: { key: keyof Omit<LicenseLimits, 'features'>; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'seats', label: 'Seats' },
  { key: 'admins', label: 'Admins' },
  { key: 'projects', label: 'Projects' },
  { key: 'environments', label: 'Environments' },
  { key: 'tenants', label: 'Tenants' },
  { key: 'api_calls_per_day', label: 'API calls / day' },
  { key: 'rate_limit_rps', label: 'Rate limit (req/s)' },
  { key: 'concurrent_sessions', label: 'Concurrent sessions' },
];

// '' (not undefined) is Mantine NumberInput's own empty-value
// representation - kept distinct from 0 so a blank field means "no
// limit set" (the key is omitted from the submitted limits object
// entirely), not "limit is zero" (which would mean no access at all).
export type LimitsFormValues = Record<(typeof NUMERIC_LIMIT_FIELDS)[number]['key'], number | ''> & {
  features: string[];
};

export const INITIAL_LIMITS: LimitsFormValues = {
  users: '',
  seats: '',
  admins: '',
  projects: '',
  environments: '',
  tenants: '',
  api_calls_per_day: '',
  rate_limit_rps: '',
  concurrent_sessions: '',
  features: [],
};

// Builds a LimitsFormValues starting point from a license's real current
// limits (the edit path) rather than always starting blank (the issue
// path) - every numeric key not present in `current` stays '' (unset),
// not 0, so an edit that doesn't touch a field doesn't silently zero it
// out. See buildLimits() below for the inverse direction.
export function limitsToFormValues(current: LicenseLimits): LimitsFormValues {
  const values = { ...INITIAL_LIMITS, features: current.features ?? [] };
  for (const { key } of NUMERIC_LIMIT_FIELDS) {
    const value = current[key];
    if (typeof value === 'number') {
      values[key] = value;
    }
  }
  return values;
}

// Only keys the admin actually filled in are included - an omitted key
// means "not enforced" to the backend (validateLicenseLimits.js only
// validates keys present in the object), not "limit is zero". Returns
// undefined (not {}) when nothing was set, so a caller can omit `limits`
// entirely from its own payload for the common case of no limits.
export function buildLimits(values: LimitsFormValues): LicenseLimits | undefined {
  const limits: LicenseLimits = {};
  for (const { key } of NUMERIC_LIMIT_FIELDS) {
    const value = values[key];
    if (value !== '') {
      limits[key] = value;
    }
  }
  if (values.features.length > 0) {
    limits.features = values.features;
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
}
