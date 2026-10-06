'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Code, Group, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { notifyRateLimited } from '@/lib/notify';
import { formatDate, formatDateTime } from '@/lib/format';
import type { StorefrontDelivery, StorefrontWebhookProvider } from '@/lib/license-client';
import { listStorefrontDeliveriesAction } from './actions';

const PAGE_SIZE = 20;

// storefront-webhook.js's own delivery lease reclaims a stalled 'sending'
// attempt after 30 seconds - anything still 'pending' this much longer
// after its own processed_at is genuinely stuck, not mid-flight, and
// worth flagging.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

function outcomeBadge(delivery: StorefrontDelivery): { label: string; color: string } {
  switch (delivery.outcome) {
    case 'issued':
      return delivery.delivery_status === 'sent'
        ? { label: 'Issued & sent', color: 'green' }
        : { label: 'Issued', color: 'blue' };
    case 'processing':
      return { label: 'Processing', color: 'blue' };
    case 'awaiting_payment':
      return { label: 'Awaiting payment', color: 'yellow' };
    case 'unmapped':
      return { label: 'No matching mapping', color: 'orange' };
    case 'over_quota':
      return { label: 'Over quota', color: 'orange' };
    case 'invalid_input':
      return { label: 'Invalid input', color: 'red' };
    case 'error':
      return { label: 'Error', color: 'red' };
    case 'refunded_before_issue':
      return { label: 'Refunded first', color: 'gray' };
    default:
      return { label: delivery.outcome, color: 'gray' };
  }
}

// License Server 1.8.0+: what a refund did. Null when the purchase has
// had no refund (or the server predates refund handling), and for
// 'refunded_before_issue', whose outcome badge already says it. Labels
// stay short enough for the 180px Outcome column at Mantine's uppercase
// badge size (checked live).
function refundBadge(delivery: StorefrontDelivery): { label: string; color: string; variant: 'light' | 'outline' } | null {
  if (delivery.outcome === 'refunded_before_issue') return null;
  if (delivery.refund_kind === 'partial') return { label: 'Partly refunded', color: 'gray', variant: 'outline' };
  if (delivery.refund_kind !== 'full') return null;
  switch (delivery.refund_action) {
    case 'revoked':
      return { label: 'Refunded · revoked', color: 'grape', variant: 'light' };
    case 'recorded':
      return { label: 'Refunded · kept', color: 'gray', variant: 'light' };
    case 'already_revoked':
      // Revoked by hand before the refund arrived - revoked either way.
      return { label: 'Refunded · revoked', color: 'grape', variant: 'light' };
    case 'revoke_failed':
      return { label: 'Revoke by hand', color: 'red', variant: 'light' };
    default:
      return { label: 'Refunded', color: 'gray', variant: 'light' };
  }
}

// Independent-review finding (M1): casazium/license's own processed_at
// column is written via SQLite's CURRENT_TIMESTAMP, which produces
// "YYYY-MM-DD HH:MM:SS" - genuinely UTC, but with no 'T' or 'Z' marker.
// `new Date()` parses that exact shape as the *viewer's local* time, not
// UTC - confirmed directly (a delivery 10 minutes old computed as -401
// minutes under America/Los_Angeles). Mock mode's own seeded
// toISOString() values already carry a 'T'/'Z' and were never affected,
// which is exactly why this went unnoticed in standalone-mode testing.
function parseTimestamp(value: string): number {
  const isoLike = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(isoLike).getTime();
}

