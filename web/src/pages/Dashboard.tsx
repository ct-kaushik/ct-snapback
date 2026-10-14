import { Card, Text, Group, Button, SimpleGrid, Badge, Table, Title, Stack, Anchor, Alert } from '@mantine/core';
import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { api } from '../api';
import { useSession, useStores } from '../context';
import { DRIVE_ENABLED } from '../features';
import { LiveProgress } from '../components/LiveProgress';

export function Dashboard() {
  const { data: session } = useSession();
  const { activeStore, refetch } = useStores();
  const qc = useQueryClient();
  const role = session?.user?.role ?? 'viewer';
  const canRun = role === 'admin' || role === 'operator';

  const runs = useQuery({
    queryKey: ['runs', activeStore?.id],
    queryFn: () => api<any[]>(`/api/stores/${activeStore!.id}/runs`),
    enabled: !!activeStore,
  });

  if (!activeStore) {
    return (
      <Alert color="blue" title="No store connected">
        {role === 'admin'
          ? <>Add your first store in <Anchor component={Link} to="/connections">Connections</Anchor> to get started.</>
          : 'No stores have been shared with your account yet. Ask an administrator to grant access.'}
      </Alert>
    );
  }

  const runBackup = async () => {
    try {
      await api(`/api/stores/${activeStore.id}/backups`, { method: 'POST' });
      notifications.show({ message: 'Backup started', color: 'blue' });
      refetch();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    }
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['runs', activeStore.id] });
    refetch();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{activeStore.name}</Title>
        <Group>
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={refresh}>Refresh</Button>
          {canRun && <Button color="coalgreen" leftSection={<IconPlayerPlay size={16} />} onClick={runBackup} disabled={activeStore.busy}>
            {activeStore.busy ? 'Backup running…' : 'Run backup now'}
          </Button>}
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: DRIVE_ENABLED ? 4 : 3 }}>
        <InfoCard label="Store domain" value={activeStore.domain} />
        <InfoCard label="API version" value={activeStore.apiVersion} />
        <InfoCard label="Schedule" value={activeStore.schedule.enabled ? activeStore.schedule.cron : 'Disabled'} badge={activeStore.schedule.enabled ? 'green' : 'gray'} />
        {DRIVE_ENABLED && (
          <InfoCard label="Google Drive" value={activeStore.drive.folderName || (activeStore.drive.folderId ? 'Folder set' : 'Not configured')} badge={activeStore.drive.folderId ? 'green' : 'gray'} />
        )}
      </SimpleGrid>

      <LiveProgress storeId={activeStore.id} onDone={refresh} />

      <Card withBorder>
        <Title order={5} mb="sm">Recent runs</Title>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Type</Table.Th><Table.Th>Status</Table.Th><Table.Th>Trigger</Table.Th><Table.Th>Started</Table.Th><Table.Th>Finished</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(runs.data ?? []).map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td tt="capitalize">{r.type}</Table.Td>
                <Table.Td><Badge color={r.status === 'completed' ? 'green' : r.status === 'failed' ? 'red' : 'blue'} variant="light">{r.status}</Badge></Table.Td>
                <Table.Td>{r.trigger}</Table.Td>
                <Table.Td>{new Date(r.startedAt).toLocaleString()}</Table.Td>
                <Table.Td>{r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '—'}</Table.Td>
              </Table.Tr>
            ))}
            {!runs.data?.length && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed">No runs yet.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}

function InfoCard({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <Card withBorder>
      <Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
      {badge ? <Badge color={badge} variant="light" mt={4}>{value}</Badge> : <Text fw={600} mt={4} truncate>{value}</Text>}
    </Card>
  );
}
