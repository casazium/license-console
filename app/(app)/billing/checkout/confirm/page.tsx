import { notFound } from 'next/navigation';
import { isMultiTenant } from '@/lib/config';
import { StubCheckoutConfirm } from './StubCheckoutConfirm';

export const dynamic = 'force-dynamic';

// Mirrors PlanSelector.tsx's own PLANS list exactly - see that file's
// comment on why these are the only two plans that exist anywhere.
const VALID_PLANS = ['free', 'pro'];

/**
 * Demo checkout confirmation page - only ever reached via
 * createCheckoutSessionAction (app/(app)/billing/actions.ts) recognizing
 * the stub billing provider's own deliberately-unreachable checkout URL
 * and routing here instead. Not a general-purpose route to link to
 * directly; an unrecognized or missing `plan` 404s rather than guessing.
 */
export default async function StubCheckoutConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  if (!isMultiTenant()) {
    notFound();
  }

  const { plan } = await searchParams;
  if (!plan || !VALID_PLANS.includes(plan)) {
    notFound();
  }

  return <StubCheckoutConfirm plan={plan} />;
}
