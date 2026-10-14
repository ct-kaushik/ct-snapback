import { useState } from 'react';
import { Card, Table, Text, Title, Stack, Badge, Group, Button, ActionIcon, Tooltip, Modal, Anchor } from '@mantine/core';
import { IconDownload, IconTrash, IconListDetails, IconRestore, IconFileText } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, fmtBytes, type Backup } from '../api';
import { useSession, useStores } from '../context';
import { DRIVE_ENABLED } from '../features';
import { LiveProgress } from '../components/LiveProgress';
import { RunLog } from '../components/RunLog';

export function Backups() {
  const { data: session } = useSession();
  const { activeStore, refetch } = useStores();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = session?.user?.role === 'admin';
  const [detail, setDetail] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<Backup | null>(null);

  const backups = useQuery({
    queryKey: ['backups', activeStore?.id],
    queryFn: () => api<Backup[]>(`/api/stores/${activeStore!.id}/backups`),
    enabled: !!activeStore,
  });

  if (!activeStore) return <Text c="dimmed">Select a store first.</Text>;

  const reload = () => { qc.invalidateQueries({ queryKey: ['backups', activeStore.id] }); refetch(); };

  const del = async (id: string) => {
    if (!confirm('Delete this backup and its files permanently?')) return;
    await api(`/api/backups/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <Stack>
      <Title order={3}>Backups — {activeStore.name}</Title>
      <LiveProgress storeId={activeStore.id} onDone={reload} />

      <Card withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Created</Table.Th><Table.Th>Status</Table.Th><Table.Th>Products</Table.Th>
              <Table.Th>Collections</Table.Th><Table.Th>Metafields</Table.Th><Table.Th>Size</Table.Th>
              <Table.Th>Checksum</Table.Th>{DRIVE_ENABLED && <Table.Th>Drive</Table.Th>}<Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(backups.data ?? []).map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>{new Date(b.createdAt).toLocaleString()}</Table.Td>
                <Table.Td><Badge variant="light" color={b.status === 'completed' ? 'green' : b.status === 'failed' ? 'red' : 'blue'}>{b.status}</Badge></Table.Td>
                <Table.Td>{b.counts.products ?? 0}</Table.Td>
                <Table.Td>{b.counts.collections ?? 0}</Table.Td>
                <Table.Td>{b.counts.metafields ?? 0}</Table.Td>
                <Table.Td>{fmtBytes(b.sizeBytes)}</Table.Td>
                <Table.Td>{b.status === 'completed' ? <Badge variant="dot" color={b.checksumOk ? 'green' : 'red'}>{b.checksumOk ? 'OK' : 'bad'}</Badge> : '—'}</Table.Td>
                {DRIVE_ENABLED && <Table.Td><Badge variant="light" color={b.driveStatus === 'uploaded' ? 'green' : b.driveStatus === 'failed' ? 'red' : 'gray'}>{b.driveStatus}</Badge></Table.Td>}
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <Tooltip label="Details"><ActionIcon variant="subtle" onClick={() => setDetail(b.id)}><IconListDetails size={16} /></ActionIcon></Tooltip>
                    <Tooltip label={b.runId ? 'View logs' : 'No logs for this backup'}><ActionIcon variant="subtle" disabled={!b.runId} onClick={() => setLogsFor(b)}><IconFileText size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Download all (zip)"><ActionIcon variant="subtle" component="a" href={`/api/backups/${b.id}/download`}><IconDownload size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Restore from this backup"><ActionIcon variant="subtle" color="grape" onClick={() => navigate('/restore')}><IconRestore size={16} /></ActionIcon></Tooltip>
                    {isAdmin && <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => del(b.id)}><IconTrash size={16} /></ActionIcon></Tooltip>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {!backups.data?.length && <Table.Tr><Table.Td colSpan={DRIVE_ENABLED ? 9 : 8}><Text c="dimmed">No backups yet. Run one from the Dashboard.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Card>

      <BackupDetail id={detail} onClose={() => setDetail(null)} />

      <Modal opened={!!logsFor} onClose={() => setLogsFor(null)} title={`Backup logs — ${logsFor ? new Date(logsFor.createdAt).toLocaleString() : ''}`} centered size="xl">
        {logsFor?.runId && <RunLog runId={logsFor.runId} storeId={logsFor.storeId} height={420} />}
      </Modal>
    </Stack>
  );
}

function BackupDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const files = useQuery({
    queryKey: ['backup-files', id],
    queryFn: () => api<{ name: string; bytes: number }[]>(`/api/backups/${id}/files`),
    enabled: !!id,
  });
  const hasTheme = (files.data ?? []).some((f) => f.name.startsWith('theme_') && f.name.endsWith('.zip'));
  return (
    <Modal opened={!!id} onClose={onClose} title="Backup files" centered size="lg">
      {hasTheme && (
        <Text size="xs" c="dimmed" mb="sm">
          To restore the theme: download the <b>theme_*.zip</b> and upload it in Shopify admin → Online Store → Themes → Add theme → Upload zip (it lands unpublished).
        </Text>
      )}
      <Table>
        <Table.Thead><Table.Tr><Table.Th>File</Table.Th><Table.Th>Size</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(files.data ?? []).map((f) => (
            <Table.Tr key={f.name}>
              <Table.Td>{f.name}</Table.Td>
              <Table.Td>{fmtBytes(f.bytes)}</Table.Td>
              <Table.Td><Anchor href={`/api/backups/${id}/download/${encodeURIComponent(f.name)}`}>Download</Anchor></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Modal>
  );
}
