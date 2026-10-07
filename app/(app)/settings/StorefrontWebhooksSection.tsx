'use client';

import { useId, useState } from 'react';
import {
  Alert,
  Accordion,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { notifyRateLimited } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import type { StorefrontRefundPolicy, StorefrontWebhook, StorefrontWebhookProvider } from '@/lib/license-client';
import { CONNECTABLE_PROVIDERS, STOREFRONT_PROVIDERS, generateWebhookSecret, providerLabel } from '@/lib/storefront-providers';
import {
  createStorefrontWebhookAction,
  disableStorefrontWebhookAction,
  setStorefrontRefundPolicyAction,
  setStorefrontSubscriptionGraceAction,
  setStorefrontWebhookSecretAction,
} from './actions';
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

  function handleRefundPolicyChanged(webhookId: string, refundPolicy: StorefrontRefundPolicy) {
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? { ...w, refund_policy: refundPolicy } : w)));
  }

  function handleGraceChanged(webhookId: string, graceDays: number) {
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? { ...w, subscription_grace_days: graceDays } : w)));
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
                      {webhook.refund_policy === 'record' && webhook.status !== 'disabled' && (
                        // Revoke is the default, so only the exception is
                        // flagged on the collapsed row.
                        <Badge color="gray" variant="outline">
                          Refunds: record only
                        </Badge>
                      )}
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

                        {webhook.refund_policy && webhook.status !== 'disabled' && (
                          <RefundPolicyControl webhook={webhook} onChanged={handleRefundPolicyChanged} />
                        )}

                        {webhook.subscription_grace_days !== undefined && webhook.status !== 'disabled' && (
                          <SubscriptionGraceControl webhook={webhook} onChanged={handleGraceChanged} />
                        )}

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
            <Code fz="xs">order_created</Code>
            {webhook.refund_policy ? (
              <>
                {' '}
                and <Code fz="xs">order_refunded</Code> events
              </>
            ) : (
              ' event'
            )}
            .{webhook.subscription_grace_days !== undefined && <SubscriptionEventsNote provider={webhook.provider} />} 3.
            Save the same secret here.
          </>
        ) : (
          <>
            1. In Stripe, add a webhook endpoint with the URL below, listening for{' '}
            <Code fz="xs">checkout.session.completed</Code>,{' '}
            <Code fz="xs">checkout.session.async_payment_succeeded</Code>,{' '}
            <Code fz="xs">checkout.session.async_payment_failed</Code>
            {webhook.refund_policy ? (
              <>
                , and <Code fz="xs">charge.refunded</Code>
              </>
            ) : null}
            .{webhook.subscription_grace_days !== undefined && <SubscriptionEventsNote provider={webhook.provider} />} 2.
            Paste the signing secret Stripe gives you below.
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

// What a full refund does on this webhook (License Server 1.8.0+; only
// rendered when the server reported a refund_policy, and never on a
// disabled webhook - it receives no events, and the server refuses the
// change with a 409). Revoke is the
// default. Saved immediately, like the rest of this section, and reverted
// on failure.
function RefundPolicyControl({
  webhook,
  onChanged,
}: {
  webhook: StorefrontWebhook;
  onChanged: (webhookId: string, refundPolicy: StorefrontRefundPolicy) => void;
}) {
  const [saving, setSaving] = useState(false);
  const labelId = useId();
  const refundEvent = STOREFRONT_PROVIDERS[webhook.provider].refundEvent;

  async function handleChange(value: string) {
    const next = value as StorefrontRefundPolicy;
    if (next === webhook.refund_policy) return;
    const previous = webhook.refund_policy as StorefrontRefundPolicy;
    onChanged(webhook.id, next);
    setSaving(true);
    try {
      const result = await setStorefrontRefundPolicyAction(webhook.id, next);
      if (!result.ok || !result.data) {
        onChanged(webhook.id, previous);
        if (!result.ok && result.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          notifications.show({
            color: 'red',
            title: "Couldn't change the refund setting",
            message: !result.ok ? result.message : 'This webhook could not be found - try reloading',
          });
        }
      }
    } catch {
      onChanged(webhook.id, previous);
      notifications.show({ color: 'red', title: "Couldn't change the refund setting", message: 'Something went wrong. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <Text id={labelId} size="sm" fw={600} mb={4}>
        When a purchase is fully refunded
      </Text>
      <SegmentedControl
        size="xs"
        disabled={saving}
        value={webhook.refund_policy}
        onChange={handleChange}
        data={[
          { label: 'Revoke the license', value: 'revoke' },
          { label: 'Keep it (record only)', value: 'record' },
        ]}
      />
      <Text size="xs" c="dimmed" mt={4}>
        Needs the <Code fz="xs">{refundEvent}</Code> event in your {providerLabel(webhook.provider)} webhook settings.
        Partial refunds are only recorded. Either way, a purchase refunded before its license is issued never gets one,
        and a refunded purchase is never emailed its key. A license file the buyer already downloaded keeps working
        offline until it expires.
      </Text>
    </div>
  );
}

// The extra events subscriptions need (License Server 1.9.0+), as a
// sentence for the setup steps and the grace setting's help.
function SubscriptionEventsNote({ provider }: { provider: StorefrontWebhookProvider }) {
  const events = STOREFRONT_PROVIDERS[provider].subscriptionEvents;
  return (
    <>
      {' '}
      Selling subscriptions? Also select{' '}
      {events.map((event, i) => (
        <span key={event}>
          {i > 0 && (i === events.length - 1 ? ' and ' : ', ')}
          <Code fz="xs">{event}</Code>
        </span>
      ))}
      {provider === 'lemonsqueezy'
        ? ' — all of them: without the two payment events a subscription never extends.'
        : ' — without them a subscription license expires after its grace period.'}
    </>
  );
}

// How long a subscription's license stays valid past its paid period
// (License Server 1.9.0+; only rendered when the server reported
// subscription_grace_days, and never on a disabled webhook). Saved with
// its own button rather than on every keystroke; the server applies it
// from each subscription's next event.
function SubscriptionGraceControl({
  webhook,
  onChanged,
}: {
  webhook: StorefrontWebhook;
  onChanged: (webhookId: string, graceDays: number) => void;
}) {
  const saved = webhook.subscription_grace_days ?? 7;
  const [value, setValue] = useState<number | string>(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const labelId = useId();
  const numeric = typeof value === 'number' ? value : Number.NaN;
  const valid = Number.isInteger(numeric) && numeric >= 0 && numeric <= 30;

  async function handleSave() {
    setError(null);
    if (!valid) {
      setError('Enter a whole number of days from 0 to 30');
      return;
    }
    setSaving(true);
    try {
      const result = await setStorefrontSubscriptionGraceAction(webhook.id, numeric);
      if (!result.ok) {
        if (result.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          setError(result.message);
        }
        return;
      }
      if (!result.data) {
        setError('This webhook could not be found - try reloading');
        return;
      }
      onChanged(webhook.id, numeric);
    } catch {
      notifications.show({ color: 'red', title: "Couldn't change the grace period", message: 'Something went wrong. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <Text id={labelId} size="sm" fw={600} mb={4}>
        Subscriptions: grace period
      </Text>
      <Group gap="xs" align="flex-start">
        <NumberInput
          aria-labelledby={labelId}
          size="xs"
          w={120}
          min={0}
          max={30}
          allowDecimal={false}
          allowNegative={false}
          // No clamping: Mantine would silently turn a typed 45 into 30 on
          // blur (found in the browser - a fumbled edit saved 30). Out of
          // range stays visible and Save refuses it with a message.
          clampBehavior="none"
          suffix=" days"
          value={value}
          onChange={setValue}
          error={error}
        />
        <Button size="xs" onClick={handleSave} loading={saving} disabled={numeric === saved}>
          Save
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        A subscription&apos;s license runs to the end of what&apos;s been paid, plus this grace while each renewal&apos;s
        payment arrives. A failed payment keeps access for the grace, then not; a cancellation keeps exactly what was
        paid. Applies from each subscription&apos;s next event.
        <SubscriptionEventsNote provider={webhook.provider} />
      </Text>
    </div>
  );
}

