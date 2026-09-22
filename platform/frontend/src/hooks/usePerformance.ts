import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { performanceApi } from '@/services/api';
import { 
  DriverPerformanceScore, 
  TeamPerformance, 
  DSPPerformance,
  PerformanceDashboard,
  PerformanceAlert,
  PerformanceFilterParams,
  PerformanceComparison
} from '@/types/performance';
import { PaginatedResponse, PaginationParams } from '@/types/common';

// Query keys
const PERFORMANCE_KEYS = {
  all: ['performance'],
  driver: (driverId: string, period?: string) => ['performance', 'drivers', driverId, period],
  team: (teamId: string, period?: string) => ['performance', 'teams', teamId, period],
  dsp: (period?: string) => ['performance', 'dsp', period],
  dashboard: (period?: string) => ['performance', 'dashboard', period],
  metrics: (params?: PaginationParams) => ['performance', 'metrics', params],
  alerts: (params?: PerformanceFilterParams & PaginationParams) => ['performance', 'alerts', params],
  trends: (metricId: string, period?: string) => ['performance', 'metrics', metricId, 'trends', period],
  comparisons: (entityType: string, entityId: string, period?: string) => 
    ['performance', entityType, entityId, 'comparisons', period],
};

// Hook to get driver performance
export const useDriverPerformance = (driverId: string, period?: string) => {
  return useQuery<DriverPerformanceScore>({
    queryKey: PERFORMANCE_KEYS.driver(driverId, period),
    queryFn: () => performanceApi.getDriverPerformance(driverId, period),
    enabled: !!driverId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get team performance
export const useTeamPerformance = (teamId: string, period?: string) => {
  return useQuery<TeamPerformance>({
    queryKey: PERFORMANCE_KEYS.team(teamId, period),
    queryFn: () => performanceApi.getTeamPerformance(teamId, period),
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get DSP performance
export const useDSPPerformance = (period?: string) => {
  return useQuery<DSPPerformance>({
    queryKey: PERFORMANCE_KEYS.dsp(period),
    queryFn: () => performanceApi.getDSPPerformance(period),
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to get performance dashboard
export const usePerformanceDashboard = (period?: string) => {
  return useQuery<PerformanceDashboard>({
    queryKey: PERFORMANCE_KEYS.dashboard(period),
    queryFn: () => performanceApi.getDashboard(period),
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get performance metrics
export const usePerformanceMetrics = (params?: PaginationParams) => {
  return useQuery({
    queryKey: PERFORMANCE_KEYS.metrics(params),
    queryFn: () => performanceApi.getMetrics(params),
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to get performance alerts
export const usePerformanceAlerts = (params?: PerformanceFilterParams & PaginationParams) => {
  return useQuery<PaginatedResponse<PerformanceAlert>>({
    queryKey: PERFORMANCE_KEYS.alerts(params),
    queryFn: () => performanceApi.getAlerts(params),
    staleTime: 1 * 60 * 1000,
  });
};

// Hook to get metric trends
export const useMetricTrends = (metricId: string, period?: string) => {
  return useQuery({
    queryKey: PERFORMANCE_KEYS.trends(metricId, period),
    queryFn: () => performanceApi.getTrends(metricId, period),
    enabled: !!metricId,
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to get performance comparisons
export const usePerformanceComparisons = (entityType: string, entityId: string, period?: string) => {
  return useQuery<PerformanceComparison>({
    queryKey: PERFORMANCE_KEYS.comparisons(entityType, entityId, period),
    queryFn: () => performanceApi.getComparisons(entityType, entityId, period),
    enabled: !!entityType && !!entityId,
    staleTime: 10 * 60 * 1000,
  });
};
