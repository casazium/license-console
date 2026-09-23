'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Group, NumberInput, Select, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { notifyRateLimited } from '@/lib/notify';
import type { CreateStorefrontMappingInput, StorefrontMapping, StorefrontMappingRefKind } from '@/lib/license-client';
import { createStorefrontMappingAction, deleteStorefrontMappingAction, listStorefrontMappingsAction } from './actions';

const REF_KIND_OPTIONS: { value: StorefrontMappingRefKind; label: string }[] = [
  { value: 'payment_link', label: 'Payment Link' },
  { value: 'metadata', label: 'Metadata (casazium_ref)' },
];

const EMPTY_FORM = {
  ref_kind: 'payment_link' as StorefrontMappingRefKind,
  external_ref: '',
  product_id: '',
  tier: '',
  max_activations: '',
  duration_days: '',
  notes: '',
  limitsJson: '',
};

/**
 * STOREFRONT_WEBHOOK_PLAN.md's own console spec: "a mappings table ...
 * with the same validation the server enforces surfaced as inline
 * errors." `limits` is deliberately a raw JSON textarea rather than a
 * dedicated field per key (validateLicenseLimits.js's ALLOWED_LIMIT_KEYS) -
 * a full key-value editor for a fixed small set of keys is more UI than
 * this v1 console section's own scope justifies; the server is still the
 * real source of truth for whether the parsed object is valid, and a
 * malformed-JSON typo is caught before the round trip either way (see
 * createStorefrontMapping's own client-side guard).
 *
 * `active` (not Accordion mount/unmount) gates the first fetch - Mantine
 * keeps every Accordion.Panel in the DOM regardless of open state, so a
 * plain mount-time effect would fetch every webhook's mappings at once
 * instead of only the one the tenant actually expanded.
 */
