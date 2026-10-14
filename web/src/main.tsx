import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { App } from './App';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

// Coalition Snapback brand palette — Coalition blue (primary) + lime-green accent.
const coalition: MantineColorsTuple = [
  '#e8f2fb', '#d0e3f5', '#a3c6ea', '#72a7df', '#4b8dd6',
  '#317ed1', '#1c6fb8', '#155a97', '#0f4676', '#0a3357',
];
const coalgreen: MantineColorsTuple = [
  '#f4fae7', '#e9f4ce', '#d4eaa0', '#bfe071', '#acd749',
  '#a0d132', '#93c02a', '#7fa622', '#688619', '#4f6810',
];
const theme = createTheme({
  primaryColor: 'coalition',
  colors: { coalition, coalgreen },
  autoContrast: true,
  luminanceThreshold: 0.45,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
