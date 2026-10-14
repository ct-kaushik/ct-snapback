import { AppShell, Burger, Group, NavLink, Select, Text, Badge, Loader, Center, Button, Stack, useComputedColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterLink, Route, Routes, useLocation, useNavigate, Navigate } from 'react-router-dom';
import {
  IconDashboard, IconDatabaseExport, IconRestore, IconCalendarClock, IconPlugConnected,
  IconBrandGoogleDrive, IconFileText, IconUsers, IconLogout, IconMailCog,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession, StoreProvider, useStores } from './context';
import { DRIVE_ENABLED } from './features';
import { AuthScreen } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Connections } from './pages/Connections';
import { Backups } from './pages/Backups';
import { RestoreWizard } from './pages/RestoreWizard';
import { Schedule } from './pages/Schedule';
import { Drive } from './pages/Drive';
import { Logs } from './pages/Logs';
import { Users } from './pages/Users';
import { SettingsSmtp } from './pages/SettingsSmtp';
import { AcceptInvite, ResetPassword, ForgotPassword } from './pages/PublicAuth';

export function App() {
  const { data: session, isLoading } = useSession();

  // Public, token-based pages must render even when signed out.
  const path = window.location.pathname;
  if (path === '/invite/accept') return <AcceptInvite />;
  if (path === '/reset') return <ResetPassword />;
  if (path === '/forgot') return <ForgotPassword />;

  if (isLoading) return <Center h="100vh"><Loader /></Center>;
  if (!session) return <Center h="100vh"><Text c="red">Cannot reach the server.</Text></Center>;
  if (session.setupRequired) return <AuthScreen mode="setup" />;
  if (!session.user) return <AuthScreen mode="login" />;

  return (
    <StoreProvider>
      <Shell role={session.user.role} email={session.user.email} />
    </StoreProvider>
  );
}

function Shell({ role, email }: { role: string; email: string }) {
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { stores, activeStoreId, setActiveStoreId } = useStores();
  const scheme = useComputedColorScheme('light');
  const logoDark = scheme === 'dark';

  const logout = async () => {
    await api('/api/logout', { method: 'POST' });
    qc.clear();
    window.location.href = '/';
  };

  const links = [
    { to: '/', label: 'Dashboard', icon: IconDashboard },
    { to: '/backups', label: 'Backups', icon: IconDatabaseExport },
    { to: '/restore', label: 'Restore', icon: IconRestore, min: 'operator' },
    { to: '/schedule', label: 'Schedule', icon: IconCalendarClock },
    { to: '/connections', label: 'Connections', icon: IconPlugConnected, min: 'admin' },
    ...(DRIVE_ENABLED ? [{ to: '/drive', label: 'Google Drive', icon: IconBrandGoogleDrive, min: 'admin' }] : []),
    { to: '/logs', label: 'Logs', icon: IconFileText },
    { to: '/users', label: 'Users', icon: IconUsers, min: 'admin' },
    { to: '/settings/smtp', label: 'Email (SMTP)', icon: IconMailCog, min: 'admin' },
  ];
  const rank: Record<string, number> = { viewer: 1, operator: 2, admin: 3 };
  const visible = links.filter((l) => !l.min || rank[role] >= rank[l.min]);

  return (
    <AppShell
      header={{ height: 140 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
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
              <img src="/logo.png" alt="Coalition Snapback" style={{ display: 'block', width: 300, height: 'auto' }} />
            </span>
          </Group>
          <Group>
            <Select
              size="xs"
              w={230}
              placeholder={stores.length ? 'Select store' : 'No stores yet'}
              data={stores.map((s) => ({ value: s.id, label: s.name }))}
              value={activeStoreId}
              onChange={(v) => v && setActiveStoreId(v)}
              disabled={!stores.length}
              searchable
            />
            <Badge variant="light" color="gray" tt="none">{email} · {role}</Badge>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack justify="space-between" h="100%">
          <div>
            {visible.map((l) => (
              <NavLink
                key={l.to}
                component={RouterLink}
                to={l.to}
                label={l.label}
                leftSection={<l.icon size={18} />}
                active={location.pathname === l.to}
                onClick={() => opened && toggle()}
              />
            ))}
          </div>
          <Button variant="subtle" color="gray" leftSection={<IconLogout size={18} />} onClick={logout}>Sign out</Button>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/restore" element={<RestoreWizard />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/connections" element={<Connections />} />
          {DRIVE_ENABLED && <Route path="/drive" element={<Drive />} />}
          <Route path="/logs" element={<Logs />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings/smtp" element={<SettingsSmtp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
