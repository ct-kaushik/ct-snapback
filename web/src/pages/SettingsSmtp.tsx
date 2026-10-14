import { useEffect, useState } from 'react';
import { Card, Stack, Title, TextInput, NumberInput, Switch, Button, Group, PasswordInput, Text, Alert, Badge } from '@mantine/core';
import { IconMail, IconSend } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api } from '../api';

interface SmtpView { host: string; port: number; secure: boolean; user: string; from: string; hasPassword: boolean; configured: boolean; }

export function SettingsSmtp() {
  const q = useQuery({ queryKey: ['smtp'], queryFn: () => api<SmtpView>('/api/settings/smtp') });
  const [form, setForm] = useState({ host: '', port: 587, secure: false, user: '', pass: '', from: '' });
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (q.data) setForm((f) => ({ ...f, host: q.data.host, port: q.data.port, secure: q.data.secure, user: q.data.user, from: q.data.from, pass: '' }));
  }, [q.data]);

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/settings/smtp', { method: 'PUT', body: { host: form.host, port: form.port, secure: form.secure, user: form.user, from: form.from, pass: form.pass || undefined } });
      notifications.show({ message: 'SMTP settings saved and verified', color: 'coalgreen' });
      q.refetch();
    } catch (e) {
      notifications.show({ title: 'Could not save', message: (e as Error).message, color: 'red' });
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api('/api/settings/smtp/test', { method: 'POST', body: { to: testTo } });
      notifications.show({ message: `Test email sent to ${testTo}`, color: 'coalgreen' });
    } catch (e) {
      notifications.show({ title: 'Test failed', message: (e as Error).message, color: 'red' });
    } finally { setTesting(false); }
  };

  return (
    <Stack maw={620}>
      <Group justify="space-between">
        <Title order={3}>Email (SMTP)</Title>
        <Badge variant="light" color={q.data?.configured ? 'green' : 'gray'}>{q.data?.configured ? 'Configured' : 'Not configured'}</Badge>
      </Group>
      <Text c="dimmed" size="sm">Used to email user invites and password-reset links. Credentials are stored encrypted.</Text>

      <Card withBorder>
        <Stack>
          <TextInput label="SMTP host" placeholder="smtp.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.currentTarget.value })} leftSection={<IconMail size={16} />} />
          <Group grow>
            <NumberInput label="Port" value={form.port} onChange={(v) => setForm({ ...form, port: Number(v) || 587 })} />
            <Switch label="Use TLS (implicit, port 465)" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.currentTarget.checked })} mt={24} />
          </Group>
          <TextInput label="Username" value={form.user} onChange={(e) => setForm({ ...form, user: e.currentTarget.value })} />
          <PasswordInput label="Password" placeholder={q.data?.hasPassword ? '•••••••• (leave blank to keep)' : ''} value={form.pass} onChange={(e) => setForm({ ...form, pass: e.currentTarget.value })} />
          <TextInput label="From address" placeholder="Coalition Snapback <no-reply@example.com>" value={form.from} onChange={(e) => setForm({ ...form, from: e.currentTarget.value })} />
          <Alert color="gray" variant="light">Saving verifies the connection and credentials before storing them.</Alert>
          <Group justify="flex-end"><Button onClick={save} loading={busy} disabled={!form.host}>Save &amp; verify</Button></Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Send a test email</Title>
        <Group align="flex-end">
          <TextInput flex={1} label="Recipient" type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.currentTarget.value)} />
          <Button variant="light" leftSection={<IconSend size={16} />} onClick={sendTest} loading={testing} disabled={!testTo || !q.data?.configured}>Send test</Button>
        </Group>
      </Card>
    </Stack>
  );
}
