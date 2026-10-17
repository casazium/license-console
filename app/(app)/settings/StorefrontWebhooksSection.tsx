'use client';

import { useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Accordion,
  Badge,
  Box,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { notifyRateLimited } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import type {
  StorefrontRefundPolicy,
  StorefrontSendPendingResult,
  StorefrontWebhook,
  StorefrontWebhookEnvironment,
  StorefrontWebhookProvider,
  StorefrontWebhookStatus,
} from '@/lib/license-client';
import {
  API_KEY_PROBLEM_TEXT,
  CONNECTABLE_PROVIDERS,
  STOREFRONT_PROVIDERS,
  generateWebhookSecret,
  paddleKeyEnvironment,
  providerLabel,
} from '@/lib/storefront-providers';
import {
  createStorefrontWebhookAction,
  disableStorefrontWebhookAction,
  sendStorefrontPendingDeliveriesAction,
  setStorefrontRefundPolicyAction,
  setStorefrontSubscriptionGraceAction,
  setStorefrontWebhookApiKeyAction,
  setStorefrontWebhookSecretAction,
} from './actions';
import { StorefrontWebhookMappings } from './StorefrontWebhookMappings';
import { StorefrontWebhookDeliveries } from './StorefrontWebhookDeliveries';
import { SETTINGS_TEXT_WIDTH } from './widths';

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
  // The open webhook lives in the URL (?webhook=<id>), so a refresh - the
  // way to see new deliveries - or a bookmark reopens it. Read once, on
  // the server as on the client, so the first render matches; an id that
  // isn't one of this account's webhooks is ignored.
  const searchParams = useSearchParams();
  const [openId, setOpenIdState] = useState<string | null>(() => {
    const fromUrl = searchParams?.get('webhook') ?? null;
    return fromUrl && initialWebhooks.some((w) => w.id === fromUrl) ? fromUrl : null;
  });

  function setOpenId(id: string | null) {
    setOpenIdState(id);
    // Replace, not push: opening and closing rows shouldn't fill the back
    // button's history. Next.js keeps useSearchParams in step with it.
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('webhook', id);
    else url.searchParams.delete('webhook');
    window.history.replaceState(window.history.state, '', url);
  }
  const [connecting, setConnecting] = useState<StorefrontWebhookProvider | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<StorefrontWebhook | null>(null);
  const [disabling, setDisabling] = useState(false);
  // Paddle asks which environment before connecting (its payloads don't
  // say, so the webhook does - once).
  const [environmentPicker, setEnvironmentPicker] = useState<StorefrontWebhookProvider | null>(null);
  const [environment, setEnvironment] = useState<StorefrontWebhookEnvironment>('sandbox');
  // Bumped to reload a webhook's deliveries after sending pending ones.
  const [deliveriesVersion, setDeliveriesVersion] = useState<Record<string, number>>({});

  function webhookUrlFor(id: string): string {
    const base = apiBaseUrl || 'https://your-license-server.example.com/v1';
    return `${base}/webhooks/storefront/${encodeURIComponent(id)}`;
  }

  function handleConnectClick(provider: StorefrontWebhookProvider) {
    if (STOREFRONT_PROVIDERS[provider].needsEnvironment) {
      setEnvironment('sandbox');
      setEnvironmentPicker(provider);
      return;
    }
    void handleConnect(provider);
  }

  async function handleConnect(provider: StorefrontWebhookProvider, chosenEnvironment?: StorefrontWebhookEnvironment) {
    setConnectError(null);
    setConnecting(provider);
    try {
      const result = chosenEnvironment
        ? await createStorefrontWebhookAction(provider, chosenEnvironment)
        : await createStorefrontWebhookAction(provider);
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
      setEnvironmentPicker(null);
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

  // The server says what the webhook's status is now: a Paddle webhook
  // stays pending until it has both its secret and its API key.
  function handleSecretSaved(webhookId: string, status: StorefrontWebhookStatus) {
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? { ...w, status } : w)));
  }

  function handleApiKeySaved(webhookId: string, status: StorefrontWebhookStatus) {
    setWebhooks((prev) =>
      prev.map((w) => (w.id === webhookId ? { ...w, status, has_api_key: true, api_key_problem: null } : w))
    );
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
              onClick={() => handleConnectClick(provider)}
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
            // A provider this console doesn't know - a newer License Server
            // that added one, used through its API. Every panel below reads
            // the provider's details, so the row says so instead of
            // breaking the whole Settings page.
            if (!STOREFRONT_PROVIDERS[webhook.provider]) {
              return (
                <Accordion.Item key={webhook.id} value={webhook.id}>
                  <Accordion.Control>
                    <Group gap="sm">
                      <Text fw={600}>{providerLabel(webhook.provider)}</Text>
                      <Badge color={badge.color} variant="light">
                        {badge.label}
                      </Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Alert color="gray" variant="light" maw={SETTINGS_TEXT_WIDTH} title="Not supported by this console">
                      This webhook&apos;s storefront ({webhook.provider}) needs a newer License Console to set up and
                      manage here.
                    </Alert>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            }
            return (
              <Accordion.Item key={webhook.id} value={webhook.id}>
                <Accordion.Control>
                  <Group justify="space-between" pr="md" wrap="nowrap">
                    <Group gap="sm">
                      <Text fw={600}>{providerLabel(webhook.provider)}</Text>
                      <Badge color={badge.color} variant="light">
                        {badge.label}
                      </Badge>
                      {webhook.environment && (
                        <Badge color={webhook.environment === 'live' ? 'blue' : 'grape'} variant="outline">
                          {webhook.environment === 'live' ? 'Live' : 'Sandbox'}
                        </Badge>
                      )}
                      {webhook.api_key_problem && webhook.status !== 'disabled' && (
                        <Badge color={API_KEY_PROBLEM_TEXT[webhook.api_key_problem]?.color ?? 'red'} variant="light">
                          API key
                        </Badge>
                      )}
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
                    {/* Setup and settings at the readable width; the
                        callback URL and the mappings and deliveries tables
                        use the panel's. */}
                    {webhook.status === 'pending' && (
                      <Box maw={SETTINGS_TEXT_WIDTH}>
                        <WebhookSecretSetup
                          webhook={webhook}
                          webhookUrl={webhookUrlFor(webhook.id)}
                          onSaved={(status) => handleSecretSaved(webhook.id, status)}
                          onApiKeySaved={(status) => handleApiKeySaved(webhook.id, status)}
                        />
                      </Box>
                    )}

                    {webhook.status !== 'pending' && (
                      <>
                        {/* Full width: a value to copy, not prose - in the
                            text column it scrolled sideways. */}
                        <Box>
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
                        </Box>

                        {webhook.refund_policy && webhook.status !== 'disabled' && (
                          <Box maw={SETTINGS_TEXT_WIDTH}>
                            <RefundPolicyControl webhook={webhook} onChanged={handleRefundPolicyChanged} />
                          </Box>
                        )}

                        {webhook.subscription_grace_days !== undefined && webhook.status !== 'disabled' && (
                          // Keyed on the saved value, so the field resets
                          // whenever the webhook's grace changes from
                          // outside the control (e.g. a future refresh).
                          <Box maw={SETTINGS_TEXT_WIDTH}>
                            <SubscriptionGraceControl
                              key={`${webhook.id}:${webhook.subscription_grace_days}`}
                              webhook={webhook}
                              onChanged={handleGraceChanged}
                            />
                          </Box>
                        )}

                        {STOREFRONT_PROVIDERS[webhook.provider].needsApiKey && webhook.status === 'active' && (
                          <Box maw={SETTINGS_TEXT_WIDTH}>
                            <PaddleApiKeyPanel
                              webhook={webhook}
                              onApiKeySaved={(status) => handleApiKeySaved(webhook.id, status)}
                              onSent={() =>
                                setDeliveriesVersion((prev) => ({ ...prev, [webhook.id]: (prev[webhook.id] ?? 0) + 1 }))
                              }
                            />
                          </Box>
                        )}

                        <StorefrontWebhookMappings
                          webhookId={webhook.id}
                          provider={webhook.provider}
                          active={openId === webhook.id}
                        />
                        <StorefrontWebhookDeliveries
                          // Remounted to reload after pending deliveries are sent.
                          key={`${webhook.id}:${deliveriesVersion[webhook.id] ?? 0}`}
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

      <Modal
        opened={environmentPicker !== null}
        onClose={() => setEnvironmentPicker(null)}
        title={`Connect ${environmentPicker ? providerLabel(environmentPicker) : ''}`}
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            Paddle&apos;s sandbox and live accounts are separate, and its events don&apos;t say which one sent them, so a
            webhook is for one of them - chosen now, and not changed later. To go live after testing, disable the
            sandbox webhook and connect a live one.
          </Text>
          <SegmentedControl
            value={environment}
            onChange={(value) => setEnvironment(value as StorefrontWebhookEnvironment)}
            data={[
              { label: 'Sandbox', value: 'sandbox' },
              { label: 'Live', value: 'live' },
            ]}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEnvironmentPicker(null)} disabled={connecting !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => environmentPicker && handleConnect(environmentPicker, environment)}
              loading={connecting !== null}
            >
              Connect
            </Button>
          </Group>
        </Stack>
      </Modal>

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
  onApiKeySaved,
}: {
  webhook: StorefrontWebhook;
  webhookUrl: string;
  onSaved: (status: StorefrontWebhookStatus) => void;
  onApiKeySaved: (status: StorefrontWebhookStatus) => void;
}) {
  const info = STOREFRONT_PROVIDERS[webhook.provider];
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Paddle: the secret can be saved before the key; the webhook stays
  // pending until both are.
  const [secretSaved, setSecretSaved] = useState(false);

  async function handleSave() {
    setError(null);
    const trimmed = secret.trim();
    if (!trimmed) {
      setError(
        info.vendorChosenSecret
          ? 'Generate a signing secret (or enter your own), and use the same one in Lemon Squeezy'
          : `Paste the signing secret ${info.label} shows you after adding this endpoint`
      );
      return;
    }
    if (info.secretPrefix && !trimmed.startsWith(info.secretPrefix)) {
      setError(`A ${info.label} signing secret starts with ${info.secretPrefix} - copy it from the notification destination`);
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
      setSecretSaved(true);
      setSecret('');
      onSaved(result.data);
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
        {webhook.provider === 'paddle' ? (
          <Stack gap={6}>
            <Text size="sm">In your Paddle {webhook.environment === 'live' ? 'live' : 'sandbox'} account:</Text>
            <Text size="sm">
              1. Developer tools → Notifications → New destination, with the URL below and the{' '}
              <Code fz="xs">transaction.completed</Code>, <Code fz="xs">adjustment.created</Code> and{' '}
              <Code fz="xs">adjustment.updated</Code> events. Optionally add <Code fz="xs">api_key.expiring</Code>,{' '}
              <Code fz="xs">api_key.expired</Code> and <Code fz="xs">api_key.revoked</Code>, to be warned about the key.
              {webhook.subscription_grace_days !== undefined && <SubscriptionEventsNote provider={webhook.provider} />}
            </Text>
            <Text size="sm">2. Copy the destination&apos;s secret key and save it below.</Text>
            <Text size="sm">
              3. Developer tools → Authentication → New API key, with <strong>only</strong>{' '}
              Customers: read and a custom
              expiry a year out. Paddle&apos;s events don&apos;t include the buyer&apos;s email, so the License Server looks
              it up with this key. Save it below.
            </Text>
          </Stack>
        ) : webhook.provider === 'lemonsqueezy' ? (
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
        label={secretSaved ? 'Signing secret (saved - paste again to replace it)' : 'Signing secret'}
        description={
          info.vendorChosenSecret && info.secretLength
            ? `${info.secretLength.min}-${info.secretLength.max} characters - Lemon Squeezy doesn't generate one, so use the same secret there and here`
            : info.secretPrefix
              ? `The notification destination's secret key (${info.secretPrefix}...)`
              : undefined
        }
        placeholder={info.vendorChosenSecret ? 'Generate one, or enter your own' : info.secretPrefix ? `${info.secretPrefix}...` : 'whsec_...'}
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

      {info.needsApiKey && <ApiKeyField webhook={webhook} onSaved={onApiKeySaved} />}
    </Stack>
  );
}

// A Paddle webhook's API key (License Server 1.11.0+): checked here for
// shape and environment only to fail fast - the server checks it with
// Paddle before saving, and its message is shown as-is.
function ApiKeyField({
  webhook,
  onSaved,
  replacing = false,
}: {
  webhook: StorefrontWebhook;
  onSaved: (status: StorefrontWebhookStatus) => void;
  replacing?: boolean;
}) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    const trimmed = apiKey.trim();
    const keyEnvironment = paddleKeyEnvironment(trimmed);
    if (!keyEnvironment) {
      setError('Paste a Paddle API key (pdl_sdbx_apikey_... or pdl_live_apikey_...)');
      return;
    }
    if (keyEnvironment !== webhook.environment) {
      setError(`That is a ${keyEnvironment} key, and this webhook is for Paddle's ${webhook.environment} environment`);
      return;
    }
    setSaving(true);
    try {
      const result = await setStorefrontWebhookApiKeyAction(webhook.id, trimmed);
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
      setApiKey('');
      notifications.show({ color: 'green', title: 'API key saved', message: 'Paddle accepted it.' });
      onSaved(result.data);
    } catch {
      notifications.show({ color: 'red', title: 'Failed to save the API key', message: 'Something went wrong. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="xs">
      <PasswordInput
        label={replacing ? 'Replace the API key' : webhook.has_api_key ? 'API key (saved - paste again to replace it)' : 'API key'}
        description="Customers: read only. Checked with Paddle before it's saved, and never shown again."
        placeholder={webhook.environment === 'live' ? 'pdl_live_apikey_...' : 'pdl_sdbx_apikey_...'}
        value={apiKey}
        onChange={(e) => setApiKey(e.currentTarget.value)}
        error={error}
        autoComplete="off"
      />
      <Group justify="flex-end">
        <Button onClick={handleSave} loading={saving} variant={replacing ? 'default' : 'filled'}>
          Save API key
        </Button>
      </Group>
    </Stack>
  );
}

// What a send-pending run's `stopped` means.
function stoppedText(stopped: string | null): string | null {
  if (!stopped) return null;
  if (stopped === 'batch_limit' || stopped === 'time_budget') return 'There are more to send - run it again.';
  if (stopped === 'daily_cap') return "Today's email limit is reached - try again tomorrow.";
  if (stopped === 'send_failed') return 'The email service failed - try again later.';
  // License Server 1.11.1+: disconnected, or a new API key saved, mid-run.
  if (stopped === 'webhook_changed') {
    return 'The webhook was disconnected or given a new API key while sending - check it, then run it again.';
  }
  if (API_KEY_PROBLEM_TEXT[stopped]) return `${API_KEY_PROBLEM_TEXT[stopped].title}.`;
  return "Paddle didn't answer - try again in a minute.";
}

// An active Paddle webhook's key status, a way to replace the key, and
// "Send pending deliveries" (License Server 1.11.0+): the way to email
// licenses issued while the key wasn't working, since Paddle doesn't
// resend an event it was answered.
function PaddleApiKeyPanel({
  webhook,
  onApiKeySaved,
  onSent,
}: {
  webhook: StorefrontWebhook;
  onApiKeySaved: (status: StorefrontWebhookStatus) => void;
  onSent: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StorefrontSendPendingResult | null>(null);
  const problem = webhook.api_key_problem ? API_KEY_PROBLEM_TEXT[webhook.api_key_problem] : null;

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      const response = await sendStorefrontPendingDeliveriesAction(webhook.id);
      if (!response.ok) {
        if (response.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          notifications.show({ color: 'red', title: "Couldn't send pending deliveries", message: response.message });
        }
        return;
      }
      if (!response.data) {
        notifications.show({ color: 'red', title: "Couldn't send pending deliveries", message: 'This webhook could not be found - try reloading' });
        return;
      }
      setResult(response.data);
      onSent();
    } catch {
      notifications.show({ color: 'red', title: "Couldn't send pending deliveries", message: 'Something went wrong. Please try again.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <Stack gap="sm">
      {problem && (
        <Alert color={problem.color} variant="light" title={problem.title}>
          {problem.body}
        </Alert>
      )}
      <ApiKeyField webhook={webhook} onSaved={onApiKeySaved} replacing />
      <div>
        <Text size="sm" fw={600} mb={4}>
          Pending deliveries
        </Text>
        <Text size="xs" c="dimmed" mb="xs">
          A license issued while the buyer&apos;s email couldn&apos;t be looked up is kept, and its email waits. Once the API
          key works, send them - up to 25 at a time, and no license is issued twice.
        </Text>
        <Group gap="sm" align="center">
          <Button size="xs" variant="default" onClick={handleSend} loading={sending}>
            Send pending deliveries
          </Button>
          {result && (
            <Text size="xs" c="dimmed" role="status">
              {result.sent === 1 ? 'Sent 1.' : `Sent ${result.sent}.`}
              {result.not_found > 0 && ` ${result.not_found} not found in Paddle.`}
              {result.remaining > 0 ? ` ${result.remaining} still waiting.` : ' None waiting.'}
              {stoppedText(result.stopped) && ` ${stoppedText(result.stopped)}`}
            </Text>
          )}
        </Group>
      </div>
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
        // The value was checked above, so a refusal now is about the
        // webhook (disabled elsewhere, a 409) or the server - a
        // notification, as for the refund setting, not a field error.
        if (result.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          notifications.show({ color: 'red', title: "Couldn't change the grace period", message: result.message });
        }
        return;
      }
      if (!result.data) {
        notifications.show({
          color: 'red',
          title: "Couldn't change the grace period",
          message: 'This webhook could not be found - try reloading',
        });
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

