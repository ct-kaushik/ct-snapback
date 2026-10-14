import { useState } from 'react';
import {
  Card, Table, Title, Stack, Group, Button, Modal, TextInput, PasswordInput, Select, MultiSelect,
  Badge, ActionIcon, Tooltip, Text, Switch, Alert, CopyButton,
} from '@mantine/core';
import { IconPlus, IconEdit, IconTrash, IconSend } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api } from '../api';
import { useStores } from '../context';

interface UserRow { id: string; email: string; name: string; role: string; isActive: boolean; emailVerified: boolean; status: string; storeIds: string[]; }

export function Users() {
  const qc = useQueryClient();
  const { stores } = useStores();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/api/users') });
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer', isActive: true, storeIds: [] as string[] });
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }));

  const openNew = () => { setEditing(null); setForm({ email: '', name: '', password: '', role: 'viewer', isActive: true, storeIds: [] }); setOpened(true); };
  const openEdit = (u: UserRow) => { setEditing(u); setForm({ email: u.email, name: u.name, password: '', role: u.role, isActive: u.isActive, storeIds: u.storeIds }); setOpened(true); };

  const save = async () => {
    try {
      if (editing) {
        await api(`/api/users/${editing.id}`, { method: 'PATCH', body: { name: form.name, role: form.role, isActive: form.isActive, password: form.password || undefined, storeIds: form.storeIds } });
        notifications.show({ message: 'User updated', color: 'green' });
      } else {
        const r = await api<{ emailed: boolean; inviteUrl?: string }>('/api/users', { method: 'POST', body: { email: form.email, name: form.name, role: form.role, storeIds: form.storeIds } });
        if (r.emailed) notifications.show({ message: `Invite emailed to ${form.email}`, color: 'coalgreen' });
        else if (r.inviteUrl) setInviteLink(r.inviteUrl);
      }
      setOpened(false);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    }
  };

  const resend = async (u: UserRow) => {
    try {
      const r = await api<{ emailed: boolean; inviteUrl?: string }>(`/api/users/${u.id}/resend-invite`, { method: 'POST' });
      if (r.emailed) notifications.show({ message: `Invite re-sent to ${u.email}`, color: 'coalgreen' });
      else if (r.inviteUrl) setInviteLink(r.inviteUrl);
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    }
  };

  const remove = async (u: UserRow) => {
    if (!confirm(`Delete user ${u.email}?`)) return;
    await api(`/api/users/${u.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  const isAdminRole = form.role === 'admin';

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>Invite user</Button>
      </Group>

      <Card withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Name</Table.Th><Table.Th>Email</Table.Th><Table.Th>Role</Table.Th><Table.Th>Status</Table.Th><Table.Th>Stores</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(users.data ?? []).map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td><Badge variant="light" color={u.role === 'admin' ? 'grape' : u.role === 'operator' ? 'blue' : 'gray'}>{u.role}</Badge></Table.Td>
                <Table.Td>
                  {u.status === 'pending'
                    ? <Badge color="yellow" variant="dot">pending invite</Badge>
                    : u.isActive
                      ? <Badge color="green" variant="dot">active</Badge>
                      : <Badge color="red" variant="dot">disabled</Badge>}
                </Table.Td>
                <Table.Td>{u.role === 'admin' ? <Text c="dimmed" size="sm">all</Text> : `${u.storeIds.length} store(s)`}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    {u.status === 'pending' && <Tooltip label="Resend invite"><ActionIcon variant="subtle" color="blue" onClick={() => resend(u)}><IconSend size={16} /></ActionIcon></Tooltip>}
                    <Tooltip label="Edit"><ActionIcon variant="subtle" onClick={() => openEdit(u)}><IconEdit size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => remove(u)}><IconTrash size={16} /></ActionIcon></Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={() => setOpened(false)} title={editing ? 'Edit user' : 'Invite user'} centered>
        <Stack>
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput label="Email" value={form.email} disabled={!!editing} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
          {editing && <PasswordInput label="New password (leave blank to keep)" value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />}
          <Select label="Role" data={['admin', 'operator', 'viewer']} value={form.role} onChange={(v) => setForm({ ...form, role: v ?? 'viewer' })} />
          {editing && <Switch label="Active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} />}
          {!isAdminRole && (
            <MultiSelect label="Store access" description="Which stores this user can see" data={storeOptions} value={form.storeIds} onChange={(v) => setForm({ ...form, storeIds: v })} />
          )}
          {!editing && <Alert color="gray" variant="light">The user gets an email with a link to set their password (which also verifies their email). If SMTP isn’t configured yet, you’ll get a link to share manually.</Alert>}
          <Button onClick={save} disabled={!form.name || (!editing && !form.email)}>{editing ? 'Save' : 'Send invite'}</Button>
        </Stack>
      </Modal>

      <Modal opened={!!inviteLink} onClose={() => setInviteLink(null)} title="Invite link" centered>
        <Stack>
          <Alert color="yellow" variant="light">SMTP isn’t configured, so no email was sent. Share this one-time link with the user:</Alert>
          <TextInput readOnly value={inviteLink ?? ''} />
          <Group justify="flex-end">
            <CopyButton value={inviteLink ?? ''}>
              {({ copied, copy }) => <Button color={copied ? 'green' : undefined} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>}
            </CopyButton>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
