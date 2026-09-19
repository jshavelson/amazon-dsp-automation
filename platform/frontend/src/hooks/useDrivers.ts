import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@/services/api';
import { Driver, DriverFilterParams, CreateDriverRequest, UpdateDriverRequest } from '@/types/driver';
import { PaginatedResponse, PaginationParams } from '@/types/common';

// Query keys
const DRIVER_KEYS = {
  all: ['drivers'],
  list: (params?: DriverFilterParams & PaginationParams) => ['drivers', 'list', params],
  detail: (id: string) => ['drivers', 'detail', id],
  performance: (driverId: string, period?: string) => ['drivers', 'performance', driverId, period],
  stats: (driverId: string) => ['drivers', 'stats', driverId],
  availability: (driverId: string, date?: string) => ['drivers', 'availability', driverId, date],
  documents: (driverId: string) => ['drivers', 'documents', driverId],
};

// Hook to get all drivers with pagination and filtering
export const useDrivers = (params?: DriverFilterParams & PaginationParams) => {
  return useQuery<PaginatedResponse<Driver>>({
    queryKey: DRIVER_KEYS.list(params),
    queryFn: () => driverApi.getAll(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

// Hook to get a single driver by ID
export const useDriver = (id: string, enabled: boolean = true) => {
  return useQuery<Driver>({
    queryKey: DRIVER_KEYS.detail(id),
    queryFn: () => driverApi.getById(id),
    enabled: enabled && !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Hook to get driver performance
export const useDriverPerformance = (driverId: string, period?: string) => {
  return useQuery({
    queryKey: DRIVER_KEYS.performance(driverId, period),
    queryFn: () => driverApi.getPerformance(driverId, period),
    enabled: !!driverId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get driver stats
export const useDriverStats = (driverId: string) => {
  return useQuery({
    queryKey: DRIVER_KEYS.stats(driverId),
    queryFn: () => driverApi.getStats(driverId),
    enabled: !!driverId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
};

// Hook to get driver availability
export const useDriverAvailability = (driverId: string, date?: string) => {
  return useQuery({
    queryKey: DRIVER_KEYS.availability(driverId, date),
    queryFn: () => driverApi.getAvailability(driverId, date),
    enabled: !!driverId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
};

// Hook to get driver documents
export const useDriverDocuments = (driverId: string) => {
  return useQuery({
    queryKey: DRIVER_KEYS.documents(driverId),
    queryFn: () => driverApi.getDocuments(driverId),
    enabled: !!driverId,
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to create a driver
export const useCreateDriver = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateDriverRequest) => driverApi.create(data),
    onSuccess: () => {
      // Invalidate drivers list
      queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.all });
    },
    onError: (error) => {
      console.error('Create driver failed:', error);
    },
  });
};

// Hook to update a driver
export const useUpdateDriver = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateDriverRequest) => driverApi.update(id, data),
    onSuccess: (_, variables) => {
      // Invalidate driver detail and list
      queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.all });
    },
    onError: (error) => {
      console.error('Update driver failed:', error);
    },
  });
};

// Hook to delete a driver
export const useDeleteDriver = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => driverApi.delete(id),
    onSuccess: () => {
      // Invalidate drivers list
      queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.all });
    },
    onError: (error) => {
      console.error('Delete driver failed:', error);
    },
  });
};

// Hook to update driver availability
export const useUpdateDriverAvailability = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ driverId, ...data }: { driverId: string; [key: string]: unknown }) => 
      driverApi.updateAvailability(driverId, data),
    onSuccess: (_, variables) => {
      // Invalidate availability for this driver
      queryClient.invalidateQueries({ 
        queryKey: DRIVER_KEYS.availability(variables.driverId) 
      });
    },
    onError: (error) => {
      console.error('Update availability failed:', error);
    },
  });
};

// Hook to upload driver document
export const useUploadDriverDocument = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ driverId, file, documentType }: { 
      driverId: string; 
      file: File; 
      documentType: string 
    }) => driverApi.uploadDocument(driverId, file, documentType),
    onSuccess: (_, variables) => {
      // Invalidate documents for this driver
      queryClient.invalidateQueries({ 
        queryKey: DRIVER_KEYS.documents(variables.driverId) 
      });
    },
    onError: (error) => {
      console.error('Upload document failed:', error);
    },
  });
};

// Prefetch functions for better UX
export const prefetchDriver = async (queryClient: unknown, id: string) => {
  // Implementation would use queryClient.prefetchQuery
};

export const prefetchDrivers = async (queryClient: unknown, params?: DriverFilterParams & PaginationParams) => {
  // Implementation would use queryClient.prefetchQuery
};
