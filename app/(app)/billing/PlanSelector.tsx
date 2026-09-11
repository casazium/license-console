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

export function PlanSelector({ currentPlan }: { currentPlan: string | null }) {
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
      {PLANS.map((plan) => (
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
              variant={currentPlan === plan.id ? 'default' : 'filled'}
              disabled={currentPlan === plan.id}
              loading={pendingPlan === plan.id}
              style={currentPlan === plan.id ? undefined : brandButtonStyle}
              onClick={() => handleSelectPlan(plan.id)}
            >
              {currentPlan === plan.id ? 'Current plan' : 'Select'}
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
