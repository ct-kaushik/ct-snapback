import { Card, Stack, Title, Text, Button, Group, Alert, Badge, Select, ActionIcon, Tooltip, Code } from '@mantine/core';
import { IconBrandGoogleDrive, IconTrash, IconFolderPlus, IconPlugConnectedX } from '@tabler/icons-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api } from '../api';
import { useStores } from '../context';

export function Drive() {
  const { activeStore, refetch } = useStores();
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ['drive-status'], queryFn: () => api<{ enabled: boolean; accounts: { id: string; email: string }[] }>('/api/drive/status') });

  if (status.isLoading) return null;
  if (!status.data?.enabled) {
    return (
      <Stack maw={640}>
        <Title order={3}>Google Drive</Title>
        <Alert color="yellow" title="Not configured">
          Set <Code>GOOGLE_CLIENT_ID</Code> and <Code>GOOGLE_CLIENT_SECRET</Code> in your <Code>.env</Code> and restart.
          Create an OAuth client in Google Cloud Console (Drive API enabled) with redirect URI
          <Code> {location.origin}/api/drive/oauth/callback</Code>. Backups still run and are stored locally without Drive.
        </Alert>
      </Stack>
    );
  }

  const accounts = status.data.accounts;

  const useDefaultFolder = async () => {
    if (!activeStore || !account) return;
    setBusy(true);
    try {
      await api(`/api/stores/${activeStore.id}/drive/default`, { method: 'POST', body: { accountId: account } });
      notifications.show({ message: 'Backup folder linked', color: 'green' });
      refetch();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!activeStore) return;
    await api(`/api/stores/${activeStore.id}/drive`, { method: 'DELETE' });
    refetch();
  };

  const removeAccount = async (id: string) => {
    if (!confirm('Disconnect this Google account?')) return;
    await api(`/api/drive/accounts/${id}`, { method: 'DELETE' });
    status.refetch();
  };

  return (
    <Stack maw={720}>
      <Title order={3}>Google Drive</Title>

      <Card withBorder>
        <Group justify="space-between">
          <Text fw={600}>Connected accounts</Text>
          <Button component="a" href="/api/drive/connect" leftSection={<IconBrandGoogleDrive size={16} />}>Connect account</Button>
        </Group>
        <Stack mt="sm" gap="xs">
          {accounts.map((a) => (
            <Group key={a.id} justify="space-between">
              <Badge variant="light" tt="none">{a.email}</Badge>
              <Tooltip label="Disconnect"><ActionIcon variant="subtle" color="red" onClick={() => removeAccount(a.id)}><IconTrash size={16} /></ActionIcon></Tooltip>
            </Group>
          ))}
          {!accounts.length && <Text c="dimmed" size="sm">No Google accounts connected yet.</Text>}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Destination for “{activeStore?.name ?? 'no store selected'}”</Title>
        {activeStore?.drive.folderId ? (
          <Group justify="space-between">
            <Text>Uploading to <Code>{activeStore.drive.folderName}</Code></Text>
            <Button variant="light" color="red" leftSection={<IconPlugConnectedX size={16} />} onClick={unlink}>Unlink</Button>
          </Group>
        ) : (
          <Stack>
            <Select label="Google account" placeholder="Pick account" data={accounts.map((a) => ({ value: a.id, label: a.email }))} value={account} onChange={setAccount} />
            <Group>
              <Button leftSection={<IconFolderPlus size={16} />} onClick={useDefaultFolder} loading={busy} disabled={!activeStore || !account}>
                Create &amp; use “Coalition Snapback/{activeStore?.domain}”
              </Button>
            </Group>
            <Text size="xs" c="dimmed">A dedicated app folder is created per store (least-privilege drive.file scope).</Text>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
