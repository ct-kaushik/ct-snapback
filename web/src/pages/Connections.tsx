import { useState } from 'react';
import {
  Button, Card, Group, Modal, Stack, Table, Text, TextInput, Title, Badge, ActionIcon, Tooltip, Alert, Code,
} from '@mantine/core';
import { IconPlus, IconTrash, IconPlugConnected, IconEdit } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { api, type Store } from '../api';
import { useStores } from '../context';

export function Connections() {
  const { stores, refetch } = useStores();
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [form, setForm] = useState({ name: '', domain: '', apiVersion: '2026-07', token: '' });
  const [busy, setBusy] = useState(false);

  const openNew = () => { setEditing(null); setForm({ name: '', domain: '', apiVersion: '2026-07', token: '' }); setOpened(true); };
  const openEdit = (s: Store) => { setEditing(s); setForm({ name: s.name, domain: s.domain, apiVersion: s.apiVersion, token: '' }); setOpened(true); };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/stores/${editing.id}`, { method: 'PATCH', body: { name: form.name, apiVersion: form.apiVersion, token: form.token || undefined } });
      } else {
        await api('/api/stores', { method: 'POST', body: form });
      }
      notifications.show({ message: 'Store saved', color: 'green' });
      setOpened(false);
      refetch();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Store) => {
    if (!confirm(`Delete store "${s.name}"? Its backup catalog entries will be removed (files on disk are kept unless you delete backups).`)) return;
    await api(`/api/stores/${s.id}`, { method: 'DELETE' });
    refetch();
  };

  const test = async (s: Store) => {
    try {
      const r = await api<{ shop: { name: string } }>(`/api/stores/${s.id}/test`, { method: 'POST' });
      notifications.show({ message: `Connected to "${r.shop.name}"`, color: 'green' });
    } catch (e) {
      notifications.show({ title: 'Connection failed', message: (e as Error).message, color: 'red' });
    }
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Store connections</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>Add store</Button>
      </Group>

      <Card withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Name</Table.Th><Table.Th>Domain</Table.Th><Table.Th>API</Table.Th><Table.Th>Token</Table.Th><Table.Th>Schedule</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {stores.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{s.name}</Table.Td>
                <Table.Td><Code>{s.domain}</Code></Table.Td>
                <Table.Td>{s.apiVersion}</Table.Td>
                <Table.Td><Text c="dimmed" size="sm">{s.tokenMasked}</Text></Table.Td>
                <Table.Td><Badge variant="light" color={s.schedule.enabled ? 'green' : 'gray'}>{s.schedule.enabled ? s.schedule.cron : 'off'}</Badge></Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <Tooltip label="Test connection"><ActionIcon variant="subtle" onClick={() => test(s)}><IconPlugConnected size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Edit"><ActionIcon variant="subtle" onClick={() => openEdit(s)}><IconEdit size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => remove(s)}><IconTrash size={16} /></ActionIcon></Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {!stores.length && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed">No stores yet.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={() => setOpened(false)} title={editing ? 'Edit store' : 'Add store'} centered>
        <Stack>
          <TextInput label="Display name" placeholder="My Store (Production)" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput label="Store domain" placeholder="your-store.myshopify.com" value={form.domain} disabled={!!editing} onChange={(e) => setForm({ ...form, domain: e.currentTarget.value })} />
          <TextInput label="API version" value={form.apiVersion} onChange={(e) => setForm({ ...form, apiVersion: e.currentTarget.value })} />
          <TextInput
            label={editing ? 'Admin API token (leave blank to keep)' : 'Admin API access token'}
            placeholder="shpat_…"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.currentTarget.value })}
          />
          <Alert color="gray" variant="light">
            Create the token from a custom app in the Shopify Dev Dashboard with scopes <Code>read_products</Code>, <Code>read_metaobjects</Code>, <Code>read_metaobject_definitions</Code> (and <Code>write_products</Code>, <Code>write_metaobjects</Code> for restore). It is stored encrypted.
          </Alert>
          <Button loading={busy} onClick={save} disabled={!form.name || !form.domain || (!editing && !form.token)}>Save</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
