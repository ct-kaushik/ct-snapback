import { useEffect, useState } from 'react';
import { Card, Stack, Title, Group, Select, Button, ScrollArea, Text, Badge, TextInput } from '@mantine/core';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import { api, useEventStream } from '../api';
import { useStores } from '../context';

interface LogRow { id?: number; ts: string; level: string; phase?: string | null; message: string; }

const LEVEL_COLOR: Record<string, string> = { info: 'blue', warn: 'orange', error: 'red', debug: 'gray' };

export function Logs() {
  const { activeStore } = useStores();
  const [level, setLevel] = useState<string>('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<LogRow[]>([]);

  const load = async () => {
    if (!activeStore) return;
    const params = new URLSearchParams({ storeId: activeStore.id, limit: '500' });
    if (level) params.set('level', level);
    const data = await api<LogRow[]>(`/api/logs?${params.toString()}`);
    setRows(data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeStore?.id, level]);

  useEventStream((ev) => {
    if (ev.kind !== 'log') return;
    if (!activeStore || ev.storeId !== activeStore.id) return;
    if (level && ev.level !== level) return;
    setRows((r) => [{ ts: ev.ts, level: ev.level, phase: ev.phase, message: ev.message }, ...r].slice(0, 1000));
  }, activeStore?.id);

  const filtered = rows.filter((r) => !search || r.message.toLowerCase().includes(search.toLowerCase()));

  const download = () => {
    const text = filtered.map((r) => `${r.ts} ${r.level.toUpperCase()} ${r.phase ? `(${r.phase}) ` : ''}${r.message}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `logs_${activeStore?.domain ?? 'store'}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!activeStore) return <Text c="dimmed">Select a store first.</Text>;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Logs — {activeStore.name}</Title>
        <Group>
          <TextInput placeholder="Search…" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Select w={130} placeholder="All levels" clearable data={['info', 'warn', 'error', 'debug']} value={level || null} onChange={(v) => setLevel(v ?? '')} />
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={load}>Refresh</Button>
          <Button variant="light" leftSection={<IconDownload size={16} />} onClick={download}>Download</Button>
        </Group>
      </Group>
      <Card withBorder p={0}>
        <ScrollArea h="calc(100vh - 190px)">
          <Stack gap={0} p="xs">
            {filtered.map((r, i) => (
              <Group key={i} gap="xs" wrap="nowrap" align="flex-start" style={{ fontFamily: 'monospace', fontSize: 12, padding: '2px 4px' }}>
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{new Date(r.ts).toLocaleTimeString()}</Text>
                <Badge size="xs" color={LEVEL_COLOR[r.level] ?? 'gray'} variant="light">{r.level}</Badge>
                {r.phase && <Badge size="xs" variant="outline" color="gray">{r.phase}</Badge>}
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.message}</Text>
              </Group>
            ))}
            {!filtered.length && <Text c="dimmed" p="md">No logs.</Text>}
          </Stack>
        </ScrollArea>
      </Card>
    </Stack>
  );
}
