'use server';

import { createCheckoutSession } from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey } from '@/lib/tenant-context';

type ActionResult<T> = { ok: true; data: T } | { ok: false; reason: 'rate-limited' };

export async function createCheckoutSessionAction(plan: string): Promise<ActionResult<{ url: string }>> {
  const { tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const session = await createCheckoutSession(plan, tenantApiKey);
    return { ok: true, data: session };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    throw err;
  }
}
