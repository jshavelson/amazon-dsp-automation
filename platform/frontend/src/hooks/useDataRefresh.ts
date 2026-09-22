import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface DataRefreshResult {
  status: 'running' | 'completed' | 'failed';
  startedAt?: string | null;
  finishedAt?: string | null;
  sources?: { id: string; status: string; message: string }[];
}

const POLL_INTERVAL_MS = 750;
const MAX_POLLS = 240;

/**
 * Runs the current tenant's source refresh and then reloads every active query.
 * This is intentionally different from a plain query refetch: connector-backed
 * pages must first give the backend an opportunity to update their snapshots.
 */
export const useDataRefresh = () => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const refresh = useCallback(async (): Promise<DataRefreshResult> => {
    if (isRefreshing) return { status: 'running' };
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      let result = await api.post<DataRefreshResult>('/connections/refresh', {});
      let polls = 0;
      while (result.status === 'running' && polls < MAX_POLLS) {
        await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
        result = await api.get<DataRefreshResult>('/connections/refresh', { _refresh: Date.now() });
        polls += 1;
      }
      if (result.status === 'running') throw new Error('Data refresh timed out.');
      if (result.status === 'failed') throw new Error('One or more data sources could not be refreshed.');

      await queryClient.invalidateQueries({ refetchType: 'none' });
      await queryClient.refetchQueries({ type: 'active' });
      setLastRefreshedAt(new Date());
      return result;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('Data refresh failed.');
      setRefreshError(normalized);
      return { status: 'failed', sources: [] };
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, queryClient]);

  return { refresh, isRefreshing, refreshError, lastRefreshedAt };
};
