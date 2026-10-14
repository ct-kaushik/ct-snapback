import { useState, type ReactNode } from 'react';
import { Paper, PasswordInput, TextInput, Button, Text, Stack, Center, Alert } from '@mantine/core';
import { api } from '../api';

function Shell({ children }: { children: ReactNode }) {
  return (
    <Center h="100vh">
      <Paper withBorder p="xl" w={400} radius="md">
        <Stack>
          <img src="/logo.png" alt="Coalition Snapback" style={{ width: 240, maxWidth: '100%', height: 'auto', margin: '0 auto 4px' }} />
          {children}
        </Stack>
      </Paper>
    </Center>
  );
}

const tokenFromUrl = () => new URLSearchParams(window.location.search).get('token') ?? '';

/** Shared "set a password" screen for both invite-accept and password-reset. */
function SetPassword({ endpoint, intro, successMsg }: { endpoint: string; intro: string; successMsg: string }) {
  const token = tokenFromUrl();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError(null);
    try { await api(endpoint, { method: 'POST', body: { token, password } }); setDone(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Shell>
      {done ? (
        <>
          <Alert color="green">{successMsg}</Alert>
          <Button component="a" href="/">Go to sign in</Button>
        </>
      ) : !token ? (
        <Alert color="red">This link is missing its token. Please use the full link from your email.</Alert>
      ) : (
        <>
          <Text ta="center" c="dimmed" size="sm">{intro}</Text>
          {error && <Alert color="red">{error}</Alert>}
          <PasswordInput label="New password" description="At least 8 characters." value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <PasswordInput label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <Button loading={busy} onClick={submit} disabled={password.length < 8}>Set password</Button>
        </>
      )}
    </Shell>
  );
}

export function AcceptInvite() {
  return <SetPassword endpoint="/api/invite/accept" intro="Welcome! Set a password to activate your account." successMsg="Your account is ready — you can now sign in." />;
}

export function ResetPassword() {
  return <SetPassword endpoint="/api/password/reset" intro="Choose a new password for your account." successMsg="Your password has been reset — you can now sign in." />;
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await api('/api/password/forgot', { method: 'POST', body: { email } }); }
    catch { /* generic — ignore */ }
    finally { setBusy(false); setSent(true); }
  };

  return (
    <Shell>
      {sent ? (
        <>
          <Alert color="blue">If an account exists for that email, we’ve sent a password-reset link. Check your inbox.</Alert>
          <Button component="a" href="/" variant="light">Back to sign in</Button>
        </>
      ) : (
        <>
          <Text ta="center" c="dimmed" size="sm">Enter your email and we’ll send a reset link.</Text>
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <Button loading={busy} onClick={submit} disabled={!email}>Send reset link</Button>
          <Button component="a" href="/" variant="subtle" color="gray" size="xs">Back to sign in</Button>
        </>
      )}
    </Shell>
  );
}
