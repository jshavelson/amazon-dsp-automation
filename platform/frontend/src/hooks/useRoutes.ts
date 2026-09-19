import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { routeApi } from '@/services/api';
import { Route, RouteFilterParams, CreateRouteRequest } from '@/types/route';
import { PaginatedResponse, PaginationParams } from '@/types/common';

// Query keys
const ROUTE_KEYS = {
  all: ['routes'],
  list: (params?: RouteFilterParams & PaginationParams) => ['routes', 'list', params],
  detail: (id: string) => ['routes', 'detail', id],
  stops: (routeId: string) => ['routes', routeId, 'stops'],
  metrics: (routeId: string) => ['routes', routeId, 'metrics'],
  packages: (routeId: string) => ['routes', routeId, 'packages'],
  optimization: (routeId: string) => ['routes', routeId, 'optimization'],
};

// Hook to get all routes with pagination and filtering
export const useRoutes = (params?: RouteFilterParams & PaginationParams) => {
  return useQuery<PaginatedResponse<Route>>({
    queryKey: ROUTE_KEYS.list(params),
    queryFn: () => routeApi.getAll(params),
    staleTime: 1 * 60 * 1000,
  });
};

// Hook to get a single route by ID
export const useRoute = (id: string, enabled: boolean = true) => {
  return useQuery<Route>({
    queryKey: ROUTE_KEYS.detail(id),
    queryFn: () => routeApi.getById(id),
    enabled: enabled && !!id,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get route stops
export const useRouteStops = (routeId: string) => {
  return useQuery({
    queryKey: ROUTE_KEYS.stops(routeId),
    queryFn: () => routeApi.getStops(routeId),
    enabled: !!routeId,
    staleTime: 2 * 60 * 1000,
  });
};

// Hook to get route metrics
export const useRouteMetrics = (routeId: string) => {
  return useQuery({
    queryKey: ROUTE_KEYS.metrics(routeId),
    queryFn: () => routeApi.getMetrics(routeId),
    enabled: !!routeId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get route packages
export const useRoutePackages = (routeId: string) => {
  return useQuery({
    queryKey: ROUTE_KEYS.packages(routeId),
    queryFn: () => routeApi.getPackages(routeId),
    enabled: !!routeId,
    staleTime: 2 * 60 * 1000,
  });
};

// Hook to get route optimization
export const useRouteOptimization = (routeId: string) => {
  return useQuery({
    queryKey: ROUTE_KEYS.optimization(routeId),
    queryFn: () => routeApi.optimize(routeId),
    enabled: !!routeId,
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to create a route
export const useCreateRoute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateRouteRequest) => routeApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.all });
    },
    onError: (error) => {
      console.error('Create route failed:', error);
    },
  });
};

// Hook to update a route
export const useUpdateRoute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; [key: string]: unknown }) => 
      routeApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.all });
    },
    onError: (error) => {
      console.error('Update route failed:', error);
    },
  });
};

// Hook to delete a route
export const useDeleteRoute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => routeApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.all });
    },
    onError: (error) => {
      console.error('Delete route failed:', error);
    },
  });
};

// Hook to create a route stop
export const useCreateRouteStop = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ routeId, ...data }: { routeId: string; [key: string]: unknown }) => 
      routeApi.createStop(routeId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.stops(variables.routeId) });
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.detail(variables.routeId) });
    },
    onError: (error) => {
      console.error('Create route stop failed:', error);
    },
  });
};

// Hook to update a route stop
export const useUpdateRouteStop = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ routeId, stopId, ...data }: { 
      routeId: string; 
      stopId: string; 
      [key: string]: unknown 
    }) => routeApi.updateStop(routeId, stopId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.stops(variables.routeId) });
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.detail(variables.routeId) });
    },
    onError: (error) => {
      console.error('Update route stop failed:', error);
    },
  });
};

// Hook to delete a route stop
export const useDeleteRouteStop = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ routeId, stopId }: { routeId: string; stopId: string }) => 
      routeApi.deleteStop(routeId, stopId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.stops(variables.routeId) });
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.detail(variables.routeId) });
    },
    onError: (error) => {
      console.error('Delete route stop failed:', error);
    },
  });
};

// Hook to update package status
export const useUpdatePackageStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ routeId, packageId, status }: { 
      routeId: string; 
      packageId: string; 
      status: string 
    }) => routeApi.updatePackageStatus(routeId, packageId, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.packages(variables.routeId) });
      queryClient.invalidateQueries({ queryKey: ROUTE_KEYS.detail(variables.routeId) });
    },
    onError: (error) => {
      console.error('Update package status failed:', error);
    },
  });
};
