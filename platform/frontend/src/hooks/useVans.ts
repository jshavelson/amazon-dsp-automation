import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vanApi } from '@/services/api';
import { Van, VanFilterParams, CreateVanRequest, UpdateVanRequest, MaintenanceRecord } from '@/types/van';
import { PaginatedResponse, PaginationParams } from '@/types/common';

// Query keys
const VAN_KEYS = {
  all: ['vans'],
  list: (params?: VanFilterParams & PaginationParams) => ['vans', 'list', params],
  detail: (id: string) => ['vans', 'detail', id],
  maintenance: (vanId: string) => ['vans', 'maintenance', vanId],
  fuelLogs: (vanId: string, params?: PaginationParams) => ['vans', 'fuel-logs', vanId, params],
  location: (vanId: string) => ['vans', 'location', vanId],
  costs: (vanId: string, period?: string) => ['vans', 'costs', vanId, period],
};

// Hook to get all vans with pagination and filtering
export const useVans = (params?: VanFilterParams & PaginationParams) => {
  return useQuery<PaginatedResponse<Van>>({
    queryKey: VAN_KEYS.list(params),
    queryFn: () => vanApi.getAll(params),
    staleTime: 2 * 60 * 1000,
  });
};

// Hook to get a single van by ID
export const useVan = (id: string, enabled: boolean = true) => {
  return useQuery<Van>({
    queryKey: VAN_KEYS.detail(id),
    queryFn: () => vanApi.getById(id),
    enabled: enabled && !!id,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get van maintenance records
export const useVanMaintenance = (vanId: string) => {
  return useQuery<MaintenanceRecord[]>({
    queryKey: VAN_KEYS.maintenance(vanId),
    queryFn: () => vanApi.getMaintenance(vanId),
    enabled: !!vanId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get van fuel logs
export const useVanFuelLogs = (vanId: string, params?: PaginationParams) => {
  return useQuery<PaginatedResponse<unknown>>({
    queryKey: VAN_KEYS.fuelLogs(vanId, params),
    queryFn: () => vanApi.getFuelLogs(vanId, params),
    enabled: !!vanId,
    staleTime: 2 * 60 * 1000,
  });
};

// Hook to get van location
export const useVanLocation = (vanId: string, pollInterval?: number) => {
  return useQuery({
    queryKey: VAN_KEYS.location(vanId),
    queryFn: () => vanApi.getLocation(vanId),
    enabled: !!vanId,
    refetchInterval: pollInterval || 30000, // 30 seconds
    staleTime: 0, // Always refetch
  });
};

// Hook to get van cost analysis
export const useVanCosts = (vanId: string, period?: string) => {
  return useQuery({
    queryKey: VAN_KEYS.costs(vanId, period),
    queryFn: () => vanApi.getCostAnalysis(vanId, period),
    enabled: !!vanId,
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to create a van
export const useCreateVan = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateVanRequest) => vanApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VAN_KEYS.all });
    },
    onError: (error) => {
      console.error('Create van failed:', error);
    },
  });
};

// Hook to update a van
export const useUpdateVan = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateVanRequest) => vanApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: VAN_KEYS.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: VAN_KEYS.all });
    },
    onError: (error) => {
      console.error('Update van failed:', error);
    },
  });
};

// Hook to delete a van
export const useDeleteVan = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => vanApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VAN_KEYS.all });
    },
    onError: (error) => {
      console.error('Delete van failed:', error);
    },
  });
};

// Hook to create maintenance record
export const useCreateMaintenance = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ vanId, ...data }: { vanId: string; [key: string]: unknown }) => 
      vanApi.createMaintenance(vanId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: VAN_KEYS.maintenance(variables.vanId) });
    },
    onError: (error) => {
      console.error('Create maintenance failed:', error);
    },
  });
};

// Hook to create fuel log
export const useCreateFuelLog = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ vanId, ...data }: { vanId: string; [key: string]: unknown }) => 
      vanApi.createFuelLog(vanId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: VAN_KEYS.fuelLogs(variables.vanId) });
    },
    onError: (error) => {
      console.error('Create fuel log failed:', error);
    },
  });
};