// A muted line under the refund badge: when, and for a partial refund how
// much. Amounts arrive in the provider's smallest currency unit with no
// currency attached, so this shows a percentage rather than guessing at
// a currency's decimal places (yen has none).
function refundDetail(delivery: StorefrontDelivery): string | null {
  if (!delivery.refund_kind) return null;
  const parts: string[] = [];
  if (
    delivery.refund_kind === 'partial' &&
    typeof delivery.refunded_amount === 'number' &&
    typeof delivery.amount_total === 'number' &&
    delivery.amount_total > 0
  ) {
    parts.push(`${Math.round((delivery.refunded_amount / delivery.amount_total) * 100)}% refunded`);
  }
  if (delivery.refunded_at) {
    parts.push(formatDate(new Date(parseTimestamp(delivery.refunded_at)).toISOString()));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function isStuck(delivery: StorefrontDelivery): boolean {
  if (delivery.outcome !== 'issued' || delivery.delivery_status === 'sent') return false;
  // A fully refunded purchase is never emailed (License Server 1.8.0+),
  // so an unsent email there isn't stuck.
  if (delivery.refund_kind === 'full') return false;
  if (!delivery.processed_at) return false;
  return Date.now() - parseTimestamp(delivery.processed_at) > STUCK_THRESHOLD_MS;
}

/**
 * STOREFRONT_WEBHOOK_PLAN.md's own console spec: "the tenant's only
 * visibility into 'did this actually work.'" No in-app resend action
 * (operator decision, this session): the platform never persists a
 * buyer's email anywhere (only available transiently from the Stripe
 * event body at delivery time), so a real one-click resend would require
 * a new permanent buyer-PII retention point this feature doesn't have
 * elsewhere. Stripe's own event redelivery already works today with no
 * server-side change - storefront-webhook.js's existing delivery-retry
 * path (outcome 'issued', delivery_status not yet 'sent') picks it back
 * up correctly - so a stuck row here just points the tenant at that.
 */
export function StorefrontWebhookDeliveries({
  webhookId,
  provider,
  active,
}: {
  webhookId: string;
  provider: StorefrontWebhookProvider;
  active: boolean;
}) {
  const [deliveries, setDeliveries] = useState<StorefrontDelivery[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  // Only for the "Load more" button's own busy state - the initial
  // fetch's in-flight guard is a ref instead (see fetchingRef below),
  // since calling setState synchronously in an effect body risks a
  // cascading-render loop (react-hooks/set-state-in-effect). "Still
  // loading the first page" for display is derived below instead, from
  // `active && deliveries === null`.
  const [loading, setLoading] = useState(false);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!active || deliveries !== null || fetchingRef.current) return;
    fetchingRef.current = true;
    listStorefrontDeliveriesAction(webhookId, { limit: PAGE_SIZE, offset: 0 })
      .then((result) => {
        if (!result.ok) {
          notifyRateLimited();
          return;
        }
        setDeliveries(result.data.deliveries);
        setHasMore(result.data.hasMore);
        setOffset(result.data.deliveries.length);
      })
      .catch(() => {
        // Independent-review finding (M2): same gap as
        // StorefrontWebhookMappings's own initial fetch - an unhandled
        // rejection here left the panel stuck on "Loading deliveries..."
        // forever, with fetchingRef never reset. Collapsing and
        // re-expanding now retries.
        notifications.show({
          color: 'red',
          title: "Couldn't load deliveries",
          message: 'Collapse and re-expand this webhook to try again.',
        });
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  }, [active, webhookId, deliveries]);

  const initialLoading = active && deliveries === null;

  async function loadMore() {
    setLoading(true);
    try {
      const result = await listStorefrontDeliveriesAction(webhookId, { limit: PAGE_SIZE, offset });
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      setDeliveries((prev) => [...(prev ?? []), ...result.data.deliveries]);
      setHasMore(result.data.hasMore);
      setOffset((prev) => prev + result.data.deliveries.length);
    } finally {
      setLoading(false);
    }
  }

  const stuckCount = deliveries?.filter(isStuck).length ?? 0;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Deliveries
      </Text>

      {stuckCount > 0 && (
        <Alert color="orange" variant="light" title="Needs attention">
          {stuckCount === 1 ? 'One purchase issued a license' : `${stuckCount} purchases issued a license`}{' '}
          but its confirmation email hasn&apos;t gone out.{' '}
          {provider === 'lemonsqueezy' ? (
            // The License Server ignores a Lemon Squeezy order more than 7
            // days old (its replay window), so a later resend does nothing.
            <>
              Resend the order&apos;s webhook from Lemon Squeezy (Settings → Webhooks) within 7 days of the
              order to retry — no license will be issued twice. After that, send the buyer their key
              yourself.
            </>
          ) : (
            <>
              Redeliver the matching event from your Stripe dashboard (Developers → Webhooks → this endpoint)
              to retry — no license will be issued twice.
            </>
          )}
        </Alert>
      )}

      {initialLoading && (
        <Text size="sm" c="dimmed">
          Loading deliveries…
        </Text>
      )}

      {deliveries && deliveries.length === 0 && (
        <Text size="sm" c="dimmed">
          No purchases through this webhook yet.
        </Text>
      )}

      {deliveries && deliveries.length > 0 && (
        // Layout bug found live on a real Coolify deployment, in three
        // parts, none caught by any local review:
        // 1. With real checkout_session_id/license_key values, this
        //    table's natural width exceeded the webhook card's width,
        //    and with no scroll container the overflow rendered
        //    `visible`, spilling the table's own border past the card's
        //    edge. Fixed with Table.ScrollContainer below.
        // 2. That alone wasn't enough: Mantine's Code component already
        //    sets overflow-wrap: break-word, but table-layout: auto
        //    (the default) sizes each column to its content's natural,
        //    UNWRAPPED width before ever considering that property - so
        //    inside a horizontally-scrollable, otherwise-unconstrained
        //    container, the browser just kept growing the table instead
        //    of ever wrapping a long id, leaving genuinely cut-off-
        //    looking content. table-layout: fixed with explicit column
        //    widths forces the browser to respect those widths and
        //    actually wrap long ids within their cell instead.
        // 3. Found only after both of those (same root cause as the
        //    matching fix in StorefrontWebhookMappings.tsx, confirmed
        //    the same way - a live Playwright reproduction against real
        //    seeded data, not assumed from a screenshot): a percentage
        //    width still starves a short, non-wrapping column once the
        //    card is near the low end of the scrollable range - 20% of a
        //    real ~606px card is ~121px, under what Mantine's own
        //    uppercased Badge needs for "Issued & sent"/"No matching
        //    mapping", so the Badge's own default text-overflow:
        //    ellipsis silently truncated it ("ISSUED & SE..."). Outcome
        //    and Processed get explicit pixel widths instead - a literal
        //    width the browser can't renegotiate, the same fix as the
        //    Remove-button column above. Checkout session/License keep
        //    no explicit width, absorbing whatever table-layout: fixed
        //    leaves over for their existing wordBreak wrapping. The
        //    Outcome Group also drops wrap="nowrap": a second "Needs
        //    attention" badge now wraps to its own line inside the cell
        //    instead of needing a column wide enough for both badges on
        //    one line in the common case.
        //
        // minWidth stays at 500, not raised to comfortably fit both
        // fixed columns (330px) plus the two flexible ones - a first
        // attempt at raising it (640) silently regressed this same bug:
        // it made the table wider than the real ~606px card, pushing
        // Table.ScrollContainer's Mantine ScrollArea into horizontal-
        // scroll mode with its overlay scrollbar, invisible in a static
        // screenshot and undiscoverable to a tenant with no reason to
        // expect this table to scroll sideways. minWidth here is only a
        // floor for genuinely narrow (mobile) viewports; it must never
        // exceed a realistic desktop card width.
        <Table.ScrollContainer minWidth={500}>
          <Table striped withTableBorder style={{ tableLayout: 'fixed', width: '100%' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Checkout session</Table.Th>
                <Table.Th style={{ width: 180 }}>Outcome</Table.Th>
                <Table.Th>License</Table.Th>
                <Table.Th style={{ width: 150 }}>Processed</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {deliveries.map((delivery) => {
                const badge = outcomeBadge(delivery);
                const refund = refundBadge(delivery);
                const detail = refund ? refundDetail(delivery) : null;
                const stuck = isStuck(delivery);
                return (
                  <Table.Tr key={delivery.checkout_session_id}>
                    <Table.Td>
                      <Code fz="xs" style={{ wordBreak: 'break-all' }}>
                        {delivery.checkout_session_id}
                      </Code>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Badge color={badge.color} variant="light">
                          {badge.label}
                        </Badge>
                        {refund && (
                          <Badge color={refund.color} variant={refund.variant}>
                            {refund.label}
                          </Badge>
                        )}
                        {detail && (
                          <Text size="xs" c="dimmed" w="100%">
                            {detail}
                          </Text>
                        )}
                        {stuck && (
                          <Badge color="orange" variant="outline">
                            Needs attention
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {delivery.license_key ? (
                        <Code fz="xs" style={{ wordBreak: 'break-all' }}>
                          {delivery.license_key}
                        </Code>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                    <Table.Td>{formatDateTime(delivery.processed_at)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {hasMore && (
        <Group justify="center">
          <Button variant="default" size="xs" loading={loading} onClick={loadMore}>
            Load more
          </Button>
        </Group>
      )}

      {deliveries && deliveries.some((d) => d.license_key) && (
        <Text size="xs" c="dimmed">
          To revoke a license issued here, find it by key in License Management.
        </Text>
      )}
    </Stack>
  );
}
