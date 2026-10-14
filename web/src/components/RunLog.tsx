import { useEffect, useMemo, useState } from 'react';
import { Paper, Stack, Group, Badge, Text, ScrollArea, Progress, Loader, Button, Select } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { api, useEventStream, type AppEvent } from '../api';

interface LogRow { ts: string; level: string; phase?: string | null; message: string; }
const LEVEL_COLOR: Record<string, string> = { info: 'blue', warn: 'orange', error: 'red', debug: 'gray' };

interface Prog { label: string; percent: number; determinate: boolean; step: number; totalSteps: number; status: string; }

/** Live + historical logs for a single run (backup or restore), keyed by runId. */
export function RunLog({ runId, storeId, height = 320 }: { runId: string; storeId?: string; height?: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [prog, setProg] = useState<Prog | null>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    setProg(null);
    api<any[]>(`/api/logs?runId=${encodeURIComponent(runId)}&limit=2000`)
      .then((data) => { if (!cancelled) setRows(data.reverse().map((r) => ({ ts: r.ts, level: r.level, phase: r.phase, message: r.message }))); })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  useEventStream((ev: AppEvent) => {
    if (!('runId' in ev) || ev.runId !== runId) return;
    if (ev.kind === 'log') {
      setRows((r) => [...r, { ts: ev.ts, level: ev.level, phase: ev.phase, message: ev.message }]);
    } else if (ev.kind === 'progress') {
      setProg({ label: ev.label, percent: ev.percent ?? 0, determinate: ev.determinate, step: ev.step, totalSteps: ev.totalSteps, status: 'running' });
    } else if (ev.kind === 'run') {
      setProg((p) => (ev.status === 'running'
        ? (p ?? { label: 'Starting…', percent: 0, determinate: false, step: 0, totalSteps: 1, status: 'running' })
        : { ...(p ?? { label: '', percent: 0, determinate: true, step: 1, totalSteps: 1 }), status: ev.status, label: ev.status === 'completed' ? 'Completed' : `Failed: ${ev.error ?? ''}` }));
    }
  }, storeId);

  const filtered = useMemo(() => (level ? rows.filter((r) => r.level === level) : rows), [rows, level]);

  const download = () => {
    const text = filtered.map((r) => `${r.ts} ${r.level.toUpperCase()} ${r.phase ? `(${r.phase}) ` : ''}${r.message}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `run_${runId}.log.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const progColor = prog?.status === 'failed' ? 'red' : prog?.status === 'completed' ? 'green' : 'coalition';

  return (
    <Stack gap="xs">
      {prog && (
        <Paper withBorder p="xs" radius="md">
          <Group justify="space-between" mb={6}>
            <Group gap="xs">
              {prog.status === 'running' && <Loader size="xs" />}
              <Text size="sm" fw={600}>{prog.label}</Text>
            </Group>
            <Badge color={progColor} variant="light">{prog.status === 'running' ? `Step ${prog.step}/${prog.totalSteps}` : prog.status}</Badge>
          </Group>
          <Progress
            value={prog.determinate ? prog.percent : prog.status === 'completed' ? 100 : (prog.step / Math.max(1, prog.totalSteps)) * 100}
            animated={prog.status === 'running' && !prog.determinate}
            striped={prog.status === 'running'}
            color={progColor}
          />
        </Paper>
      )}

      <Group justify="space-between">
        <Text size="xs" c="dimmed">{loading ? 'Loading logs…' : `${filtered.length} log line(s)`}</Text>
        <Group gap="xs">
          <Select size="xs" w={120} placeholder="All levels" clearable data={['info', 'warn', 'error', 'debug']} value={level || null} onChange={(v) => setLevel(v ?? '')} />
          <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} onClick={download} disabled={!filtered.length}>Download</Button>
        </Group>
      </Group>

      <Paper withBorder p={0} radius="md">
        <ScrollArea h={height}>
          <Stack gap={0} p="xs">
            {loading && <Group p="sm"><Loader size="xs" /><Text size="sm" c="dimmed">Loading…</Text></Group>}
            {!loading && !filtered.length && <Text c="dimmed" p="sm" size="sm">No logs for this run.</Text>}
            {filtered.map((r, i) => (
              <Group key={i} gap="xs" wrap="nowrap" align="flex-start" style={{ fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12, padding: '2px 4px' }}>
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{new Date(r.ts).toLocaleTimeString()}</Text>
                <Badge size="xs" color={LEVEL_COLOR[r.level] ?? 'gray'} variant="light">{r.level}</Badge>
                {r.phase && <Badge size="xs" variant="outline" color="gray">{r.phase}</Badge>}
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.message}</Text>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
