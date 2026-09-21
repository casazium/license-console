'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { brandButtonStyle } from '@/components/brandButtonStyle';
import { notifyRateLimited } from '@/lib/notify';
import { completeStubCheckoutAction } from '../../actions';

// Mirrors PlanSelector.tsx's own PLANS list exactly.
const PLAN_LABELS: Record<string, { label: string; limitDescription: string }> = {
  free: { label: 'Free', limitDescription: 'Up to 5 active licenses' },
  pro: { label: 'Pro', limitDescription: 'Up to 1,000 active licenses' },
};

export function StubCheckoutConfirm({ plan }: { plan: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const planInfo = PLAN_LABELS[plan];

  async function handleConfirm() {
    setLoading(true);
    try {
      const result = await completeStubCheckoutAction(plan);
      if (!result.ok) {
        notifyRateLimited();
        setLoading(false);
        return;
      }
      notifications.show({
        color: 'green',
        title: 'Plan updated',
        message: `You're now on the ${planInfo.label} plan.`,
      });
      // A full navigation, not next/navigation's router - calling
      // router.push() immediately after an awaited Server Action call
      // reliably got dropped (confirmed via Playwright: the action
      // completed, the toast showed, but the URL never changed) -
      // matches why PlanSelector.tsx's own post-action redirect
      // (../../PlanSelector.tsx) also uses window.location.assign
      // rather than the client router.
      window.location.assign('/billing');
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to complete checkout',
        message: 'Something went wrong. Please try again.',
      });
      setLoading(false);
    }
  }

  return (
    <Stack maw={480}>
      <Title order={2}>Confirm plan change</Title>

      <Alert color="blue" title="Demo checkout">
        No real payment is collected here. Casazium&apos;s hosted billing isn&apos;t live yet - this
        simulates what selecting a plan will look like once it is.
      </Alert>

      <Card withBorder padding="lg">
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            Plan
          </Text>
          <Text size="lg" fw={600}>
            {planInfo.label}
          </Text>
          <Text size="sm" c="dimmed">
            {planInfo.limitDescription}
          </Text>
        </Stack>
      </Card>

      <Group justify="flex-end">
        <Button variant="default" onClick={() => router.push('/billing')} disabled={loading}>
          Cancel
        </Button>
        <Button loading={loading} style={brandButtonStyle} onClick={handleConfirm}>
          Complete purchase (demo)
        </Button>
      </Group>
    </Stack>
  );
}
