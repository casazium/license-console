'use client';

import { useState } from 'react';
import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { brandButtonStyle } from '@/components/brandButtonStyle';
import { notifyRateLimited } from '@/lib/notify';
import { createCheckoutSessionAction } from './actions';

// Mirrors casazium/license's own src/lib/quota.js PLAN_LIMITS exactly -
// the only two plans that exist anywhere in the system. Placeholder
// numbers (that file's own comment: "no real pricing has been decided
// anywhere in this plan"), not this task's to invent real ones for.
const PLANS = [
  { id: 'free', label: 'Free', limitDescription: 'Up to 5 active licenses' },
  { id: 'pro', label: 'Pro', limitDescription: 'Up to 100 active licenses' },
];

export function PlanSelector({ currentPlan }: { currentPlan: string | null }) {
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

  async function handleSelectPlan(plan: string) {
    setPendingPlan(plan);
    try {
      const result = await createCheckoutSessionAction(plan);
      if (!result.ok) {
        notifyRateLimited();
        setPendingPlan(null);
        return;
      }
      // The stub provider's URL isn't part of this app's own routing -
      // a plain navigation, not next/navigation's router, which is only
      // for internal routes. .assign(), not a `.href =` assignment -
      // this project's eslint config (react-hooks' immutability rule)
      // rejects directly mutating a property on an external value like
      // `window`, even from an event handler.
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
      {PLANS.map((plan) => (
        <Card key={plan.id} withBorder padding="md">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text fw={600}>{plan.label}</Text>
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
