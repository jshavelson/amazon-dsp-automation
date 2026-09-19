import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vanService } from '@/services/vanService';
import { FleetCostsResponse, VanCostResponse, VanStatsResponse } from '@/types/van';

const QUERY_KEYS = {
  FLEET_COSTS: ['fleet-costs'],
  FLEET_COSTS_BY_VAN: (vanId: string) => ['fleet-costs', vanId],
  VAN_STATS: ['van-stats'],
};

export const useFleetCosts = (options?: {
  refetchInterval?: number;
  enabled?: boolean;
}) => {
  return useQuery<FleetCostsResponse>({
    queryKey: QUERY_KEYS.FLEET_COSTS,
    queryFn: () => vanService.getFleetCosts(),
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled !== false,
  });
};

export const useVanCosts = (vanId: string, options?: {
  startDate?: string;
  endDate?: string;
  refetchInterval?: number;
  enabled?: boolean;
}) => {
  return useQuery<VanCostResponse>({
    queryKey: QUERY_KEYS.FLEET_COSTS_BY_VAN(vanId),
    queryFn: () => vanService.getVanCosts(vanId, options?.startDate, options?.endDate),
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled !== false && !!vanId,
  });
};

export const useVanStats = (options?: {
  refetchInterval?: number;
  enabled?: boolean;
}) => {
  return useQuery<VanStatsResponse>({
    queryKey: QUERY_KEYS.VAN_STATS,
    queryFn: () => vanService.getVanStats(),
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled !== false,
  });
};

export const useInvalidateFleetCosts = () => {
  const queryClient = useQueryClient();
  
  return {
    invalidateFleetCosts: () => {
      return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FLEET_COSTS });
    },
    invalidateVanCosts: (vanId: string) => {
      return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FLEET_COSTS_BY_VAN(vanId) });
    },
    invalidateAll: () => {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FLEET_COSTS }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.VAN_STATS }),
      ]);
    },
  };
};

export default useFleetCosts;