export function StorefrontWebhookMappings({ webhookId, active }: { webhookId: string; active: boolean }) {
  const [mappings, setMappings] = useState<StorefrontMapping[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A ref, not state - the initial fetch's own in-flight guard shouldn't
  // itself trigger a render (react-hooks/set-state-in-effect: calling
  // setState synchronously in an effect body risks a cascading-render
  // loop). "Still loading" for display purposes is derived instead, from
  // `active && mappings === null`, below.
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!active || mappings !== null || fetchingRef.current) return;
    fetchingRef.current = true;
    listStorefrontMappingsAction(webhookId)
      .then((result) => {
        if (!result.ok) {
          notifyRateLimited();
          return;
        }
        setMappings(result.data);
      })
      .catch(() => {
        // Independent-review finding (M2): this had no .catch at all -
        // an unhandled rejection (a 500, or a tenant-rejected error the
        // action re-throws after marking) left the panel stuck on
        // "Loading mappings..." forever, since fetchingRef never reset
        // and mappings never left null. Resetting it here means
        // collapsing and re-expanding the row retries, the same recovery
        // path a rate-limited fetch already had.
        notifications.show({
          color: 'red',
          title: "Couldn't load mappings",
          message: 'Collapse and re-expand this webhook to try again.',
        });
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  }, [active, webhookId, mappings]);

  const loading = active && mappings === null;

  async function refresh() {
    const result = await listStorefrontMappingsAction(webhookId);
    if (result.ok) setMappings(result.data);
  }

  async function handleCreate() {
    setFormError(null);
    if (!form.external_ref.trim() || !form.product_id.trim() || !form.tier.trim()) {
      setFormError('Reference, product, and tier are all required');
      return;
    }

    const input: CreateStorefrontMappingInput = {
      ref_kind: form.ref_kind,
      external_ref: form.external_ref.trim(),
      product_id: form.product_id.trim(),
      tier: form.tier.trim(),
      limitsJson: form.limitsJson.trim() || undefined,
      max_activations: form.max_activations ? Number(form.max_activations) : undefined,
      duration_days: form.duration_days ? Number(form.duration_days) : undefined,
      notes: form.notes.trim() || undefined,
    };

    setSaving(true);
    try {
      const result = await createStorefrontMappingAction(webhookId, input);
      if (!result.ok) {
        if (result.reason === 'rate-limited') {
          notifyRateLimited();
        } else {
          setFormError(result.message);
        }
        return;
      }
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await refresh();
    } catch {
      notifications.show({ color: 'red', title: 'Failed to add mapping', message: 'Something went wrong. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(mappingId: string) {
    try {
      const result = await deleteStorefrontMappingAction(webhookId, mappingId);
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      setMappings((prev) => prev?.filter((m) => m.id !== mappingId) ?? prev);
    } catch {
      notifications.show({ color: 'red', title: 'Failed to remove mapping', message: 'Something went wrong. Please try again.' });
    }
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Product mappings
      </Text>
      <Text size="xs" c="dimmed">
        Map each Payment Link (or a <Text component="code" fz="xs">casazium_ref</Text> metadata value) to the
        product, tier, and limits a purchase through it should issue.
      </Text>

      {loading && (
        <Text size="sm" c="dimmed">
          Loading mappings…
        </Text>
      )}

      {mappings && mappings.length > 0 && (
        // Layout bug found live (real Coolify test deployment, not caught
        // by any local review): this table's natural (layout: auto)
        // width regularly exceeds the Accordion.Panel's own width once
        // real Payment Link IDs/product names are long enough - with no
        // scroll container, the overflow rendered as `visible`, so the
        // table (and its own withTableBorder box) spilled out past the
        // webhook card's right edge, visually crossing over neighboring
        // content. Table.ScrollContainer contains that overflow with its
        // own horizontal scrollbar instead.
        <Table.ScrollContainer minWidth={500}>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Product</Table.Th>
                <Table.Th>Tier</Table.Th>
                <Table.Th>Seats</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {mappings.map((mapping) => (
                <Table.Tr key={mapping.id}>
                  <Table.Td>
                    <Text size="sm">{mapping.external_ref}</Text>
                    <Text size="xs" c="dimmed">
                      {mapping.ref_kind === 'payment_link' ? 'Payment Link' : 'Metadata'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{mapping.product_id}</Table.Td>
                  <Table.Td>{mapping.tier}</Table.Td>
                  <Table.Td>{mapping.max_activations ?? 'Unlimited'}</Table.Td>
                  <Table.Td>{mapping.duration_days ? `${mapping.duration_days} days` : 'Perpetual'}</Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="subtle" color="red" onClick={() => handleDelete(mapping.id)}>
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {mappings && mappings.length === 0 && (
        <Text size="sm" c="dimmed">
          No mappings yet — a purchase through this webhook won&apos;t issue anything until one exists.
        </Text>
      )}

      {formOpen ? (
        <Stack gap="xs" p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
          <Group grow>
            <Select
              label="Reference type"
              data={REF_KIND_OPTIONS}
              value={form.ref_kind}
              onChange={(value) => setForm((f) => ({ ...f, ref_kind: (value as StorefrontMappingRefKind) || f.ref_kind }))}
            />
            <TextInput
              label={form.ref_kind === 'payment_link' ? 'Payment Link ID' : 'casazium_ref value'}
              placeholder={form.ref_kind === 'payment_link' ? 'plink_...' : 'my-product-ref'}
              value={form.external_ref}
              onChange={(e) => {
                const externalRef = e.currentTarget.value;
                setForm((f) => ({ ...f, external_ref: externalRef }));
              }}
            />
          </Group>
          <Group grow>
            <TextInput
              label="Product ID"
              value={form.product_id}
              onChange={(e) => {
                const productId = e.currentTarget.value;
                setForm((f) => ({ ...f, product_id: productId }));
              }}
            />
            <TextInput
              label="Tier"
              value={form.tier}
              onChange={(e) => {
                const tier = e.currentTarget.value;
                setForm((f) => ({ ...f, tier }));
              }}
            />
          </Group>
          <Group grow>
            <NumberInput
              label="Max activations (optional)"
              placeholder="Unlimited"
              min={1}
              value={form.max_activations}
              onChange={(value) => setForm((f) => ({ ...f, max_activations: value === '' ? '' : String(value) }))}
            />
            <NumberInput
              label="Duration in days (optional)"
              placeholder="Perpetual"
              min={1}
              value={form.duration_days}
              onChange={(value) => setForm((f) => ({ ...f, duration_days: value === '' ? '' : String(value) }))}
            />
          </Group>
          <Textarea
            label="Limits (optional, JSON)"
            placeholder='{"api_calls_per_day": 10000}'
            minRows={2}
            value={form.limitsJson}
            onChange={(e) => {
              const limitsJson = e.currentTarget.value;
              setForm((f) => ({ ...f, limitsJson }));
            }}
          />
          <Textarea
            label="Notes (optional)"
            value={form.notes}
            onChange={(e) => {
              const notes = e.currentTarget.value;
              setForm((f) => ({ ...f, notes }));
            }}
          />
          {formError && (
            <Text size="sm" c="red">
              {formError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={saving}>
              Add mapping
            </Button>
          </Group>
        </Stack>
      ) : (
        <Group>
          <Button variant="light" size="xs" onClick={() => setFormOpen(true)}>
            Add mapping
          </Button>
        </Group>
      )}
    </Stack>
  );
}
