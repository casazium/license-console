'use client';

import { useState } from 'react';
import { Alert, Accordion, Badge, Button, Code, CopyButton, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { notifyRateLimited } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import type { StorefrontWebhook, StorefrontWebhookProvider } from '@/lib/license-client';
import { CONNECTABLE_PROVIDERS, STOREFRONT_PROVIDERS, generateWebhookSecret, providerLabel } from '@/lib/storefront-providers';
import { createStorefrontWebhookAction, disableStorefrontWebhookAction, setStorefrontWebhookSecretAction } from './actions';
import { StorefrontWebhookMappings } from './StorefrontWebhookMappings';
import { StorefrontWebhookDeliveries } from './StorefrontWebhookDeliveries';

function statusBadge(status: StorefrontWebhook['status']): { label: string; color: string } {
  switch (status) {
    case 'active':
      return { label: 'Active', color: 'green' };
    case 'pending':
      return { label: 'Needs setup', color: 'yellow' };
    case 'disabled':
      return { label: 'Disabled', color: 'gray' };
    default:
      return { label: status, color: 'gray' };
  }
}

/**
 * STOREFRONT_WEBHOOK_PLAN.md's own console spec, built entirely against
 * the API casazium/license's admin-storefront-webhooks.js already ships -
 * no backend change needed for this section. Three pieces, matching that
 * plan almost verbatim:
 *
 * 1. "Connect <provider>" flow - create the row (pending, real URL right
 *    away), the tenant pastes the URL into their storefront, then saves
 *    the signing secret here (flips to active). Stripe generates that
 *    secret; Lemon Squeezy has the vendor choose one, so its setup offers
 *    a generated one to paste into both places
 *    (lib/storefront-providers.ts). Shown inline in the
 *    just-created row's own expanded panel, not a separate modal step -
 *    a webhook left in 'pending' (abandoned mid-setup) can resume the
 *    exact same panel later.
 * 2. Mappings + deliveries per webhook (StorefrontWebhookMappings /
 *    StorefrontWebhookDeliveries) - only fetched for whichever single
 *    webhook is currently expanded (`active` prop), not for every row up
 *    front.
 * 3. No in-app delivery-resend action (operator decision, this session -
 *    see StorefrontWebhookDeliveries' own header comment for why).
 */
export function StorefrontWebhooksSection({
  initialWebhooks,
  apiBaseUrl,
}: {
  initialWebhooks: StorefrontWebhook[];
  apiBaseUrl: string;
}) {
  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [openId, setOpenId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<StorefrontWebhookProvider | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<StorefrontWebhook | null>(null);
  const [disabling, setDisabling] = useState(false);

  function webhookUrlFor(id: string): string {
    const base = apiBaseUrl || 'https://your-license-server.example.com/v1';
    return `${base}/webhooks/storefront/${encodeURIComponent(id)}`;
  }

  async function handleConnect(provider: StorefrontWebhookProvider) {
    setConnectError(null);
    setConnecting(provider);
    try {
      const result = await createStorefrontWebhookAction(provider);
      if (!result.ok) {
        if (result.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          setConnectError(result.message);
        }
        return;
      }
      setWebhooks((prev) => [result.data, ...prev]);
      setOpenId(result.data.id);
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to connect',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisableConfirmed() {
    if (!disableTarget) return;
    setDisabling(true);
    try {
      const result = await disableStorefrontWebhookAction(disableTarget.id);
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      setWebhooks((prev) => prev.map((w) => (w.id === disableTarget.id ? { ...w, status: 'disabled' } : w)));
      setDisableTarget(null);
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to disable webhook',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setDisabling(false);
    }
  }

  function handleSecretSaved(webhookId: string) {
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? { ...w, status: 'active' } : w)));
  }

  // The server enforces at most one non-disabled webhook per {tenant,
  // provider} (schema.sql's own partial unique index) - mirrored here so
  // the button disappears once connected, rather than letting a click
  // reach the server just to bounce off its 409.
  const connectableProviders = CONNECTABLE_PROVIDERS.filter(
    (provider) => !webhooks.some((w) => w.provider === provider && w.status !== 'disabled')
  );

  return (
    <Stack gap="md">
      {connectError && (
        <Alert color="red" variant="light" title="Couldn't connect" onClose={() => setConnectError(null)} withCloseButton>
          {connectError}
        </Alert>
      )}

      {connectableProviders.length > 0 && (
        <Group>
          {connectableProviders.map((provider) => (
            <Button
              key={provider}
              onClick={() => handleConnect(provider)}
              loading={connecting === provider}
              disabled={connecting !== null && connecting !== provider}
            >
              Connect {providerLabel(provider)}
            </Button>
          ))}
        </Group>
      )}

      {webhooks.length === 0 ? (
        <Text size="sm" c="dimmed">
          No storefront connected yet.
        </Text>
      ) : (
        <Accordion value={openId} onChange={setOpenId} variant="separated">
          {webhooks.map((webhook) => {
            const badge = statusBadge(webhook.status);
            return (
              <Accordion.Item key={webhook.id} value={webhook.id}>
                <Accordion.Control>
                  <Group justify="space-between" pr="md" wrap="nowrap">
                    <Group gap="sm">
                      <Text fw={600}>{providerLabel(webhook.provider)}</Text>
                      <Badge color={badge.color} variant="light">
                        {badge.label}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {webhook.last_event_at
                        ? `Last event ${formatDateTime(webhook.last_event_at)}`
                        : `Connected ${formatDateTime(webhook.created_at)}`}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="lg">
                    {webhook.status === 'pending' && (
                      <WebhookSecretSetup
                        webhook={webhook}
                        webhookUrl={webhookUrlFor(webhook.id)}
                        onSaved={() => handleSecretSaved(webhook.id)}
                      />
                    )}

                    {webhook.status !== 'pending' && (
                      <>
                        <div>
                          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
                            Callback URL
                          </Text>
                          <Group gap="xs" wrap="nowrap">
                            <Code block style={{ flex: 1 }}>
                              {webhookUrlFor(webhook.id)}
                            </Code>
                            <CopyButton value={webhookUrlFor(webhook.id)}>
                              {({ copied, copy }) => (
                                <Button size="xs" onClick={copy} color={copied ? 'teal' : undefined}>
                                  {copied ? 'Copied' : 'Copy'}
                                </Button>
                              )}
                            </CopyButton>
                          </Group>
                        </div>

                        <StorefrontWebhookMappings
                          webhookId={webhook.id}
                          provider={webhook.provider}
                          active={openId === webhook.id}
                        />
                        <StorefrontWebhookDeliveries
                          webhookId={webhook.id}
                          provider={webhook.provider}
                          active={openId === webhook.id}
                        />
                      </>
                    )}

                    {webhook.status !== 'disabled' && (
                      <Group justify="flex-end">
                        <Button size="xs" variant="subtle" color="red" onClick={() => setDisableTarget(webhook)}>
                          Disable this webhook
                        </Button>
                      </Group>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <Modal opened={disableTarget !== null} onClose={() => setDisableTarget(null)} title="Disable this webhook" centered>
        <Text size="sm">
          Purchases through this webhook will stop auto-issuing licenses immediately. Its history and
          mappings are kept, and you can connect a new one later.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDisableTarget(null)} disabled={disabling}>
            Cancel
          </Button>
          <Button color="red" onClick={handleDisableConfirmed} loading={disabling}>
            Disable
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

function WebhookSecretSetup({
  webhook,
  webhookUrl,
  onSaved,
}: {
  webhook: StorefrontWebhook;
  webhookUrl: string;
  onSaved: () => void;
}) {
  const info = STOREFRONT_PROVIDERS[webhook.provider];
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    const trimmed = secret.trim();
    if (!trimmed) {
      setError(
        info.vendorChosenSecret
          ? 'Generate a signing secret (or enter your own), and use the same one in Lemon Squeezy'
          : 'Paste the signing secret Stripe shows you after adding this endpoint'
      );
      return;
    }
    if (info.secretLength) {
      const { length } = [...trimmed];
      if (length < info.secretLength.min || length > info.secretLength.max) {
        setError(`The signing secret must be ${info.secretLength.min}-${info.secretLength.max} characters`);
        return;
      }
    }
    setSaving(true);
    try {
      const result = await setStorefrontWebhookSecretAction(webhook.id, trimmed);
      if (!result.ok) {
        if (result.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          setError(result.message);
        }
        return;
      }
      if (!result.data) {
        setError('This webhook could not be found - try reconnecting');
        return;
      }
      onSaved();
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to save secret',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm">
      <Alert color="yellow" variant="light" title="Finish connecting">
        {webhook.provider === 'lemonsqueezy' ? (
          <>
            1. Generate a signing secret below and copy it. 2. In Lemon Squeezy, go to Settings → Webhooks,
            add a webhook with the URL below, paste the secret as its signing secret, and select the{' '}
            <Code fz="xs">order_created</Code> event. 3. Save the same secret here.
          </>
        ) : (
          <>
            1. In Stripe, add a webhook endpoint with the URL below, listening for{' '}
            <Code fz="xs">checkout.session.completed</Code>,{' '}
            <Code fz="xs">checkout.session.async_payment_succeeded</Code>, and{' '}
            <Code fz="xs">checkout.session.async_payment_failed</Code>. 2. Paste the signing secret Stripe
            gives you below.
          </>
        )}
      </Alert>

      <div>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
          Callback URL
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Code block style={{ flex: 1 }}>
            {webhookUrl}
          </Code>
          <CopyButton value={webhookUrl}>
            {({ copied, copy }) => (
              <Button size="xs" onClick={copy} color={copied ? 'teal' : undefined}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </CopyButton>
        </Group>
      </div>

      <TextInput
        label="Signing secret"
        description={
          info.secretLength
            ? `${info.secretLength.min}-${info.secretLength.max} characters - Lemon Squeezy doesn't generate one, so use the same secret there and here`
            : undefined
        }
        placeholder={info.vendorChosenSecret ? 'Generate one, or enter your own' : 'whsec_...'}
        value={secret}
        onChange={(e) => setSecret(e.currentTarget.value)}
        error={error}
      />
      <Group justify={info.vendorChosenSecret ? 'space-between' : 'flex-end'}>
        {info.vendorChosenSecret && (
          <Group gap="xs">
            <Button variant="default" onClick={() => setSecret(generateWebhookSecret())}>
              Generate
            </Button>
            <CopyButton value={secret}>
              {({ copied, copy }) => (
                <Button variant="default" onClick={copy} disabled={!secret} color={copied ? 'teal' : undefined}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
        )}
        <Button onClick={handleSave} loading={saving}>
          Save secret
        </Button>
      </Group>
    </Stack>
  );
}
