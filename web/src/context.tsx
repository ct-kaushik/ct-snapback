import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionInfo, type Store } from './api';

export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: () => api<SessionInfo>('/api/session') });
}

interface StoreCtx {
  stores: Store[];
  activeStoreId: string | null;
  setActiveStoreId: (id: string) => void;
  activeStore: Store | null;
  isLoading: boolean;
  refetch: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: stores = [], isLoading } = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/api/stores') });
  const [activeStoreId, setActive] = useState<string | null>(() => localStorage.getItem('activeStoreId'));

  useEffect(() => {
    if (stores.length && (!activeStoreId || !stores.find((s) => s.id === activeStoreId))) {
      setActive(stores[0].id);
    }
  }, [stores, activeStoreId]);

  const value = useMemo<StoreCtx>(() => ({
    stores,
    activeStoreId,
    setActiveStoreId: (id) => { setActive(id); localStorage.setItem('activeStoreId', id); },
    activeStore: stores.find((s) => s.id === activeStoreId) ?? null,
    isLoading,
    refetch: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  }), [stores, activeStoreId, isLoading, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStores(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStores must be used within StoreProvider');
  return ctx;
}
