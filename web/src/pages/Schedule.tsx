import { useEffect, useState } from 'react';
import {
  Card, Stack, Title, SegmentedControl, TextInput, Switch, Button, Text, Group, Code,
  Select, Divider, Badge, Paper,
} from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { api } from '../api';
import { useSession, useStores } from '../context';

type Freq = 'daily' | 'weekly' | 'monthly' | 'hourly';

interface Builder {
  freq: Freq;
  time: string;      // "HH:MM"
  weekday: string;   // cron day-of-week 0..6 (0 = Sunday)
  monthday: string;  // 1..28
  everyHours: string;
}

const DEFAULTS: Builder = { freq: 'weekly', time: '03:00', weekday: '1', monthday: '1', everyHours: '6' };

const WEEKDAYS = [
  { value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday' }, { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' }, { value: '5', label: 'Friday' }, { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
];
const HOURLY_OPTS = ['1', '2', '3', '4', '6', '8', '12'].map((h) => ({ value: h, label: `Every ${h} hour${h === '1' ? '' : 's'}` }));

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const MONTHDAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${ordinal(i + 1)}` }));

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

function buildCron(b: Builder): string {
  const [h, m] = b.time.split(':').map((x) => parseInt(x, 10) || 0);
  switch (b.freq) {
    case 'daily': return `${m} ${h} * * *`;
    case 'weekly': return `${m} ${h} * * ${b.weekday}`;
    case 'monthly': return `${m} ${h} ${b.monthday} * *`;
    case 'hourly': return `0 */${b.everyHours} * * *`;
  }
}

/** Try to read a cron string back into the friendly builder. Returns null if it's not a shape we build. */
function parseCron(cron: string): Builder | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [m, h, dom, mon, dow] = p;
  const num = (x: string) => /^\d+$/.test(x);
  const time = (hh: string, mm: string) => `${String(+hh).padStart(2, '0')}:${String(+mm).padStart(2, '0')}`;
  if (mon === '*') {
    if (dom === '*' && dow === '*' && num(m) && num(h)) return { ...DEFAULTS, freq: 'daily', time: time(h, m) };
    if (dom === '*' && num(dow) && num(m) && num(h) && +dow <= 6) return { ...DEFAULTS, freq: 'weekly', time: time(h, m), weekday: String(+dow) };
    if (dow === '*' && num(dom) && num(m) && num(h) && +dom >= 1 && +dom <= 28) return { ...DEFAULTS, freq: 'monthly', time: time(h, m), monthday: String(+dom) };
  }
  const hourly = h.match(/^\*\/(\d+)$/);
  if (hourly && m === '0' && dom === '*' && mon === '*' && dow === '*') return { ...DEFAULTS, freq: 'hourly', everyHours: hourly[1] };
  return null;
}

function describe(b: Builder): string {
  switch (b.freq) {
    case 'daily': return `Every day at ${fmtTime(b.time)}`;
    case 'weekly': return `Every ${WEEKDAYS.find((w) => w.value === b.weekday)?.label} at ${fmtTime(b.time)}`;
    case 'monthly': return `On the ${ordinal(+b.monthday)} of every month at ${fmtTime(b.time)}`;
    case 'hourly': return `Every ${b.everyHours} hour${b.everyHours === '1' ? '' : 's'}, on the hour`;
  }
}

function nextRuns(b: Builder, count = 3): Date[] {
  const out: Date[] = [];
  const now = new Date();
  if (b.freq === 'hourly') {
    const n = parseInt(b.everyHours, 10) || 1;
    const c = new Date(now); c.setMinutes(0, 0, 0);
    while (out.length < count) {
      c.setHours(c.getHours() + 1);
      if (c > now && c.getHours() % n === 0) out.push(new Date(c));
    }
    return out;
  }
  const [H, M] = b.time.split(':').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 400 && out.length < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, H, M, 0, 0);
    if (d <= now) continue;
    if (b.freq === 'daily') out.push(d);
    else if (b.freq === 'weekly' && d.getDay() === +b.weekday) out.push(d);
    else if (b.freq === 'monthly' && d.getDate() === +b.monthday) out.push(d);
  }
  return out;
}

const fmtWhen = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Schedule() {
  const { data: session } = useSession();
  const { activeStore, refetch } = useStores();
  const isAdmin = session?.user?.role === 'admin';

  const [enabled, setEnabled] = useState(false);
  const [builder, setBuilder] = useState<Builder>(DEFAULTS);
  const [advanced, setAdvanced] = useState(false);
  const [customCron, setCustomCron] = useState('0 3 * * 1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeStore) return;
    setEnabled(activeStore.schedule.enabled);
    const parsed = parseCron(activeStore.schedule.cron);
    if (parsed) { setBuilder(parsed); setAdvanced(false); }
    else { setAdvanced(true); setCustomCron(activeStore.schedule.cron); }
  }, [activeStore?.id, activeStore?.schedule.cron, activeStore?.schedule.enabled]);

  if (!activeStore) return <Text c="dimmed">Select a store first.</Text>;

  const set = (patch: Partial<Builder>) => setBuilder((b) => ({ ...b, ...patch }));
  const cron = advanced ? customCron.trim() : buildCron(builder);
  const runs = advanced ? [] : nextRuns(builder);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/stores/${activeStore.id}/schedule`, { method: 'PUT', body: { cron, enabled } });
      notifications.show({ message: 'Schedule saved', color: 'coalgreen' });
      refetch();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack maw={640}>
      <Title order={3}>Schedule — {activeStore.name}</Title>
      <Card withBorder>
        <Stack>
          <Switch label="Run backups automatically on a schedule" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} disabled={!isAdmin} />

          {!advanced && (
            <>
              <div>
                <Text size="sm" fw={500} mb={6}>How often?</Text>
                <SegmentedControl
                  fullWidth
                  disabled={!isAdmin}
                  value={builder.freq}
                  onChange={(v) => set({ freq: v as Freq })}
                  data={[
                    { value: 'hourly', label: 'Hourly' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                  ]}
                />
              </div>

              <Group grow align="flex-end">
                {builder.freq === 'weekly' && (
                  <Select label="On which day" data={WEEKDAYS} value={builder.weekday} onChange={(v) => v && set({ weekday: v })} disabled={!isAdmin} allowDeselect={false} />
                )}
                {builder.freq === 'monthly' && (
                  <Select label="Day of the month" data={MONTHDAYS} value={builder.monthday} onChange={(v) => v && set({ monthday: v })} disabled={!isAdmin} allowDeselect={false} searchable />
                )}
                {builder.freq === 'hourly' && (
                  <Select label="Interval" data={HOURLY_OPTS} value={builder.everyHours} onChange={(v) => v && set({ everyHours: v })} disabled={!isAdmin} allowDeselect={false} />
                )}
                {builder.freq !== 'hourly' && (
                  <TextInput label="At what time" type="time" value={builder.time} onChange={(e) => set({ time: e.currentTarget.value })} disabled={!isAdmin} />
                )}
              </Group>
            </>
          )}

          {advanced && (
            <TextInput
              label="Cron expression"
              description="Standard 5-field cron (minute hour day-of-month month day-of-week)."
              value={customCron}
              onChange={(e) => setCustomCron(e.currentTarget.value)}
              disabled={!isAdmin}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
          )}

          <Divider />

          <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-default-hover)">
            <Group gap="xs" mb={runs.length ? 8 : 0}>
              <IconClock size={16} />
              <Text size="sm" fw={600}>{advanced ? 'Custom schedule' : describe(builder)}</Text>
            </Group>
            {runs.length > 0 && (
              <Group gap={6}>
                <Text size="xs" c="dimmed">Next runs:</Text>
                {runs.map((d, i) => <Badge key={i} variant="light" color="coalition" size="sm">{fmtWhen(d)}</Badge>)}
              </Group>
            )}
            <Text size="xs" c="dimmed" mt={8}>Cron: <Code>{cron || '—'}</Code> · times use the server timezone.</Text>
          </Paper>

          <Group justify="space-between">
            <Button variant="subtle" size="xs" color="gray" onClick={() => setAdvanced((a) => !a)} disabled={!isAdmin}>
              {advanced ? '← Back to the simple picker' : 'Advanced: write a cron expression'}
            </Button>
            <Button onClick={save} loading={busy} disabled={!isAdmin || (advanced && !customCron.trim())}>Save schedule</Button>
          </Group>

          {!isAdmin && <Text size="sm" c="orange">Only administrators can change the schedule.</Text>}
        </Stack>
      </Card>
    </Stack>
  );
}
