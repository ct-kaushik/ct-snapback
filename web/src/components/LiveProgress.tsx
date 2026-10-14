import { useEffect, useState } from 'react';
import { Paper, Progress, Text, Group, Badge, Stack, Loader } from '@mantine/core';
import { useEventStream, type AppEvent } from '../api';

interface ProgressState {
  runId: string;
  runType: string;
  phase: string;
  step: number;
  totalSteps: number;
  label: string;
  determinate: boolean;
  percent: number;
  status: string;
}

/** Shows the live phase stepper + progress bar for the active store's running job. */
export function LiveProgress({ storeId, onDone }: { storeId: string; onDone?: () => void }) {
  const [state, setState] = useState<ProgressState | null>(null);

  useEffect(() => setState(null), [storeId]);

  useEventStream((ev: AppEvent) => {
    if (!('storeId' in ev) || ev.storeId !== storeId) return;
    if (ev.kind === 'run') {
      if (ev.status === 'running') {
        setState({ runId: ev.runId, runType: ev.runType, phase: 'Starting', step: 0, totalSteps: 1, label: 'Starting…', determinate: false, percent: 0, status: 'running' });
      } else {
        setState((s) => (s ? { ...s, status: ev.status, label: ev.status === 'completed' ? 'Completed' : `Failed: ${ev.error ?? ''}` } : s));
        onDone?.();
      }
    } else if (ev.kind === 'progress') {
      setState((s) => ({
        runId: ev.runId,
        runType: s?.runType ?? 'backup',
        phase: ev.phase,
        step: ev.step,
        totalSteps: ev.totalSteps,
        label: ev.label,
        determinate: ev.determinate,
        percent: ev.percent ?? 0,
        status: 'running',
      }));
    }
  }, storeId);

  if (!state) return null;

  const color = state.status === 'failed' ? 'red' : state.status === 'completed' ? 'green' : 'blue';

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between">
          <Group gap="xs">
            {state.status === 'running' && <Loader size="xs" />}
            <Text fw={600} tt="capitalize">{state.runType} · {state.phase}</Text>
          </Group>
          <Badge color={color} variant="light">
            {state.status === 'running' ? `Step ${state.step}/${state.totalSteps}` : state.status}
          </Badge>
        </Group>
        <Progress
          value={state.determinate ? state.percent : state.status === 'completed' ? 100 : (state.step / Math.max(1, state.totalSteps)) * 100}
          animated={state.status === 'running' && !state.determinate}
          striped={state.status === 'running'}
          color={color}
        />
        <Text size="sm" c="dimmed">{state.label}{state.determinate ? ` — ${state.percent}%` : ''}</Text>
      </Stack>
    </Paper>
  );
}
