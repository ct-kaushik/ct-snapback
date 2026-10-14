import { useState } from 'react';
import { Paper, TextInput, PasswordInput, Button, Text, Stack, Center, Alert, Anchor, useComputedColorScheme } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function AuthScreen({ mode }: { mode: 'login' | 'setup' }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logoDark = useComputedColorScheme('light') === 'dark';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'setup') await api('/api/setup', { method: 'POST', body: { email, name, password } });
      else await api('/api/login', { method: 'POST', body: { email, password } });
      await qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center h="100vh">
      <Paper withBorder p="xl" w={400} radius="md">
        <Stack>
          <div style={{ textAlign: 'center' }}>
            <span
              style={{
                display: 'inline-block',
                margin: '20px 0',
                lineHeight: 0,
                padding: logoDark ? '8px 14px' : 0,
                background: logoDark ? 'rgba(255,255,255,0.92)' : 'transparent',
                borderRadius: logoDark ? 12 : 0,
              }}
            >
              <img src="/logo.png" alt="Coalition Snapback" style={{ display: 'block', width: 300, maxWidth: '100%', height: 'auto' }} />
            </span>
            <Text c="dimmed" size="sm">
              {mode === 'setup' ? 'Create the first administrator account.' : 'Sign in to continue.'}
            </Text>
          </div>
          {error && <Alert color="red">{error}</Alert>}
          {mode === 'setup' && <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />}
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            description={mode === 'setup' ? 'At least 8 characters.' : undefined}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Button loading={busy} onClick={submit} disabled={!email || !password || (mode === 'setup' && !name)}>
            {mode === 'setup' ? 'Create account' : 'Sign in'}
          </Button>
          {mode === 'login' && (
            <Anchor href="/forgot" size="sm" ta="center" c="dimmed">Forgot your password?</Anchor>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
