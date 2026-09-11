'use client';

import { useState } from 'react';
import { Button, Card, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { brandButtonStyle } from '@/components/brandButtonStyle';
import { notifyRateLimited } from '@/lib/notify';
import { createCheckoutSessionAction } from './actions';

// Mirrors casazium/license's own src/lib/quota.js PLAN_LIMITS exactly -
// the only two plans that exist anywhere in the system. Price is real
// (competitor-research-informed pricing decision), the license limits
// are unchanged from the stub-era placeholder.
const PLANS = [
  { id: 'free', label: 'Free', limitDescription: 'Up to 5 active licenses', priceLabel: '$0' },
  { id: 'pro', label: 'Pro', limitDescription: 'Up to 100 active licenses', priceLabel: '$39/mo or $374/yr' },
];

// Only Pro has more than one Stripe Price (monthly/annual) - Free has no
// Price at all (it's the absence of a paid subscription, not a $0
// Price), so this control only matters when selecting Pro.
// billing-checkout.js's own schema defaults to 'monthly' when omitted.
const INTERVAL_OPTIONS = [
  { label: 'Monthly', value: 'monthly' },
  { label: 'Annual (save ~20%)', value: 'annual' },
];

export function PlanSelector({
  currentPlan,
  currentStatus,
}: {
  currentPlan: string | null;
  currentStatus: string;
}) {
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<string>('monthly');

  async function handleSelectPlan(plan: string) {
    setPendingPlan(plan);
    try {
      const result = await createCheckoutSessionAction(plan, plan === 'pro' ? billingInterval : undefined);
      if (!result.ok) {
        notifyRateLimited();
        setPendingPlan(null);
        return;
      }
      // Covers a real Stripe Checkout Session, a real Stripe Billing
      // Portal session (the downgrade-to-free path), and the stub's own
      // in-app confirm-page redirect - all three are just a URL to
      // navigate to. .assign(), not a `.href =` assignment - this
      // project's eslint config (react-hooks' immutability rule) rejects
      // directly mutating a property on an external value like `window`,
      // even from an event handler.
      window.location.assign(result.data.url);
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to start checkout',
        message: 'Something went wrong. Please try again.',
      });
      setPendingPlan(null);
    }
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Change plan
      </Text>
      <SegmentedControl
        data={INTERVAL_OPTIONS}
        value={billingInterval}
        onChange={setBillingInterval}
        size="sm"
        aria-label="Billing interval for the Pro plan"
      />
      {PLANS.map((plan) => {
        // A plan only counts as "current" (and its button disabled) while
        // it's actually active - matching billing.plan alone isn't enough.
        // A canceled or past_due subscription still has its old plan
        // recorded (deliberately preserved as history, not cleared), so
        // without this check a tenant who canceled Pro would see "Pro -
        // Current plan" as a disabled button with no way back in, even
        // though they have no active subscription at all (a real gap
        // found live-testing the real Stripe cancellation flow for the
        // first time - the stub era never produced a canceled-but-still-
        // recorded-as-pro state to expose this).
        const isCurrent = currentPlan === plan.id && currentStatus === 'active';
        // Selecting "free" means "downgrade my active paid subscription" -
        // it redirects to the Stripe Billing Portal, which only has
        // something to do when a real subscription (active or past_due,
        // i.e. Stripe still considers it live) exists. Once a
        // subscription is fully canceled there's nothing left to manage
        // there - found live, immediately after fixing the "Pro" button
        // above: canceling, then clicking "Free" again, bounced to an
        // empty Portal page with nothing to cancel.
        const nothingToDowngrade = plan.id === 'free' && currentStatus === 'canceled';
        const disabled = isCurrent || nothingToDowngrade;
        return (
          <Card key={plan.id} withBorder padding="md">
            <Group justify="space-between">
              <Stack gap={0}>
                <Text fw={600}>
                  {plan.label} · {plan.priceLabel}
                </Text>
                <Text size="sm" c="dimmed">
                  {plan.limitDescription}
                </Text>
              </Stack>
              <Button
                variant={disabled ? 'default' : 'filled'}
                disabled={disabled}
                loading={pendingPlan === plan.id}
                style={disabled ? undefined : brandButtonStyle}
                onClick={() => handleSelectPlan(plan.id)}
              >
                {isCurrent ? 'Current plan' : nothingToDowngrade ? 'Nothing to cancel' : 'Select'}
              </Button>
            </Group>
          </Card>
        );
      })}
    </Stack>
  );
}
