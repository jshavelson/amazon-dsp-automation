import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import { 
  PayrollPeriod, 
  PayrollRecord, 
  PayrollSummary,
  PayrollFilterParams 
} from '@/types/payroll';
import { PaginatedResponse, PaginationParams } from '@/types/common';

// Query keys
const PAYROLL_KEYS = {
  all: ['payroll'],
  periods: ['payroll', 'periods'],
  periodList: (params?: PaginationParams) => ['payroll', 'periods', 'list', params],
  periodDetail: (id: string) => ['payroll', 'periods', 'detail', id],
  records: (periodId: string, params?: PayrollFilterParams & PaginationParams) => 
    ['payroll', 'periods', periodId, 'records', params],
  recordDetail: (periodId: string, recordId: string) => 
    ['payroll', 'periods', periodId, 'records', recordId],
  summary: (periodId: string) => ['payroll', 'periods', periodId, 'summary'],
  reports: (periodId: string) => ['payroll', 'periods', periodId, 'reports'],
};

// Hook to get all payroll periods
export const usePayrollPeriods = (params?: PaginationParams) => {
  return useQuery<PaginatedResponse<PayrollPeriod>>({
    queryKey: PAYROLL_KEYS.periodList(params),
    queryFn: () => payrollApi.getPeriods(params),
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get a single payroll period by ID
export const usePayrollPeriod = (id: string, enabled: boolean = true) => {
  return useQuery<PayrollPeriod>({
    queryKey: PAYROLL_KEYS.periodDetail(id),
    queryFn: () => payrollApi.getPeriodById(id),
    enabled: enabled && !!id,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get payroll records for a period
export const usePayrollRecords = (periodId: string, params?: PayrollFilterParams & PaginationParams) => {
  return useQuery<PaginatedResponse<PayrollRecord>>({
    queryKey: PAYROLL_KEYS.records(periodId, params),
    queryFn: () => payrollApi.getRecords(periodId, params),
    enabled: !!periodId,
    staleTime: 2 * 60 * 1000,
  });
};

// Hook to get a single payroll record
export const usePayrollRecord = (periodId: string, recordId: string) => {
  return useQuery<PayrollRecord>({
    queryKey: PAYROLL_KEYS.recordDetail(periodId, recordId),
    queryFn: () => payrollApi.getRecordById(periodId, recordId),
    enabled: !!periodId && !!recordId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get payroll summary for a period
export const usePayrollSummary = (periodId: string) => {
  return useQuery<PayrollSummary>({
    queryKey: PAYROLL_KEYS.summary(periodId),
    queryFn: () => payrollApi.getSummary(periodId),
    enabled: !!periodId,
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to get payroll reports
export const usePayrollReports = (periodId: string) => {
  return useQuery({
    queryKey: PAYROLL_KEYS.reports(periodId),
    queryFn: () => payrollApi.getReports(periodId),
    enabled: !!periodId,
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to create a payroll period
export const useCreatePayrollPeriod = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: unknown) => payrollApi.createPeriod(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYROLL_KEYS.periods });
    },
    onError: (error) => {
      console.error('Create payroll period failed:', error);
    },
  });
};

// Hook to process a payroll period
export const useProcessPayrollPeriod = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ periodId, force }: { periodId: string; force?: boolean }) => 
      payrollApi.processPeriod(periodId, force),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: PAYROLL_KEYS.periodDetail(variables.periodId) });
      queryClient.invalidateQueries({ queryKey: PAYROLL_KEYS.records(variables.periodId) });
      queryClient.invalidateQueries({ queryKey: PAYROLL_KEYS.summary(variables.periodId) });
    },
    onError: (error) => {
      console.error('Process payroll period failed:', error);
    },
  });
};

// Hook to create payroll adjustment
export const useCreatePayrollAdjustment = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ recordId, ...data }: { recordId: string; [key: string]: unknown }) => 
      payrollApi.createAdjustment(recordId, data),
    onSuccess: (_, variables) => {
      // Invalidate the specific record and period data
      queryClient.invalidateQueries({ 
        queryKey: PAYROLL_KEYS.recordDetail(variables.recordId.split('/')[0], variables.recordId) 
      });
      queryClient.invalidateQueries({ 
        queryKey: PAYROLL_KEYS.records(variables.recordId.split('/')[0]) 
      });
    },
    onError: (error) => {
      console.error('Create payroll adjustment failed:', error);
    },
  });
};

// Hook to generate payroll report
export const useGeneratePayrollReport = () => {
  return useMutation({
    mutationFn: ({ periodId, reportType }: { periodId: string; reportType: string }) => 
      payrollApi.generateReport(periodId, reportType),
    onSuccess: (_, variables) => {
      // Could invalidate reports query
    },
    onError: (error) => {
      console.error('Generate payroll report failed:', error);
    },
  });
};
