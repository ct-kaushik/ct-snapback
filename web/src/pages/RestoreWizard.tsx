import { useState } from 'react';
import { Card, Select, Stack, Title, Checkbox, Group, Button, Switch, Text, Alert, Divider, SegmentedControl, FileInput } from '@mantine/core';
import { IconRestore, IconEye, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api, type Backup } from '../api';
import { useStores } from '../context';
import { RunLog } from '../components/RunLog';

export function RestoreWizard() {
  const { stores } = useStores();
  const qc = useQueryClient();
  const [sourceStore, setSourceStore] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sourceBackup, setSourceBackup] = useState<string | null>(null);
  const [targetStore, setTargetStore] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [conflictMode, setConflictMode] = useState<'overwrite' | 'skip'>('overwrite');
  const [res, setRes] = useState({ definitions: true, metaobjects: true, products: true, collections: true, metafields: true, inventory: true });
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const backups = useQuery({
    queryKey: ['backups', sourceStore],
    queryFn: () => api<Backup[]>(`/api/stores/${sourceStore}/backups`),
    enabled: !!sourceStore,
  });

  const completed = (backups.data ?? []).filter((b) => b.status === 'completed');

  const uploadZip = async () => {
    if (!sourceStore || !uploadFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const res = await fetch(`/api/stores/${sourceStore}/imports`, { method: 'POST', body: fd, credentials: 'include' });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      await qc.invalidateQueries({ queryKey: ['backups', sourceStore] });
      setSourceBackup(data.id);
      setUploadFile(null);
      notifications.show({ message: 'Backup uploaded — selected as the source', color: 'coalgreen' });
    } catch (e) {
      notifications.show({ title: 'Upload failed', message: (e as Error).message, color: 'red' });
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!sourceBackup || !targetStore) return;
    if (!dryRun && !confirm(`This will WRITE to "${stores.find((s) => s.id === targetStore)?.name}". Continue?`)) return;
    setRunning(true);
    try {
      const r = await api<{ runId: string }>('/api/restore', { method: 'POST', body: { sourceBackupId: sourceBackup, targetStoreId: targetStore, dryRun, conflictMode, resources: res } });
      setRunId(r.runId);
      notifications.show({ message: dryRun ? 'Dry-run started' : 'Restore started', color: 'blue' });
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Stack maw={720}>
      <Title order={3}>Restore / Import</Title>
      <Card withBorder>
        <Stack>
          <Select label="Source store" placeholder="Pick a store" data={stores.map((s) => ({ value: s.id, label: s.name }))} value={sourceStore} onChange={(v) => { setSourceStore(v); setSourceBackup(null); }} />
          <Select
            label="Source backup"
            placeholder={sourceStore ? 'Pick a backup' : 'Select a source store first'}
            data={completed.map((b) => ({ value: b.id, label: `${new Date(b.createdAt).toLocaleString()} — ${b.counts.products ?? 0} products` }))}
            value={sourceBackup}
            onChange={setSourceBackup}
            disabled={!sourceStore}
          />
          <Group align="flex-end" gap="xs">
            <FileInput
              flex={1}
              label="…or upload an (edited) backup .zip"
              description="Download a backup, edit the CSVs, re-zip, and upload to restore from it."
              placeholder="Choose a .zip file"
              accept=".zip,application/zip"
              value={uploadFile}
              onChange={setUploadFile}
              disabled={!sourceStore || uploading}
              leftSection={<IconUpload size={16} />}
            />
            <Button variant="light" onClick={uploadZip} loading={uploading} disabled={!sourceStore || !uploadFile}>Upload</Button>
          </Group>
          <Divider label="Target" />
          <Select label="Target store" placeholder="Pick a store" data={stores.map((s) => ({ value: s.id, label: `${s.name}${s.id === sourceStore ? ' (same store)' : ''}` }))} value={targetStore} onChange={setTargetStore} />

          <div>
            <Text size="sm" fw={500} mb={4}>Resources to restore</Text>
            <Group>
              <Checkbox label="Definitions" checked={res.definitions} onChange={(e) => setRes({ ...res, definitions: e.currentTarget.checked })} />
              <Checkbox label="Metaobjects" checked={res.metaobjects} onChange={(e) => setRes({ ...res, metaobjects: e.currentTarget.checked })} />
              <Checkbox label="Products" checked={res.products} onChange={(e) => setRes({ ...res, products: e.currentTarget.checked })} />
              <Checkbox label="Collections" checked={res.collections} onChange={(e) => setRes({ ...res, collections: e.currentTarget.checked })} />
              <Checkbox label="Metafields" checked={res.metafields} onChange={(e) => setRes({ ...res, metafields: e.currentTarget.checked })} />
              <Checkbox label="Inventory" checked={res.inventory} onChange={(e) => setRes({ ...res, inventory: e.currentTarget.checked })} />
            </Group>
          </div>

          <div>
            <Text size="sm" fw={500} mb={4}>If a product / collection already exists</Text>
            <SegmentedControl
              data={[{ label: 'Overwrite existing', value: 'overwrite' }, { label: 'Skip existing', value: 'skip' }]}
              value={conflictMode}
              onChange={(v) => setConflictMode(v as 'overwrite' | 'skip')}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {conflictMode === 'overwrite'
                ? 'Existing records (matched by handle) are updated in place; new ones are created.'
                : 'Existing records are left untouched; only new records are created.'}
            </Text>
          </div>

          <Switch label="Dry-run (preview only — no changes written)" checked={dryRun} onChange={(e) => setDryRun(e.currentTarget.checked)} />

          {!dryRun && <Alert color="orange" variant="light">Restore uses replace-all semantics per product. A write-scoped token is required on the target store. Review the dry-run first.</Alert>}
          {targetStore && sourceStore && targetStore !== sourceStore && <Alert color="blue" variant="light">Cross-store restore: reference metafields are remapped by handle/SKU; unresolved references are logged.</Alert>}

          <Button
            leftSection={dryRun ? <IconEye size={16} /> : <IconRestore size={16} />}
            color={dryRun ? 'blue' : 'orange'}
            disabled={!sourceBackup || !targetStore || running}
            onClick={submit}
          >
            {dryRun ? 'Run dry-run preview' : 'Run restore'}
          </Button>
        </Stack>
      </Card>

      {runId && targetStore && (
        <Card withBorder>
          <Title order={5} mb="sm">Live log — this {dryRun ? 'dry-run' : 'restore'}</Title>
          <RunLog runId={runId} storeId={targetStore} height={360} />
        </Card>
      )}
    </Stack>
  );
}
