import {
  usePluginContext,
  useConnection,
  useNotifications,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import { createContext, createElement, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const PendingClusterOpens = createContext<Set<string> | undefined>(undefined);

/** Coalesces duplicate entry points within one explorer, never across pages or routers. */
export function ClusterActionProvider({ children }: { children?: ReactNode }) {
  const [pendingOpens] = useState(() => new Set<string>());
  return createElement(PendingClusterOpens.Provider, { value: pendingOpens }, children);
}

/** Connection actions navigate only; the mounted ready route owns recent history. */
export function useClusterAction(connectionId: string, isConnected: boolean) {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { notify } = useNotifications();
  const { startConnection, stopConnection } = useConnection({
    pluginID: meta.id,
    connectionID: connectionId,
    enabled: false,
  });
  const [connecting, setConnecting] = useState(false);
  const pending = useRef(false);
  const pendingOpens = useContext(PendingClusterOpens);
  const run = useCallback(
    async (open: boolean) => {
      if (pending.current || (open && pendingOpens?.has(connectionId))) return;
      pending.current = true;
      if (open) pendingOpens?.add(connectionId);
      setConnecting(true);
      try {
        if (!isConnected) {
          const status = await startConnection();
          if (status.status !== types.ConnectionStatusCode.ConnectionStatusConnected) {
            void notify({
              severity: 'warning',
              title: 'Failed to connect to cluster',
              details: status.details,
            });
            return;
          }
        }
        if (open) {
          navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
        }
      } catch {
        // Lifecycle failures already report structured details through useConnection.
      } finally {
        pending.current = false;
        if (open) pendingOpens?.delete(connectionId);
        setConnecting(false);
      }
    },
    [connectionId, isConnected, navigate, notify, startConnection, pendingOpens],
  );
  const handleClick = useCallback(() => run(true), [run]);
  const handleConnect = useCallback(() => run(false), [run]);
  const handleDisconnect = useCallback(async () => {
    try {
      await stopConnection();
    } catch {
      /* useConnection reports lifecycle failures. */
    }
  }, [stopConnection]);
  return { handleClick, handleConnect, handleDisconnect, connecting };
}
